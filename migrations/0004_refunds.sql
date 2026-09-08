-- Links a refund to the spend it returns.
--
-- Separate from voids_entry_id on purpose: a void says "this never happened",
-- a refund says "this happened and some of the money came back". They net out
-- differently in a month's totals and only one of them can be partial.
ALTER TABLE ledger_entries ADD COLUMN refunds_entry_id TEXT REFERENCES ledger_entries(id);
CREATE INDEX ix_ledger_refunds ON ledger_entries(refunds_entry_id);
