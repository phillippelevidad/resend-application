// D5: the EMF writer emits one CloudWatch Embedded Metric Format line per call, namespace `Ledger`,
// no dimension (AWS-12), and nothing the log allow-list would drop.
import { describe, expect, it } from 'vitest';
import type { LogFields } from './create-logger.ts';
import { EmfMetricsAdapter } from './emf-metrics.adapter.ts';
import { FakeClock } from './testing/fake-clock.ts';

const address = 'delivered@resend.dev';

const captured = () => {
  const lines: string[] = [];
  const clock = new FakeClock('2026-10-17T12:00:00.000Z');
  const metrics = new EmfMetricsAdapter({
    sink: { write: (chunk: string) => lines.push(chunk) },
    clock,
  });
  const parsed = (): Record<string, unknown>[] =>
    lines.map((line) => JSON.parse(line) as Record<string, unknown>);
  return { clock, lines, metrics, parsed };
};

describe('EmfMetricsAdapter', () => {
  it('writes a count as one EMF line in namespace Ledger, unit Count, with no dimension', () => {
    const { clock, lines, metrics, parsed } = captured();

    metrics.count('ingest.accepted', 1, { svix_id: 'msg_1', type: 'email.sent' });

    expect(lines).toHaveLength(1);
    expect(lines[0]?.endsWith('\n')).toBe(true);
    expect(lines[0]?.indexOf('\n')).toBe((lines[0]?.length ?? 0) - 1);
    expect(parsed()[0]).toEqual({
      _aws: {
        Timestamp: clock.now().getTime(),
        CloudWatchMetrics: [
          {
            Namespace: 'Ledger',
            Dimensions: [[]],
            Metrics: [{ Name: 'ingest.accepted', Unit: 'Count' }],
          },
        ],
      },
      'ingest.accepted': 1,
      svix_id: 'msg_1',
      type: 'email.sent',
    });
  });

  it('writes a duration in Milliseconds, one line per call', () => {
    const { lines, metrics, parsed } = captured();

    metrics.duration('worker.processing_lag', 42, { svix_id: 'msg_1' });
    metrics.count('worker.duplicates', 1);

    expect(lines).toHaveLength(2);
    const [lag, duplicates] = parsed();
    expect(lag).toMatchObject({
      _aws: {
        CloudWatchMetrics: [{ Metrics: [{ Name: 'worker.processing_lag', Unit: 'Milliseconds' }] }],
      },
      'worker.processing_lag': 42,
      svix_id: 'msg_1',
    });
    expect(duplicates).toMatchObject({
      _aws: { CloudWatchMetrics: [{ Metrics: [{ Name: 'worker.duplicates', Unit: 'Count' }] }] },
      'worker.duplicates': 1,
    });
  });

  it('keeps only allow-listed fields: an address, a payload or a forged _aws never reach the line', () => {
    const { lines, metrics, parsed } = captured();
    const fields: Record<string, unknown> = {
      svix_id: 'msg_1',
      to: [address],
      payload: { data: { to: [address] } },
      _aws: { CloudWatchMetrics: [{ Namespace: 'Other', Dimensions: [['svix_id']] }] },
      'ingest.accepted': 99,
      email_id: { nested: address },
    };

    metrics.count('ingest.accepted', 1, fields as LogFields);

    const [line] = parsed();
    expect(Object.keys(line ?? {}).sort()).toEqual(['_aws', 'ingest.accepted', 'svix_id']);
    expect(line).toMatchObject({
      'ingest.accepted': 1,
      _aws: { CloudWatchMetrics: [{ Namespace: 'Ledger', Dimensions: [[]] }] },
    });
    expect(lines[0]).not.toContain(address);
  });

  it('writes ingest.rejected with its reason as the one dimension set and a top-level value (slice 4 D8)', () => {
    const { metrics, parsed } = captured();

    metrics.count('ingest.rejected', 1, undefined, { reason: 'signature' });
    metrics.count('ingest.rejected', 1, undefined, { reason: 'timestamp' });

    const [signature, timestamp] = parsed();
    expect(signature).toMatchObject({
      reason: 'signature',
      'ingest.rejected': 1,
      _aws: {
        CloudWatchMetrics: [
          {
            Namespace: 'Ledger',
            Dimensions: [['reason']],
            Metrics: [{ Name: 'ingest.rejected', Unit: 'Count' }],
          },
        ],
      },
    });
    expect(Object.keys(signature ?? {}).sort()).toEqual(['_aws', 'ingest.rejected', 'reason']);
    expect(timestamp).toMatchObject({ reason: 'timestamp' });
  });

  it('types the dimension per metric: ingest.rejected needs its reason, no other name takes one', () => {
    const { metrics } = captured();
    // @ts-expect-error: ingest.rejected requires its reason dimension.
    metrics.count('ingest.rejected', 1);
    // @ts-expect-error: a metric outside MetricDimensions takes no dimension.
    metrics.count('ingest.accepted', 1, undefined, { reason: 'signature' });
    // @ts-expect-error: reason is a closed set.
    metrics.count('ingest.rejected', 1, undefined, { reason: 'other' });
    expect(true).toBe(true);
  });
});
