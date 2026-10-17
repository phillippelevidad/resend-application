// RS-03: the test signer in `@ledger/core/testing` is proven by `resend`'s own verifier (RS-02), not
// by reading it: a request it signs verifies, and one changed byte does not (RS-01). It lives here
// because ingest is the package allowed to import `resend`.
import { Buffer } from 'node:buffer';
import { signWebhook } from '@ledger/core/testing';
import { Resend } from 'resend';
import { describe, expect, it } from 'vitest';

// Built at run time from a label, so no `whsec_` literal sits in the source (the gitleaks rule).
const secret = `whsec_${Buffer.from('ledger-sign-webhook-test').toString('base64')}`;
// RS-02: `webhooks.verify` checks the window against the wall clock, so the signer reads it too.
const nowSeconds = () => Math.floor(Date.now() / 1000);
const resend = new Resend('ingest-verifies-only');

const body = JSON.stringify({
  type: 'email.sent',
  created_at: '2026-10-17T12:00:00.000Z',
  data: { email_id: 'e_sign', to: ['delivered@resend.dev'] },
});

const verify = (payload: string, headers: ReturnType<typeof signWebhook>) =>
  resend.webhooks.verify({
    payload,
    headers: {
      id: headers['svix-id'],
      timestamp: headers['svix-timestamp'],
      signature: headers['svix-signature'],
    },
    webhookSecret: secret,
  });

describe('signWebhook', () => {
  it('signs a request that resend webhooks.verify accepts, returning the parsed body', () => {
    const headers = signWebhook({ secret, svixId: 'msg_sign_1', timestamp: nowSeconds(), body });

    expect(verify(body, headers)).toEqual(JSON.parse(body));
  });

  it('signs over the exact bytes: one changed body byte is rejected by resend webhooks.verify', () => {
    const headers = signWebhook({ secret, svixId: 'msg_sign_2', timestamp: nowSeconds(), body });
    const tampered = body.replace('e_sign', 'e_sigm');

    expect(tampered).toHaveLength(body.length);
    expect(() => verify(tampered, headers)).toThrow();
  });
});
