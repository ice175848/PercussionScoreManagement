import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
let mf,
  db,
  alice,
  bob,
  editor,
  viewer,
  admin,
  outsider,
  bandA,
  bandB,
  legacyOwner,
  ip = 0;
const origin = "https://tenancy.example",
  key = "test-only-legacy-admin-key-32-characters",
  pass = "Long test password 123!";
async function request(path, payload, actor, band, extra = {}) {
  const response = await mf.dispatchFetch(
    origin + path + (band ? "?band=" + encodeURIComponent(band) : ""),
    {
      ...(payload === undefined
        ? {}
        : { method: "POST", body: JSON.stringify(payload) }),
      headers: {
        Origin: origin,
        "Content-Type": "application/json",
        "CF-Connecting-IP": `203.0.${Math.floor(++ip / 250)}.${ip % 250}`,
        ...(actor?.cookie ? { Cookie: actor.cookie } : {}),
        ...extra,
      },
    },
  );
  return {
    status: response.status,
    data: await response.json(),
    cookie: response.headers.get("set-cookie")?.split(";")[0],
  };
}
async function register(name) {
  const result = await request("/api/auth/register", {
    username: name,
    password: pass,
    display_name: name,
  });
  assert.equal(result.status, 200, JSON.stringify(result.data));
  return { cookie: result.cookie, ...result.data.user };
}
async function snap(actor, band) {
  const result = await request("/api/data", undefined, actor, band);
  assert.equal(result.status, 200, JSON.stringify(result.data));
  return result.data;
}
async function edit(actor, band, overrides = {}) {
  const data = await snap(actor, band);
  return request(
    "/api/data",
    {
      action: "batch_save",
      revision: data.revision,
      performance_name: "Concert",
      delete_rows: [],
      create_rows: [
        {
          title: "Song",
          part_name: "P1",
          instrument_name: "Marimba",
          instrument_remark: "Notes",
        },
      ],
      ...overrides,
    },
    actor,
    band,
  );
}
async function invite(actor, target, role, band = bandA) {
  const result = await request(
    "/api/invitations",
    { username: target.username, role },
    actor,
    band,
  );
  assert.equal(result.status, 200, JSON.stringify(result.data));
  return result.data;
}
async function accept(actor, code) {
  return request("/api/invitations/accept", { code }, actor);
}
before(async () => {
  mf = new Miniflare(
    convertV4MiniflareOptions({
      workers: [
        {
          name: "tenancy",
          modules: true,
          scriptPath: "server/worker.js",
          compatibilityDate: "2026-10-01",
          d1Databases: { DB: "tenancy" },
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
  async function migrate(name) {
    const sql = (await readFile("migrations/" + name, "utf8")).replace(
      /--[^\n]*/g,
      "",
    );
    for (const statement of sql
      .split(";")
      .map((s) => s.trim())
      .filter(Boolean))
      await db.prepare(statement).run();
  }
  await migrate("0001_initial.sql");
  await db.prepare("INSERT INTO players VALUES ('Legacy player')").run();
  await db
    .prepare(
      "INSERT INTO score_rows(performance_name,title,part_name,player_name,instrument_name,instrument_remark,checked) VALUES ('Old concert','Old song','Old part','Legacy player','Marimba','Keep this note',1)",
    )
    .run();
  await db.prepare("UPDATE metadata SET revision=17").run();
  await migrate("0002_accounts_and_bands.sql");
  alice = await register("alice");
  bob = await register("bob");
  editor = await register("editor");
  viewer = await register("viewer");
  admin = await register("admin");
  outsider = await register("outsider");
});
after(async () => mf?.dispose());

test("migration preserves legacy records; claim is private, authenticated and only succeeds once", async () => {
  assert.equal(
    (await request("/api/data", undefined, alice, "legacy")).status,
    403,
  );
  assert.equal(
    (await request("/api/legacy/claim", { key: "wrong" }, alice)).status,
    403,
  );
  assert.equal((await request("/api/legacy/claim", { key })).status, 401);
  const result = await Promise.all([
    request("/api/legacy/claim", { key }, alice),
    request("/api/legacy/claim", { key }, bob),
  ]);
  assert.deepEqual(result.map((r) => r.status).sort(), [200, 409]);
  legacyOwner = result[0].status === 200 ? alice : bob;
  const data = await snap(legacyOwner, "legacy");
  assert.equal(data.revision, 17);
  assert.equal(data.performances[0]._row, 1);
  assert.equal(data.performances[0].instrument_remark, "Keep this note");
  assert.equal(data.performances[0].checked, 1);
  assert.deepEqual(data.players, ["Legacy player"]);
  assert.equal(data.instruments.length, 26);
  const other = legacyOwner === alice ? bob : alice;
  assert.equal(
    (await request("/api/data", undefined, other, "legacy")).status,
    403,
  );
  assert.equal((await request("/api/login", { key })).status, 401);
});
test("account validation, unique normalized usernames, salted hashes and no password disclosure", async () => {
  assert.equal(
    (await request("/api/auth/register", { username: "ALICE", password: pass }))
      .status,
    409,
  );
  assert.equal(
    (
      await request("/api/auth/register", {
        username: "short",
        password: "short",
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await request("/api/auth/register", {
        username: "invalid name",
        password: pass,
      })
    ).status,
    400,
  );
  const users = await db
    .prepare("SELECT password_hash,password_salt FROM users")
    .all();
  assert.equal(new Set(users.results.map((u) => u.password_hash)).size, 6);
  assert.ok(
    users.results.every(
      (u) => u.password_hash !== pass && u.password_salt.length === 64,
    ),
  );
  const me = await request("/api/me", undefined, alice);
  assert.equal(me.status, 200);
  assert.equal(me.data.user.password_hash, undefined);
  assert.equal(
    (
      await request("/api/auth/login", {
        username: "alice",
        password: "Wrong password 123",
      })
    ).status,
    401,
  );
  assert.equal(
    (await request("/api/auth/login", { username: "missing", password: pass }))
      .status,
    401,
  );
});
test("each band has separate rows, catalog, roster, revision, export and membership", async () => {
  bandA = (await request("/api/bands", { name: "Band A" }, alice)).data.id;
  bandB = (await request("/api/bands", { name: "Band B" }, bob)).data.id;
  assert.ok(bandA && bandB && bandA !== bandB);
  assert.equal(
    (
      await edit(alice, bandA, {
        create_rows: [
          {
            title: "Only A",
            part_name: "A",
            instrument_name: "Custom A",
            player_name: "Player A",
          },
        ],
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await edit(bob, bandB, {
        create_rows: [
          {
            title: "Only B",
            part_name: "B",
            instrument_name: "Custom B",
            player_name: "Player B",
          },
        ],
      })
    ).status,
    200,
  );
  const a = await snap(alice, bandA),
    b = await snap(bob, bandB);
  assert.equal(a.revision, 1);
  assert.equal(b.revision, 1);
  assert.equal(a.performances.length, 1);
  assert.equal(b.performances.length, 1);
  assert.ok(!a.instruments.includes("Custom B"));
  assert.ok(!b.players.includes("Player A"));
  for (const path of ["/api/data", "/api/members", "/api/invitations"])
    assert.equal((await request(path, undefined, alice, bandB)).status, 403);
  assert.equal(
    (await request("/api/data", undefined, outsider, bandA)).status,
    403,
  );
  assert.equal((await request("/api/data", undefined, alice)).status, 400);
  assert.equal(
    (
      await request(
        "/api/data",
        {
          action: "ADD_INSTRUMENT",
          instrument_name: "Injected",
          revision: 1,
          band_id: bandB,
        },
        alice,
        bandA,
      )
    ).status,
    200,
  );
  assert.ok(!(await snap(bob, bandB)).instruments.includes("Injected"));
});
test("row-ID tampering cannot delete, check, or partially overwrite another band", async () => {
  const a = await snap(alice, bandA),
    b = await snap(bob, bandB),
    foreign = b.performances[0]._row;
  assert.equal(
    (await edit(alice, bandA, { delete_rows: [foreign] })).status,
    409,
  );
  assert.equal(
    (
      await request(
        "/api/data",
        {
          action: "set_checked",
          revision: a.revision,
          performance_name: "Concert",
          row_indexes: [foreign],
          checked: true,
        },
        alice,
        bandA,
      )
    ).status,
    409,
  );
  const after = await snap(alice, bandA);
  assert.equal(after.revision, a.revision);
  assert.deepEqual(after.performances, a.performances);
  assert.deepEqual((await snap(bob, bandB)).performances, b.performances);
});
test("targeted invitations are single-use; tokens are hashed and not listed", async () => {
  const invitation = await invite(alice, editor, "editor");
  assert.equal((await accept(outsider, invitation.code)).status, 403);
  assert.equal((await accept(editor, invitation.code)).status, 200);
  assert.equal((await accept(editor, invitation.code)).status, 409);
  const stored = await db
    .prepare("SELECT token_hash FROM invitations WHERE id=?")
    .bind(invitation.id)
    .first();
  assert.notEqual(stored.token_hash, invitation.code);
  const list = await request("/api/invitations", undefined, alice, bandA);
  assert.ok(!JSON.stringify(list.data).includes(invitation.code));
  assert.equal(list.data.invitations[0].token_hash, undefined);
  const readonly = await invite(alice, viewer, "viewer");
  assert.equal((await accept(viewer, readonly.code)).status, 200);
  const management = await invite(alice, admin, "admin");
  assert.equal((await accept(admin, management.code)).status, 200);
});
test("viewer can read/export but cannot write, import, invite or promote; editor cannot administer", async () => {
  const data = await snap(viewer, bandA);
  assert.ok(data.performances.length);
  for (const action of [
    "ADD_INSTRUMENT",
    "ADD_PLAYER",
    "batch_save",
    "set_checked",
    "import",
  ])
    assert.equal(
      (
        await request(
          "/api/data",
          { action, revision: data.revision },
          viewer,
          bandA,
        )
      ).status,
      403,
    );
  assert.equal(
    (
      await request(
        "/api/members",
        { user_id: viewer.id, role: "admin" },
        viewer,
        bandA,
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await request(
        "/api/invitations",
        { username: "outsider", role: "viewer" },
        viewer,
        bandA,
      )
    ).status,
    403,
  );
  assert.equal((await edit(editor, bandA)).status, 200);
  assert.equal(
    (
      await request(
        "/api/data",
        { action: "import", revision: 0, data: [] },
        editor,
        bandA,
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await request(
        "/api/members",
        { user_id: viewer.id, role: "editor" },
        editor,
        bandA,
      )
    ).status,
    403,
  );
  assert.equal(
    (await request("/api/members", undefined, editor, bandB)).status,
    403,
  );
});
test("administrators cannot grant admin, modify owner or other admins; owner can change roles", async () => {
  assert.equal(
    (
      await request(
        "/api/invitations",
        { username: "outsider", role: "admin" },
        admin,
        bandA,
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await request(
        "/api/members",
        { user_id: alice.id, action: "remove" },
        admin,
        bandA,
      )
    ).status,
    409,
  );
  assert.equal(
    (
      await request(
        "/api/members",
        { user_id: viewer.id, role: "admin" },
        admin,
        bandA,
      )
    ).status,
    409,
  );
  assert.equal(
    (
      await request(
        "/api/members",
        { user_id: viewer.id, role: "editor" },
        admin,
        bandA,
      )
    ).status,
    200,
  );
  assert.equal((await edit(viewer, bandA)).status, 200);
  assert.equal(
    (
      await request(
        "/api/members",
        { user_id: viewer.id, role: "viewer" },
        alice,
        bandA,
      )
    ).status,
    200,
  );
  assert.equal((await edit(viewer, bandA)).status, 403);
  assert.equal(
    (await request("/api/ownership", { user_id: admin.id }, admin, bandA))
      .status,
    403,
  );
});
test("expired and revoked invitations cannot be used; concurrent acceptance has one winner", async () => {
  const expired = await invite(alice, outsider, "viewer");
  await db
    .prepare("UPDATE invitations SET expires_at=0 WHERE id=?")
    .bind(expired.id)
    .run();
  assert.equal((await accept(outsider, expired.code)).status, 409);
  const revoked = await invite(alice, outsider, "viewer");
  assert.equal(
    (
      await request(
        "/api/invitations",
        { action: "revoke", id: revoked.id },
        alice,
        bandA,
      )
    ).status,
    200,
  );
  assert.equal((await accept(outsider, revoked.code)).status, 409);
  const fresh = await invite(alice, outsider, "viewer");
  const result = await Promise.all([
    accept(outsider, fresh.code),
    accept(outsider, fresh.code),
  ]);
  assert.deepEqual(result.map((r) => r.status).sort(), [200, 409]);
  assert.equal(
    (
      await request(
        "/api/members",
        { action: "remove", user_id: outsider.id },
        alice,
        bandA,
      )
    ).status,
    200,
  );
});
test("removal immediately invalidates data access; viewer can leave and owner cannot remove self", async () => {
  const inviteCode = await invite(admin, outsider, "editor");
  assert.equal((await accept(outsider, inviteCode.code)).status, 200);
  assert.equal((await snap(outsider, bandA)).band_id, bandA);
  assert.equal(
    (
      await request(
        "/api/members",
        { action: "remove", user_id: outsider.id },
        admin,
        bandA,
      )
    ).status,
    200,
  );
  assert.equal(
    (await request("/api/data", undefined, outsider, bandA)).status,
    403,
  );
  assert.equal(
    (
      await request(
        "/api/members",
        { action: "remove", user_id: viewer.id },
        viewer,
        bandA,
      )
    ).status,
    200,
  );
  assert.equal(
    (await request("/api/data", undefined, viewer, bandA)).status,
    403,
  );
  assert.equal(
    (
      await request(
        "/api/members",
        { action: "remove", user_id: alice.id },
        alice,
        bandA,
      )
    ).status,
    409,
  );
});
test("independent band revisions and permission guards prevent concurrent lost writes", async () => {
  const data = await snap(alice, bandA);
  const payload = {
    action: "ADD_INSTRUMENT",
    instrument_name: "Concurrent",
    revision: data.revision,
  };
  const result = await Promise.all([
    request("/api/data", payload, alice, bandA),
    request("/api/data", payload, alice, bandA),
  ]);
  assert.deepEqual(result.map((r) => r.status).sort(), [200, 409]);
  assert.equal((await snap(bob, bandB)).revision, 1);
});
test("ownership transfer is atomic and old owner loses owner-only authority", async () => {
  assert.equal(
    (await request("/api/ownership", { user_id: admin.id }, alice, bandA))
      .status,
    200,
  );
  const me = await request("/api/me", undefined, alice);
  assert.equal(me.data.bands.find((b) => b.id === bandA).role, "admin");
  assert.equal(
    (await request("/api/ownership", { user_id: alice.id }, alice, bandA))
      .status,
    403,
  );
  assert.equal(
    (
      await request(
        "/api/members",
        { action: "remove", user_id: admin.id },
        alice,
        bandA,
      )
    ).status,
    409,
  );
  assert.equal(
    (await request("/api/ownership", { user_id: alice.id }, admin, bandA))
      .status,
    200,
  );
});
test("password change revokes all sessions and logout revokes the server session", async () => {
  const login = await request("/api/auth/login", {
    username: "bob",
    password: pass,
  });
  assert.equal(login.status, 200);
  const second = { cookie: login.cookie };
  assert.equal(
    (
      await request(
        "/api/auth/password",
        { current_password: "wrong", new_password: "New password 456!" },
        bob,
      )
    ).status,
    401,
  );
  assert.equal(
    (
      await request(
        "/api/auth/password",
        { current_password: pass, new_password: "New password 456!" },
        bob,
      )
    ).status,
    200,
  );
  assert.equal((await request("/api/me", undefined, bob)).status, 401);
  assert.equal((await request("/api/me", undefined, second)).status, 401);
  assert.equal(
    (await request("/api/auth/login", { username: "bob", password: pass }))
      .status,
    401,
  );
  const next = await request("/api/auth/login", {
    username: "bob",
    password: "New password 456!",
  });
  assert.equal(next.status, 200);
  const active = { cookie: next.cookie };
  assert.equal((await request("/api/auth/logout", {}, active)).status, 200);
  assert.equal((await request("/api/me", undefined, active)).status, 401);
});

test('legacy unscoped table names are absent, so old Worker rollbacks fail closed', async () => {
  for (const table of ['score_rows','instruments','players']) {
    await assert.rejects(db.prepare(`SELECT * FROM ${table}`).all(), /no such table/);
  }
});
test('expired and random valid-format session tokens are rejected', async () => {
  assert.equal((await request('/api/me',undefined,{cookie:'percussion_session='+ 'a'.repeat(64)})).status,401);
  await db.prepare('UPDATE sessions SET expires_at=1 WHERE user_id=?').bind(outsider.id).run();
  assert.equal((await request('/api/me',undefined,outsider)).status,401);
});
