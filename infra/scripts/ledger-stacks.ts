// The names the scripts find the deployed installation by. `infra/src/main.ts` fixes both stack
// names, and every physical name below derives from them (D27, D28): the scripts hold no id, ARN or
// URL of their own, and read the rest from the stacks' outputs.

export const APP_STACK_NAME = 'LedgerApp';
export const GUARDRAILS_STACK_NAME = 'LedgerGuardrails';

// D27's outputs.
export const appOutputKeys = {
  deployedCommit: 'DeployedCommit',
  apiUrl: 'ApiUrl',
  signingSecretsArn: 'SigningSecretsArn',
  databaseSecretArn: 'DatabaseSecretArn',
  queueUrl: 'QueueUrl',
  dlqUrl: 'DlqUrl',
  workerFunctionName: 'WorkerFunctionName',
  throttleRateLimit: 'ThrottleRateLimit',
  throttleBurstLimit: 'ThrottleBurstLimit',
} as const;

// D28's outputs.
export const guardrailsOutputKeys = {
  killSwitchArmed: 'KillSwitchArmed',
  tripTopicArn: 'TripTopicArn',
  alertTopicArn: 'AlertTopicArn',
  killSwitchFunctionName: 'KillSwitchFunctionName',
} as const;

// D30: the usage-trip alarm the drill forces (app stack); D28: the budget the re-arm reads and the
// kill switch's `Errors` alarm the drill watches (guardrails stack).
export const USAGE_TRIP_ALARM_NAME = `${APP_STACK_NAME}-usage-trip`;
export const MONTHLY_BUDGET_NAME = `${GUARDRAILS_STACK_NAME}-monthly`;
export const KILL_SWITCH_ERRORS_ALARM_NAME = `${GUARDRAILS_STACK_NAME}-kill-switch-errors`;

// D27: the one project tag `infra/src/main.ts` puts on every resource, which the post-destroy
// listing filters on (aws.md → Teardown).
export const PROJECT_TAG = { key: 'ledger-project', value: 'ledger' } as const;

// D26, D27: the log groups a function can leave behind, tagged or not: each function's explicit
// `/ledger/<name>` group, and any implicit `/aws/lambda/<name>` group (AWS-19). The guardrails
// prefix covers the kill switch, which the design's two prefixes would miss.
export const LOG_GROUP_PREFIXES = [
  '/ledger/',
  `/aws/lambda/${APP_STACK_NAME}-`,
  `/aws/lambda/${GUARDRAILS_STACK_NAME}-`,
] as const;
