// Slice 2, Ships 3 (R5; ADR-008, AWS-05) and AWS-U12: the worker's Lambda adapter returns
// `batchItemFailures` exactly as the worker built them from per-message results, rethrows a thrown
// error as a constant so the whole batch is redelivered (an empty response would delete it), answers
// the resume event with the worker's `ResumeResult`, and throws a constant on any other event. A fake
// worker stands in for the package factory; no AWS client and no environment are involved, because
// `main.ts` is never imported.
import { errorRegistry } from '@ledger/core';
import { createLogger, LedgerError, type QueueMessage } from '@ledger/shared';
import type { ResumeResult, Worker } from '@ledger/worker';
import { describe, expect, it } from 'vitest';
import { createWorkerHandler, type InvocationFields } from './create-worker-handler.ts';

// A worker that fails the messages whose body is `fail`, or throws on every batch.
class FakeWorker implements Worker {
  readonly received: QueueMessage[][] = [];
  throwOnBatch = false;
  resumeResult: ResumeResult = { outcome: 'resumed', state: 'enabled' };

  async processBatch(messages: readonly QueueMessage[]) {
    this.received.push([...messages]);
    if (this.throwOnBatch) {
      throw new RangeError('driver said: delivered@resend.dev');
    }
    return {
      batchItemFailures: messages
        .filter((message) => message.body === 'fail')
        .map((message) => ({ itemIdentifier: message.messageId })),
    };
  }

  async resume() {
    return this.resumeResult;
  }
}

let lastRequest = 0;
const lambdaContext = () => {
  lastRequest += 1;
  return { awsRequestId: `req-${lastRequest}` };
};

const record = (messageId: string, body: string) => ({
  messageId,
  receiptHandle: `handle-${messageId}`,
  body,
  attributes: { ApproximateReceiveCount: '1' },
  eventSource: 'aws:sqs',
  eventSourceARN: 'arn:aws:sqs:us-east-2:000000000000:ledger-queue',
  awsRegion: 'us-east-2',
});

const harness = () => {
  const worker = new FakeWorker();
  const lines: string[] = [];
  const invocation: InvocationFields = { request_id: undefined, cold_start: true };
  const logger = createLogger({
    functionName: 'worker',
    stream: { write: (chunk: string) => lines.push(chunk) },
    context: () => invocation,
  });
  const handler = createWorkerHandler({ worker, logger, invocation });
  const logged = () => lines.map((line) => JSON.parse(line) as Record<string, unknown>);
  return { worker, handler, lines, logged };
};

const constantError = (thrown: unknown) => {
  expect(thrown).toBeInstanceOf(LedgerError);
  expect(thrown).toMatchObject({
    code: 'internal_error',
    message: errorRegistry.internal_error.message,
  });
  expect((thrown as LedgerError).cause).toBeUndefined();
};

describe('createWorkerHandler', () => {
  it('three SQS records with one failure return batchItemFailures holding exactly that messageId', async () => {
    const { worker, handler } = harness();

    const response = await handler(
      { Records: [record('m-1', 'ok'), record('m-2', 'fail'), record('m-3', 'ok')] },
      lambdaContext(),
    );

    expect(response).toEqual({ batchItemFailures: [{ itemIdentifier: 'm-2' }] });
    expect(worker.received).toEqual([
      [
        { messageId: 'm-1', body: 'ok' },
        { messageId: 'm-2', body: 'fail' },
        { messageId: 'm-3', body: 'ok' },
      ],
    ]);
  });

  it('a throwing processBatch is rethrown as a constant internal_error with no cause, logged by name only', async () => {
    const { worker, handler, lines, logged } = harness();
    worker.throwOnBatch = true;
    const context = lambdaContext();

    const thrown = await handler({ Records: [record('m-1', 'ok')] }, context).then(
      (response) => response,
      (error: unknown) => error,
    );

    constantError(thrown);
    expect(logged().filter((line) => line.level === 'error')).toEqual([
      {
        level: 'error',
        timestamp: expect.any(String),
        function_name: 'worker',
        message: 'worker.internal_error',
        request_id: context.awsRequestId,
        cold_start: true,
        error_name: 'RangeError',
      },
    ]);
    expect(lines.join('')).not.toContain('delivered@resend.dev');
  });

  it('the resume event answers the worker’s ResumeResult', async () => {
    const { worker, handler } = harness();
    worker.resumeResult = { outcome: 'probe_failed', state: 'paused' };

    expect(await handler({ ledger: 'resume-event-source' }, lambdaContext())).toEqual({
      outcome: 'probe_failed',
      state: 'paused',
    });
    expect(worker.received).toEqual([]);
  });

  it.each([
    ['an unknown ledger event', { ledger: 'drain-queue' }],
    ['a non-SQS record', { Records: [{ ...record('m-1', 'ok'), eventSource: 'aws:kinesis' }] }],
    ['an empty object', {}],
  ])('%s throws a constant internal_error and reaches no worker method', async (_, event) => {
    const { worker, handler } = harness();

    const thrown = await handler(event, lambdaContext()).then(
      (response) => response,
      (error: unknown) => error,
    );

    constantError(thrown);
    expect(worker.received).toEqual([]);
  });

  it('marks only the first invocation of a container as a cold start (D6)', async () => {
    const { handler, logged } = harness();
    const first = lambdaContext();
    const second = lambdaContext();

    await handler({}, first).catch(() => undefined);
    await handler({}, second).catch(() => undefined);

    expect(logged().map((line) => [line.request_id, line.cold_start])).toEqual([
      [first.awsRequestId, true],
      [second.awsRequestId, false],
    ]);
  });
});
