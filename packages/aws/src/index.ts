// @ledger/aws: the only @aws-sdk importer (ADR-013). Client factories, the five port adapters, the
// kill switch's trip and restore steps, and the script-only modules (D26). The package's one public
// surface; its stubbed client stays in its own tests.
export { type AlarmState, alarmControl } from './alarm-control.ts';
export {
  createApiGatewayV2Client,
  createBudgetsClient,
  createCloudFormationClient,
  createCloudWatchClient,
  createCloudWatchLogsClient,
  createLambdaClient,
  createResourceGroupsTaggingClient,
  createSecretsManagerClient,
  createSnsClient,
  createSqsClient,
} from './aws-clients.ts';
export { type BudgetSpend, readBudgetSpend } from './budget-spend.ts';
export {
  type DeclaredThrottle,
  KILL_SWITCH_STOP_THROTTLE,
  type KillSwitchClients,
  type KillSwitchNames,
  type KillSwitchReport,
  type KillSwitchState,
  readKillSwitchState,
  restoreFromTrip,
  tripKillSwitch,
} from './kill-switch.ts';
export {
  LambdaEventSourceControlAdapter,
  type LambdaEventSourceControlAdapterDeps,
} from './lambda-event-source-control.adapter.ts';
export {
  LambdaFunctionInvokeAdapter,
  type LambdaFunctionInvokeAdapterDeps,
} from './lambda-function-invoke.adapter.ts';
export {
  type Leftover,
  listPostDestroyLeftovers,
  type PostDestroyClients,
  type PostDestroyListing,
  type PostDestroyScope,
} from './post-destroy-listing.ts';
export { writeSecretIfChanged } from './secret-writer.ts';
export {
  SecretsManagerSecretReaderAdapter,
  type SecretsManagerSecretReaderAdapterDeps,
} from './secrets-manager-secret-reader.adapter.ts';
export { SqsQueueAdapter, type SqsQueueAdapterDeps } from './sqs-queue.adapter.ts';
export {
  SqsQueueAttributesAdapter,
  type SqsQueueAttributesAdapterDeps,
} from './sqs-queue-attributes.adapter.ts';
export { readStackOutputs, type StackOutputs } from './stack-outputs.ts';
