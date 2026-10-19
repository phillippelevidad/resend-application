// D2: the internal variable names, one object per function (pp-infra → env-and-inputs). `infra` sets
// each value on its reader only, and that app's `<fn>.config.ts` takes its schema keys from the same
// object, so the two sides cannot drift. Every value is an ARN, URL or name, never a secret; no name
// is Lambda-reserved (AWS-56).

export const ingestEnv = {
  SIGNING_SECRETS_ARN: 'SIGNING_SECRETS_ARN',
  QUEUE_URL: 'QUEUE_URL',
} as const;

// D12: set on ingest only when the stack is synthesized with `ledger:simulator=true` (ADR-016), so
// ingest's config parses it as optional; absent, a simulator-signed request answers `401` (D13).
export const ingestSimulatorEnv = {
  SIMULATOR_SECRET_ARN: 'SIMULATOR_SECRET_ARN',
} as const;

// The worker finds its own event source mapping by the reserved `AWS_LAMBDA_FUNCTION_NAME` (AWS-56).
export const workerEnv = {
  DATABASE_SECRET_ARN: 'DATABASE_SECRET_ARN',
} as const;

export const apiEnv = {
  DATABASE_SECRET_ARN: 'DATABASE_SECRET_ARN',
  QUEUE_URL: 'QUEUE_URL',
  DLQ_URL: 'DLQ_URL',
  WORKER_FUNCTION_NAME: 'WORKER_FUNCTION_NAME',
} as const;

export const killSwitchEnv = {
  APP_STACK_NAME: 'APP_STACK_NAME',
  ALERT_TOPIC_ARN: 'ALERT_TOPIC_ARN',
} as const;
