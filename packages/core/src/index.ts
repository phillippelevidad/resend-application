// @ledger/core: event types, projectEmail, projectRecipient, reaction rules. Pure, no I/O (ADR-013).
// The package's one public surface. Test arbitraries are not here: they ship through `./testing`.
export { compareCodeUnits } from './compare-code-units.ts';
export { type Deliverability, deliverabilitySchema } from './deliverability.schema.ts';
export { type EmailEvent, emailEventSchema } from './email-event.schema.ts';
export { type EmailEventType, emailEventTypes } from './email-event-types.ts';
export { type EmailStatus, emailStatusSchema } from './email-status.schema.ts';
export {
  type ErrorCode,
  type ErrorRegistryEntry,
  errorCodeSchema,
  errorCodes,
  errorRegistry,
  RUNBOOK_BASE_URL,
} from './error-codes.ts';
export { eventRank } from './event-rank.ts';
export { addressHashKeyId, hashAddress } from './hash-address.ts';
export {
  eventSourceSchema,
  type IngestEnvelope,
  ingestEnvelopeSchema,
} from './ingest-envelope.schema.ts';
export type { LedgerEvent } from './ledger-event.ts';
export { maskAddress } from './mask-address.ts';
export { maskFrom } from './mask-from.ts';
export { maskText } from './mask-text.ts';
export { normalizeAddress } from './normalize-address.ts';
export {
  type EmailRecipientState,
  type EmailState,
  projectEmail,
} from './project-email.projection.ts';
export { projectRecipient, type RecipientState } from './project-recipient.projection.ts';
export { type SanitizeForJsonbResult, sanitizeForJsonb } from './sanitize-for-jsonb.ts';
export { type SoftSignal, softSignalSchema } from './soft-signal.schema.ts';
export { type StickySignal, stickySignalSchema } from './sticky-signal.schema.ts';
export { type WebhookEnvelope, webhookEnvelopeSchema } from './webhook-envelope.schema.ts';
