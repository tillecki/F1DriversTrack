-- Revision counter, so clients can check for changes in a single row read
-- instead of downloading the whole state every poll.
--   npx wrangler d1 execute grid-call --remote --file=./migrations/006_rev.sql
INSERT OR IGNORE INTO settings (k, v) VALUES ('rev', '1');
