-- Provisional qualifying from OpenF1. Non-destructive.
--   npx wrangler d1 execute grid-call --remote --file=./migrations/002_live_qualifying.sql
ALTER TABLE quali ADD COLUMN provisional INTEGER NOT NULL DEFAULT 0;
