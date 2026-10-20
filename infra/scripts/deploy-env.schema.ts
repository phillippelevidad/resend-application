import { z } from 'zod';
import { DEFAULT_BUDGET_USD } from '../src/guardrails.stack.ts';

// D33's input assertion, run before step 1. Keys are listed in the order the refusal names them, so
// with nothing set the first one named is `LEDGER_DEPLOY_DATABASE_URL`. Every message names what is
// expected and never the value (`loadConfig` keeps Zod's `reportInput` off). An empty value, which a
// `NAME=` line in `.env.local` produces, counts as unset.

const KEY_HINT = 'run pnpm db:setup once to generate it';
const HEX_64 = /^[0-9a-f]{64}$/;
const POSTGRES_URL = /^postgres(ql)?:\/\//;
// RS-02: a signing secret in its `whsec_` form, as ingest parses it (signing-secrets.schema.ts).
const SIGNING_SECRET = /^whsec_[A-Za-z0-9+/=]+$/;
// Slice 4 D29: a Resend API key's form; the reconciler reads any other value as not configured.
const RESEND_API_KEY = /^re_[A-Za-z0-9_]+$/;

const unsetIfEmpty = (value: unknown): unknown => (value === '' ? undefined : value);

const postgresUrl = (expected: string) =>
  z.preprocess(
    unsetIfEmpty,
    z
      .string({ error: expected })
      .regex(POSTGRES_URL, { error: expected })
      .refine((value) => URL.canParse(value), { error: expected }),
  );

// D33: the deploy command never generates a key, because a key made per deploy would orphan every
// stored hash (data-modeling.md → PII & retention).
const hexKey = z.preprocess(
  unsetIfEmpty,
  z
    .string({ error: `must be set to 64 lowercase hex; ${KEY_HINT}` })
    .regex(HEX_64, { error: `must be 64 lowercase hex; ${KEY_HINT}` }),
);

