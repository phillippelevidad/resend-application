// D1, D16, D26: the worker's event source mapping over a stubbed Lambda client. Error names from the
// API Reference: ListEventSourceMappings
// (https://docs.aws.amazon.com/lambda/latest/api/API_ListEventSourceMappings.html#API_ListEventSourceMappings_Errors)
// and UpdateEventSourceMapping
// (https://docs.aws.amazon.com/lambda/latest/api/API_UpdateEventSourceMapping.html#API_UpdateEventSourceMapping_Errors).
import {
  type LambdaClient,
  ResourceInUseException,
  ResourceNotFoundException,
  TooManyRequestsException,
} from '@aws-sdk/client-lambda';
import { LedgerError } from '@ledger/shared';
import { eventSourceControlPortContract } from '@ledger/shared/testing';
import { describe, expect, it } from 'vitest';
import { LambdaEventSourceControlAdapter } from './lambda-event-source-control.adapter.ts';
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

  it('rejects with the SDK error unchanged when the update fails (ResourceInUseException)', async () => {
    const stub = lambdaWith([uuid]).answer('UpdateEventSourceMapping', () => {
      throw new ResourceInUseException({ message: 'updating', ...metadata });
    });

    const failure = await control(stub)
      .disable()
      .catch((caught: unknown) => caught);

    expect((failure as Error).name).toBe('ResourceInUseException');
  });
});

eventSourceControlPortContract('LambdaEventSourceControlAdapter', () =>
  control(lambdaWith([uuid])),
);
