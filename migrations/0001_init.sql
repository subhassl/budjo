-- Budjo initial schema.
-- Money is ALWAYS a signed integer number of cents. Timestamps are ISO-8601 UTC
-- strings, which sort lexicographically. Periods are 'YYYY-MM' in family tz.

CREATE TABLE family (
  id                        TEXT PRIMARY KEY,
  name                      TEXT NOT NULL,
  timezone                  TEXT NOT NULL DEFAULT 'America/Chicago',
  currency                  TEXT NOT NULL DEFAULT 'USD',
  reserve_threshold_cents   INTEGER NOT NULL DEFAULT 5000,
  hold_ttl_hours            INTEGER NOT NULL DEFAULT 48,
  -- Set by the maintenance pass so the lazy path runs at most once a day.
  last_maintenance_at       TEXT,
  created_at                TEXT NOT NULL
);

CREATE TABLE users (
  id            TEXT PRIMARY KEY,
  family_id     TEXT NOT NULL REFERENCES family(id),
  display_name  TEXT NOT NULL,
  email         TEXT,
  role          TEXT NOT NULL CHECK (role IN ('admin','member')),
  status        TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','disabled')),
  created_at    TEXT NOT NULL
);
CREATE INDEX ix_users_family ON users(family_id);

-- Money lives in accounts, not on users.
CREATE TABLE accounts (
  id                TEXT PRIMARY KEY,
  family_id         TEXT NOT NULL REFERENCES family(id),
  kind              TEXT NOT NULL CHECK (kind IN ('personal','joint')),
  owner_user_id     TEXT REFERENCES users(id),
  name              TEXT NOT NULL,
  sort_order        INTEGER NOT NULL DEFAULT 0,
  allow_advance     INTEGER NOT NULL DEFAULT 1,
  max_advance_cents INTEGER,
  archived_at       TEXT,
  CHECK ((kind = 'personal' AND owner_user_id IS NOT NULL)
      OR (kind = 'joint'    AND owner_user_id IS NULL))
);
CREATE UNIQUE INDEX ux_accounts_owner ON accounts(owner_user_id)
  WHERE kind = 'personal' AND archived_at IS NULL;

-- Who may SPEND from an account. Deliberately separate from users.role:
-- an admin can administer an account they have no right to spend from.
CREATE TABLE account_access (
  account_id  TEXT NOT NULL REFERENCES accounts(id),
  user_id     TEXT NOT NULL REFERENCES users(id),
  created_at  TEXT NOT NULL,
  PRIMARY KEY (account_id, user_id)
);
CREATE INDEX ix_access_user ON account_access(user_id);

CREATE TABLE credentials (
  id             TEXT PRIMARY KEY,
  user_id        TEXT NOT NULL REFERENCES users(id),
  credential_id  TEXT NOT NULL UNIQUE,          -- base64url
  public_key     TEXT NOT NULL,                 -- base64url
  counter        INTEGER NOT NULL DEFAULT 0,
  transports     TEXT,
  nickname       TEXT,
  created_at     TEXT NOT NULL,
  last_used_at   TEXT
);
CREATE INDEX ix_credentials_user ON credentials(user_id);

CREATE TABLE sessions (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id),
  expires_at  TEXT NOT NULL,
  created_at  TEXT NOT NULL,
  user_agent  TEXT,
  revoked_at  TEXT
);
CREATE INDEX ix_sessions_user ON sessions(user_id);

CREATE TABLE invites (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id),
  code_hash   TEXT NOT NULL,
  expires_at  TEXT NOT NULL,
  used_at     TEXT,
  created_by  TEXT REFERENCES users(id),
  created_at  TEXT NOT NULL
);
CREATE INDEX ix_invites_user ON invites(user_id);

-- Allocation amounts change over time; we insert a new rule rather than
-- mutating, so a past month's history stays explainable.
CREATE TABLE allocation_rules (
  id              TEXT PRIMARY KEY,
  account_id      TEXT NOT NULL REFERENCES accounts(id),
  amount_cents    INTEGER NOT NULL,
  effective_from  TEXT NOT NULL,                -- 'YYYY-MM'
  effective_to    TEXT,
  created_by      TEXT REFERENCES users(id),
  created_at      TEXT NOT NULL
);
CREATE UNIQUE INDEX ux_alloc_rule ON allocation_rules(account_id, effective_from);

CREATE TABLE categories (
  id                      TEXT PRIMARY KEY,
  family_id               TEXT NOT NULL REFERENCES family(id),
  name                    TEXT NOT NULL,
  icon                    TEXT NOT NULL DEFAULT '•',
  sort_order              INTEGER NOT NULL DEFAULT 0,
  counts_against_budget   INTEGER NOT NULL DEFAULT 1,
  archived_at             TEXT
);

CREATE TABLE cards (
  id                   TEXT PRIMARY KEY,
  family_id            TEXT NOT NULL REFERENCES family(id),
  name                 TEXT NOT NULL,
  issuer               TEXT,
  last4                TEXT,
  reward_note          TEXT,
  statement_close_day  INTEGER,
  due_day              INTEGER,
  sort_order           INTEGER NOT NULL DEFAULT 0,
  archived_at          TEXT
);

CREATE TABLE category_card_rules (
  category_id  TEXT NOT NULL REFERENCES categories(id),
  card_id      TEXT NOT NULL REFERENCES cards(id),
  priority     INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (category_id, priority)
);

