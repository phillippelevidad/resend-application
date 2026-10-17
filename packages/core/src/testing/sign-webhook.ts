import { Buffer } from 'node:buffer';
import { createHmac } from 'node:crypto';

// RS-03: Svix's `v1` scheme on `node:crypto`, no signing dependency. HMAC-SHA-256 over
// `${svix-id}.${svix-timestamp}.${body}`, keyed with the base64-decoded part after `whsec_`, as
// `resend`'s `webhooks.verify` (standardwebhooks) recomputes it. Proven by the round trip in
// packages/ingest, not by reading it.

export type SignWebhookInput = {
  // The `whsec_` form `webhooks.verify` takes (RS-02).
  readonly secret: string;
  readonly svixId: string;
  // Unix seconds, an integer: the verifier re-reads the header with `parseInt`.
  readonly timestamp: number;
  // Sent byte for byte as signed (RS-01): never re-serialized after signing.
  readonly body: string;
};

export type SvixHeaders = {
  readonly 'svix-id': string;
  readonly 'svix-timestamp': string;
  readonly 'svix-signature': string;
};

const secretPrefix = 'whsec_';

export function signWebhook(input: SignWebhookInput): SvixHeaders {
  const encoded = input.secret.startsWith(secretPrefix)
    ? input.secret.slice(secretPrefix.length)
    : input.secret;
  const timestamp = String(input.timestamp);
  const signature = createHmac('sha256', Buffer.from(encoded, 'base64'))
    .update(`${input.svixId}.${timestamp}.${input.body}`)
    .digest('base64');
  return {
    'svix-id': input.svixId,
    'svix-timestamp': timestamp,
    'svix-signature': `v1,${signature}`,
  };
}
