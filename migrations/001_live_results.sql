-- Adds provisional (OpenF1) results. Non-destructive — your data survives.
--   npx wrangler d1 execute grid-call --remote --file=./migrations/001_live_results.sql
ALTER TABLE results ADD COLUMN provisional INTEGER NOT NULL DEFAULT 0;
INSERT OR IGNORE INTO settings (k, v) VALUES ('liveState', '{}');
