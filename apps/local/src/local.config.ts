import { z } from 'zod';

// D29: the local process's boot assertion, parsed once by `main.ts` through `loadConfig`. A failure
// names the variable, never its value (pp-general → config-and-env).

// RS-02: `webhooks.verify` takes the secret in its `whsec_` form.
const signingSecretPattern = /^whsec_[A-Za-z0-9+/=]+$/;
// D2: 32 bytes as 64 lowercase hex characters.
const addressHashKeyPattern = /^[0-9a-f]{64}$/;

// `.env.example` lists every name with an empty value, so an empty optional variable is unset.
const emptyAsUnset = (value: unknown): unknown => (value === '' ? undefined : value);

const signingSecret = z.string().regex(signingSecretPattern, {
  error: 'must be whsec_ followed by base64',
});

export const localConfigSchema = z
  .object({
    DATABASE_URL: z.string({ error: 'must be set' }).min(1, { error: 'must be set' }),
    // D2: decoded here, at the composition root, and passed as config. An empty or malformed key
    // would hash under the wrong key silently, so anything else fails the boot.
    LEDGER_ADDRESS_HASH_KEY: z
      .string({ error: 'must be set' })
      .regex(addressHashKeyPattern, { error: 'must be 64 lowercase hex characters' })
      .transform((hex) => new Uint8Array(Buffer.from(hex, 'hex'))),
    // Comma-separated, one per `resend webhooks listen` session (RS-U22), tried in this order (D9).
    LEDGER_WEBHOOK_SECRETS: z
      .preprocess(emptyAsUnset, z.string().optional())
      .transform((list) => (list === undefined ? [] : list.split(',').map((entry) => entry.trim())))
      .pipe(z.array(signingSecret)),
    LEDGER_SIMULATOR_SECRET: z.preprocess(emptyAsUnset, signingSecret.optional()),
  })
  // With no secret, every delivery answers `401` (D9): refuse instead of starting a deaf ingest.
  .refine(
    (env) => env.LEDGER_WEBHOOK_SECRETS.length > 0 || env.LEDGER_SIMULATOR_SECRET !== undefined,
    { error: 'at least one signing secret must be set' },
  )
  .transform((env) => ({
    databaseUrl: env.DATABASE_URL,
    addressHashKey: env.LEDGER_ADDRESS_HASH_KEY,
    secrets: { resend: env.LEDGER_WEBHOOK_SECRETS, simulator: env.LEDGER_SIMULATOR_SECRET },
  }));

export type LocalConfig = z.output<typeof localConfigSchema>;

// Log messages are constants (data-modeling.md → Log fields) and the allow-list has no key for a
// variable name, so each failing variable maps to its own constant line. `loadConfig` reports the
// cross-variable refinement as `(config)`, and an array entry as `LEDGER_WEBHOOK_SECRETS.<index>`.
const configFailureMessages = {
  DATABASE_URL: 'refusing to start: DATABASE_URL must be set',
  LEDGER_ADDRESS_HASH_KEY:
    'refusing to start: LEDGER_ADDRESS_HASH_KEY must be 64 lowercase hex characters',
  LEDGER_WEBHOOK_SECRETS:
    'refusing to start: each LEDGER_WEBHOOK_SECRETS entry must be whsec_ followed by base64',
  LEDGER_SIMULATOR_SECRET:
    'refusing to start: LEDGER_SIMULATOR_SECRET must be whsec_ followed by base64',
  '(config)':
    'refusing to start: set LEDGER_WEBHOOK_SECRETS or LEDGER_SIMULATOR_SECRET, or every delivery answers 401',
} as const;

export function configFailureMessage(variable: string): string {
  const name = variable.split('.')[0] ?? variable;
  return Object.hasOwn(configFailureMessages, name)
    ? configFailureMessages[name as keyof typeof configFailureMessages]
    : 'refusing to start: invalid configuration';
}
