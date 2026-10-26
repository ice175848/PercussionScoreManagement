const FIELDS = ['performance_name', 'title', 'composer', 'arranger', 'part_name', 'player_name', 'instrument_name', 'instrument_remark'];
const MAX_BODY = 2_000_000;
const SESSION_SECONDS = 8 * 60 * 60;
class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const json = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), {
  status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...headers }
});
function text(value, required = false) {
  if (value !== undefined && value !== null && !['string', 'number'].includes(typeof value)) throw new HttpError(400, '文字欄位格式錯誤');
  const result = String(value ?? '').trim();
  if (result.length > 1000 || (required && !result)) throw new HttpError(400, '必填欄位缺漏或超過 1000 字');
  return result;
}
function rows(values, perfName) {
  if (!Array.isArray(values) || values.length > 5000) throw new HttpError(400, '資料須為陣列，單次最多 5000 筆');
  return values.map(row => {
    if (!row || typeof row !== 'object' || Array.isArray(row)) throw new HttpError(400, '資料列格式錯誤');
    return { ...Object.fromEntries(FIELDS.map(field => [field, text(field === 'performance_name' ? perfName ?? row[field] : row[field], ['performance_name', 'title'].includes(field))])), checked: row.checked === true || row.checked === 1 || (row.checked === undefined && ['已清點', 'checked'].includes(row.instrument_remark)) ? 1 : 0 };
  });
}
function ids(values) {
  if (!Array.isArray(values) || values.length > 1000 || values.some(id => !Number.isSafeInteger(id) || id <= 0)) throw new HttpError(400, '資料 ID 格式錯誤');
  return [...new Set(values)];
}
async function body(request) {
  if (!request.headers.get('Content-Type')?.startsWith('application/json')) throw new HttpError(415, '請使用 JSON');
  const reader = request.body?.getReader();
  if (!reader) throw new HttpError(400, '缺少 JSON');
  let size = 0; const chunks = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > MAX_BODY) { await reader.cancel(); throw new HttpError(413, '資料不可超過 2 MB'); }
    chunks.push(value);
  }
  try {
    const bytes = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    const value = JSON.parse(new TextDecoder().decode(bytes));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
    return value;
  } catch { throw new HttpError(400, 'JSON 格式錯誤'); }
}
const hex = bytes => [...new Uint8Array(bytes)].map(n => n.toString(16).padStart(2, '0')).join('');
async function digest(value) { return hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))); }
async function equal(a, b) { return (await digest(a)) === (await digest(b)); }
async function sign(value, secret) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return hex(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(value)));
}
async function authorized(request, secret) {
  const token = request.headers.get('Cookie')?.match(/(?:^|;\s*)percussion_session=([^;]+)/)?.[1] || '';
  const [expires, signature] = token.split('.');
  if (!/^\d+$/.test(expires) || Number(expires) <= Date.now() / 1000 || !signature) return false;
  return equal(signature, await sign(`session:${expires}`, secret));
}
function cookie(request, value, age) {
  return `percussion_session=${value}; HttpOnly; SameSite=Strict; Path=/api; Max-Age=${age}${new URL(request.url).protocol === 'https:' ? '; Secure' : ''}`;
}
async function snapshot(db) {
  // One transactional batch keeps the revision and exported data consistent.
  const result = await db.batch([
    db.prepare('SELECT revision FROM metadata WHERE id=1'),
    db.prepare('SELECT name FROM instruments ORDER BY name'),
    db.prepare('SELECT name FROM players ORDER BY name'),
    db.prepare('SELECT id AS _row, performance_name, title, composer, arranger, part_name, player_name, instrument_name, instrument_remark, checked FROM score_rows ORDER BY id')
  ]);
  return { version: 1, revision: result[0].results[0].revision, instruments: result[1].results.map(r => r.name), players: result[2].results.map(r => r.name), performances: result[3].results };
}
function insertRows(db, data) {
  // json_each uses one statement so imports stay within the Free subrequest budget.
  return db.prepare(`INSERT INTO score_rows (${FIELDS.join(',')},checked) SELECT ${[...FIELDS, 'checked'].map(f => `json_extract(value,'$.${f}')`).join(',')} FROM json_each(?)`).bind(JSON.stringify(data));
}
async function mutate(db, payload) {
  if (!Number.isSafeInteger(payload.revision) || payload.revision < 0) throw new HttpError(400, '缺少有效資料版本，請重新載入');
  const statements = [db.prepare('INSERT INTO write_guard(id) SELECT CASE WHEN revision=? THEN 1 ELSE 0 END FROM metadata WHERE id=1').bind(payload.revision)];
  if (payload.action === 'ADD_INSTRUMENT' || payload.action === 'ADD_PLAYER') {
    const instrument = payload.action === 'ADD_INSTRUMENT';
    statements.push(db.prepare(`INSERT OR IGNORE INTO ${instrument ? 'instruments' : 'players'}(name) VALUES (?)`).bind(text(payload[instrument ? 'instrument_name' : 'player_name'], true)));
  } else if (payload.action === 'batch_save') {
    const perf = text(payload.performance_name, true);
    const deleted = ids(payload.delete_rows ?? []);
    const created = rows(payload.create_rows, perf);
    // Validate deletion scope inside the transaction. Never delete another performance's rows.
    statements.push(db.prepare('INSERT OR REPLACE INTO write_guard(id) SELECT CASE WHEN COUNT(*)=? THEN 1 ELSE 0 END FROM score_rows WHERE performance_name=? AND id IN (SELECT value FROM json_each(?))').bind(deleted.length, text(payload.original_performance_name ?? perf, true), JSON.stringify(deleted)));
    statements.push(db.prepare('DELETE FROM score_rows WHERE id IN (SELECT value FROM json_each(?))').bind(JSON.stringify(deleted)), insertRows(db, created));
    // Keep newly entered instruments and players in their global pools.
    const instruments = [...new Set(created.map(r => r.instrument_name).filter(Boolean))];
    const players = [...new Set(created.flatMap(r => r.player_name.split(',').map(s => s.trim()).filter(Boolean)))];
    statements.push(db.prepare('INSERT OR IGNORE INTO instruments(name) SELECT value FROM json_each(?)').bind(JSON.stringify(instruments)), db.prepare('INSERT OR IGNORE INTO players(name) SELECT value FROM json_each(?)').bind(JSON.stringify(players)));
  } else if (payload.action === 'set_checked') {
    const selected = ids(payload.row_indexes);
    if (typeof payload.checked !== 'boolean') throw new HttpError(400, '清點狀態格式錯誤');
    const perf = text(payload.performance_name, true);
    statements.push(db.prepare('INSERT OR REPLACE INTO write_guard(id) SELECT CASE WHEN COUNT(*)=? THEN 1 ELSE 0 END FROM score_rows WHERE performance_name=? AND id IN (SELECT value FROM json_each(?))').bind(selected.length, perf, JSON.stringify(selected)));
    statements.push(db.prepare('UPDATE score_rows SET checked=? WHERE performance_name=? AND id IN (SELECT value FROM json_each(?))').bind(payload.checked ? 1 : 0, perf, JSON.stringify(selected)));
  } else if (payload.action === 'import') {
    const data = payload.data;
    const source = Array.isArray(data) ? { performances: data } : data;
    if (!source || !Array.isArray(source.performances)) throw new HttpError(400, '匯入格式錯誤');
    if ((source.instruments !== undefined && !Array.isArray(source.instruments)) || (source.players !== undefined && !Array.isArray(source.players))) throw new HttpError(400, '名冊格式錯誤');
    if (source.version !== undefined && source.version !== 1) throw new HttpError(400, '不支援此備份版本');
    const imported = rows(source.performances);
    const pool = (list = []) => {
      if (!Array.isArray(list) || list.length > 5000) throw new HttpError(400, '名冊格式錯誤');
      return [...new Set(list.map(value => text(value, true)))];
    };
    const instruments = pool([...(source.instruments || []), ...imported.map(r => r.instrument_name).filter(Boolean)]);
    const players = pool([...(source.players || []), ...imported.flatMap(r => r.player_name.split(',').map(s => s.trim()).filter(Boolean))]);
    // Import is a first-run migration/restore, never an implicit overwrite or duplicate merge.
    statements.push(db.prepare('INSERT OR REPLACE INTO write_guard(id) SELECT CASE WHEN COUNT(*)=0 THEN 1 ELSE 0 END FROM score_rows'));
    statements.push(db.prepare('DELETE FROM instruments'), db.prepare('DELETE FROM players'), insertRows(db, imported));
    statements.push(db.prepare('INSERT INTO instruments(name) SELECT value FROM json_each(?)').bind(JSON.stringify(instruments)), db.prepare('INSERT INTO players(name) SELECT value FROM json_each(?)').bind(JSON.stringify(players)));
  } else throw new HttpError(400, '不支援的操作');
  statements.push(db.prepare('UPDATE metadata SET revision=revision+1 WHERE id=1'), db.prepare('DELETE FROM write_guard'));
  try { await db.batch(statements); }
  catch (error) {
    if (/CHECK constraint failed/.test(String(error))) throw new HttpError(409, '資料已被更新、資料 ID 不符，或匯入目標不是空資料庫。請重新載入後確認。');
    throw error;
  }
  return { success: true, revision: payload.revision + 1 };
}
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(request);
    try {
      if (url.pathname === '/api/health' && request.method === 'GET') {
        await env.DB.prepare('SELECT revision FROM metadata WHERE id=1').first();
        return json({ status: 'ok', database: 'up' });
      }
      if (!env.ADMIN_KEY || env.ADMIN_KEY.length < 32) throw new HttpError(503, '管理金鑰尚未設定，請聯絡管理者');
      if (request.method !== 'GET') {
        if (request.headers.get('Origin') !== url.origin) throw new HttpError(403, '來源驗證失敗');
        if (request.method !== 'POST') throw new HttpError(405, '不支援的方法');
      }
      if (url.pathname === '/api/login' && request.method === 'POST') {
        if (!env.LOGIN_LIMITER) throw new HttpError(503, '登入限制尚未設定');
        const { success } = await env.LOGIN_LIMITER.limit({ key: request.headers.get('CF-Connecting-IP') || 'local' });
        if (!success) throw new HttpError(429, '登入嘗試過多，請稍後再試');
        const { key } = await body(request);
        if (typeof key !== 'string' || key.length > 1000 || !await equal(key, env.ADMIN_KEY)) throw new HttpError(401, '管理金鑰不正確');
        const expires = String(Math.floor(Date.now() / 1000) + SESSION_SECONDS);
        return json({ success: true }, 200, { 'Set-Cookie': cookie(request, `${expires}.${await sign(`session:${expires}`, env.ADMIN_KEY)}`, SESSION_SECONDS) });
      }
      if (url.pathname === '/api/logout' && request.method === 'POST') return json({ success: true }, 200, { 'Set-Cookie': cookie(request, '', 0) });
      if (!await authorized(request, env.ADMIN_KEY)) throw new HttpError(401, '請先登入');
      if (url.pathname === '/api/data' && request.method === 'GET') return json(await snapshot(env.DB));
      if (url.pathname === '/api/data' && request.method === 'POST') return json(await mutate(env.DB, await body(request)));
      throw new HttpError(404, '找不到此 API');
    } catch (error) {
      if (!error.status) console.error('API operation failed:', error.message);
      return json({ error: error.status ? error.message : '伺服器無法完成操作，請稍後重試' }, error.status || 500);
    }
  }
};
