CREATE TABLE instruments (name TEXT PRIMARY KEY NOT NULL);
CREATE TABLE players (name TEXT PRIMARY KEY NOT NULL);
CREATE TABLE score_rows (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  performance_name TEXT NOT NULL,
  title TEXT NOT NULL,
  composer TEXT NOT NULL DEFAULT '',
  arranger TEXT NOT NULL DEFAULT '',
  part_name TEXT NOT NULL DEFAULT '',
  player_name TEXT NOT NULL DEFAULT '',
  instrument_name TEXT NOT NULL DEFAULT '',
  instrument_remark TEXT NOT NULL DEFAULT '',
  checked INTEGER NOT NULL DEFAULT 0 CHECK(checked IN (0,1))
);
CREATE INDEX score_rows_performance ON score_rows(performance_name);
CREATE TABLE metadata (id INTEGER PRIMARY KEY CHECK(id=1), revision INTEGER NOT NULL);
INSERT INTO metadata VALUES (1, 0);
-- A failing guard aborts the entire D1 batch, including deletions and inserts.
CREATE TABLE write_guard (id INTEGER PRIMARY KEY CHECK(id=1));
INSERT INTO instruments(name) VALUES
 ('Timpani'),('Drumset'),('Bongo'),('Conga'),('Tom-Tom'),('Floor Tom'),
 ('Snare Drum'),('Bass Drum'),('Suspend Cymbal'),('Crash Cymbals'),('Hi-hats'),
 ('Ride Cymbal'),('Triangle'),('Tambourine'),('Cowbell'),('Claves'),('Guiro'),
 ('Cabasa'),('Shaker'),('Sleigh Bell'),('Wind Chimes'),('Bells'),
 ('Xylophone'),('Marimba'),('Vibraphone'),('Chimes');
