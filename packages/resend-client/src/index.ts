// @ledger/resend-client: Resend API wrapper and its rate limiter, the only Resend API caller
// (ADR-012). The package's one public surface; the fakes ship through `./testing`.
export {
  type CallOptions,
  type CreateResendClientDeps,
  createResendClient,
  type ListedWebhookEvent,
  type ListedWebhookEvents,
  RESEND_REQUEST_TIMEOUT_MS,
  type ResendClient,
  type SendEmailInput,
  type SendEmailOutcome,
} from './create-resend-client.ts';
