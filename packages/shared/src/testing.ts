// @ledger/shared/testing: the port doubles other packages' tests share (pp-testing → fakes). Never
// imported by runtime code.
export { FakeClock } from './testing/fake-clock.ts';
export { type RecordedMetric, RecordingMetrics } from './testing/recording-metrics.ts';