CREATE TABLE spend_checks (
  id                        TEXT PRIMARY KEY,
  account_id                TEXT NOT NULL REFERENCES accounts(id),
  actor_user_id             TEXT NOT NULL REFERENCES users(id),
  estimated_cents           INTEGER NOT NULL,
  category_id               TEXT REFERENCES categories(id),
  card_id                   TEXT REFERENCES cards(id),
  merchant                  TEXT,
  note                      TEXT,
  decision                  TEXT NOT NULL CHECK (decision IN ('approved','tight','denied')),
  decision_available_cents  INTEGER NOT NULL,
  status                    TEXT NOT NULL
    CHECK (status IN ('pending','settled','cancelled','expired','denied')),
  actual_cents              INTEGER,
  overdrawn                 INTEGER NOT NULL DEFAULT 0,
  superseded_by             TEXT REFERENCES spend_checks(id),
  expires_at                TEXT NOT NULL,
  created_at                TEXT NOT NULL,
  settled_at                TEXT
);
-- The hold query: pending checks that have not yet timed out.
CREATE INDEX ix_checks_hold ON spend_checks(account_id, status, expires_at);
CREATE INDEX ix_checks_actor ON spend_checks(actor_user_id, created_at DESC);

-- The source of truth. Append-only: corrections are new rows, never UPDATEs.
CREATE TABLE ledger_entries (
  id                        TEXT PRIMARY KEY,
  account_id                TEXT NOT NULL REFERENCES accounts(id),
  actor_user_id             TEXT REFERENCES users(id),
  type                      TEXT NOT NULL CHECK (type IN (
                              'allocation','spend','refund','adjustment',
                              'transfer_in','transfer_out','advance',
                              'advance_repayment','void')),
  amount_cents              INTEGER NOT NULL,
  period                    TEXT NOT NULL,
  category_id               TEXT REFERENCES categories(id),
  card_id                   TEXT REFERENCES cards(id),
  spend_check_id            TEXT REFERENCES spend_checks(id),
  counterparty_account_id   TEXT REFERENCES accounts(id),
  advance_id                TEXT,
  voids_entry_id            TEXT REFERENCES ledger_entries(id),
  note                      TEXT,
  occurred_at               TEXT NOT NULL,
  created_by                TEXT REFERENCES users(id),
  created_at                TEXT NOT NULL
);
-- One allocation per account per month, whatever runs the job and how often.
CREATE UNIQUE INDEX ux_alloc_entry ON ledger_entries(account_id, period)
  WHERE type = 'allocation';
CREATE UNIQUE INDEX ux_advance_repay ON ledger_entries(advance_id)
  WHERE type = 'advance_repayment';
CREATE UNIQUE INDEX ux_void_once ON ledger_entries(voids_entry_id)
  WHERE type = 'void';
CREATE INDEX ix_ledger_acct_time ON ledger_entries(account_id, occurred_at DESC);
CREATE INDEX ix_ledger_period ON ledger_entries(account_id, period);
CREATE INDEX ix_ledger_check ON ledger_entries(spend_check_id);

CREATE TABLE advances (
  id            TEXT PRIMARY KEY,
  account_id    TEXT NOT NULL REFERENCES accounts(id),
  amount_cents  INTEGER NOT NULL,
  repay_period  TEXT NOT NULL,
  repaid_at     TEXT,
  created_by    TEXT REFERENCES users(id),
  created_at    TEXT NOT NULL
);
CREATE INDEX ix_advances_open ON advances(account_id, repaid_at);

CREATE TABLE transfer_requests (
  id                   TEXT PRIMARY KEY,
  from_account_id      TEXT NOT NULL REFERENCES accounts(id),
  to_account_id        TEXT NOT NULL REFERENCES accounts(id),
  requested_by_user_id TEXT NOT NULL REFERENCES users(id),
  amount_cents         INTEGER NOT NULL,
  note                 TEXT,
  status               TEXT NOT NULL
    CHECK (status IN ('pending','approved','declined','expired')),
  spend_check_id       TEXT REFERENCES spend_checks(id),
  decided_by_user_id   TEXT REFERENCES users(id),
  decided_at           TEXT,
  expires_at           TEXT NOT NULL,
  created_at           TEXT NOT NULL
);
CREATE INDEX ix_transfer_requests_status ON transfer_requests(status, created_at DESC);

CREATE TABLE balance_snapshots (
  account_id            TEXT NOT NULL REFERENCES accounts(id),
  period                TEXT NOT NULL,
  closing_balance_cents INTEGER NOT NULL,
  created_at            TEXT NOT NULL,
  PRIMARY KEY (account_id, period)
);

CREATE TABLE idempotency_keys (
  key            TEXT PRIMARY KEY,
  user_id        TEXT NOT NULL REFERENCES users(id),
  request_hash   TEXT NOT NULL,
  response_json  TEXT NOT NULL,
  status_code    INTEGER NOT NULL DEFAULT 200,
  created_at     TEXT NOT NULL
);

CREATE TABLE audit_log (
  id             TEXT PRIMARY KEY,
  actor_user_id  TEXT REFERENCES users(id),
  action         TEXT NOT NULL,
  target_type    TEXT,
  target_id      TEXT,
  detail_json    TEXT,
  created_at     TEXT NOT NULL
);
CREATE INDEX ix_audit_time ON audit_log(created_at DESC);
