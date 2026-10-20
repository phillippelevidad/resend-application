// @ledger/resend-client/testing: the fake Resend API the client's own tests, the recovery suite and
// the gap drill's tests reach through `baseUrl`, and `ResendClient`'s fake for the reconciler's unit
// tests (pp-testing → The fake Resend API). Never imported by runtime code.
export {
  FAKE_SIGNING_SECRET,
  type FakeResendApi,
  type FakeResendRoute,
  type FakeWebhookEvent,
  type RecordedRequest,
  type ScriptedResponse,
  startFakeResendApi,
} from './testing/fake-resend-api.ts';
export { type FakeResendCall, FakeResendClient } from './testing/fake-resend-client.ts';
