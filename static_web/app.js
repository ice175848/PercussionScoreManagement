const API_URL = 'https://script.google.com/macros/s/AKfycbwj8dHYHbFzezG4ONcCuTjG8JyEIoIppk2vcHWfbXuzej1RREo73-uYNy50orZl3P0/exec';

const App = {
    data: {
        performances: []
    },

    init() {
        this.cacheDOM();
        this.bindEvents();
        this.loadSettings();

        if (!this.getSheetId()) {
            // Force user to settings page if sheet ID is missing
            this.switchView('view-settings');
            this.showLoader(false);
        } else {
            this.fetchData();
        }
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

    loadSettings() {
        const sheetUrlInput = document.getElementById('setting-sheet-url');
        if (sheetUrlInput) sheetUrlInput.value = localStorage.getItem('SHEET_URL') || '';
    },

    async saveSettings() {
        const sheetUrl = document.getElementById('setting-sheet-url').value.trim();

        if (!sheetUrl) {
            alert('請輸入 Google 試算表網址！');
            return;
        }

        localStorage.setItem('SHEET_URL', sheetUrl);

        if (!this.getSheetId()) {
            alert('網址格式錯誤，無法擷取試算表 ID。請確保網址包含 /d/.../edit');
            return;
        }

        // Show loader
        this.showLoader(true);

        try {
            // Automatically initialize the spreadsheet format
            await fetch(API_URL, {
                method: 'POST',
                mode: 'no-cors',
                body: JSON.stringify({ action: 'INIT', sheetId: this.getSheetId() })
            });
            // Wait for GAS to finish processing
            await new Promise(resolve => setTimeout(resolve, 2000));
        } catch (e) {
            console.warn('Initialization request (expected opaque):', e);
        }

        alert('設定已儲存！系統已自動為您建立資料表結構。');

        // Switch to performances view and fetch
        this.switchView('view-performances');
        this.fetchData();
    },

    getSheetId() {
        const url = localStorage.getItem('SHEET_URL') || '';
        const match = url.match(/\/d\/([a-zA-Z0-9-_]+)/);
        return match ? match[1] : null;
    },

    openSheet() {
        const sheetUrl = localStorage.getItem('SHEET_URL');
        if (sheetUrl) {
            window.open(sheetUrl, '_blank');
        } else {
            alert('您尚未設定試算表網址。');
        }
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

                // Highlight matching part
                if (val) {
                    const regex = new RegExp(`(${val.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
                    item.innerHTML = opt.title.replace(regex, '<strong style="color:var(--primary)">$1</strong>');
                } else {
                    item.textContent = opt.title;
                }

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
        const sheetId = this.getSheetId();
        if (!sheetId) return;

        try {
            this.showLoader(true);
            // Append a timestamp and sheetId
            const url = API_URL + '?sheetId=' + sheetId + '&t=' + new Date().getTime();
            const response = await fetch(url);
            const json = await response.json();

            // Check if GAS returned an error
            if (json && json.error) {
                console.error('GAS error:', json.error);
                alert('GAS 伺服器錯誤: ' + json.error);
                this.showLoader(false);
                return;
            }

            try {
                this.processData(json);
                this.renderPerformances();
                this.populateSummarySelect();
                this.renderGlobalInstruments();
            } catch (renderError) {
                console.error('Rendering error:', renderError);
                alert('處理或渲染資料時發生錯誤:\n' + renderError.message);
            }

            this.showLoader(false);

            // Show performances view by default if it's currently hidden and loader is gone
            if (document.querySelector('.view:not(.hidden)') === null) {
                this.viewPerformances.classList.remove('hidden');
            }
        } catch (error) {
            console.error('Error fetching data:', error);
            alert('網路或解析 JSON 發生錯誤:\n' + error.message);
            this.showLoader(false);
            this.loader.innerHTML = `<p style="color:var(--danger)">載入失敗，請檢查網路連線或錯誤訊息。</p>`;
        }
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
                piece.partsMap.set(partName, { name: partName, instruments: [], rowIndexes: [] });
            }
            const part = piece.partsMap.get(partName);

            // Record the row index for this specific entry so we can delete/edit it later
            if (row._row) part.rowIndexes.push(row._row);

            if (row.instrument_name !== null && row.instrument_name !== undefined && String(row.instrument_name).trim() !== '') {
                part.instruments.push({
                    name: String(row.instrument_name).trim(),
                    player: row.player_name != null ? String(row.player_name).trim() : '',
                    remark: row.instrument_remark != null ? String(row.instrument_remark).trim() : '',
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
        this.perfContainer.innerHTML = '';
        if (this.data.performances.length === 0) {
            this.perfContainer.innerHTML = '<p style="color:var(--text-muted)">目前沒有任何表演資料。</p>';
            return;
        }

        let hasVisiblePerformances = false;

        this.data.performances.forEach(perf => {
            if (perf.name === '樂器標籤') return; // Option A: Hide fake performance from UI

            hasVisiblePerformances = true;
            const card = document.createElement('div');
            card.className = 'perf-card';

            let piecesHtml = '<ul class="piece-list">';
            perf.pieces.forEach(piece => {
                const partsCount = piece.parts.length;
                let composerText = piece.composer ? piece.composer + ' 曲' : '';
                let metaText = [composerText, `${partsCount} 個分部`].filter(Boolean).join(' • ');

                let partsHtml = '<div class="parts-grid">';
                piece.parts.forEach(part => {
                    let instsText = part.instruments.map(i => i.name + (i.remark ? ` (${i.remark})` : '')).join(', ');
                    if (!instsText) instsText = '<span style="color:var(--text-muted)">無設定樂器</span>';
                    // Extract player info from the first instrument (shared per part)
                    const playerText = (part.instruments[0] && part.instruments[0].player) ? part.instruments[0].player : '';
                    const playerHtml = playerText ? `<div class="part-players" style="font-size:11px; color:var(--secondary); margin-top:4px;">🎵 ${playerText}</div>` : '';
                    // Convert rowIndexes to JSON string to pass it safely in the onclick handler
                    const rowIdxStr = JSON.stringify(part.rowIndexes);
                    partsHtml += `
                        <div class="part-card" onclick="event.stopPropagation(); app.editPart('${perf.name}', '${piece.id}', '${part.name}', ${rowIdxStr})" style="cursor: pointer;" title="點擊編輯此分部">
                            <div class="part-name">${part.name} <span style="float:right; opacity:0.5;">✏️</span></div>
                            <div class="part-insts">${instsText}</div>
                            ${playerHtml}
                        </div>
                    `;
                });
                partsHtml += '</div>';

                piecesHtml += `
                    <li class="piece-item">
                        <div class="piece-summary" onclick="app.togglePieceDetail(this)">
                            <span class="piece-title">${piece.title}</span>
                            <span class="piece-meta">${metaText}</span>
                        </div>
                        <div class="piece-detail-wrapper">
                            <div class="piece-detail">
                                <div class="piece-detail-inner">
                                    ${partsHtml}
                                </div>
                            </div>
                        </div>
                    </li>
                `;
            });
            piecesHtml += '</ul>';

            card.innerHTML = `
                <h3>${perf.name}</h3>
                ${piecesHtml}
            `;
            this.perfContainer.appendChild(card);
        });

        if (!hasVisiblePerformances && this.data.performances.length > 0) {
            this.perfContainer.innerHTML = '<p style="color:var(--text-muted)">目前只有設定標籤，尚未有正式的表演資料。</p>';
        }
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
        if (!perfName) {
            this.summaryContainer.innerHTML = '<p style="color:var(--text-muted); text-align:center; padding: 40px;">請從上方選擇一場演出以查看樂器總表。</p>';
            return;
        }

        const perf = this.data.performances.find(p => p.name === perfName);
        if (!perf) return;

        // 計算每種樂器所需數量並記錄列索引
        const instMap = new Map();
        perf.pieces.forEach(piece => {
            piece.parts.forEach(part => {
                part.instruments.forEach(inst => {
                    const name = inst.name.trim();
                    if (name) {
                        if (!instMap.has(name)) {
                            instMap.set(name, { count: 0, checkedCount: 0, rowIndexes: [] });
                        }
                        const entry = instMap.get(name);
                        entry.count++;
                        entry.rowIndexes.push(inst.rowIndex);
                        if (inst.remark === '已清點' || inst.remark === 'checked') {
                            entry.checkedCount++;
                        }
                    }
                });
            });
        });

        const entries = Array.from(instMap.entries());
        if (entries.length === 0) {
            this.summaryContainer.innerHTML = '<p style="color:var(--text-muted); text-align:center; padding: 40px;">此演出尚未設定任何樂器。</p>';
            return;
        }

        // Sort by count descending
        entries.sort((a, b) => b[1].count - a[1].count);

        let tableHtml = `
            <table class="summary-table">
                <thead><tr>
                    <th style="width: 50px; text-align: center;">清點</th>
                    <th>樂器名稱 (Instrument)</th>
                    <th>需求數量 (Count)</th>
                </tr></thead>
                <tbody>
        `;

        for (const [name, data] of entries) {
            const isChecked = data.checkedCount === data.count;
            const rowIdxsJson = JSON.stringify(data.rowIndexes);
            const style = isChecked ? 'text-decoration: line-through; color: var(--text-muted);' : '';
            tableHtml += `
                <tr class="${isChecked ? 'checked-row' : ''}">
                    <td style="text-align: center;">
                        <input type="checkbox" 
                               style="transform: scale(1.5); cursor: pointer;"
                               ${isChecked ? 'checked' : ''} 
                               onchange='App.toggleInstrumentCheck("${perfName}", "${name}", this.checked, ${rowIdxsJson})'>
                    </td>
                    <td style="${style}">${name}</td>
                    <td style="${style}"><strong style="font-size:16px; ${isChecked ? '' : 'color:var(--primary);'}">${data.count}</strong></td>
                </tr>
            `;
        }

        tableHtml += `</tbody></table>`;
        this.summaryContainer.innerHTML = tableHtml;
    },

    async toggleInstrumentCheck(perfName, instName, isChecked, rowIndexes) {
        const remark = isChecked ? '已清點' : '';
        
        try {
            // Optimistic UI update
            const perf = this.data.performances.find(p => p.name === perfName);
            if (perf) {
                perf.pieces.forEach(piece => {
                    piece.parts.forEach(part => {
                        part.instruments.forEach(inst => {
                            if (rowIndexes.includes(inst.rowIndex)) {
                                inst.remark = remark;
                            }
                        });
                    });
                });
            }
            this.renderSummary(perfName);

            // Send to backend
            await this.postData({
                action: 'update_remark',
                performance_name: perfName,
                row_indexes: rowIndexes,
                remark: remark
            });
        } catch (e) {
            console.warn('Update remark failed locally:', e);
        }
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
                    evt.item.onclick = () => evt.item.remove();
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
        this.showModal("編輯樂譜配置");
        this.resetBuilder(); // resets form and editingRowIndexes

        // Find the performance, piece, and part data
        const perf = this.data.performances.find(p => p.name === perfName);
        const piece = perf ? perf.pieces.find(p => p.id === pieceId) : null;
        const part = piece ? piece.parts.find(p => p.name === partName) : null;

        if (!part) return;

        // Set edit mode data
        this.editingRowIndexes = rowIndexes;

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
                this.createInstrumentTag(inst.name, selectedZone, false);
            }
        });

        // Pre-fill selected players
        const selectedPlayerZone = document.getElementById('selected-players');
        selectedPlayerZone.innerHTML = '';
        const firstInst = part.instruments[0];
        if (firstInst && firstInst.player) {
            firstInst.player.split(',').forEach(p => {
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
                const clone = tag.cloneNode(true);
                clone.onclick = () => clone.remove();
                document.getElementById('selected-instruments').appendChild(clone);
            };
        } else {
            // Already in selected zone
            tag.onclick = () => tag.remove();
        }

        container.appendChild(tag);
        return tag;
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
            // Immediately add to backend pool silently
            try {
                this.postData({
                    action: 'ADD_PLAYER',
                    player_name: name
                });
            } catch (e) { console.warn(e); }
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
        const instruments = Array.from(instTags).map(t => t.dataset.name);

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
                for (const instName of instruments) {
                    createRows.push({
                        title: title, part_name: partName,
                        instrument_name: instName, player_name: playersStr, instrument_remark: ''
                    });
                }
            }

            await this.postData({
                action: 'batch_save',
                performance_name: perfName,
                delete_rows: deleteRows,
                create_rows: createRows
            });

            this.closeModal();
        } catch (e) {
            console.warn('Submit warning (data likely saved):', e);
            this.closeModal();
        } finally {
            submitBtn.textContent = originalText;
            submitBtn.disabled = false;
        }

        // Always refresh data after submit, regardless of try/catch outcome
        await new Promise(resolve => setTimeout(resolve, 2500));
        await this.fetchData();
    },

    async postData(payload) {
        const sheetId = this.getSheetId();
        if (!sheetId) {
            alert('尚未設定試算表網址，無法寫入資料。');
            return;
        }

        try {
            const dataWithSheet = { ...payload, sheetId: sheetId };
            await fetch(API_URL, {
                method: 'POST',
                mode: 'no-cors',
                body: JSON.stringify(dataWithSheet)
            });
        } catch (e) {
            console.warn('Opaque POST threw an error (usually expected due to GAS 302 redirect):', e);
        }
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

            // Give Google Sheets time to persist
            await new Promise(resolve => setTimeout(resolve, 2000));
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
