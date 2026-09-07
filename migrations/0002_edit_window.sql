-- A short grace period in which a fresh entry can simply be fixed.
--
-- Outside it the ledger stays strictly append-only: corrections are new rows
-- that point at what they reverse. Inside it a typo noticed two minutes later
-- would otherwise leave three rows in history for one dinner, which makes the
-- record harder to read rather than easier to trust. The audit log still
-- captures before and after, so even a direct edit is reconstructable.
ALTER TABLE family ADD COLUMN edit_window_hours INTEGER NOT NULL DEFAULT 48;
