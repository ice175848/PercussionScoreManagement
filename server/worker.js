const FIELDS = [
  "performance_name",
  "title",
  "composer",
  "arranger",
  "part_name",
  "player_name",
  "instrument_name",
  "instrument_remark",
];
const MAX_BODY = 2_000_000;
const SESSION_SECONDS = 8 * 60 * 60;
class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
const json = (body, status = 200, headers = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      ...headers,
    },
  });
function text(value, required = false) {
  if (
    value !== undefined &&
    value !== null &&
    !["string", "number"].includes(typeof value)
  )
    throw new HttpError(400, "文字欄位格式錯誤");
  const result = String(value ?? "").trim();
  if (result.length > 1000 || (required && !result))
    throw new HttpError(400, "必填欄位缺漏或超過 1000 字");
  return result;
}
function rows(values, perfName) {
  if (!Array.isArray(values) || values.length > 5000)
    throw new HttpError(400, "資料須為陣列，單次最多 5000 筆");
  return values.map((row) => {
    if (!row || typeof row !== "object" || Array.isArray(row))
      throw new HttpError(400, "資料列格式錯誤");
    return {
      ...Object.fromEntries(
        FIELDS.map((field) => [
          field,
          text(
            field === "performance_name"
              ? (perfName ?? row[field])
              : row[field],
            ["performance_name", "title"].includes(field),
          ),
        ]),
      ),
      checked:
        row.checked === true ||
        row.checked === 1 ||
        (row.checked === undefined &&
          ["已清點", "checked"].includes(row.instrument_remark))
          ? 1
          : 0,
    };
  });
}
function ids(values) {
  if (
    !Array.isArray(values) ||
    values.length > 1000 ||
    values.some((id) => !Number.isSafeInteger(id) || id <= 0)
  )
    throw new HttpError(400, "資料 ID 格式錯誤");
  return [...new Set(values)];
}
async function body(request) {
  if (!request.headers.get("Content-Type")?.startsWith("application/json"))
    throw new HttpError(415, "請使用 JSON");
  const reader = request.body?.getReader();
  if (!reader) throw new HttpError(400, "缺少 JSON");
  let size = 0;
  const chunks = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > MAX_BODY) {
      await reader.cancel();
      throw new HttpError(413, "資料不可超過 2 MB");
    }
    chunks.push(value);
  }
  try {
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
    const value = JSON.parse(new TextDecoder().decode(bytes));
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw new Error();
    return value;
  } catch {
    throw new HttpError(400, "JSON 格式錯誤");
  }
}
const hex = (bytes) =>
  [...new Uint8Array(bytes)]
    .map((n) => n.toString(16).padStart(2, "0"))
    .join("");
