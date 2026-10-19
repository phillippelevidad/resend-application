// D1, D16, D26: the worker's event source mapping over a stubbed Lambda client. Error names from the
// API Reference: ListEventSourceMappings
// (https://docs.aws.amazon.com/lambda/latest/api/API_ListEventSourceMappings.html#API_ListEventSourceMappings_Errors)
// and UpdateEventSourceMapping
// (https://docs.aws.amazon.com/lambda/latest/api/API_UpdateEventSourceMapping.html#API_UpdateEventSourceMapping_Errors).
import {
  type LambdaClient,
  ResourceConflictException,
  ResourceInUseException,
  ResourceNotFoundException,
  TooManyRequestsException,
} from '@aws-sdk/client-lambda';
import { LedgerError } from '@ledger/shared';
import { eventSourceControlPortContract, FakeClock } from '@ledger/shared/testing';
import { describe, expect, it } from 'vitest';
import {
  EVENT_SOURCE_SETTLE_POLL_MS,
  LambdaEventSourceControlAdapter,
} from './lambda-event-source-control.adapter.ts';
import { StubClient } from './testing/stub-client.ts';

const metadata = { $metadata: {} };
const functionName = 'LedgerApp-worker';
const uuid = '6d9a3f0e-1b2c-4d5e-8f90-123456789abc';

// A Lambda that holds the given mappings for the worker and remembers `Enabled`, answering `State`
// as `Enabled` or `Disabled` (AWS-18).
const lambdaWith = (uuids: readonly string[], state = 'Enabled', nextMarker?: string) => {
  let current = state;
  return new StubClient()
    .answer('ListEventSourceMappings', () => ({
      EventSourceMappings: uuids.map((UUID) => ({ UUID, State: current })),
      ...(nextMarker === undefined ? {} : { NextMarker: nextMarker }),
      ...metadata,
    }))
    .answer('GetEventSourceMapping', () => ({ UUID: uuid, State: current, ...metadata }))
    .answer('UpdateEventSourceMapping', (input) => {
      current = input.Enabled === true ? 'Enabled' : 'Disabled';
      return { UUID: uuid, State: input.Enabled === true ? 'Enabling' : 'Disabling', ...metadata };
    });
};

const control = (stub: StubClient) =>
  new LambdaEventSourceControlAdapter({ client: stub.as<LambdaClient>(), functionName });

// The adapter over a fake clock whose sleep advances it, so a settle wait runs instantly.
const settling = (stub: StubClient, clock: FakeClock, timeoutMs?: number) =>
  new LambdaEventSourceControlAdapter({
    client: stub.as<LambdaClient>(),
    functionName,
    settle: {
      clock,
      sleep: async (ms) => clock.advance(ms),
      ...(timeoutMs === undefined ? {} : { timeoutMs }),
    },
  });

