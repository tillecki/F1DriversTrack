-- Freeze the drawn driver per round. Without this, changing the start round,
-- the seed, or the active driver pool silently re-draws rounds already played.
--   npx wrangler d1 execute grid-call --remote --file=./migrations/005_freeze_draw.sql
ALTER TABLE rounds ADD COLUMN drawn TEXT;