async function digest(value) {
  return hex(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
  );
}
async function equal(a, b) {
  return (await digest(a)) === (await digest(b));
}
function cookie(request, value, age) {
  return `percussion_session=${value}; HttpOnly; SameSite=Strict; Path=/api; Max-Age=${age}${new URL(request.url).protocol === "https:" ? "; Secure" : ""}`;
}
async function snapshot(db, band) {
  // One transactional batch keeps the revision and exported data consistent.
  const result = await db.batch([
    db.prepare("SELECT revision FROM bands WHERE id=?").bind(band),
    db
      .prepare(
        "SELECT name FROM band_instruments WHERE band_id=? ORDER BY name",
      )
      .bind(band),
    db
      .prepare("SELECT name FROM band_players WHERE band_id=? ORDER BY name")
      .bind(band),
    db
      .prepare(
        "SELECT id AS _row, performance_name, title, composer, arranger, part_name, player_name, instrument_name, instrument_remark, checked FROM band_score_rows WHERE band_id=? ORDER BY id",
      )
      .bind(band),
  ]);
  return {
    version: 1,
    band_id: band,
    revision: result[0].results[0].revision,
    instruments: result[1].results.map((r) => r.name),
    players: result[2].results.map((r) => r.name),
    performances: result[3].results,
  };
}
function insertRows(db, data, band) {
  // json_each uses one statement so imports stay within the Free subrequest budget.
  return db
    .prepare(
      `INSERT INTO band_score_rows (band_id,${FIELDS.join(",")},checked) SELECT ?,${[...FIELDS, "checked"].map((f) => `json_extract(value,'$.${f}')`).join(",")} FROM json_each(?)`,
    )
    .bind(band, JSON.stringify(data));
}
async function mutate(db, payload, band, user) {
  if (!Number.isSafeInteger(payload.revision) || payload.revision < 0)
    throw new HttpError(400, "缺少有效資料版本，請重新載入");
  const statements = [
    permissionGuard(
      db,
      band,
      user,
      payload.action === "import" ? "admin" : "editor",
    ),
    db
      .prepare(
        "INSERT OR REPLACE INTO write_guard(id) SELECT CASE WHEN revision=? THEN 1 ELSE 0 END FROM bands WHERE id=?",
      )
      .bind(payload.revision, band),
  ];
  if (payload.action === "ADD_INSTRUMENT" || payload.action === "ADD_PLAYER") {
    const instrument = payload.action === "ADD_INSTRUMENT";
    statements.push(
      db
        .prepare(
          `INSERT OR IGNORE INTO ${instrument ? "band_instruments" : "band_players"}(band_id,name) VALUES (?,?)`,
        )
        .bind(
          band,
          text(payload[instrument ? "instrument_name" : "player_name"], true),
        ),
    );
  } else if (payload.action === "batch_save") {
    const perf = text(payload.performance_name, true);
    const deleted = ids(payload.delete_rows ?? []);
    const created = rows(payload.create_rows, perf);
    // Validate deletion scope inside the transaction. Never delete another performance's rows.
    statements.push(
      db
        .prepare(
          "INSERT OR REPLACE INTO write_guard(id) SELECT CASE WHEN COUNT(*)=? THEN 1 ELSE 0 END FROM band_score_rows WHERE band_id=? AND performance_name=? AND id IN (SELECT value FROM json_each(?))",
        )
        .bind(
          deleted.length,
          band,
          text(payload.original_performance_name ?? perf, true),
          JSON.stringify(deleted),
        ),
    );
    statements.push(
      db
        .prepare(
          "DELETE FROM band_score_rows WHERE band_id=? AND id IN (SELECT value FROM json_each(?))",
        )
        .bind(band, JSON.stringify(deleted)),
      insertRows(db, created, band),
    );
    // Keep newly entered instruments and players in their global pools.
    const instruments = [
      ...new Set(created.map((r) => r.instrument_name).filter(Boolean)),
    ];
    const players = [
      ...new Set(
        created.flatMap((r) =>
          r.player_name
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean),
        ),
      ),
    ];
    statements.push(
      db
        .prepare(
          "INSERT OR IGNORE INTO band_instruments(band_id,name) SELECT ?,value FROM json_each(?)",
        )
        .bind(band, JSON.stringify(instruments)),
      db
        .prepare(
          "INSERT OR IGNORE INTO band_players(band_id,name) SELECT ?,value FROM json_each(?)",
        )
        .bind(band, JSON.stringify(players)),
    );
  } else if (payload.action === "set_checked") {
    const selected = ids(payload.row_indexes);
    if (typeof payload.checked !== "boolean")
      throw new HttpError(400, "清點狀態格式錯誤");
    const perf = text(payload.performance_name, true);
    statements.push(
      db
        .prepare(
          "INSERT OR REPLACE INTO write_guard(id) SELECT CASE WHEN COUNT(*)=? THEN 1 ELSE 0 END FROM band_score_rows WHERE band_id=? AND performance_name=? AND id IN (SELECT value FROM json_each(?))",
        )
        .bind(selected.length, band, perf, JSON.stringify(selected)),
    );
    statements.push(
      db
        .prepare(
          "UPDATE band_score_rows SET checked=? WHERE band_id=? AND performance_name=? AND id IN (SELECT value FROM json_each(?))",
        )
        .bind(payload.checked ? 1 : 0, band, perf, JSON.stringify(selected)),
    );
  } else if (payload.action === "import") {
    const data = payload.data;
    const source = Array.isArray(data) ? { performances: data } : data;
    if (!source || !Array.isArray(source.performances))
      throw new HttpError(400, "匯入格式錯誤");
    if (
      (source.instruments !== undefined &&
        !Array.isArray(source.instruments)) ||
      (source.players !== undefined && !Array.isArray(source.players))
    )
      throw new HttpError(400, "名冊格式錯誤");
    if (source.version !== undefined && source.version !== 1)
      throw new HttpError(400, "不支援此備份版本");
    const imported = rows(source.performances);
    const pool = (list = []) => {
      if (!Array.isArray(list) || list.length > 5000)
        throw new HttpError(400, "名冊格式錯誤");
      return [...new Set(list.map((value) => text(value, true)))];
    };
    const instruments = pool([
      ...(source.instruments || []),
      ...imported.map((r) => r.instrument_name).filter(Boolean),
    ]);
    const players = pool([
      ...(source.players || []),
      ...imported.flatMap((r) =>
        r.player_name
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
      ),
    ]);
    // Import is a first-run migration/restore, never an implicit overwrite or duplicate merge.
    statements.push(
      db
        .prepare(
          "INSERT OR REPLACE INTO write_guard(id) SELECT CASE WHEN COUNT(*)=0 THEN 1 ELSE 0 END FROM band_score_rows WHERE band_id=?",
        )
        .bind(band),
    );
    statements.push(
      db.prepare("DELETE FROM band_instruments WHERE band_id=?").bind(band),
      db.prepare("DELETE FROM band_players WHERE band_id=?").bind(band),
      insertRows(db, imported, band),
    );
    statements.push(
      db
        .prepare(
          "INSERT INTO band_instruments(band_id,name) SELECT ?,value FROM json_each(?)",
        )
        .bind(band, JSON.stringify(instruments)),
      db
        .prepare(
          "INSERT INTO band_players(band_id,name) SELECT ?,value FROM json_each(?)",
        )
        .bind(band, JSON.stringify(players)),
    );
  } else throw new HttpError(400, "不支援的操作");
  statements.push(
    db.prepare("UPDATE bands SET revision=revision+1 WHERE id=?").bind(band),
    db.prepare("DELETE FROM write_guard"),
  );
  try {
    await db.batch(statements);
  } catch (error) {
    if (/CHECK constraint failed/.test(String(error)))
      throw new HttpError(
        409,
        "資料已被更新、資料 ID 不符，或匯入目標不是空資料庫。請重新載入後確認。",
      );
    throw error;
  }
  return { success: true, revision: payload.revision + 1 };
}