describe('LambdaEventSourceControlAdapter', () => {
  it('finds the mapping by function name once, then reads and updates it by UUID', async () => {
    const stub = lambdaWith([uuid]);
    const adapter = control(stub);

    expect(await adapter.getState()).toBe('enabled');
    await adapter.disable();
    expect(await adapter.getState()).toBe('paused');
    await adapter.enable();

    expect(stub.sent).toEqual([
      { name: 'ListEventSourceMappings', input: { FunctionName: functionName } },
      { name: 'GetEventSourceMapping', input: { UUID: uuid } },
      { name: 'UpdateEventSourceMapping', input: { UUID: uuid, Enabled: false } },
      { name: 'GetEventSourceMapping', input: { UUID: uuid } },
      { name: 'UpdateEventSourceMapping', input: { UUID: uuid, Enabled: true } },
    ]);
  });

  it.each([
    ['Enabled', 'enabled'],
    ['Disabled', 'paused'],
    ['Enabling', 'changing'],
    ['Disabling', 'changing'],
    ['Updating', 'changing'],
    ['Creating', 'changing'],
  ])('maps State %s to %s (D4)', async (lambdaState, expected) => {
    expect(await control(lambdaWith([uuid], lambdaState)).getState()).toBe(expected);
  });

  it.each([
    ['no mapping', [] as string[], undefined],
    ['two mappings', [uuid, '0f0f0f0f-1b2c-4d5e-8f90-123456789abc'], undefined],
    ['one mapping on a page that has more', [uuid], 'next-page'],
  ])(
    'refuses with a constant internal_error when the function has %s',
    async (_case, uuids, next) => {
      const stub = lambdaWith(uuids, 'Enabled', next);

      const failure = await control(stub)
        .getState()
        .catch((caught: unknown) => caught);

      expect(failure).toBeInstanceOf(LedgerError);
      expect((failure as LedgerError).code).toBe('internal_error');
      expect((failure as LedgerError).message).not.toContain(functionName);
      expect(stub.names()).toEqual(['ListEventSourceMappings']);
    },
  );

  it('caches no failed lookup: the next call lists again and succeeds', async () => {
    let calls = 0;
    const stub = lambdaWith([uuid]).answer('ListEventSourceMappings', () => {
      calls += 1;
      if (calls === 1) throw new TooManyRequestsException({ message: 'slow', ...metadata });
      return { EventSourceMappings: [{ UUID: uuid, State: 'Enabled' }], ...metadata };
    });
    const adapter = control(stub);

    const failure = await adapter.getState().catch((caught: unknown) => caught);
    expect((failure as Error).name).toBe('TooManyRequestsException');

    expect(await adapter.getState()).toBe('enabled');
    expect(stub.names()).toEqual([
      'ListEventSourceMappings',
      'ListEventSourceMappings',
      'GetEventSourceMapping',
    ]);
  });

  it('drops a cached UUID the mapping no longer answers to and runs the call once more on a fresh lookup', async () => {
    const replaced = '0f0f0f0f-1b2c-4d5e-8f90-123456789abc';
    let listed = uuid;
    const stub = lambdaWith([uuid])
      .answer('ListEventSourceMappings', () => ({
        EventSourceMappings: [{ UUID: listed, State: 'Enabled' }],
        ...metadata,
      }))
      .answer('GetEventSourceMapping', (input) => {
        if (input.UUID !== listed) {
          throw new ResourceNotFoundException({ message: 'gone', ...metadata });
        }
        return { UUID: listed, State: 'Enabled', ...metadata };
      });
    const adapter = control(stub);

    expect(await adapter.getState()).toBe('enabled');
    listed = replaced;
    expect(await adapter.getState()).toBe('enabled');

    expect(stub.sent).toEqual([
      { name: 'ListEventSourceMappings', input: { FunctionName: functionName } },
      { name: 'GetEventSourceMapping', input: { UUID: uuid } },
      { name: 'GetEventSourceMapping', input: { UUID: uuid } },
      { name: 'ListEventSourceMappings', input: { FunctionName: functionName } },
      { name: 'GetEventSourceMapping', input: { UUID: replaced } },
    ]);
  });

  it('rejects with the SDK error unchanged and waits nothing when the update fails for another reason (TooManyRequestsException)', async () => {
    const clock = new FakeClock();
    const started = clock.now().getTime();
    const stub = lambdaWith([uuid]).answer('UpdateEventSourceMapping', () => {
      throw new TooManyRequestsException({ message: 'slow', ...metadata });
    });

    const failure = await settling(stub, clock)
      .disable()
      .catch((caught: unknown) => caught);

    expect((failure as Error).name).toBe('TooManyRequestsException');
    expect(clock.now().getTime() - started).toBe(0);
    expect(stub.names().filter((name) => name === 'UpdateEventSourceMapping')).toHaveLength(1);
  });
});

