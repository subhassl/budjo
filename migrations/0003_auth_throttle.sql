-- Rate limiting for the auth routes, which DESIGN.md §10 claimed and the code
-- did not have. Kept in D1 rather than a platform binding so it is portable and
-- visible; at two users the write volume is nil.
CREATE TABLE auth_attempts (
  bucket_key    TEXT PRIMARY KEY,   -- route + client ip + window
  attempts      INTEGER NOT NULL DEFAULT 0,
  window_start  TEXT NOT NULL,
  expires_at    TEXT NOT NULL
);
CREATE INDEX ix_auth_attempts_expiry ON auth_attempts(expires_at);
