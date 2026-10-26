CREATE TABLE users (
 id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE COLLATE NOCASE,
 display_name TEXT NOT NULL, password_hash TEXT NOT NULL, password_salt TEXT NOT NULL,
 created_at INTEGER NOT NULL
);
CREATE TABLE bands (
 id TEXT PRIMARY KEY, name TEXT NOT NULL,
 owner_id TEXT REFERENCES users(id), revision INTEGER NOT NULL DEFAULT 0,
 created_at INTEGER NOT NULL
);
INSERT INTO bands(id,name,revision,created_at) SELECT 'legacy','既有樂團',revision,unixepoch() FROM metadata WHERE id=1;
CREATE TABLE memberships (
 band_id TEXT NOT NULL REFERENCES bands(id), user_id TEXT NOT NULL REFERENCES users(id),
 role TEXT NOT NULL CHECK(role IN ('admin','editor','viewer')),
 PRIMARY KEY(band_id,user_id)
);
CREATE INDEX memberships_user ON memberships(user_id,band_id);
CREATE TABLE sessions (
 token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id),
 expires_at INTEGER NOT NULL, created_at INTEGER NOT NULL
);
CREATE INDEX sessions_user ON sessions(user_id);
CREATE INDEX sessions_expiry ON sessions(expires_at);
CREATE TABLE invitations (
 id TEXT PRIMARY KEY, band_id TEXT NOT NULL REFERENCES bands(id),
 username TEXT NOT NULL COLLATE NOCASE, role TEXT NOT NULL CHECK(role IN ('admin','editor','viewer')),
 token_hash TEXT NOT NULL UNIQUE, created_by TEXT NOT NULL REFERENCES users(id),
 expires_at INTEGER NOT NULL, used_at INTEGER, revoked_at INTEGER
);
CREATE INDEX invitations_band ON invitations(band_id);
CREATE TABLE migration_score_sequence (seq INTEGER NOT NULL);
INSERT INTO migration_score_sequence SELECT seq FROM sqlite_sequence WHERE name='score_rows';
CREATE TABLE score_rows_v2 (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 performance_name TEXT NOT NULL, title TEXT NOT NULL,
 composer TEXT NOT NULL DEFAULT '', arranger TEXT NOT NULL DEFAULT '',
 part_name TEXT NOT NULL DEFAULT '', player_name TEXT NOT NULL DEFAULT '',
 instrument_name TEXT NOT NULL DEFAULT '', instrument_remark TEXT NOT NULL DEFAULT '',
 checked INTEGER NOT NULL DEFAULT 0 CHECK(checked IN (0,1)),
 band_id TEXT NOT NULL DEFAULT 'legacy' REFERENCES bands(id)
);
INSERT INTO score_rows_v2(id,performance_name,title,composer,arranger,part_name,player_name,instrument_name,instrument_remark,checked,band_id)
 SELECT id,performance_name,title,composer,arranger,part_name,player_name,instrument_name,instrument_remark,checked,'legacy' FROM score_rows;
DROP TABLE score_rows;
ALTER TABLE score_rows_v2 RENAME TO score_rows;
UPDATE sqlite_sequence SET seq=MAX(seq,COALESCE((SELECT seq FROM migration_score_sequence),0)) WHERE name='score_rows';
DROP TABLE migration_score_sequence;
CREATE INDEX score_rows_band ON score_rows(band_id,performance_name);
CREATE INDEX score_rows_performance ON score_rows(performance_name);
ALTER TABLE instruments RENAME TO legacy_instruments;
CREATE TABLE instruments (band_id TEXT NOT NULL DEFAULT 'legacy' REFERENCES bands(id), name TEXT NOT NULL, PRIMARY KEY(band_id,name));
INSERT INTO instruments(band_id,name) SELECT 'legacy',name FROM legacy_instruments;
DROP TABLE legacy_instruments;
ALTER TABLE players RENAME TO legacy_players;
CREATE TABLE players (band_id TEXT NOT NULL DEFAULT 'legacy' REFERENCES bands(id), name TEXT NOT NULL, PRIMARY KEY(band_id,name));
INSERT INTO players(band_id,name) SELECT 'legacy',name FROM legacy_players;
DROP TABLE legacy_players;
-- Remove the old unscoped table names so rolling back an old Worker fails closed.
ALTER TABLE score_rows RENAME TO band_score_rows;
ALTER TABLE instruments RENAME TO band_instruments;
ALTER TABLE players RENAME TO band_players;
