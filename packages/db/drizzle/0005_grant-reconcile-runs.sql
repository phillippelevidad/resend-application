-- The runtime role's narrowest DML on reconcile_runs (pp-database → Grants): an ops record,
-- inserted, claimed once, finished once, so SELECT, INSERT, UPDATE and never DELETE (slice 4). The
-- role name is the literal RUNTIME_ROLE spells in src/prepare-database.ts.
GRANT SELECT, INSERT, UPDATE ON "reconcile_runs" TO "ledger_runtime";
