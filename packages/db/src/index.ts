// @ledger/db: Drizzle schema, migrations, repositories (ADR-018). The package's one public surface;
// the int harness ships through `./testing`.
export {
  type ActiveApiToken,
  type ApiTokenValues,
  apiTokensRepository,
} from './api-tokens.repository.ts';
export { classifyDatabaseError } from './classify-database-error.ts';
export {
  CONNECTION_TIMEOUT_MS,
  type CreateDatabaseOptions,
  createDatabase,
  type Database,
} from './create-database.ts';
export {
  databaseRepository,
  STORAGE_LIMIT_BYTES,
  STORAGE_PROBE_THRESHOLD,
} from './database.repository.ts';
export { DatabaseUnavailableError } from './database-unavailable.error.ts';
export {
  type ContractStep,
  pendingContractSteps,
  storedAddressHashKeyId,
} from './deploy-checks.ts';
export {
  type EmailRecipientValues,
  emailRecipientsRepository,
} from './email-recipients.repository.ts';
export { type EmailStateValues, emailStateRepository } from './email-state.repository.ts';
export type { Executor, Transaction } from './executor.ts';
export {
  type PrepareDatabaseOptions,
  prepareDatabase,
  type RoleTimeouts,
  RUNTIME_ROLE,
  RUNTIME_ROLE_TIMEOUTS,
} from './prepare-database.ts';
export {
  type RecipientStateValues,
  recipientStateRepository,
} from './recipient-state.repository.ts';
export { runTransaction } from './run-transaction.ts';
export { type ApiTokenRow, apiTokens, type NewApiToken } from './schema/api-tokens.ts';
export {
  type EmailRecipientRow,
  emailRecipients,
  type NewEmailRecipient,
} from './schema/email-recipients.ts';
export { type EmailStateRow, emailState, type NewEmailState } from './schema/email-state.ts';
export {
  type NewRecipientState,
  type RecipientStateRow,
  recipientState,
} from './schema/recipient-state.ts';
export {
  type NewWebhookEvent,
  type WebhookEventRow,
  webhookEvents,
} from './schema/webhook-events.ts';
export { type TimelineRow, webhookEventsRepository } from './webhook-events.repository.ts';
