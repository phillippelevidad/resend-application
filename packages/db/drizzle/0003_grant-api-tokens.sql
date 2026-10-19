-- The runtime role's narrowest DML on api_tokens (pp-database → Grants): a credential record,
-- inserted, then revoked once, so SELECT, INSERT, UPDATE and never DELETE (D7). The role name is
-- the literal RUNTIME_ROLE spells in src/prepare-database.ts.
GRANT SELECT, INSERT, UPDATE ON "api_tokens" TO "ledger_runtime";