const DEFAULT_INSTRUMENTS = [
  "Timpani",
  "Drumset",
  "Bongo",
  "Conga",
  "Tom-Tom",
  "Floor Tom",
  "Snare Drum",
  "Bass Drum",
  "Suspend Cymbal",
  "Crash Cymbals",
  "Hi-hats",
  "Ride Cymbal",
  "Triangle",
  "Tambourine",
  "Cowbell",
  "Claves",
  "Guiro",
  "Cabasa",
  "Shaker",
  "Sleigh Bell",
  "Wind Chimes",
  "Bells",
  "Xylophone",
  "Marimba",
  "Vibraphone",
  "Chimes",
];
const now = () => Math.floor(Date.now() / 1000);
const token = () => hex(crypto.getRandomValues(new Uint8Array(32)));
function username(value) {
  const name = String(value ?? "")
    .trim()
    .toLowerCase();
  if (!/^[a-z0-9][a-z0-9_.-]{2,39}$/.test(name))
    throw new HttpError(400, "帳號須為 3–40 碼英文、數字、底線、點或連字號");
  return name;
}
function password(value) {
  if (typeof value !== "string" || value.length < 12 || value.length > 128)
    throw new HttpError(400, "密碼須為 12–128 個字元");
  return value;
}
async function passwordHash(value, salt, pepper) {
  const material = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(value),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  // Workers Free caps WebCrypto PBKDF2 at 100k. A separately stored pepper
  // prevents offline password verification from a database-only disclosure.
  const derived = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      salt: new TextEncoder().encode(salt),
      iterations: 100000,
    },
    material,
    256,
  );
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(pepper),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return hex(await crypto.subtle.sign("HMAC", key, derived));
}
async function limited(request, env) {
  if (!env.LOGIN_LIMITER) throw new HttpError(503, "登入限制尚未設定");
  const { success } = await env.LOGIN_LIMITER.limit({
    key: request.headers.get("CF-Connecting-IP") || "local",
  });
  if (!success) throw new HttpError(429, "嘗試過多，請稍候一分鐘再試");
}
function sessionToken(request) {
  return (
    request.headers
      .get("Cookie")
      ?.match(/(?:^|;\s*)percussion_session=([a-f0-9]{64})(?:;|$)/)?.[1] || ""
  );
}
async function principal(request, db) {
  const raw = sessionToken(request);
  if (!raw) throw new HttpError(401, "請先登入會員帳號");
  const result = await db
    .prepare(
      "SELECT u.id,u.username,u.display_name FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>?",
    )
    .bind(await digest(raw), now())
    .first();
  if (!result) throw new HttpError(401, "登入已到期，請重新登入");
  return result;
}
async function issueSession(request, db, userId) {
  const raw = token();
  const old = sessionToken(request);
  await db.batch([
    db
      .prepare("DELETE FROM sessions WHERE expires_at<=? OR token_hash=?")
      .bind(now(), await digest(old)),
    db
      .prepare("INSERT INTO sessions VALUES (?,?,?,?)")
      .bind(await digest(raw), userId, now() + SESSION_SECONDS, now()),
  ]);
  return cookie(request, raw, SESSION_SECONDS);
}
async function member(db, band, user) {
  const result = await db
    .prepare(
      "SELECT b.id,b.name,CASE WHEN b.owner_id=m.user_id THEN 'owner' ELSE m.role END AS role FROM bands b JOIN memberships m ON m.band_id=b.id WHERE b.id=? AND m.user_id=?",
    )
    .bind(band, user)
    .first();
  if (!result) throw new HttpError(403, "你沒有此樂團的存取權限");
  return result;
}
function requireRole(membership, required) {
  const ranks = { viewer: 0, editor: 1, admin: 2, owner: 3 };
  if (ranks[membership.role] < ranks[required])
    throw new HttpError(403, "你的樂團角色沒有此操作權限");
}
function permissionGuard(db, band, user, role) {
  const roles =
    role === "viewer"
      ? ["admin", "editor", "viewer"]
      : role === "editor"
        ? ["admin", "editor"]
        : ["admin"];
  return db
    .prepare(
      `INSERT OR REPLACE INTO write_guard(id) SELECT CASE WHEN EXISTS (SELECT 1 FROM memberships m JOIN bands b ON b.id=m.band_id WHERE m.band_id=? AND m.user_id=? AND (b.owner_id=m.user_id OR (?!='owner' AND m.role IN (SELECT value FROM json_each(?))))) THEN 1 ELSE 0 END`,
    )
    .bind(band, user, role, JSON.stringify(roles));
}
const guard = (db, sql, ...values) =>
  db
    .prepare(
      `INSERT OR REPLACE INTO write_guard(id) SELECT CASE WHEN (${sql}) THEN 1 ELSE 0 END`,
    )
    .bind(...values);