// D16, D29 (owner: "Wait, then cap"): a mapping mid-transition refuses `UpdateEventSourceMapping`
// with `ResourceInUseException` (API Reference, Errors), so enable and disable wait it out within
// their budget. Time is a `FakeClock` whose sleep advances it, so no test sleeps.
describe('LambdaEventSourceControlAdapter on a mapping in transition', () => {
  const TIMEOUT_MS = 10_000;
  const settled = new Set(['Enabled', 'Disabled']);

  // A mapping in `transition` that settles at `settlesTo` once `settlesAfterMs` has passed on the
  // clock (never, when `settlesTo` is undefined), refusing every update until it settles.
  const inTransition = (
    clock: FakeClock,
    transition: string,
    settlesTo: string | undefined,
    settlesAfterMs = 0,
  ) => {
    const settlesAt = clock.now().getTime() + settlesAfterMs;
    let current = transition;
    const state = () => {
      if (current === transition && settlesTo !== undefined && clock.now().getTime() >= settlesAt) {
        current = settlesTo;
      }
      return current;
    };
    const stub = new StubClient()
      .answer('ListEventSourceMappings', () => ({
        EventSourceMappings: [{ UUID: uuid, State: state() }],
        ...metadata,
      }))
      .answer('GetEventSourceMapping', () => ({ UUID: uuid, State: state(), ...metadata }))
      .answer('UpdateEventSourceMapping', (input) => {
        if (!settled.has(state())) {
          throw new ResourceInUseException({ message: 'in transition', ...metadata });
        }
        current = input.Enabled === true ? 'Enabled' : 'Disabled';
        return { UUID: uuid, ...metadata };
      });
    return { stub, state };
  };
  const updates = (stub: StubClient) => stub.inputs('UpdateEventSourceMapping');

  it('disable on an Enabling mapping waits for it to settle, then pauses it', async () => {
    const clock = new FakeClock();
    const started = clock.now().getTime();
    const { stub, state } = inTransition(clock, 'Enabling', 'Enabled', 2_500);

    await settling(stub, clock, TIMEOUT_MS).disable();

    expect(state()).toBe('Disabled');
    expect(updates(stub).at(-1)).toEqual({ UUID: uuid, Enabled: false });
    expect(updates(stub)).toHaveLength(4);
    expect(clock.now().getTime() - started).toBe(3_000);
  });

  it('enable on a Disabling mapping (the worker just paused itself) waits, then enables it, as resume needs', async () => {
    const clock = new FakeClock();
    const { stub, state } = inTransition(clock, 'Disabling', 'Disabled', 1_500);
    const adapter = settling(stub, clock, TIMEOUT_MS);

    await adapter.enable();

    expect(state()).toBe('Enabled');
    expect(await adapter.getState()).toBe('enabled');
    expect(updates(stub).at(-1)).toEqual({ UUID: uuid, Enabled: true });
  });

  it('sends no further update once the transition settles at the target', async () => {
    const clock = new FakeClock();
    const { stub, state } = inTransition(clock, 'Disabling', 'Disabled', 500);

    await settling(stub, clock, TIMEOUT_MS).disable();

    expect(state()).toBe('Disabled');
    expect(updates(stub)).toHaveLength(1);
  });

  it('rejects with ResourceInUseException unchanged once the budget runs out, having polled for all of it', async () => {
    const clock = new FakeClock();
    const started = clock.now().getTime();
    const { stub, state } = inTransition(clock, 'Updating', undefined);

    const failure = await settling(stub, clock, TIMEOUT_MS)
      .disable()
      .catch((caught: unknown) => caught);

    expect((failure as Error).name).toBe('ResourceInUseException');
    expect(state()).toBe('Updating');
    expect(clock.now().getTime() - started).toBe(TIMEOUT_MS);
    // One attempt at the start and one after each one-second poll.
    expect(updates(stub)).toHaveLength(TIMEOUT_MS / EVENT_SOURCE_SETTLE_POLL_MS + 1);
  });

  it('waits out ResourceConflictException (another operation in progress) the same way', async () => {
    const clock = new FakeClock();
    let conflicts = 2;
    const stub = lambdaWith([uuid], 'Enabled').answer('UpdateEventSourceMapping', (input) => {
      if (conflicts > 0) {
        conflicts -= 1;
        throw new ResourceConflictException({ message: 'in progress', ...metadata });
      }
      return { UUID: uuid, State: input.Enabled === true ? 'Enabling' : 'Disabling', ...metadata };
    });

    await settling(stub, clock, TIMEOUT_MS).disable();

    expect(updates(stub)).toHaveLength(3);
  });
});

eventSourceControlPortContract('LambdaEventSourceControlAdapter', () =>
  control(lambdaWith([uuid])),
);
