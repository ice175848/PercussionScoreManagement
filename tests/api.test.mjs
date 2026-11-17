import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";

let mf, db, session;
let ipCounter = 0;
const key = "local-test-key-only-at-least-32-characters-long";
const origin = "https://percussion.example";
async function request(path, payload, cookie = session, extra = {}) {
  return mf.dispatchFetch(
    origin + path + (path === "/api/data" ? "?band=legacy" : ""),
    {
      ...(payload === undefined
        ? {}
        : { method: "POST", body: JSON.stringify(payload) }),
      headers: {
        "Content-Type": "application/json",
        Origin: origin,
        "CF-Connecting-IP": `192.0.2.${++ipCounter}`,
        ...(cookie ? { Cookie: cookie } : {}),
        ...extra,
      },
    },
  );
}
before(async () => {
  mf = new Miniflare(
    convertV4MiniflareOptions({
      workers: [
        {
          name: "api",
          modules: true,
          scriptPath: "server/worker.js",
          compatibilityDate: "2026-10-01",
          d1Databases: { DB: "test-database" },
          bindings: { ADMIN_KEY: key, AUTH_PEPPER: key },
          ratelimits: {
            LOGIN_LIMITER: {
              namespace_id: "1001",
              simple: { limit: 5, period: 60 },
            },
          },
        },
      ],
    }),
  );
  db = await mf.getD1Database("DB");
  for (const name of ["0001_initial.sql", "0002_accounts_and_bands.sql", "0003_performance_order.sql"]) {
    const sql = (await readFile(`migrations/${name}`, "utf8")).replace(
      /--[^\n]*/g,
      "",
    );
    for (const statement of sql
      .split(";")
      .map((s) => s.trim())
      .filter(Boolean))
      await db.prepare(statement).run();
  }
});
after(async () => mf?.dispose());