async function transaction(db, statements) {
  try {
    await db.batch([...statements, db.prepare("DELETE FROM write_guard")]);
  } catch (error) {
    if (/constraint failed/i.test(String(error)))
      throw new HttpError(
        409,
        "資料或權限已變更，或操作條件不符；請重新載入確認",
      );
    throw error;
  }
}
async function accountRoutes(request, env, path) {
  const db = env.DB;
  if (
    ["/api/auth/register", "/api/auth/login"].includes(path) &&
    request.method === "POST"
  ) {
    await limited(request, env);
    const input = await body(request);
    const name = username(input.username);
    const pass = password(input.password);
    let user;
    if (path.endsWith("/register")) {
      const display = text(input.display_name || name, true);
      if (display.length > 80)
        throw new HttpError(400, "顯示名稱不可超過 80 字");
      const id = crypto.randomUUID(),
        salt = token();
      const hash = await passwordHash(pass, salt, env.AUTH_PEPPER);
      try {
        await db
          .prepare("INSERT INTO users VALUES (?,?,?,?,?,?)")
          .bind(id, name, display, hash, salt, now())
          .run();
      } catch (error) {
        if (/UNIQUE constraint failed/.test(String(error)))
          throw new HttpError(409, "此帳號無法使用，請選擇其他帳號");
        throw error;
      }
      user = { id, username: name, display_name: display };
    } else {
      const found = await db
        .prepare("SELECT * FROM users WHERE username=?")
        .bind(name)
        .first();
      const hash = await passwordHash(
        pass,
        found?.password_salt || "unregistered-account-placeholder",
        env.AUTH_PEPPER,
      );
      if (!found || !(await equal(hash, found.password_hash)))
        throw new HttpError(401, "帳號或密碼不正確");
      user = {
        id: found.id,
        username: found.username,
        display_name: found.display_name,
      };
    }
    return json({ user }, 200, {
      "Set-Cookie": await issueSession(request, db, user.id),
    });
  }
  if (
    (path === "/api/auth/logout" || path === "/api/logout") &&
    request.method === "POST"
  ) {
    await db
      .prepare("DELETE FROM sessions WHERE token_hash=?")
      .bind(await digest(sessionToken(request)))
      .run();
    return json({ success: true }, 200, {
      "Set-Cookie": cookie(request, "", 0),
    });
  }
  return null;
}
export default {
  async fetch(request, env) {
    const url = new URL(request.url),
      path = url.pathname,
      db = env.DB;
    if (!path.startsWith("/api/")) return env.ASSETS.fetch(request);
    try {
      if (path === "/api/health" && request.method === "GET") {
        await db.prepare("SELECT id FROM bands LIMIT 1").first();
        return json({ status: "ok", database: "up" });
      }
      if (!env.AUTH_PEPPER || env.AUTH_PEPPER.length < 32)
        throw new HttpError(503, "會員登入尚未完成設定");
      if (!["GET", "POST"].includes(request.method))
        throw new HttpError(405, "不支援的方法");
      if (
        request.method === "POST" &&
        request.headers.get("Origin") !== url.origin
      )
        throw new HttpError(403, "來源驗證失敗");
      const account = await accountRoutes(request, env, path);
      if (account) return account;
      const user = await principal(request, db);
      if (path === "/api/me" && request.method === "GET") {
        const bands = await db
          .prepare(
            "SELECT b.id,b.name,CASE WHEN b.owner_id=m.user_id THEN 'owner' ELSE m.role END AS role FROM bands b JOIN memberships m ON m.band_id=b.id WHERE m.user_id=? ORDER BY b.created_at,b.id",
          )
          .bind(user.id)
          .all();
        return json({ user, bands: bands.results });
      }
      if (path === "/api/auth/password" && request.method === "POST") {
        await limited(request, env);
        const input = await body(request),
          next = password(input.new_password);
        const stored = await db
          .prepare("SELECT password_hash,password_salt FROM users WHERE id=?")
          .bind(user.id)
          .first();
        if (
          typeof input.current_password !== "string" ||
          input.current_password.length > 128 ||
          !(await equal(
            await passwordHash(
              input.current_password,
              stored.password_salt,
              env.AUTH_PEPPER,
            ),
            stored.password_hash,
          ))
        )
          throw new HttpError(401, "目前密碼不正確");
        const salt = token(),
          hash = await passwordHash(next, salt, env.AUTH_PEPPER);
        await transaction(db, [
          guard(
            db,
            "EXISTS(SELECT 1 FROM users WHERE id=? AND password_hash=?)",
            user.id,
            stored.password_hash,
          ),
          db
            .prepare(
              "UPDATE users SET password_hash=?,password_salt=? WHERE id=?",
            )
            .bind(hash, salt, user.id),
          db.prepare("DELETE FROM sessions WHERE user_id=?").bind(user.id),
        ]);
        return json({ success: true }, 200, {
          "Set-Cookie": cookie(request, "", 0),
        });
      }
      if (path === "/api/bands" && request.method === "POST") {
        const input = await body(request),
          name = text(input.name, true),
          id = crypto.randomUUID();
        if (name.length > 100)
          throw new HttpError(400, "樂團名稱不可超過 100 字");
        await transaction(db, [
          guard(
            db,
            "(SELECT COUNT(*) FROM bands WHERE owner_id=?)<20",
            user.id,
          ),
          db
            .prepare(
              "INSERT INTO bands(id,name,owner_id,created_at) VALUES (?,?,?,?)",
            )
            .bind(id, name, user.id, now()),
          db
            .prepare("INSERT INTO memberships VALUES (?,?,'admin')")
            .bind(id, user.id),
          db
            .prepare(
              "INSERT INTO band_instruments(band_id,name) SELECT ?,value FROM json_each(?)",
            )
            .bind(id, JSON.stringify(DEFAULT_INSTRUMENTS)),
        ]);
        return json({ id, name, role: "owner" });
      }
      if (path === "/api/legacy/claim" && request.method === "POST") {
        await limited(request, env);
        const input = await body(request);
        if (
          !env.ADMIN_KEY ||
          env.ADMIN_KEY.length < 32 ||
          typeof input.key !== "string" ||
          input.key.length > 1000 ||
          !(await equal(input.key, env.ADMIN_KEY))
        )
          throw new HttpError(403, "原管理金鑰不正確");
        await transaction(db, [
          guard(
            db,
            "EXISTS(SELECT 1 FROM bands WHERE id='legacy' AND owner_id IS NULL)",
          ),
          db
            .prepare("UPDATE bands SET owner_id=? WHERE id='legacy'")
            .bind(user.id),
          db
            .prepare("INSERT INTO memberships VALUES ('legacy',?,'admin')")
            .bind(user.id),
        ]);
        return json({ id: "legacy", success: true });
      }
      if (path === "/api/invitations/accept" && request.method === "POST") {
        const input = await body(request);
        if (
          typeof input.code !== "string" ||
          !/^[a-f0-9]{64}$/.test(input.code)
        )
          throw new HttpError(400, "邀請碼格式錯誤");
        const hash = await digest(input.code);
        const invite = await db
          .prepare(
            "SELECT id,band_id FROM invitations WHERE token_hash=? AND username=?",
          )
          .bind(hash, user.username)
          .first();
        if (!invite) throw new HttpError(403, "此邀請無效或不是提供給你的帳號");
        await transaction(db, [
          guard(
            db,
            "EXISTS(SELECT 1 FROM invitations i JOIN memberships m ON m.band_id=i.band_id AND m.user_id=i.created_by JOIN bands b ON b.id=i.band_id WHERE (i.role!='admin' OR b.owner_id=i.created_by) AND i.id=? AND i.username=? AND i.used_at IS NULL AND i.revoked_at IS NULL AND i.expires_at>? AND m.role='admin')",
            invite.id,
            user.username,
            now(),
          ),
          db
            .prepare(
              "INSERT INTO memberships(band_id,user_id,role) SELECT band_id,?,role FROM invitations WHERE id=?",
            )
            .bind(user.id, invite.id),
          db
            .prepare("UPDATE invitations SET used_at=? WHERE id=?")
            .bind(now(), invite.id),
        ]);
        return json({ id: invite.band_id, success: true });
      }
      const band = url.searchParams.get("band");
      if (!band) throw new HttpError(400, "請先選擇樂團空間");
      const access = await member(db, band, user.id);
      if (path === "/api/data") {
        if (request.method === "GET") return json(await snapshot(db, band));
        const input = await body(request);
        requireRole(access, input.action === "import" ? "admin" : "editor");
        return json(await mutate(db, input, band, user.id));
      }
      if (path === "/api/members" && request.method === "GET") {
        const members = await db
          .prepare(
            "SELECT u.id,u.username,u.display_name,CASE WHEN b.owner_id=m.user_id THEN 'owner' ELSE m.role END AS role FROM memberships m JOIN users u ON u.id=m.user_id JOIN bands b ON b.id=m.band_id WHERE m.band_id=? ORDER BY u.username",
          )
          .bind(band)
          .all();
        return json({ members: members.results });
      }
      if (path === "/api/members" && request.method === "POST") {
        const input = await body(request),
          target = text(input.user_id, true);
        const selfLeave = target === user.id && input.action === "remove";
        if (!selfLeave) requireRole(access, "admin");
        if (
          input.action !== "remove" &&
          !["admin", "editor", "viewer"].includes(input.role)
        )
          throw new HttpError(400, "角色格式錯誤");
        await transaction(db, [
          permissionGuard(db, band, user.id, selfLeave ? "viewer" : "admin"),
          guard(
            db,
            "NOT EXISTS(SELECT 1 FROM bands WHERE id=? AND owner_id=?)",
            band,
            target,
          ),
          guard(
            db,
            "EXISTS(SELECT 1 FROM bands WHERE id=? AND owner_id=?) OR ?=? OR (EXISTS(SELECT 1 FROM memberships WHERE band_id=? AND user_id=? AND role!='admin') AND ?!='admin')",
            band,
            user.id,
            target,
            user.id,
            band,
            target,
            input.role || "",
          ),
          ...(input.action === "remove"
            ? [
                db
                  .prepare(
                    "DELETE FROM memberships WHERE band_id=? AND user_id=?",
                  )
                  .bind(band, target),
              ]
            : [
                db
                  .prepare(
                    "UPDATE memberships SET role=? WHERE band_id=? AND user_id=?",
                  )
                  .bind(input.role, band, target),
              ]),
          db
            .prepare(
              "UPDATE invitations SET revoked_at=? WHERE band_id=? AND created_by=? AND used_at IS NULL AND revoked_at IS NULL",
            )
            .bind(now(), band, target),
        ]);
        return json({ success: true });
      }
      if (path === "/api/ownership" && request.method === "POST") {
        requireRole(access, "owner");
        const input = await body(request),
          target = text(input.user_id, true);
        await transaction(db, [
          permissionGuard(db, band, user.id, "owner"),
          guard(
            db,
            "EXISTS(SELECT 1 FROM memberships WHERE band_id=? AND user_id=?)",
            band,
            target,
          ),
          db
            .prepare(
              "UPDATE memberships SET role='admin' WHERE band_id=? AND user_id=?",
            )
            .bind(band, target),
          db
            .prepare("UPDATE bands SET owner_id=? WHERE id=?")
            .bind(target, band),
        ]);
        return json({ success: true });
      }
      if (path === "/api/invitations") {
        requireRole(access, "admin");
        if (request.method === "GET") {
          const invitations = await db
            .prepare(
              "SELECT id,username,role,expires_at,used_at,revoked_at FROM invitations WHERE band_id=? ORDER BY expires_at DESC LIMIT 200",
            )
            .bind(band)
            .all();
          return json({ invitations: invitations.results });
        }
        const input = await body(request);
        if (input.action === "revoke") {
          await transaction(db, [
            permissionGuard(db, band, user.id, "admin"),
            db
              .prepare(
                "UPDATE invitations SET revoked_at=? WHERE band_id=? AND id=? AND used_at IS NULL",
              )
              .bind(now(), band, text(input.id, true)),
          ]);
          return json({ success: true });
        }
        const name = username(input.username),
          role = input.role;
        if (!["admin", "editor", "viewer"].includes(role))
          throw new HttpError(400, "角色格式錯誤");
        if (role === "admin") requireRole(access, "owner");
        const raw = token(),
          id = crypto.randomUUID();
        await transaction(db, [
          permissionGuard(
            db,
            band,
            user.id,
            role === "admin" ? "owner" : "admin",
          ),
          guard(
            db,
            "NOT EXISTS(SELECT 1 FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.band_id=? AND u.username=?)",
            band,
            name,
          ),
          db
            .prepare(
              "INSERT INTO invitations(id,band_id,username,role,token_hash,created_by,expires_at) VALUES (?,?,?,?,?,?,?)",
            )
            .bind(
              id,
              band,
              name,
              role,
              await digest(raw),
              user.id,
              now() + 7 * 86400,
            ),
        ]);
        return json({ id, code: raw, expires_at: now() + 7 * 86400 });
      }
      throw new HttpError(404, "找不到此 API");
    } catch (error) {
      if (!error.status) console.error("API operation failed:", error.message);
      return json(
        {
          error: error.status
            ? error.message
            : "伺服器無法完成操作，請稍後重試",
        },
        error.status || 500,
      );
    }
  },
};
