// The names the scripts find the deployed installation by. The stack names, the outputs and the
// alarm names live in `@ledger/aws` (slice 3, D2), so `sim` reads the same ones without importing
// `infra`; they are re-exported here for the scripts. The scripts hold no id, ARN or URL of their
// own, and read the rest from the stacks' outputs.
import { APP_STACK_NAME, GUARDRAILS_STACK_NAME } from '@ledger/aws';

export {
  API_5XX_ALARM_NAME,
  API_FUNCTION_NAME,
  APP_STACK_NAME,
  appOutputKeys,
  DLQ_DEPTH_ALARM_NAME,
  GUARDRAILS_STACK_NAME,
  guardrailsOutputKeys,
  KILL_SWITCH_ERRORS_ALARM_NAME,
  QUEUE_AGE_ALARM_NAME,
  USAGE_TRIP_ALARM_NAME,
} from '@ledger/aws';

// Slice 2, D28: the budget the re-arm reads (guardrails stack).
export const MONTHLY_BUDGET_NAME = `${GUARDRAILS_STACK_NAME}-monthly`;

// Slice 2, D27: the one project tag `infra/src/main.ts` puts on every resource, which the
// post-destroy listing filters on (aws.md → Teardown).
export const PROJECT_TAG = { key: 'ledger-project', value: 'ledger' } as const;

// Slice 2, D26, D27: the log groups a function can leave behind, tagged or not: each function's
// explicit `/ledger/<name>` group, and any implicit `/aws/lambda/<name>` group (AWS-19). The
// guardrails prefix covers the kill switch, which the design's two prefixes would miss.
export const LOG_GROUP_PREFIXES = [
  '/ledger/',
  `/aws/lambda/${APP_STACK_NAME}-`,
  `/aws/lambda/${GUARDRAILS_STACK_NAME}-`,
] as const;