test("private reads, authentication, CSRF, and session expiry", async () => {
  assert.equal((await request("/api/data", undefined, "")).status, 401);
  assert.equal(
    (
      await request(
        "/api/auth/login",
        { username: "owner", password: "wrong-password" },
        "",
      )
    ).status,
    401,
  );
  assert.equal(
    (
      await request(
        "/api/auth/register",
        { username: "owner", password: "test-password-123" },
        "",
        { Origin: "https://other.example" },
      )
    ).status,
    403,
  );
  const login = await request(
    "/api/auth/register",
    { username: "owner", password: "test-password-123" },
    "",
  );
  assert.equal(login.status, 200);
  assert.match(login.headers.get("set-cookie"), /HttpOnly; SameSite=Strict/);
  assert.match(login.headers.get("set-cookie"), /Secure/);
  session = login.headers.get("set-cookie").split(";")[0];
  assert.equal((await request("/api/data")).status, 403);
  assert.equal((await request("/api/legacy/claim", { key })).status, 200);
  assert.equal((await request("/api/data")).status, 200);
  assert.equal(
    (await request("/api/data", undefined, "percussion_session=1.forged"))
      .status,
    401,
  );
  assert.equal(
    (await request("/api/data", undefined, session + "tampered")).status,
    401,
  );
  assert.equal((await request("/api/unknown?band=legacy")).status, 404);
});
test("import validates all rows before writing, supports numeric Sheet names, and rejects duplicate imports", async () => {
  const invalid = {
    action: "import",
    revision: 0,
    data: [{ performance_name: "test", title: "" }],
  };
  assert.equal((await request("/api/data", invalid)).status, 400);
  assert.equal(
    (
      await request("/api/data", {
        action: "import",
        revision: 0,
        data: { performances: [], instruments: {} },
      })
    ).status,
    400,
  );
  assert.equal(
    (await (await request("/api/data")).json()).performances.length,
    0,
  );
  const imported = {
    instruments: ["Marimba"],
    players: ["Player"],
    performances: [
      {
        performance_name: 2025,
        title: "Friend's <Song>",
        part_name: "P1",
        instrument_name: "Marimba",
        instrument_remark: "soft mallets",
        player_name: "Player",
      },
    ],
  };
  assert.equal(
    (
      await request("/api/data", {
        action: "import",
        revision: 0,
        data: imported,
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await request("/api/data", {
        action: "import",
        revision: 1,
        data: imported,
      })
    ).status,
    409,
  );
  const data = await (await request("/api/data")).json();
  assert.equal(data.revision, 1);
  assert.equal(data.performances.length, 1);
  assert.equal(data.performances[0].performance_name, "2025");
  assert.deepEqual(data.instruments, ["Marimba"]);
});
test("atomic edit, stable IDs, concurrency conflicts, and preservation of notes", async () => {
  let data = await (await request("/api/data")).json();
  const old = data.performances[0];
  const payload = {
    action: "batch_save",
    revision: data.revision,
    performance_name: "new concert",
    original_performance_name: "2025",
    delete_rows: [old._row],
    create_rows: [{ ...old, title: "Edited" }],
  };
  const responses = await Promise.all([
    request("/api/data", payload),
    request("/api/data", payload),
  ]);
  assert.deepEqual(responses.map((r) => r.status).sort(), [200, 409]);
  data = await (await request("/api/data")).json();
  assert.equal(data.revision, 2);
  assert.equal(data.performances.length, 1);
  assert.ok(data.performances[0]._row > old._row);
  assert.equal(data.performances[0].performance_name, "new concert");
  const current = data.performances[0];
  assert.equal(
    (
      await request("/api/data", {
        action: "set_checked",
        revision: 2,
        performance_name: "new concert",
        row_indexes: [current._row],
        checked: true,
      })
    ).status,
    200,
  );
  data = await (await request("/api/data")).json();
  assert.equal(data.performances[0].checked, 1);
  assert.equal(data.performances[0].instrument_remark, "soft mallets");
  assert.equal(
    (
      await request("/api/data", {
        ...payload,
        revision: 3,
        original_performance_name: "wrong",
        delete_rows: [current._row],
      })
    ).status,
    409,
  );
  data = await (await request("/api/data")).json();
  assert.equal(data.revision, 3);
  assert.equal(data.performances[0]._row, current._row);
});
test("empty parts preserve players; deletion and failed mutations do not leave partial data", async () => {
  const payload = {
    action: "batch_save",
    revision: 3,
    performance_name: "empty part concert",
    create_rows: [{ title: "Song", part_name: "P1", player_name: "Soloist" }],
    delete_rows: [],
  };
  assert.equal((await request("/api/data", payload)).status, 200);
  let data = await (await request("/api/data")).json();
  const empty = data.performances.find((r) => r.title === "Song");
  assert.equal(empty.player_name, "Soloist");
  assert.ok(data.players.includes("Soloist"));
  assert.equal(
    (
      await request("/api/data", {
        action: "batch_save",
        revision: 4,
        performance_name: "empty part concert",
        create_rows: [{ title: "" }],
        delete_rows: [empty._row],
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await request("/api/data", {
        ...payload,
        revision: 4,
        create_rows: [],
        delete_rows: [empty._row],
      })
    ).status,
    200,
  );
  data = await (await request("/api/data")).json();
  assert.equal(data.revision, 5);
  assert.equal(data.performances.length, 1);
});
test("export can restore to an empty database without losing notes, players or checked state", async () => {
  const exported = await (await request("/api/data")).json();
  await db.prepare("DELETE FROM band_score_rows").run();
  assert.equal(
    (
      await request("/api/data", {
        action: "import",
        revision: 5,
        data: exported,
      })
    ).status,
    200,
  );
  const restored = await (await request("/api/data")).json();
  assert.deepEqual(restored.players, exported.players);
  assert.deepEqual(restored.instruments, exported.instruments);
  const withoutId = ({ _row, ...row }) => row;
  assert.deepEqual(
    restored.performances.map(withoutId),
    exported.performances.map(withoutId),
  );
});
test("performance order is shared across parts, scoped to one concert, and survives backup", async () => {
  const snapshot = async () => (await request("/api/data")).json();
  const save = async (performance_name, create_rows, extra = {}) =>
    request("/api/data", {
      action: "batch_save", revision: (await snapshot()).revision,
      performance_name, create_rows, ...extra,
    });
  const row = (part_name) => ({ title: "Shared title", part_name });
  assert.equal((await save("Concert 1", [row("P1")], { performance_order: 30 })).status, 200);
  assert.equal((await save("Concert 1", [row("P2")])).status, 200);
  assert.equal((await save("Concert 2", [row("P1")], { performance_order: 9 })).status, 200);
  let data = await snapshot();
  const inConcert = (name) => data.performances.filter(r => r.performance_name === name);
  assert.deepEqual(inConcert("Concert 1").map(r => r.performance_order), [30, 30]);
  assert.equal((await save("Concert 1", [row("P2")], {
    performance_order: 2, delete_rows: [inConcert("Concert 1")[1]._row],
  })).status, 200);
  data = await snapshot();
  assert.deepEqual(inConcert("Concert 1").map(r => r.performance_order), [2, 2]);
  assert.equal(inConcert("Concert 2")[0].performance_order, 9);
  for (const invalid of [0, -1, 1.5, 10000, "3"]) {
    assert.equal((await save("Concert 1", [row("P3")], { performance_order: invalid })).status, 400);
  }
  assert.equal((await save("Concert 2", [row("P1")], {
    delete_rows: [inConcert("Concert 2")[0]._row],
  })).status, 200);
  data = await snapshot();
  assert.equal(inConcert("Concert 2")[0].performance_order, 9);
  assert.equal((await save("Concert 1", [row("P3")], { performance_order: null })).status, 200);
  data = await snapshot();
  assert.deepEqual(inConcert("Concert 1").map(r => r.performance_order), [null, null, null]);
  await db.prepare("DELETE FROM band_score_rows").run();
  assert.equal((await request("/api/data", { action: "import", revision: data.revision, data })).status, 200);
  data = await snapshot();
  assert.equal(inConcert("Concert 2")[0].performance_order, 9);
});

test("login rate limiting and logout cookie removal", async () => {
  let response;
  for (let i = 0; i < 7; i++)
    response = await request(
      "/api/auth/login",
      { username: "owner", password: "invalid-password" },
      "",
      { "CF-Connecting-IP": "198.51.100.1" },
    );
  assert.equal(response.status, 429);
  const logout = await request("/api/logout", {});
  assert.match(logout.headers.get("set-cookie"), /Max-Age=0/);
});

test('native sign-in posts support autofill, fixed redirects and optional 30-day sessions', async () => {
  const native = async (path, values, originHeader = origin) => mf.dispatchFetch(origin + path, {
    method: 'POST', redirect: 'manual',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Origin: originHeader, 'CF-Connecting-IP': `198.18.0.${++ipCounter}` },
    body: new URLSearchParams(values).toString()
  });
  const before = Math.floor(Date.now() / 1000);
  const remembered = await native('/api/auth/sign-in', { username: 'owner', password: 'test-password-123', remember_session: 'on', next: 'https://evil.example' });
  assert.equal(remembered.status, 303);
  assert.equal(remembered.headers.get('location'), '/');
  assert.match(remembered.headers.get('set-cookie'), /Max-Age=2592000/);
  assert.match(remembered.headers.get('set-cookie'), /HttpOnly; SameSite=Strict/);
  assert.match(remembered.headers.get('set-cookie'), /Secure/);
  const active = remembered.headers.get('set-cookie').split(';')[0];
  assert.equal((await request('/api/me', undefined, active)).status, 200);
  const stored = await db.prepare('SELECT expires_at,created_at FROM sessions ORDER BY expires_at DESC LIMIT 1').first();
  assert.equal(stored.expires_at - stored.created_at, 30 * 24 * 60 * 60);
  assert.ok(stored.created_at >= before);
  assert.equal((await request('/api/auth/logout', {}, active)).status, 200);
  assert.equal((await request('/api/me', undefined, active)).status, 401);
  const normal = await native('/api/auth/sign-in', { username: 'owner', password: 'test-password-123' });
  assert.equal(normal.status, 303);
  assert.match(normal.headers.get('set-cookie'), /Max-Age=28800/);
  const invalid = await native('/api/auth/sign-in', { username: 'owner', password: 'wrong-secret-password', next: 'https://evil.example' });
  assert.equal(invalid.status, 303);
  assert.equal(invalid.headers.get('location'), '/?auth_error=invalid');
  assert.equal(invalid.headers.get('set-cookie'), null);
  assert.equal((await invalid.text()).includes('wrong-secret-password'), false);
  assert.equal((await native('/api/auth/sign-in', { username: 'owner', password: 'test-password-123' }, 'https://evil.example')).status, 403);
  const registered = await native('/api/auth/sign-up', { username: 'native-registration', password: 'Long native registration password', display_name: 'New member' });
  assert.equal(registered.status, 303);
  assert.equal(registered.headers.get('location'), '/');
  const user = await (await request('/api/me', undefined, registered.headers.get('set-cookie').split(';')[0])).json();
  assert.equal(user.user.username, 'native-registration');
  assert.equal(user.bands.length, 0);
  const duplicate = await native('/api/auth/sign-up', { username: 'native-registration', password: 'Long native registration password' });
  assert.equal(duplicate.headers.get('location'), '/?auth_error=taken&auth_mode=register');
});

test('JSON clients retain the default expiry unless remember_session is explicitly true', async () => {
  const login = { username: 'owner', password: 'test-password-123' };
  const remembered = await request('/api/auth/login', { ...login, remember_session: true }, '');
  assert.equal(remembered.status, 200);
  assert.match(remembered.headers.get('set-cookie'), /Max-Age=2592000/);
  const ordinary = await request('/api/auth/login', { ...login, remember_session: false }, '');
  assert.match(ordinary.headers.get('set-cookie'), /Max-Age=28800/);
  const invalid = await request('/api/auth/login', { ...login, remember_session: 'false' }, '');
  assert.equal(invalid.status, 400);
});
