// Slice 3, D2: the names the deployed installation is found by, shared by `infra` (the CDK app fixes
// both stack names from here) and every caller that must not import `infra`: its scripts and `sim`.
// Every physical name below derives from the stack names (slice 2, D27, D28), so the template and
// its callers cannot disagree; the rest is read from the stacks' outputs.

export const APP_STACK_NAME = 'LedgerApp';
export const GUARDRAILS_STACK_NAME = 'LedgerGuardrails';

// Slice 2, D27's outputs; `simulatorSecretArn` only when the simulator is on (slice 3, D12).
export const appOutputKeys = {
  deployedCommit: 'DeployedCommit',
  apiUrl: 'ApiUrl',
  signingSecretsArn: 'SigningSecretsArn',
  databaseSecretArn: 'DatabaseSecretArn',
  simulatorSecretArn: 'SimulatorSecretArn',
  queueUrl: 'QueueUrl',
  dlqUrl: 'DlqUrl',
  workerFunctionName: 'WorkerFunctionName',
  throttleRateLimit: 'ThrottleRateLimit',
  throttleBurstLimit: 'ThrottleBurstLimit',
  // Slice 4 D26: the reconciler's key secret, which the deploy's key write targets.
  resendApiKeySecretArn: 'ResendApiKeySecretArn',
} as const;

// Slice 2, D28's outputs.
export const guardrailsOutputKeys = {
  killSwitchArmed: 'KillSwitchArmed',
  tripTopicArn: 'TripTopicArn',
  alertTopicArn: 'AlertTopicArn',
  killSwitchFunctionName: 'KillSwitchFunctionName',
} as const;

// The read API's physical name, derived as `infra/src/app.stack.ts` derives it; no output names it.
export const API_FUNCTION_NAME = `${APP_STACK_NAME}-api`;

// Slice 4 D20: the reconciler's physical name, derived as the stack derives it.
export const RECONCILER_FUNCTION_NAME = `${APP_STACK_NAME}-reconciler`;

// The alarms: the usage trip the drill forces (slice 2, D30) and the three operating alarms
// (slice 3, D17) in the app stack; the kill switch's `Errors` alarm the drill watches in the
// guardrails stack (slice 2, D28).
export const USAGE_TRIP_ALARM_NAME = `${APP_STACK_NAME}-usage-trip`;
export const QUEUE_AGE_ALARM_NAME = `${APP_STACK_NAME}-queue-age`;
export const DLQ_DEPTH_ALARM_NAME = `${APP_STACK_NAME}-dlq-depth`;
export const API_5XX_ALARM_NAME = `${APP_STACK_NAME}-api-5xx`;
export const KILL_SWITCH_ERRORS_ALARM_NAME = `${GUARDRAILS_STACK_NAME}-kill-switch-errors`;

// Slice 4 D24, D25: the reconciler's hourly schedule and its gap alarm.
export const RECONCILE_SCHEDULE_NAME = `${APP_STACK_NAME}-reconcile-hourly`;
export const RECONCILE_GAP_ALARM_NAME = `${APP_STACK_NAME}-reconcile-gap`;