export const deployEnvSchema = z
  .object({
    LEDGER_DEPLOY_DATABASE_URL: postgresUrl(
      "must be set to the database's direct postgres:// URL, owner credentials",
    ),
    LEDGER_DEPLOY_DATABASE_POOLED_URL: postgresUrl(
      "must be set to the database's pooled postgres:// URL, owner credentials",
    ),
    LEDGER_ALERT_EMAIL: z.preprocess(
      unsetIfEmpty,
      z.email({ error: 'must be set to the budget and kill-switch alert address' }),
    ),
    LEDGER_ADDRESS_HASH_KEY: hexKey,
    LEDGER_TOKEN_TAG_KEY: hexKey,
    // Design → Environment: comma-separated, each one RS-02's `whsec_` form; stored as a JSON array.
    LEDGER_DEPLOY_WEBHOOK_SECRETS: z.preprocess(
      unsetIfEmpty,
      z
        .string()
        .transform((value) => value.split(',').map((secret) => secret.trim()))
        .pipe(
          z.array(
            z.string().regex(SIGNING_SECRET, {
              error: 'must be comma-separated whsec_ signing secrets',
            }),
          ),
        )
        .optional(),
    ),
    LEDGER_KILL_SWITCH: z.preprocess(
      unsetIfEmpty,
      z.enum(['on', 'off'], { error: 'must be on or off' }).default('off'),
    ),
    LEDGER_BUDGET_USD: z.preprocess(
      unsetIfEmpty,
      z.coerce
        .number({ error: 'must be a positive number of USD' })
        .positive({ error: 'must be a positive number of USD' })
        .default(DEFAULT_BUDGET_USD),
    ),
    // Slice 3, D11: on only in the owner's deployment, where it adds the simulator secret.
    LEDGER_SIMULATOR: z.preprocess(
      unsetIfEmpty,
      z.enum(['on', 'off'], { error: 'must be on or off' }).default('off'),
    ),
    // Read and checked only with LEDGER_SIMULATOR=on (below): `.env.local` holds it for local mode too.
    LEDGER_SIMULATOR_SECRET: z.preprocess(unsetIfEmpty, z.string().optional()),
    // Slice 4 D29: the reconciler's dedicated `full_access` key and the webhook it reconciles; set
    // both or neither (below).
    LEDGER_DEPLOY_RESEND_API_KEY: z.preprocess(
      unsetIfEmpty,
      z
        .string()
        .regex(RESEND_API_KEY, { error: 'must be a Resend API key starting re_' })
        .optional(),
    ),
    LEDGER_DEPLOY_RESEND_WEBHOOK_ID: z.preprocess(
      unsetIfEmpty,
      z
        .string()
        .trim()
        .min(1, { error: 'must be the Resend webhook id' })
        .regex(/^\S+$/, { error: 'must be the Resend webhook id' })
        .optional(),
    ),
  })
  // D11: with `on`, the value the deploy writes into the simulator secret must be one RS-02 secret,
  // asserted before contacting AWS. The message names the variable's form, never its value.
  // Slice 4 D29: the reconciler is configured by both inputs or by neither, and a deploy that sets
  // the signing secrets (the owner's live webhook) sets both, so a redeploy cannot silently leave
  // the reconciler unconfigured. The first missing one is named, never a value.
  .superRefine((env, ctx) => {
    const key = env.LEDGER_DEPLOY_RESEND_API_KEY;
    const id = env.LEDGER_DEPLOY_RESEND_WEBHOOK_ID;
    const required =
      (key !== undefined) !== (id !== undefined) || env.LEDGER_DEPLOY_WEBHOOK_SECRETS !== undefined;
    if (!required) return;
    if (key === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['LEDGER_DEPLOY_RESEND_API_KEY'],
        message:
          "must be set to the reconciler's full_access Resend key, with LEDGER_DEPLOY_RESEND_WEBHOOK_ID and LEDGER_DEPLOY_WEBHOOK_SECRETS",
      });
    } else if (id === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['LEDGER_DEPLOY_RESEND_WEBHOOK_ID'],
        message:
          'must be set to the Resend webhook id, with LEDGER_DEPLOY_RESEND_API_KEY and LEDGER_DEPLOY_WEBHOOK_SECRETS',
      });
    }
  })
  .superRefine((env, ctx) => {
    if (env.LEDGER_SIMULATOR !== 'on') return;
    const secret = env.LEDGER_SIMULATOR_SECRET;
    if (secret === undefined || !SIGNING_SECRET.test(secret)) {
      ctx.addIssue({
        code: 'custom',
        path: ['LEDGER_SIMULATOR_SECRET'],
        message:
          secret === undefined
            ? 'must be set to one whsec_ signing secret when LEDGER_SIMULATOR is on'
            : 'must be one whsec_ signing secret when LEDGER_SIMULATOR is on',
      });
    }
  })
  .transform((env) => ({
    databaseUrl: env.LEDGER_DEPLOY_DATABASE_URL,
    pooledDatabaseUrl: env.LEDGER_DEPLOY_DATABASE_POOLED_URL,
    alertEmail: env.LEDGER_ALERT_EMAIL,
    addressHashKey: env.LEDGER_ADDRESS_HASH_KEY,
    tokenTagKey: env.LEDGER_TOKEN_TAG_KEY,
    webhookSecrets: env.LEDGER_DEPLOY_WEBHOOK_SECRETS,
    killSwitch: env.LEDGER_KILL_SWITCH === 'on',
    budgetUsd: env.LEDGER_BUDGET_USD,
    // `undefined` with LEDGER_SIMULATOR off; with `on`, the refinement above guarantees the secret.
    simulator:
      env.LEDGER_SIMULATOR === 'on' && env.LEDGER_SIMULATOR_SECRET !== undefined
        ? { secret: env.LEDGER_SIMULATOR_SECRET }
        : undefined,
    // Slice 4 D29: both or neither, the refinement above guarantees.
    resend:
      env.LEDGER_DEPLOY_RESEND_API_KEY !== undefined &&
      env.LEDGER_DEPLOY_RESEND_WEBHOOK_ID !== undefined
        ? {
            apiKey: env.LEDGER_DEPLOY_RESEND_API_KEY,
            webhookId: env.LEDGER_DEPLOY_RESEND_WEBHOOK_ID,
          }
        : undefined,
  }));

export type DeployEnv = z.output<typeof deployEnvSchema>;
