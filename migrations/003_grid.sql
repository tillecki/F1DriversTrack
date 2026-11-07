-- Starting grid position, which differs from qualifying when penalties apply.
--   npx wrangler d1 execute grid-call --remote --file=./migrations/003_grid.sql
ALTER TABLE results ADD COLUMN grid INTEGER;
