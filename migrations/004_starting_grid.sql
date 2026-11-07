-- The starting grid, available before the race. Jolpica only reports it
-- afterwards, bundled with results, so this comes from OpenF1.
--   npx wrangler d1 execute grid-call --remote --file=./migrations/004_starting_grid.sql
CREATE TABLE IF NOT EXISTS grid (
  season    INTEGER NOT NULL,
  round     INTEGER NOT NULL,
  driver_id TEXT NOT NULL,
  pos       INTEGER NOT NULL,
  PRIMARY KEY (season, round, driver_id)
);
