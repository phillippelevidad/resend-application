import { z } from 'zod';

// RS-02: `webhooks.verify` takes the secret in its `whsec_` form.
const signingSecretPattern = /^whsec_[A-Za-z0-9+/=]+$/;

// D13: one stored secret, the simulator's: the bare `whsec_` string, no JSON. A mismatch is a
// `ZodError` whose issue carries no input, as below.
export const signingSecretSchema = z
  .string()
  .regex(signingSecretPattern, { error: 'must be whsec_ followed by base64' });

// D13: the signing-secret set's stored value, a JSON array of `whsec_` strings (an empty array is
// valid here; whether the set holds any secret at all is ingest's check, because the simulator
// secret counts too). Invalid JSON is one more issue of the same parse, so every unparseable value
// fails as a `ZodError` whose issues carry no input (`reportInput` stays off): a value is never
// echoed into an error, and ingest logs only the error's name.
export const signingSecretsSchema = z
  .string()
  .transform((value, ctx): unknown => {
    try {
      return JSON.parse(value);
    } catch {
      ctx.addIssue({ code: 'custom', message: 'must be a JSON array' });
      return z.NEVER;
    }
  })
  .pipe(z.array(signingSecretSchema));

export type SigningSecrets = z.output<typeof signingSecretsSchema>;
