// @ledger/shared/testing: the port doubles and port contract suites other packages' tests share
// (pp-testing → fakes, shared contract suites). Never imported by runtime code.
export { eventSourceControlPortContract } from './testing/event-source-control-port-contract.ts';
export { FakeClock } from './testing/fake-clock.ts';
export { FakeEventSourceControl } from './testing/fake-event-source-control.ts';
export { FakeFunctionInvoke } from './testing/fake-function-invoke.ts';
export { FakeQueueAttributes } from './testing/fake-queue-attributes.ts';
export { FakeSecretReader } from './testing/fake-secret-reader.ts';
export {
  functionInvokePortContract,
  type InvokedFunction,
} from './testing/function-invoke-port-contract.ts';
export {
  type QueueAttributesUnderTest,
  queueAttributesPortContract,
} from './testing/queue-attributes-port-contract.ts';
export { type QueuePortUnderTest, queuePortContract } from './testing/queue-port-contract.ts';
export { type RecordedMetric, RecordingMetrics } from './testing/recording-metrics.ts';
export {
  type HeldSecret,
  secretReaderPortContract,
} from './testing/secret-reader-port-contract.ts';
