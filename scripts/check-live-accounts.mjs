// Only run against the disposable verification Worker, never a real band's data.
import assert from "node:assert/strict";
const base =
  process.env.ACCOUNTS_CHECK_URL ||
  "https://percussion-sync-accounts-check.memory509609.workers.dev";
if (!new URL(base).hostname.startsWith("percussion-sync-accounts-check."))
  throw new Error(
    "Refusing to create test accounts outside the disposable check Worker",
  );
const suffix = crypto.randomUUID().slice(0, 8),
  password = "Disposable cloud QA 123!";
async function request(path, payload, actor, band) {
  const response = await fetch(
    base + path + (band ? "?band=" + encodeURIComponent(band) : ""),
    {
      method: payload === undefined ? "GET" : "POST",
      headers: {
        Origin: base,
        "Content-Type": "application/json",
        ...(actor?.cookie ? { Cookie: actor.cookie } : {}),
      },
      ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
    },
  );
  const raw = await response.text();
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new Error(`${path} HTTP ${response.status}: ${raw.slice(0, 160)}`);
  }
  return {
    status: response.status,
    data,
    cookie: response.headers.get("set-cookie")?.split(";")[0],
  };
}
const register = async (name) => {
  const username = `qa-${name}-${suffix}`;
  const result = await request("/api/auth/register", { username, password });
  assert.equal(result.status, 200, JSON.stringify(result.data));
  return { username, ...result };
};
assert.equal((await request("/api/me")).status, 401);
const owner = await register("owner"),
  outsider = await register("outsider"),
  viewer = await register("viewer");
const band = (
  await request("/api/bands", { name: "Disposable QA band" }, owner)
).data.id;
const otherBand = (
  await request("/api/bands", { name: "Other disposable band" }, outsider)
).data.id;
assert.ok(band && otherBand);
assert.equal(
  (await request("/api/data", undefined, outsider, band)).status,
  403,
);
const snapshot = await request("/api/data", undefined, owner, band);
assert.equal(snapshot.status, 200);
assert.equal(
  (
    await request(
      "/api/data",
      {
        action: "batch_save",
        revision: snapshot.data.revision,
        performance_name: "QA concert",
        delete_rows: [],
        create_rows: [
          {
            title: "QA song",
            part_name: "P1",
            instrument_name: "Marimba",
            instrument_remark: "Keep note",
          },
        ],
      },
      owner,
      band,
    )
  ).status,
  200,
);
const saved = await request("/api/data", undefined, owner, band);
assert.equal(saved.data.performances.length, 1);
assert.equal(
  (await request("/api/data", undefined, outsider, otherBand)).data.performances
    .length,
  0,
);
const invite = await request(
  "/api/invitations",
  { username: viewer.username, role: "viewer" },
  owner,
  band,
);
assert.equal(invite.status, 200);
assert.equal(
  (
    await request(
      "/api/invitations/accept",
      { code: invite.data.code },
      outsider,
    )
  ).status,
  403,
);
assert.equal(
  (await request("/api/invitations/accept", { code: invite.data.code }, viewer))
    .status,
  200,
);
assert.equal((await request("/api/data", undefined, viewer, band)).status, 200);
assert.equal(
  (
    await request(
      "/api/data",
      {
        action: "ADD_PLAYER",
        player_name: "forbidden",
        revision: saved.data.revision,
      },
      viewer,
      band,
    )
  ).status,
  403,
);
assert.equal(
  (await request("/api/invitations/accept", { code: invite.data.code }, viewer))
    .status,
  409,
);
assert.equal(
  (
    await request(
      "/api/members",
      { action: "remove", user_id: viewer.data.user.id },
      owner,
      band,
    )
  ).status,
  200,
);
assert.equal((await request("/api/data", undefined, viewer, band)).status, 403);
assert.equal((await request("/api/auth/logout", {}, owner)).status, 200);
assert.equal((await request("/api/me", undefined, owner)).status, 401);
assert.equal(
  (
    await request("/api/auth/login", {
      username: owner.username,
      password: "incorrect password",
    })
  ).status,
  401,
);
const login = await request("/api/auth/login", {
  username: owner.username,
  password,
});
assert.equal(login.status, 200, JSON.stringify(login.data));
assert.equal((await request("/api/data", undefined, login, band)).status, 200);
console.log(
  "Cloudflare Free live checks: registration, password login, sessions, band isolation, persistence, viewer permissions, targeted/single-use invitation, member revocation and logout PASS",
);
