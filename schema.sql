-- Grid Call — D1 schema.
-- Run once:  npm run db:init

DROP TABLE IF EXISTS picks;
DROP TABLE IF EXISTS results;
DROP TABLE IF EXISTS rounds;
DROP TABLE IF EXISTS drivers;
DROP TABLE IF EXISTS players;
DROP TABLE IF EXISTS settings;

CREATE TABLE players (
  id        TEXT PRIMARY KEY,
  name      TEXT NOT NULL,
  name_key  TEXT NOT NULL UNIQUE,   -- lowercased name, so "Max" and "max" are one person
  photo     TEXT,                   -- data URL, 160px square, or NULL
  color     TEXT NOT NULL DEFAULT '#37D67A',
  pw_hash   TEXT NOT NULL,          -- PBKDF2-SHA256, 210k iterations
  pw_salt   TEXT NOT NULL,
  is_admin  INTEGER NOT NULL DEFAULT 0,
  joined    INTEGER NOT NULL
);

CREATE TABLE rounds (
  round    INTEGER NOT NULL,
  season   INTEGER NOT NULL,
  name     TEXT NOT NULL,
  circuit  TEXT,
  cc       TEXT,
  start    TEXT NOT NULL,           -- ISO 8601 UTC, lights out
  PRIMARY KEY (season, round)
);

CREATE TABLE drivers (
  id      TEXT PRIMARY KEY,         -- Jolpica driverId, e.g. "max_verstappen"
  season  INTEGER NOT NULL,
  first   TEXT NOT NULL,
  last    TEXT NOT NULL,
  code    TEXT,
  no      INTEGER,
  team    TEXT                      -- constructorId, e.g. "red_bull"
);

CREATE TABLE results (
  season    INTEGER NOT NULL,
  round     INTEGER NOT NULL,
  pos       INTEGER NOT NULL,
  driver_id TEXT NOT NULL,
  PRIMARY KEY (season, round, pos)
);

CREATE TABLE picks (
  season    INTEGER NOT NULL,
  round     INTEGER NOT NULL,
  player_id TEXT NOT NULL,
  pos       INTEGER NOT NULL,
  at        INTEGER NOT NULL,
  PRIMARY KEY (season, round, player_id)
);

CREATE TABLE settings (
  k TEXT PRIMARY KEY,
  v TEXT NOT NULL
);

CREATE INDEX idx_picks_round  ON picks (season, round);
CREATE INDEX idx_results_round ON results (season, round);
CREATE INDEX idx_drivers_season ON drivers (season);

-- Scoring, the draw seed and the first round in play.
-- Everything here is editable from Settings in the app.
INSERT INTO settings (k, v) VALUES
  ('scoring', '{"exact":25,"off1":18,"off2":12,"off3":8,"off45":4,"off6":0,"podium":5,"points":3}'),
  ('seed', '0'),
  ('startRound', '0');
