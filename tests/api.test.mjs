import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';

let mf, db, session;
const key = 'local-test-key-only-at-least-32-characters-long';
const origin = 'https://percussion.example';
async function request(path, payload, cookie = session, extra = {}) {
  return mf.dispatchFetch(origin + path, {
    ...(payload === undefined ? {} : { method: 'POST', body: JSON.stringify(payload) }),
    headers: { 'Content-Type': 'application/json', Origin: origin, ...(cookie ? { Cookie: cookie } : {}), ...extra }
  });
}
before(async () => {
  mf = new Miniflare(convertV4MiniflareOptions({ workers: [{ name: 'api', modules: true, scriptPath: 'server/worker.js', compatibilityDate: '2026-10-01',
    d1Databases: { DB: 'test-database' }, bindings: { ADMIN_KEY: key },
    ratelimits: { LOGIN_LIMITER: { namespace_id: '1001', simple: { limit: 5, period: 60 } } }
  }] }));
  db = await mf.getD1Database('DB');
  const sql = (await readFile('migrations/0001_initial.sql', 'utf8')).replace(/--[^\n]*/g, '');
  for (const statement of sql.split(';').map(s => s.trim()).filter(Boolean)) await db.prepare(statement).run();
});
after(async () => mf?.dispose());

test('private reads, authentication, CSRF, and session expiry', async () => {
  assert.equal((await request('/api/data', undefined, '')).status, 401);
  assert.equal((await request('/api/login', { key: 'wrong' }, '')).status, 401);
  assert.equal((await request('/api/login', { key }, '', { Origin: 'https://other.example' })).status, 403);
  const login = await request('/api/login', { key }, '');
  assert.equal(login.status, 200);
  assert.match(login.headers.get('set-cookie'), /HttpOnly; SameSite=Strict/);
  assert.match(login.headers.get('set-cookie'), /Secure/);
  session = login.headers.get('set-cookie').split(';')[0];
  assert.equal((await request('/api/data')).status, 200);
  assert.equal((await request('/api/data', undefined, 'percussion_session=1.forged')).status, 401);
  assert.equal((await request('/api/data', undefined, session + 'tampered')).status, 401);
  assert.equal((await request('/api/unknown')).status, 404);
});
test('import validates all rows before writing, supports numeric Sheet names, and rejects duplicate imports', async () => {
  const invalid = { action: 'import', revision: 0, data: [{ performance_name: 'test', title: '' }] };
  assert.equal((await request('/api/data', invalid)).status, 400);
  assert.equal((await request('/api/data', { action: 'import', revision: 0, data: { performances: [], instruments: {} } })).status, 400);
  assert.equal((await (await request('/api/data')).json()).performances.length, 0);
  const imported = { instruments: ['Marimba'], players: ['Player'], performances: [
    { performance_name: 2025, title: "Friend's <Song>", part_name: 'P1', instrument_name: 'Marimba', instrument_remark: 'soft mallets', player_name: 'Player' }
  ] };
  assert.equal((await request('/api/data', { action: 'import', revision: 0, data: imported })).status, 200);
  assert.equal((await request('/api/data', { action: 'import', revision: 1, data: imported })).status, 409);
  const data = await (await request('/api/data')).json();
  assert.equal(data.revision, 1); assert.equal(data.performances.length, 1);
  assert.equal(data.performances[0].performance_name, '2025');
  assert.deepEqual(data.instruments, ['Marimba']);
});
test('atomic edit, stable IDs, concurrency conflicts, and preservation of notes', async () => {
  let data = await (await request('/api/data')).json();
  const old = data.performances[0];
  const payload = { action: 'batch_save', revision: data.revision, performance_name: 'new concert', original_performance_name: '2025', delete_rows: [old._row], create_rows: [{ ...old, title: 'Edited' }] };
  const responses = await Promise.all([request('/api/data', payload), request('/api/data', payload)]);
  assert.deepEqual(responses.map(r => r.status).sort(), [200, 409]);
  data = await (await request('/api/data')).json();
  assert.equal(data.revision, 2); assert.equal(data.performances.length, 1);
  assert.ok(data.performances[0]._row > old._row);
  assert.equal(data.performances[0].performance_name, 'new concert');
  const current = data.performances[0];
  assert.equal((await request('/api/data', { action: 'set_checked', revision: 2, performance_name: 'new concert', row_indexes: [current._row], checked: true })).status, 200);
  data = await (await request('/api/data')).json();
  assert.equal(data.performances[0].checked, 1);
  assert.equal(data.performances[0].instrument_remark, 'soft mallets');
  assert.equal((await request('/api/data', { ...payload, revision: 3, original_performance_name: 'wrong', delete_rows: [current._row] })).status, 409);
  data = await (await request('/api/data')).json();
  assert.equal(data.revision, 3); assert.equal(data.performances[0]._row, current._row);
});
test('empty parts preserve players; deletion and failed mutations do not leave partial data', async () => {
  const payload = { action: 'batch_save', revision: 3, performance_name: 'empty part concert', create_rows: [{ title: 'Song', part_name: 'P1', player_name: 'Soloist' }], delete_rows: [] };
  assert.equal((await request('/api/data', payload)).status, 200);
  let data = await (await request('/api/data')).json();
  const empty = data.performances.find(r => r.title === 'Song');
  assert.equal(empty.player_name, 'Soloist'); assert.ok(data.players.includes('Soloist'));
  assert.equal((await request('/api/data', { action: 'batch_save', revision: 4, performance_name: 'empty part concert', create_rows: [{ title: '' }], delete_rows: [empty._row] })).status, 400);
  assert.equal((await request('/api/data', { ...payload, revision: 4, create_rows: [], delete_rows: [empty._row] })).status, 200);
  data = await (await request('/api/data')).json();
  assert.equal(data.revision, 5); assert.equal(data.performances.length, 1);
});
test('export can restore to an empty database without losing notes, players or checked state', async () => {
  const exported = await (await request('/api/data')).json();
  await db.prepare('DELETE FROM score_rows').run();
  assert.equal((await request('/api/data', { action: 'import', revision: 5, data: exported })).status, 200);
  const restored = await (await request('/api/data')).json();
  assert.deepEqual(restored.players, exported.players);
  assert.deepEqual(restored.instruments, exported.instruments);
  const withoutId = ({ _row, ...row }) => row;
  assert.deepEqual(restored.performances.map(withoutId), exported.performances.map(withoutId));
});
test('login rate limiting and logout cookie removal', async () => {
  let response;
  for (let i = 0; i < 7; i++) response = await request('/api/login', { key: 'invalid' }, '');
  assert.equal(response.status, 429);
  const logout = await request('/api/logout', {});
  assert.match(logout.headers.get('set-cookie'), /Max-Age=0/);
});
