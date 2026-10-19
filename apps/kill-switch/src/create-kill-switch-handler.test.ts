// Slice 2, R16's handler half and AWS-U12: any message on the trip topic trips the stack (D29); a
// non-SNS payload is refused with a constant before any AWS call, which is the failure the trip drill
// forces to observe the `Errors` alarm (D36 step 4); a failed trip leaves as a constant
// `internal_error` with no `cause`, logged by name only. The trip steps themselves are proven in
// `packages/aws/src/kill-switch.test.ts`; `main.ts` is never imported, so no client and no
// environment are involved.
import { errorRegistry } from '@ledger/core';
import { createLogger, LedgerError } from '@ledger/shared';
import { describe, expect, it } from 'vitest';
import {
  createKillSwitchHandler,
  type InvocationFields,
  type TripReport,
} from './create-kill-switch-handler.ts';

let lastRequest = 0;
const lambdaContext = () => {
  lastRequest += 1;
  return { awsRequestId: `req-${lastRequest}` };
};

// The shape SNS delivers to a subscribed function; the message is a budget notification's text.
const snsEvent = (message: string) => ({
  Records: [
    {
      EventSource: 'aws:sns',
      EventVersion: '1.0',
      Sns: { Type: 'Notification', Subject: 'AWS Budgets', Message: message },
    },
  ],
});

const harness = (trip: () => Promise<TripReport>) => {
  const lines: string[] = [];
  const invocation: InvocationFields = { request_id: undefined, cold_start: true };
  const logger = createLogger({
    functionName: 'kill-switch',
    stream: { write: (chunk: string) => lines.push(chunk) },
    context: () => invocation,
  });
  let trips = 0;
  const handler = createKillSwitchHandler({
    trip: () => {
      trips += 1;
      return trip();
    },
    logger,
    invocation,
  });
  const logged = () => lines.map((line) => JSON.parse(line) as Record<string, unknown>);
  return { handler, logged, lines, tripCount: () => trips };
};

const constantFailure = (thrown: unknown) => {
  expect(thrown).toBeInstanceOf(LedgerError);
  expect(thrown).toMatchObject({
    code: 'internal_error',
    message: errorRegistry.internal_error.message,
  });
  expect((thrown as LedgerError).cause).toBeUndefined();
};

describe('createKillSwitchHandler', () => {
  it('trips once for an SNS message and logs how many steps changed', async () => {
    const { handler, logged, tripCount } = harness(() =>
      Promise.resolve({ changed: ['event_source', 'concurrency:LedgerApp-ingest'] }),
    );
    const context = lambdaContext();

    await handler(snsEvent('Budget threshold exceeded'), context);

    expect(tripCount()).toBe(1);
    expect(logged()).toEqual([
      {
        level: 'info',
        timestamp: expect.any(String),
        function_name: 'kill-switch',
        message: 'kill_switch.tripped',
        request_id: context.awsRequestId,
        cold_start: true,
        changed_count: 2,
      },
    ]);
  });

  it('trips on any message, whatever its body says', async () => {
    const { handler, tripCount } = harness(() => Promise.resolve({ changed: [] }));

    await handler(snsEvent('{"AlarmName":"LedgerApp-usage-trip","NewStateValue":"ALARM"}'), {
      awsRequestId: 'req-alarm',
    });
    await handler(snsEvent(''), { awsRequestId: 'req-empty' });

    expect(tripCount()).toBe(2);
  });

  it.each([
    ['an empty object', {}],
    ['the drill payload', { ledger: 'force-failure' }],
    ['an SQS batch', { Records: [{ eventSource: 'aws:sqs', body: '{}' }] }],
    ['an SNS event with no records', { Records: [] }],
    ['null', null],
  ])('refuses %s with a constant internal_error and never trips', async (_, event) => {
    const { handler, logged, tripCount } = harness(() => Promise.resolve({ changed: [] }));
    const context = lambdaContext();

    const thrown = await handler(event, context).catch((error: unknown) => error);

    constantFailure(thrown);
    expect(tripCount()).toBe(0);
    expect(logged()).toEqual([
      {
        level: 'error',
        timestamp: expect.any(String),
        function_name: 'kill-switch',
        message: 'kill_switch.unexpected_event',
        request_id: context.awsRequestId,
        cold_start: true,
      },
    ]);
  });

  it('rethrows a failed trip as a constant internal_error with no cause, logged by name only', async () => {
    const { handler, logged, lines } = harness(() =>
      Promise.reject(
        new RangeError('User is not authorized on resource arn:aws:apigateway:region::/apis/x'),
      ),
    );
    const context = lambdaContext();

    const thrown = await handler(snsEvent('Budget threshold exceeded'), context).catch(
      (error: unknown) => error,
    );

    constantFailure(thrown);
    expect(logged()).toEqual([
      {
        level: 'error',
        timestamp: expect.any(String),
        function_name: 'kill-switch',
        message: 'kill_switch.internal_error',
        request_id: context.awsRequestId,
        cold_start: true,
        error_name: 'RangeError',
      },
    ]);
    expect(lines.join('')).not.toContain('apigateway');
  });

  it('marks only the first invocation of a container as a cold start (D6)', async () => {
    const { handler, logged } = harness(() => Promise.resolve({ changed: [] }));
    const first = lambdaContext();
    const second = lambdaContext();

    await handler(snsEvent('first'), first);
    await handler(snsEvent('second'), second);

    expect(logged().map((line) => [line.request_id, line.cold_start])).toEqual([
      [first.awsRequestId, true],
      [second.awsRequestId, false],
    ]);
  });
});
