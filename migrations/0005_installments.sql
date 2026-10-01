-- Payment plans: something bought on financing and paid off monthly.
--
-- The plan is the promise; each month's charge is an ordinary spend in the
-- ledger, posted by the maintenance job on the plan's day of the month. Nothing
-- about a plan is stored as a running total — what has been paid is whatever
-- the ledger says, so the two can never drift apart.
CREATE TABLE installment_plans (
  id            TEXT PRIMARY KEY,
  account_id    TEXT NOT NULL REFERENCES accounts(id),
  description   TEXT NOT NULL,
  total_cents   INTEGER NOT NULL CHECK (total_cents > 0),
  months        INTEGER NOT NULL CHECK (months BETWEEN 1 AND 60),
  day_of_month  INTEGER NOT NULL CHECK (day_of_month BETWEEN 1 AND 31),
  first_period  TEXT NOT NULL,
  category_id   TEXT REFERENCES categories(id),
  card_id       TEXT REFERENCES cards(id),
  cancelled_at  TEXT,
  cancelled_by  TEXT REFERENCES users(id),
  created_by    TEXT REFERENCES users(id),
  created_at    TEXT NOT NULL
);
CREATE INDEX ix_installment_plans_account ON installment_plans(account_id, created_at DESC);

ALTER TABLE ledger_entries ADD COLUMN installment_plan_id TEXT REFERENCES installment_plans(id);
ALTER TABLE ledger_entries ADD COLUMN installment_no INTEGER;

-- Each payment posts once, however many times the job runs.
CREATE UNIQUE INDEX ux_installment_once ON ledger_entries(installment_plan_id, installment_no)
  WHERE installment_plan_id IS NOT NULL;
