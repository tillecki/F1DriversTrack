-- Grid Call — D1 schema (v2).
-- Run once:  npm run db:init
-- This DROPs and recreates. Re-running wipes players, calls and results.

DROP TABLE IF EXISTS picks;
DROP TABLE IF EXISTS results;
DROP TABLE IF EXISTS quali;
DROP TABLE IF EXISTS rounds;
DROP TABLE IF EXISTS drivers;
DROP TABLE IF EXISTS players;
DROP TABLE IF EXISTS settings;

CREATE TABLE players (
  id        TEXT PRIMARY KEY,
  name      TEXT NOT NULL,
  name_key  TEXT NOT NULL UNIQUE,
  photo     TEXT,
  color     TEXT NOT NULL DEFAULT '#37D67A',
  favourite TEXT,                       -- driverId, for favourite-driver mode
  pw_hash   TEXT NOT NULL,
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
  start    TEXT NOT NULL,               -- ISO 8601 UTC, lights out
  quali_at TEXT,                        -- ISO 8601 UTC, start of qualifying
  PRIMARY KEY (season, round)
);

CREATE TABLE drivers (
  id      TEXT PRIMARY KEY,             -- Jolpica driverId, e.g. "max_verstappen"
  season  INTEGER NOT NULL,
  first   TEXT NOT NULL,
  last    TEXT NOT NULL,
  code    TEXT,
  no      INTEGER,                      -- the car number actually raced, not permanentNumber
  team    TEXT,
  starts  INTEGER NOT NULL DEFAULT 0,   -- races started this season
  active  INTEGER NOT NULL DEFAULT 1,   -- in the draw pool? organiser can override
  photo   TEXT,                         -- image URL from Wikimedia
  wiki    TEXT                          -- Wikipedia page, shown as attribution
);

CREATE TABLE results (
  season    INTEGER NOT NULL,
  round     INTEGER NOT NULL,
  pos       INTEGER NOT NULL,
  driver_id TEXT NOT NULL,
  PRIMARY KEY (season, round, pos)
);

CREATE TABLE quali (
  season    INTEGER NOT NULL,
  round     INTEGER NOT NULL,
  pos       INTEGER NOT NULL,
  driver_id TEXT NOT NULL,
  PRIMARY KEY (season, round, pos)
);

CREATE TABLE picks (
  season      INTEGER NOT NULL,
  round       INTEGER NOT NULL,
  player_id   TEXT NOT NULL,
  pos         INTEGER,                  -- the drawn driver's finishing position
  fav_pos     INTEGER,                  -- your favourite driver's finishing position
  pole_driver TEXT,                     -- who takes pole
  at          INTEGER NOT NULL,
  PRIMARY KEY (season, round, player_id)
);

CREATE TABLE settings (
  k TEXT PRIMARY KEY,
  v TEXT NOT NULL
);

CREATE INDEX idx_picks_round   ON picks   (season, round);
CREATE INDEX idx_results_round ON results (season, round);
CREATE INDEX idx_quali_round   ON quali   (season, round);
CREATE INDEX idx_drivers_season ON drivers (season);

INSERT INTO settings (k, v) VALUES
  ('scoring', '{"exact":25,"off1":18,"off2":12,"off3":8,"off45":4,"off6":0,"podium":5,"points":3,"favScale":50,"poleExact":15,"poleFrontRow":5}'),
  ('modes', '{"favourite":false,"pole":false}'),
  ('seed', '0'),
  ('startRound', '0'),
  ('syncState', '{}');
