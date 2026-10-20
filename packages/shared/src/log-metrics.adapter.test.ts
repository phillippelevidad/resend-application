import { describe, expect, it } from 'vitest';
import { createLogger } from './create-logger.ts';
import { LogMetricsAdapter } from './log-metrics.adapter.ts';

describe('LogMetricsAdapter', () => {
  it('writes each metric as a line whose message is its name, the value beside the ids (D16)', () => {
    const lines: string[] = [];
    const metrics = new LogMetricsAdapter(
      createLogger({
        functionName: 'worker',
        stream: { write: (chunk: string) => lines.push(chunk) },
      }),
    );

    metrics.count('ingest.accepted', 1, { svix_id: 'msg_1', type: 'email.sent' });
    metrics.duration('worker.processing_lag', 42, { svix_id: 'msg_1' });

    expect(lines.map((line) => JSON.parse(line))).toMatchObject([
      {
        level: 'info',
        message: 'ingest.accepted',
        svix_id: 'msg_1',
        type: 'email.sent',
        value_count: 1,
      },
      { level: 'info', message: 'worker.processing_lag', svix_id: 'msg_1', value_ms: 42 },
    ]);
  });

  it('writes a dimension as a log field: ingest.rejected carries its reason (slice 4 D8)', () => {
    const lines: string[] = [];
    const metrics = new LogMetricsAdapter(
      createLogger({
        functionName: 'ingest',
        stream: { write: (chunk: string) => lines.push(chunk) },
      }),
    );

    metrics.count('ingest.rejected', 1, undefined, { reason: 'timestamp' });

    expect(lines.map((line) => JSON.parse(line))).toMatchObject([
      { message: 'ingest.rejected', reason: 'timestamp', value_count: 1 },
    ]);
  });
});
