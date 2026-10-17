-- The runtime role's narrowest DML per table (pp-database → Grants). The role name is the literal
-- RUNTIME_ROLE spells in src/prepare-database.ts: SQL cannot import it, so a mismatch fails as
-- `permission denied` in the int harness, which connects as that role.
-- webhook_events is append-only: never UPDATE or DELETE (ADR-004).
GRANT SELECT, INSERT ON "webhook_events" TO "ledger_runtime";
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "email_state" TO "ledger_runtime";
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "email_recipients" TO "ledger_runtime";
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "recipient_state" TO "ledger_runtime";
