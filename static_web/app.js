const App = {
    data: {
        performances: []
    },

    init() {
        this.cacheDOM();
        this.bindEvents();
        this.loadAccount();
    },

    cacheDOM() {
        this.loader = document.getElementById('loader');
        this.viewPerformances = document.getElementById('view-performances');
        this.viewSummary = document.getElementById('view-summary');
        this.viewInstruments = document.getElementById('view-instruments');
        this.perfContainer = document.getElementById('performances-container');
        this.summaryContainer = document.getElementById('summary-container');
        this.summarySelect = document.getElementById('summary-perf-select');
        this.globalInstPool = document.getElementById('global-instruments-pool');
        this.modal = document.getElementById('crud-modal');
        this.form = document.getElementById('crud-form');
        this.navBtns = document.querySelectorAll('.nav-btn');
    },

    bindEvents() {
        this.navBtns.forEach(btn => {
            btn.addEventListener('click', (e) => {
                if (e.target.dataset.target) {
                    this.switchView(e.target.dataset.target);
                }
            });
        });

        this.summarySelect.addEventListener('change', (e) => this.renderSummary(e.target.value));

        this.setupAutocompleteEvents();
        this.initBuilder();
    },

    roles: { owner: '擁有者', admin: '管理員', editor: '編輯者', viewer: '唯讀成員' },

    async request(path, payload, band = this.bandId) {
        if (['/api/data', '/api/members', '/api/invitations', '/api/ownership'].includes(path)) {
            if (!band) throw new Error('請先選擇樂團空間');
            path += '?band=' + encodeURIComponent(band);
        }
        const response = await fetch(path, {
            credentials: 'same-origin',
            ...(payload === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
        });
        const data = await response.json();
        if (!response.ok) {
            if (response.status === 401 && !path.startsWith('/api/auth/')) this.clearAccount();
            const error = new Error(data.error || '操作失敗'); error.status = response.status; throw error;
        }
        return data;
    },

    clearData() {
        this.data = { performances: [], globalInstruments: [], globalPlayers: [] };
        this.revision = undefined;
        this.perfContainer.replaceChildren(); this.summaryContainer.replaceChildren();
        this.globalInstPool.replaceChildren(); this.summarySelect.replaceChildren();
        document.getElementById('band-members').replaceChildren();
        document.getElementById('band-invitations').replaceChildren();
        document.getElementById('invite-result').value = '';
        this.closeModal();
    },

    clearAccount() {
        this.user = null; this.bands = []; this.bandId = null; this.role = null; this.clearData();
        for (const id of ['workspace-bar','account-controls','logout-btn','backup-controls','band-members-panel']) document.getElementById(id).classList.add('hidden');
        document.getElementById('login-form').classList.remove('hidden');
        this.switchView('view-settings'); this.showLoader(false);
    },

    async loadAccount(preferred) {
        try {
            const account = await this.request('/api/me');
            this.user = account.user; this.bands = account.bands;
            document.getElementById('login-form').classList.add('hidden');
            for (const id of ['workspace-bar','account-controls','logout-btn']) document.getElementById(id).classList.remove('hidden');
            document.getElementById('account-label').textContent = this.user.display_name + ' (@' + this.user.username + ')';
            const select = document.getElementById('band-select'); select.replaceChildren();
            for (const band of this.bands) { const option = document.createElement('option'); option.value = band.id; option.textContent = band.name; select.append(option); }
            const saved = preferred || this.bandId || localStorage.getItem('percussion-band');
            const next = this.bands.find(band => band.id === saved)?.id || this.bands[0]?.id || null;
            await this.switchBand(next);
            if (!next) { this.switchView('view-settings'); document.getElementById('connection-status').textContent = '已登入。請建立樂團、接受邀請，或認領既有樂團。'; }
            return true;
        } catch (error) { this.clearAccount(); document.getElementById('connection-status').textContent = error.message; return false; }
    },

    async switchBand(id) {
        const select = document.getElementById('band-select'); select.disabled = true;
        try {
            await (this.pendingWrite || Promise.resolve());
            this.bandId = id || null; this.clearData();
            select.value = id || '';
            if (id) localStorage.setItem('percussion-band', id);
            const access = this.bands?.find(band => band.id === id);
            this.role = access?.role || null;
            document.getElementById('role-label').textContent = this.roles[this.role] || '尚未加入樂團';
            document.getElementById('backup-controls').classList.toggle('hidden', !id);
            document.getElementById('band-members-panel').classList.toggle('hidden', !id);
            const admin = ['owner','admin'].includes(this.role), edit = ['owner','admin','editor'].includes(this.role);
            document.getElementById('invite-form').classList.toggle('hidden', !admin);
            document.querySelector('#invite-role option[value="admin"]').disabled = this.role !== 'owner';
            document.getElementById('leave-band-btn').classList.toggle('hidden', !id || this.role === 'owner');
            document.querySelector('label[for="import-file"]').classList.toggle('hidden', !admin);
            document.getElementById('import-file').classList.toggle('hidden', !admin);
            document.querySelector('#view-performances .action-btn').classList.toggle('hidden', !edit);
            document.querySelector('#view-instruments .add-inst-row').classList.toggle('hidden', !edit);
            if (id) { await this.fetchData(); await this.loadMembers(); }
        } finally { select.disabled = false; this.showLoader(false); }
    },

    async login(event) {
        event.preventDefault();
        const mode = event.submitter?.value === 'register' ? 'register' : 'login';
        const controls = event.target.querySelectorAll('button'); controls.forEach(button => button.disabled = true);
        try {
            await this.request('/api/auth/' + mode, {
                username: document.getElementById('login-username').value,
                password: document.getElementById('login-password').value,
                display_name: document.getElementById('login-display').value
            });
            document.getElementById('login-password').value = '';
            await this.loadAccount();
            this.switchView(this.bandId ? 'view-performances' : 'view-settings');
        } catch (error) { document.getElementById('connection-status').textContent = error.message; }
        finally { controls.forEach(button => button.disabled = false); }
    },

    async logout() {
        try { await (this.pendingWrite || Promise.resolve()); await this.request('/api/auth/logout', {}); this.clearAccount(); document.getElementById('connection-status').textContent = '已登出'; }
        catch (error) { alert(error.message); }
    },

    async workspaceAction(event, path, payload) {
        event.preventDefault();
        const button = event.target.querySelector('button'); button.disabled = true;
        try { const result = await this.request(path,payload); event.target.reset(); await this.loadAccount(result.id); return result; }
        catch (error) { alert(error.message); }
        finally { button.disabled = false; }
    },
    createBand(event) { return this.workspaceAction(event,'/api/bands',{ name: document.getElementById('new-band-name').value }); },
    joinBand(event) { return this.workspaceAction(event,'/api/invitations/accept',{ code: document.getElementById('join-code').value.trim() }); },
    claimLegacy(event) { return this.workspaceAction(event,'/api/legacy/claim',{ key: document.getElementById('legacy-key').value }); },
    async changePassword(event) {
        event.preventDefault();
        try {
            await this.request('/api/auth/password',{ current_password: document.getElementById('current-password').value, new_password: document.getElementById('new-password').value });
            event.target.reset(); this.clearAccount(); document.getElementById('connection-status').textContent = '密碼已變更，全部裝置已登出，請使用新密碼登入。';
        } catch (error) { alert(error.message); }
    },
    async loadMembers() {
        const band = this.bandId;
        const data = await this.request('/api/members',undefined,band);
        if (this.bandId !== band) return;
        const container = document.getElementById('band-members'); container.replaceChildren();
        for (const member of data.members) {
            const row = document.createElement('div'); row.className = 'member-row';
            const label = document.createElement('span'); label.textContent = member.display_name + ' (@' + member.username + ') · ' + this.roles[member.role]; row.append(label);
            const manageable = member.id !== this.user.id && member.role !== 'owner' && (this.role === 'owner' || (this.role === 'admin' && member.role !== 'admin'));
            if (manageable) {
                const select = document.createElement('select'); select.setAttribute('aria-label', member.username + '角色');
                for (const role of ['viewer','editor','admin']) {
                    if (role === 'admin' && this.role !== 'owner') continue;
                    const option = document.createElement('option'); option.value = role; option.textContent = this.roles[role]; select.append(option);
                }
                select.value = member.role;
                select.onchange = () => this.memberAction({ user_id: member.id, role: select.value }); row.append(select);
                const remove = document.createElement('button'); remove.textContent = '移除'; remove.className = 'action-btn secondary mini';
                remove.onclick = () => { if (confirm('移除 ' + member.username + ' 的樂團權限？')) this.memberAction({ action: 'remove',user_id: member.id }); }; row.append(remove);
            }
            if (this.role === 'owner' && member.id !== this.user.id) {
                const transfer = document.createElement('button'); transfer.textContent = '轉移擁有權'; transfer.className = 'action-btn secondary mini';
                transfer.onclick = async () => { if (confirm('將樂團擁有權轉移給 ' + member.username + '？你會保留管理員權限。')) { try { await this.request('/api/ownership',{ user_id: member.id }); await this.loadAccount(); } catch (error) { alert(error.message); } } }; row.append(transfer);
            }
            container.append(row);
        }
        if (['owner','admin'].includes(this.role)) {
            const result = await this.request('/api/invitations',undefined,band);
            if (this.bandId !== band) return;
            const list = document.getElementById('band-invitations'); list.replaceChildren();
            for (const invite of result.invitations.filter(i => !i.used_at && !i.revoked_at && i.expires_at > Date.now()/1000)) {
                const row = document.createElement('div'); row.className = 'member-row';
                const label = document.createElement('span'); label.textContent = '待加入：@' + invite.username + ' · ' + this.roles[invite.role];
                const revoke = document.createElement('button'); revoke.textContent = '撤銷邀請'; revoke.className = 'action-btn secondary mini';
                revoke.onclick = async () => { try { await this.request('/api/invitations',{ action: 'revoke',id: invite.id }); await this.loadMembers(); } catch (error) { alert(error.message); } };
                row.append(label,revoke); list.append(row);
            }
        }
    },
    async memberAction(payload) { try { await this.request('/api/members',payload); await this.loadAccount(); } catch (error) { alert(error.message); await this.loadAccount(); } },
    async leaveBand() { if (confirm('確定離開目前樂團？再次加入需要新的邀請。')) await this.memberAction({ action: 'remove',user_id: this.user.id }); },
    async inviteMember(event) {
        event.preventDefault();
        const button = event.target.querySelector('button'); button.disabled = true;
        try {
            const result = await this.request('/api/invitations',{ username: document.getElementById('invite-username').value,role: document.getElementById('invite-role').value });
            document.getElementById('invite-result').value = result.code; await this.loadMembers();
        } catch (error) { alert(error.message); }
        finally { button.disabled = false; }
    },

    downloadJson(data, name) {
        const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
        const link = document.createElement('a');
        link.href = url; link.download = name; link.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    },

    async exportData() {
        try {
            const data = await this.request('/api/data');
            const today = new Date();
            const date = [today.getFullYear(), String(today.getMonth() + 1).padStart(2, '0'), String(today.getDate()).padStart(2, '0')].join('-');
            this.downloadJson(data, `percussion-backup-${date}.json`);
        } catch (error) { alert(error.message); }
    },

    async importData(input) {
        try {
            const file = input.files[0];
            if (!file) return;
            if (file.size > 2000000) throw new Error('匯入檔案不可超過 2 MB');
            const data = JSON.parse(await file.text());
            if (!data) throw new Error('備份格式錯誤');
            const records = Array.isArray(data) ? data : data.performances;
            if (!Array.isArray(records)) throw new Error('請選擇 JSON 備份或舊版資料檔');
            if (!confirm(`將匯入 ${records.length} 筆配置。此功能僅能在尚無演出配置的資料庫使用。確定匯入？`)) return;
            await this.postData({ action: 'import', data });
            await this.fetchData();
            alert('匯入完成！');
        } catch (error) { alert(error.message); }
        finally { input.value = ''; }
    },

    async exportSheet() {
        try {
            const url = document.getElementById('setting-sheet-url').value.trim();
            const id = url.match(/^https:\/\/docs\.google\.com\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/)?.[1];
            if (!id) throw new Error('請輸入有效的 Google 試算表網址');
            const response = await fetch('https://script.google.com/macros/s/AKfycbwj8dHYHbFzezG4ONcCuTjG8JyEIoIppk2vcHWfbXuzej1RREo73-uYNy50orZl3P0/exec?sheetId=' + encodeURIComponent(id));
            if (!response.ok) throw new Error('讀取舊資料失敗');
            const data = await response.json();
            if (data.error) throw new Error(data.error);
            this.downloadJson(data, 'google-sheet-backup.json');
            alert('舊資料備份已下載。請檢查檔案內容，再透過「匯入 JSON」搬移至資料庫。');
        } catch (error) { alert(error.message); }
    },

    setupAutocompleteEvents() {
        this.setupAutocomplete('input-perf', 'autocomplete-perf', () => this.getUniquePerformances());
        this.setupAutocomplete('input-title', 'autocomplete-title', () => this.getUniquePieces());

        // Close all autocompletes when clicking outside
        document.addEventListener('click', (e) => {
            if (!e.target.closest('.autocomplete')) {
                document.querySelectorAll('.autocomplete-items').forEach(el => el.classList.add('hidden'));
            }
        });
    },

    getUniquePerformances() {
        return [...new Set(this.data.performances.map(p => String(p.name)))]
            .filter(name => name && name !== '樂器標籤');
    },

    getUniquePieces() {
        const currentPerfName = document.getElementById('input-perf').value.trim();
        const piecesInCurrentPerf = new Set();
        const otherPieces = new Set();

        this.data.performances.forEach(perf => {
            if (perf.name === '樂器標籤') return; // Hide entirely
            perf.pieces.forEach(p => {
                if (!p.title) return;
                if (perf.name === currentPerfName) {
                    piecesInCurrentPerf.add(p.title);
                } else {
                    otherPieces.add(p.title);
                }
            });
        });

        // Remove duplicates from other pieces that are already in the current performance
        piecesInCurrentPerf.forEach(title => otherPieces.delete(title));

        const result = [];
        // Add current performance pieces first (prioritized)
        piecesInCurrentPerf.forEach(title => result.push({ title, inCurrent: true }));
        // Add the rest
        otherPieces.forEach(title => result.push({ title, inCurrent: false }));

        return result;
    },

    getUniqueParts() {
        const parts = [];
        this.data.performances.forEach(perf => {
            perf.pieces.forEach(piece => {
                piece.parts.forEach(p => {
                    if (p.name !== 'Pool') parts.push(p.name);
                });
            });
        });
        return [...new Set(parts)].filter(Boolean);
    },

    getUniqueInstruments() {
        const insts = [];
        if (this.data.globalInstruments) {
            insts.push(...this.data.globalInstruments);
        }

        this.data.performances.forEach(perf => {
            perf.pieces.forEach(piece => {
                piece.parts.forEach(part => {
                    // Legacy support: extract tags the user saved as parts in the fake performance
                    if (perf.name === '樂器標籤' && part.name !== 'Pool') {
                        insts.push(part.name);
                    }
                    part.instruments.forEach(i => insts.push(i.name));
                });
            });
        });
        return [...new Set(insts)].filter(Boolean);
    },

    getUniquePlayers() {
        const players = [];
        if (this.data.globalPlayers) {
            players.push(...this.data.globalPlayers);
        }

        this.data.performances.forEach(perf => {
            perf.pieces.forEach(piece => {
                piece.parts.forEach(part => {
                    part.instruments.forEach(i => {
                        if (i.player) {
                            i.player.split(',').forEach(p => {
                                if (p.trim()) players.push(p.trim());
                            });
                        }
                    });
                });
            });
        });
        return [...new Set(players)].filter(Boolean);
    },

    setupAutocomplete(inputId, listId, getOptionsCallback) {
        const input = document.getElementById(inputId);
        const listContainer = document.getElementById(listId);

        const renderList = (val) => {
            const rawOptions = getOptionsCallback();
            listContainer.innerHTML = '';

            // Normalize options to object format. Safely convert numbers to strings.
            const options = rawOptions.map(opt => {
                if (typeof opt === 'object' && opt !== null) return opt;
                return { title: String(opt), inCurrent: false };
            });

            // Filter options, or show all if val is empty
            const filtered = val
                ? options.filter(opt => opt.title.toLowerCase().includes(val.toLowerCase()))
                : options;

            if (filtered.length === 0) {
                listContainer.classList.add('hidden');
                return;
            }

            filtered.forEach(opt => {
                const item = document.createElement('div');
                item.className = 'autocomplete-item';

                if (opt.inCurrent) {
                    item.classList.add('highlight-current');
                }

                item.textContent = opt.title;

                if (opt.inCurrent) {
                    // Append a small badge
                    item.innerHTML += ' <span style="font-size:10px; padding:2px 6px; border-radius:4px; background:rgba(56, 189, 248, 0.2); border: 1px solid rgba(56, 189, 248, 0.4); float:right; margin-top:2px;">本場已有</span>';
                }

                item.addEventListener('click', () => {
                    input.value = opt.title;
                    listContainer.classList.add('hidden');
                    input.dispatchEvent(new Event('change')); // Trigger change for dependent logic
                });
                listContainer.appendChild(item);
            });
            listContainer.classList.remove('hidden');
        };

        input.addEventListener('focus', () => {
            document.querySelectorAll('.autocomplete-items').forEach(el => el.classList.add('hidden')); // close others
            renderList(input.value);
        });

        input.addEventListener('input', () => {
            renderList(input.value);
        });
    },

    switchView(targetId) {
        this.navBtns.forEach(btn => btn.classList.remove('active'));
        const targetBtn = document.querySelector(`[data-target="${targetId}"]`);
        if (targetBtn) targetBtn.classList.add('active');

        document.querySelectorAll('.view').forEach(view => view.classList.add('hidden'));
        document.getElementById(targetId).classList.remove('hidden');

        // If switching to summary, try to render first option if none selected
        if (targetId === 'view-summary' && !this.summarySelect.value && this.summarySelect.options.length > 1) {
            this.summarySelect.selectedIndex = 1;
            this.renderSummary(this.summarySelect.value);
        }
    },

    async fetchData() {
        if (!this.bandId) { this.showLoader(false); return false; }
        try {
            this.showLoader(true);
            const band = this.bandId;
            const data = await this.request('/api/data',undefined,band);
            if (band !== this.bandId) return false;
            this.revision = data.revision;
            this.processData(data);
            this.renderPerformances();
            const selected = this.summarySelect.value;
            this.populateSummarySelect();
            this.summarySelect.value = selected;
            this.renderSummary(this.summarySelect.value);
            this.renderGlobalInstruments();
            document.getElementById('connection-status').textContent = '已連線至 ' + (this.bands.find(b => b.id === this.bandId)?.name || '樂團') + ' · ' + this.roles[this.role];
            document.getElementById('login-form').classList.add('hidden');
            document.getElementById('logout-btn').classList.remove('hidden');
            if (!document.querySelector('.view:not(.hidden)')) this.switchView('view-performances');
            return true;
        } catch (error) {
            document.getElementById('connection-status').textContent = error.message;
            this.clearData();
            this.switchView('view-settings');
            return false;
        } finally { this.showLoader(false); }
    },

    processData(rawJson) {
        let rows = [];
        this.data.globalInstruments = [];
        this.data.globalPlayers = [];

        // Handle GAS format: { instruments: [], players: [], performances: [] }
        if (rawJson && !Array.isArray(rawJson) && rawJson.performances) {
            this.data.globalInstruments = rawJson.instruments || [];
            this.data.globalPlayers = rawJson.players || [];
            rows = rawJson.performances || [];
        } else if (Array.isArray(rawJson)) {
            rows = rawJson;
        }

        const perfMap = new Map();

        rows.forEach(row => {
            if (!row.performance_name && !row.title) return; // Skip entirely empty rows

            // Safely cast everything to strings since GAS might return numbers
            let perfName = row.performance_name;
            perfName = (perfName !== null && perfName !== undefined && String(perfName).trim() !== '')
                ? String(perfName).trim() : '未命名表演';

            let title = row.title;
            title = (title !== null && title !== undefined) ? String(title).trim() : '';
            if (!title) return; // Must have a title

            const pieceId = title;

            if (!perfMap.has(perfName)) {
                perfMap.set(perfName, { id: perfName, name: perfName, piecesMap: new Map() });
            }
            const perf = perfMap.get(perfName);

            if (!perf.piecesMap.has(pieceId)) {
                perf.piecesMap.set(pieceId, {
                    id: pieceId, title: title,
                    composer: row.composer != null ? String(row.composer).trim() : '',
                    arranger: row.arranger != null ? String(row.arranger).trim() : '',
                    partsMap: new Map()
                });
            }
            const piece = perf.piecesMap.get(pieceId);

            let partName = row.part_name;
            partName = (partName !== null && partName !== undefined) ? String(partName).trim() : '';
            if (!partName) return; // If no part, just the piece is registered

            if (!piece.partsMap.has(partName)) {
                piece.partsMap.set(partName, { name: partName, player: String(row.player_name || ''), instruments: [], rowIndexes: [] });
            }
            const part = piece.partsMap.get(partName);

            // Record the row index for this specific entry so we can delete/edit it later
            if (row._row) part.rowIndexes.push(row._row);

            if (row.instrument_name !== null && row.instrument_name !== undefined && String(row.instrument_name).trim() !== '') {
                part.instruments.push({
                    name: String(row.instrument_name).trim(),
                    player: row.player_name != null ? String(row.player_name).trim() : '',
                    remark: row.instrument_remark != null ? String(row.instrument_remark).trim() : '',
                    checked: Boolean(row.checked),
                    rowIndex: row._row
                });
            }
        });

        // Convert Maps to Arrays for easier rendering
        this.data.performances = Array.from(perfMap.values()).map(perf => ({
            ...perf,
            pieces: Array.from(perf.piecesMap.values()).map(piece => ({
                ...piece,
                parts: Array.from(piece.partsMap.values())
            }))
        }));
    },

    renderPerformances() {
        this.perfContainer.replaceChildren();
        for (const perf of this.data.performances) {
            if (perf.name === '樂器標籤') continue;
            const card = document.createElement('div'); card.className = 'perf-card';
            const heading = document.createElement('h3'); heading.textContent = perf.name; card.append(heading);
            const list = document.createElement('ul'); list.className = 'piece-list';
            for (const piece of perf.pieces) {
                const item = document.createElement('li'); item.className = 'piece-item';
                const summary = document.createElement('div'); summary.className = 'piece-summary';
                summary.tabIndex = 0; summary.setAttribute('role', 'button');
                summary.setAttribute('aria-expanded', 'false');
                const title = document.createElement('span'); title.className = 'piece-title'; title.textContent = piece.title;
                const meta = document.createElement('span'); meta.className = 'piece-meta';
                meta.textContent = [piece.composer && piece.composer + ' 曲', `${piece.parts.length} 個分部`].filter(Boolean).join(' • ');
                summary.append(title, meta);
                const wrapper = document.createElement('div'); wrapper.className = 'piece-detail-wrapper';
                const detail = document.createElement('div'); detail.className = 'piece-detail';
                const inner = document.createElement('div'); inner.className = 'piece-detail-inner';
                const parts = document.createElement('div'); parts.className = 'parts-grid';
                for (const part of piece.parts) {
                    const button = document.createElement('div'); button.className = 'part-card';
                    button.tabIndex = 0; button.setAttribute('role', 'button'); button.title = '點擊編輯此分部';
                    const name = document.createElement('div'); name.className = 'part-name'; name.textContent = part.name + ' ✏️';
                    const insts = document.createElement('div'); insts.className = 'part-insts';
                    insts.textContent = part.instruments.map(i => i.name + (i.remark ? ` (${i.remark})` : '')).join(', ') || '無設定樂器';
                    const player = document.createElement('div'); player.className = 'part-players'; player.textContent = part.player ? '🎵 ' + part.player : '';
                    const edit = () => this.editPart(perf.name, piece.id, part.name, part.rowIndexes);
                    button.onclick = edit;
                    button.onkeydown = event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); edit(); } };
                    button.append(name, insts, player); parts.append(button);
                }
                inner.append(parts); detail.append(inner); wrapper.append(detail);
                const toggle = () => { wrapper.classList.toggle('expanded'); summary.setAttribute('aria-expanded', String(wrapper.classList.contains('expanded'))); };
                summary.onclick = toggle;
                summary.onkeydown = event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); toggle(); } };
                item.append(summary, wrapper); list.append(item);
            }
            card.append(list); this.perfContainer.append(card);
        }
        if (!this.perfContainer.children.length) this.perfContainer.textContent = '目前沒有演出資料，點擊「新增曲目/分部」開始建立。';
    },

    populateSummarySelect() {
        this.summarySelect.innerHTML = '<option value="">請選擇演出...</option>';
        const perfs = [...this.data.performances].reverse();
        perfs.forEach(perf => {
            if (perf.name === '樂器標籤') return; // Hide from summary dropdown
            const opt = document.createElement('option');
            opt.value = perf.name;
            opt.textContent = perf.name;
            this.summarySelect.appendChild(opt);
        });
    },

    renderSummary(perfName) {
        this.summaryContainer.replaceChildren();
        const perf = this.data.performances.find(p => p.name === perfName);
        if (!perf) { this.summaryContainer.textContent = '請選擇一場演出以查看樂器總表。'; return; }
        const map = new Map();
        for (const piece of perf.pieces) {
            const counts = new Map();
            for (const part of piece.parts) for (const inst of part.instruments) {
                const name = inst.name.trim();
                if (!map.has(name)) map.set(name, { uses: 0, needed: 0, checked: true, rows: [] });
                const entry = map.get(name); entry.uses++; entry.rows.push(inst.rowIndex); entry.checked &&= inst.checked;
                counts.set(name, (counts.get(name) || 0) + 1);
            }
            // Different pieces play sequentially; use the largest per-piece demand.
            for (const [name, count] of counts) map.get(name).needed = Math.max(map.get(name).needed, count);
        }
        if (!map.size) { this.summaryContainer.textContent = '此演出尚未設定樂器。'; return; }
        const note = document.createElement('p'); note.className = 'summary-note';
        note.textContent = '建議備妥數量取各曲目需求的最大值；配置次數是整場演出的累計。共用與特殊配置仍請由場務確認。';
        const table = document.createElement('table'); table.className = 'summary-table';
        const header = table.createTHead().insertRow();
        for (const label of ['清點', '樂器名稱', '建議備妥', '配置次數']) { const th = document.createElement('th'); th.textContent = label; header.append(th); }
        const tbody = table.createTBody();
        for (const [name, data] of [...map].sort((a, b) => b[1].needed - a[1].needed)) {
            const row = tbody.insertRow();
            const check = document.createElement('input'); check.type = 'checkbox'; check.checked = data.checked;
            check.setAttribute('aria-label', name + '已清點');
            check.disabled = this.role === 'viewer';
            check.onchange = async () => {
                check.disabled = true;
                try {
                    await this.postData({ action: 'set_checked', performance_name: perfName, row_indexes: data.rows, checked: check.checked });
                    await this.fetchData(); this.switchView('view-summary');
                } catch (error) { check.checked = data.checked; alert(error.message); }
                finally { check.disabled = false; }
            };
            row.insertCell().append(check);
            for (const value of [name, data.needed, data.uses]) row.insertCell().textContent = value;
        }
        this.summaryContainer.append(note, table);
    },

    showLoader(show) {
        if (show) {
            this.loader.style.display = 'flex';
            this.viewPerformances.classList.add('hidden');
            this.viewSummary.classList.add('hidden');
        } else {
            this.loader.style.display = 'none';
        }
    },

    showModal(title = "新增樂器配置") {
        document.getElementById('modal-title').textContent = title;
        this.modal.classList.remove('hidden');
    },

    closeModal() {
        this.modal.classList.add('hidden');
    },

    showCreateModal() {
        if (!['owner','admin','editor'].includes(this.role)) return;
        this.showModal("樂譜配置建立器");
        this.resetBuilder();
    },

    togglePieceDetail(summaryElement) {
        const wrapper = summaryElement.nextElementSibling;
        if (wrapper && wrapper.classList.contains('piece-detail-wrapper')) {
            wrapper.classList.toggle('expanded');
        }
    },

    // --- Interactive Builder Logic ---
    initBuilder() {
        // Initialize Sortable for drag and drop
        const selectedZone = document.getElementById('selected-instruments');
        const poolZone = document.getElementById('available-instruments');

        this.selectedSortable = new Sortable(selectedZone, {
            group: 'shared',
            animation: 150,
            ghostClass: 'sortable-ghost',
        });

        this.poolSortable = new Sortable(poolZone, {
            group: { name: 'shared', pull: 'clone', put: false },
            animation: 150,
            sort: false,
            onEnd: (evt) => {
                if (evt.to === selectedZone) {
                    this.configureSelectedInstrumentTag(evt.item);
                }
            }
        });

        const selectedPlayerZone = document.getElementById('selected-players');
        const poolPlayerZone = document.getElementById('available-players');

        this.selectedPlayerSortable = new Sortable(selectedPlayerZone, {
            group: 'players',
            animation: 150,
            ghostClass: 'sortable-ghost',
        });

        this.poolPlayerSortable = new Sortable(poolPlayerZone, {
            group: { name: 'players', pull: 'clone', put: false },
            animation: 150,
            sort: false,
            onEnd: (evt) => {
                if (evt.to === selectedPlayerZone) {
                    evt.item.onclick = () => evt.item.remove();
                }
            }
        });
    },

    resetBuilder() {
        this.editingRowIndexes = null; // Clear edit mode
        this.originalPerformanceName = null;
        this.editingInstruments = [];
        document.getElementById('delete-part-btn').classList.add('hidden');
        document.getElementById('input-composer').value = '';
        document.getElementById('input-arranger').value = '';

        document.getElementById('input-perf').value = '';
        document.getElementById('input-title').value = '';
        document.getElementById('input-new-part').value = '';
        document.getElementById('input-new-inst').value = '';
        document.getElementById('input-new-player').value = '';
        document.getElementById('selected-instruments').innerHTML = '';
        document.getElementById('selected-players').innerHTML = '';

        // Render part chips and instrument pool based on current data
        this.renderBuilderOptions();

        // Setup change listeners to dynamically update options if needed
        document.getElementById('input-perf').onchange = () => this.renderBuilderOptions();
        document.getElementById('input-title').onchange = () => this.renderBuilderOptions();
    },

    editPart(perfName, pieceId, partName, rowIndexes) {
        if (!['owner','admin','editor'].includes(this.role)) return;
        this.showModal("編輯樂譜配置");
        this.resetBuilder(); // resets form and editingRowIndexes

        // Find the performance, piece, and part data
        const perf = this.data.performances.find(p => p.name === perfName);
        const piece = perf ? perf.pieces.find(p => p.id === pieceId) : null;
        const part = piece ? piece.parts.find(p => p.name === partName) : null;

        if (!part) return;

        // Set edit mode data
        this.editingRowIndexes = rowIndexes;
        this.originalPerformanceName = perfName;
        this.editingInstruments = part.instruments;
        document.getElementById('delete-part-btn').classList.remove('hidden');
        document.getElementById('input-composer').value = piece.composer;
        document.getElementById('input-arranger').value = piece.arranger;

        // Pre-fill the form
        document.getElementById('input-perf').value = perf.name;
        document.getElementById('input-title').value = piece.title;
        document.getElementById('input-new-part').value = part.name;

        this.renderBuilderOptions();

        // Pre-fill selected instruments
        const selectedZone = document.getElementById('selected-instruments');
        selectedZone.innerHTML = ''; // clear default empty
        part.instruments.forEach(inst => {
            if (inst.name) {
                const tag = this.createInstrumentTag(inst.name, selectedZone, false);
                tag.querySelector('input').value = inst.remark;
                tag.dataset.checked = String(inst.checked);
            }
        });

        // Pre-fill selected players
        const selectedPlayerZone = document.getElementById('selected-players');
        selectedPlayerZone.innerHTML = '';
        if (part.player) {
            part.player.split(',').forEach(p => {
                if (p.trim()) {
                    this.createPlayerTag(p.trim(), selectedPlayerZone, false);
                }
            });
        }
    },

    renderBuilderOptions() {
        // Parts Chips
        const parts = this.getUniqueParts();
        const chipsContainer = document.getElementById('part-chips');
        chipsContainer.innerHTML = '';
        parts.forEach(partName => {
            const chip = document.createElement('div');
            chip.className = 'chip';
            chip.textContent = partName;
            chip.onclick = () => {
                // Deselect others
                document.querySelectorAll('.chip').forEach(c => c.classList.remove('active'));
                chip.classList.add('active');
                document.getElementById('input-new-part').value = ''; // clear manual input
            };
            chipsContainer.appendChild(chip);
        });

        // Instruments Pool
        const iPool = document.getElementById('available-instruments');
        iPool.innerHTML = '';
        const allInsts = this.getUniqueInstruments();
        allInsts.forEach(name => {
            this.createInstrumentTag(name, iPool, true);
        });

        const pPool = document.getElementById('available-players');
        pPool.innerHTML = '';
        const allPlayers = this.getUniquePlayers();
        allPlayers.forEach(name => {
            this.createPlayerTag(name, pPool, true);
        });
    },

    createInstrumentTag(name, container, isPoolItem) {
        const tag = document.createElement('div');
        tag.className = 'inst-tag';
        tag.textContent = name;
        tag.dataset.name = name;

        if (isPoolItem) {
            // Support tap to add on mobile
            tag.onclick = () => {
                this.createInstrumentTag(name, document.getElementById('selected-instruments'), false);
            };
        } else {
            this.configureSelectedInstrumentTag(tag);
        }

        container.appendChild(tag);
        return tag;
    },

    configureSelectedInstrumentTag(tag) {
        tag.replaceChildren();
        tag.classList.add('selected-instrument');
        const name = document.createElement('span'); name.textContent = tag.dataset.name;
        const remark = document.createElement('input'); remark.type = 'text'; remark.maxLength = 1000;
        remark.placeholder = '備註（選填）'; remark.setAttribute('aria-label', tag.dataset.name + '備註');
        remark.onclick = event => event.stopPropagation();
        const remove = document.createElement('button'); remove.type = 'button'; remove.textContent = '×';
        remove.setAttribute('aria-label', '移除 ' + tag.dataset.name);
        remove.onclick = () => tag.remove();
        tag.onclick = null;
        tag.append(name, remark, remove);
    },

    createPlayerTag(name, container, isPoolItem) {
        const tag = document.createElement('div');
        tag.className = 'inst-tag player-tag'; // reuse inst-tag styles
        tag.textContent = name;
        tag.dataset.name = name;
        
        // Give player tags a slightly different tint
        tag.style.backgroundColor = 'var(--secondary)';
        tag.style.borderColor = 'var(--primary)';
        tag.style.color = 'var(--text-light)';

        if (isPoolItem) {
            // Support tap to add on mobile
            tag.onclick = () => {
                const target = document.getElementById('selected-players');
                const exists = Array.from(target.children).some(c => c.dataset.name === name);
                if (!exists) {
                    this.createPlayerTag(name, target, false);
                }
            };
        } else {
            // Already in selected zone
            tag.onclick = () => tag.remove();
        }

        container.appendChild(tag);
        return tag;
    },

    addNewInstrument() {
        const input = document.getElementById('input-new-inst');
        const name = input.value.trim();
        if (name) {
            this.createInstrumentTag(name, document.getElementById('selected-instruments'), false);
            input.value = '';
        }
    },
    
    addNewPlayer() {
        const input = document.getElementById('input-new-player');
        const name = input.value.trim();
        if (name) {
            this.createPlayerTag(name, document.getElementById('selected-players'), false);
            input.value = '';
        }
    },

    async submitBuilder() {
        const perfName = document.getElementById('input-perf').value.trim();
        const title = document.getElementById('input-title').value.trim();

        // Determine part name (active chip OR input)
        const activeChip = document.querySelector('.chip.active');
        const inputPart = document.getElementById('input-new-part').value.trim();
        const partName = inputPart || (activeChip ? activeChip.textContent : '');

        if (!perfName || !title || !partName) {
            alert('演出名稱、曲目名稱、分部 皆為必填！');
            return;
        }

        // Gather instruments from the selected zone
        const selectedZone = document.getElementById('selected-instruments');
        const instTags = selectedZone.querySelectorAll('.inst-tag');
        const instruments = Array.from(instTags).map(t => ({
            name: t.dataset.name,
            remark: t.querySelector('input')?.value.trim() || '',
            checked: t.dataset.checked === 'true'
        }));

        // Gather players from the selected zone
        const selectedPlayerZone = document.getElementById('selected-players');
        const playerTags = selectedPlayerZone.querySelectorAll('.inst-tag');
        const playersStr = Array.from(playerTags).map(t => t.dataset.name).join(', ');

        const submitBtn = document.querySelector('.builder-modal .action-btn.primary');
        const originalText = submitBtn.textContent;
        submitBtn.textContent = "儲存中...";
        submitBtn.disabled = true;

        try {
            const deleteRows = (this.editingRowIndexes && this.editingRowIndexes.length > 0) 
                ? [...this.editingRowIndexes] : [];
            
            const createRows = [];
            if (instruments.length === 0) {
                createRows.push({
                    title: title, part_name: partName,
                    instrument_name: '', player_name: playersStr, instrument_remark: ''
                });
            } else {
                for (const inst of instruments) {
                    createRows.push({
                        title: title, part_name: partName,
                        instrument_name: inst.name, player_name: playersStr,
                        instrument_remark: inst.remark,
                        checked: inst.checked
                    });
                }
            }

            for (const row of createRows) {
                row.composer = document.getElementById('input-composer').value.trim();
                row.arranger = document.getElementById('input-arranger').value.trim();
            }
            await this.postData({
                action: 'batch_save',
                performance_name: perfName,
                original_performance_name: this.originalPerformanceName || perfName,
                delete_rows: deleteRows,
                create_rows: createRows
            });

            this.closeModal();
        } catch (e) {
            alert('儲存失敗：' + e.message);
            return;
        } finally {
            submitBtn.textContent = originalText;
            submitBtn.disabled = false;
        }

        await this.fetchData();
    },

    async deletePart() {
        if (!this.editingRowIndexes?.length || !confirm('確定刪除此分部及其所有樂器配置？請先確認已下載所需備份。')) return;
        const button = document.getElementById('delete-part-btn');
        button.disabled = true;
        try {
            await this.postData({ action: 'batch_save', performance_name: this.originalPerformanceName,
                delete_rows: this.editingRowIndexes, create_rows: [] });
            this.closeModal();
            await this.fetchData();
        } catch (error) { alert(error.message); }
        finally { button.disabled = false; }
    },

    async postData(payload) {
        // Serialize writes within a tab and keep the version current.
        const band = this.bandId;
        const execute = async () => {
            if (band !== this.bandId) throw new Error('樂團已切換，請重新操作');
            const data = await this.request('/api/data', { ...payload, revision: this.revision },band);
            this.revision = data.revision;
            return data;
        };
        const pending = (this.pendingWrite || Promise.resolve()).then(execute);
        this.pendingWrite = pending.catch(() => {});
        return pending;
    },

    renderGlobalInstruments() {
        if (!this.globalInstPool) return;
        this.globalInstPool.innerHTML = '';
        const insts = this.getUniqueInstruments();

        if (insts.length === 0) {
            this.globalInstPool.innerHTML = '<p style="color:var(--text-muted)">目前沒有任何樂器。</p>';
            return;
        }

        insts.forEach(name => {
            const tag = document.createElement('div');
            tag.className = 'inst-tag';
            tag.textContent = name;
            // Display only, no dragging required here
            tag.style.cursor = 'default';
            this.globalInstPool.appendChild(tag);
        });
    },

    async addGlobalInstrument() {
        const input = document.getElementById('setting-new-inst');
        const name = input.value.trim();
        if (!name) return;

        const btn = input.nextElementSibling;
        const originalText = btn.textContent;
        btn.textContent = '新增中...';
        btn.disabled = true;

        try {
            await this.postData({
                action: 'ADD_INSTRUMENT',
                instrument_name: name
            });

            input.value = '';

            await this.fetchData();
        } catch (e) {
            console.error('Submit error:', e);
            alert("新增樂器時發生錯誤。");
        } finally {
            btn.textContent = originalText;
            btn.disabled = false;
        }
    }
};

document.addEventListener('DOMContentLoaded', () => {
    App.init();
    // Expose app to global window for inline onclick handlers in HTML
    window.app = App;
});
