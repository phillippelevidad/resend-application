// D29, D35, R16: the kill switch's trip and restore over stubbed Lambda, API Gateway and SNS clients
// that hold a small account's state: functions and their reserved concurrency, the worker's mapping,
// and the HTTP API's stage. The commands sent are the consequence at this seam; the state they leave
// is asserted too. Error names from the API References: PutFunctionConcurrency
// (https://docs.aws.amazon.com/lambda/latest/api/API_PutFunctionConcurrency.html#API_PutFunctionConcurrency_Errors)
// and UpdateStage (https://docs.aws.amazon.com/apigatewayv2/latest/api-reference/apis-apiid-stages-stagename.html).
import { type ApiGatewayV2Client, BadRequestException } from '@aws-sdk/client-apigatewayv2';
import {
  type LambdaClient,
  ResourceInUseException,
  TooManyRequestsException,
} from '@aws-sdk/client-lambda';
import type { SNSClient } from '@aws-sdk/client-sns';
import { LedgerError } from '@ledger/shared';
import { FakeClock } from '@ledger/shared/testing';
import { describe, expect, it } from 'vitest';
import {
  KILL_SWITCH_SETTLE_TIMEOUT_MS,
  type KillSwitchNames,
  readKillSwitchState,
  restoreFromTrip,
  tripKillSwitch,
} from './kill-switch.ts';
import { StubClient } from './testing/stub-client.ts';

const metadata = { $metadata: {} };
const accountId = '123456789012';
const apiId = 'a1b2c3d4e5';
const mappingUuid = '6d9a3f0e-1b2c-4d5e-8f90-123456789abc';
const names: KillSwitchNames = {
  appStackName: 'LedgerApp',
  alertTopicArn: `arn:aws:sns:us-east-2:${accountId}:LedgerGuardrails-alert`,
};
const declared = { rateLimit: 100, burstLimit: 200 };

type Settings = {
  ThrottlingRateLimit?: number;
  ThrottlingBurstLimit?: number;
  DetailedMetricsEnabled?: boolean;
};

type AccountState = {
  // Function name → reserved concurrency (`null`: none set), in `ListFunctions` order.
  functions: Map<string, number | null>;
  mappingState: string;
  apis: { Name: string; ApiId: string }[];
  defaultSettings: Settings;
  routeSettings: Record<string, Settings>;
  published: { TopicArn: unknown; Subject: unknown; Message: string }[];
};

// A steady app stack: three app functions, one from a later slice, the kill switch and an unrelated
// function; the mapping enabled; the declared throttle; one hand-added route throttle.
const steadyAccount = (): AccountState => ({
  functions: new Map<string, number | null>([
    ['LedgerApp-ingest', null],
    ['LedgerApp-worker', null],
    ['LedgerApp-api', null],
    ['LedgerGuardrails-kill-switch', null],
    ['LedgerApp-dispatcher', null],
    ['other-project-fn', 7],
    ['LedgerApp2-lookalike', null],
  ]),
  mappingState: 'Enabled',
  apis: [
    { Name: 'other-http', ApiId: 'zzzzzzzzzz' },
    { Name: 'LedgerApp-http', ApiId: apiId },
  ],
  defaultSettings: {
    DetailedMetricsEnabled: false,
    ThrottlingRateLimit: 100,
    ThrottlingBurstLimit: 200,
  },
  routeSettings: {
    'POST /webhooks/resend': { ThrottlingRateLimit: 500, ThrottlingBurstLimit: 1000 },
  },
  published: [],
});

// `ListFunctions` pages hold three functions each, so a run crosses pages.
const PAGE_SIZE = 3;

// The three stubbed clients share one ordered log of every command, across services.
const harness = (account: AccountState) => {
  const log: string[] = [];
  const logged = (stub: StubClient): StubClient => {
    const send = stub.send.bind(stub);
    stub.send = async (command) => {
      log.push(command.constructor.name.replace(/Command$/, ''));
      return send(command);
    };
    return stub;
  };
  const lambda = logged(
    new StubClient()
      .answer('ListFunctions', (input) => {
        const all = [...account.functions.keys()];
        const start = input.Marker === undefined ? 0 : Number(input.Marker);
        const end = start + PAGE_SIZE;
        return {
          Functions: all.slice(start, end).map((FunctionName) => ({ FunctionName })),
          ...(end < all.length ? { NextMarker: String(end) } : {}),
          ...metadata,
        };
      })
      .answer('GetFunctionConcurrency', (input) => {
        const reserved = account.functions.get(input.FunctionName as string);
        return {
          ...(reserved == null ? {} : { ReservedConcurrentExecutions: reserved }),
          ...metadata,
        };
      })
      .answer('PutFunctionConcurrency', (input) => {
        account.functions.set(
          input.FunctionName as string,
          input.ReservedConcurrentExecutions as number,
        );
        return { ReservedConcurrentExecutions: input.ReservedConcurrentExecutions, ...metadata };
      })
      .answer('DeleteFunctionConcurrency', (input) => {
        account.functions.set(input.FunctionName as string, null);
        return metadata;
      })
      .answer('ListEventSourceMappings', (input) => ({
        EventSourceMappings:
          input.FunctionName === 'LedgerApp-worker'
            ? [{ UUID: mappingUuid, State: account.mappingState }]
            : [],
        ...metadata,
      }))
      .answer('GetEventSourceMapping', () => ({
        UUID: mappingUuid,
        State: account.mappingState,
        ...metadata,
      }))
      .answer('UpdateEventSourceMapping', (input) => {
        account.mappingState = input.Enabled === true ? 'Enabled' : 'Disabled';
        return { UUID: mappingUuid, ...metadata };
      }),
  );
  const apiGateway = logged(
    new StubClient()
      .answer('GetApis', (input) => {
        // One API per page, so the lookup crosses pages too.
        const index = input.NextToken === undefined ? 0 : Number(input.NextToken);
        const next = index + 1;
        return {
          Items: account.apis.slice(index, next),
          ...(next < account.apis.length ? { NextToken: String(next) } : {}),
          ...metadata,
        };
      })
      .answer('GetStage', () => ({
        StageName: '$default',
        DefaultRouteSettings: { ...account.defaultSettings },
        RouteSettings: structuredClone(account.routeSettings),
        ...metadata,
      }))
      .answer('UpdateStage', (input) => {
        if (input.DefaultRouteSettings !== undefined) {
          account.defaultSettings = input.DefaultRouteSettings as Settings;
        }
        for (const [routeKey, settings] of Object.entries(
          (input.RouteSettings ?? {}) as Record<string, Settings>,
        )) {
          account.routeSettings[routeKey] = settings;
        }
        return metadata;
      })
      .answer('DeleteRouteSettings', (input) => {
        delete account.routeSettings[input.RouteKey as string];
        return metadata;
      }),
  );
  const sns = logged(
    new StubClient().answer('Publish', (input) => {
      account.published.push({
        TopicArn: input.TopicArn,
        Subject: input.Subject,
        Message: input.Message as string,
      });
      return { MessageId: 'sns-1', ...metadata };
    }),
  );
  const clients = {
    lambda: lambda.as<LambdaClient>(),
    apiGateway: apiGateway.as<ApiGatewayV2Client>(),
    sns: sns.as<SNSClient>(),
  };
  // The commands that change the account, in the order sent.
  const updates = () =>
    log.filter((name) =>
      [
        'UpdateEventSourceMapping',
        'PutFunctionConcurrency',
        'DeleteFunctionConcurrency',
        'UpdateStage',
        'DeleteRouteSettings',
      ].includes(name),
    );
  return { account, apiGateway, clients, lambda, log, sns, updates };
};

// D29 (owner: "Wait, then cap"): the worker's mapping in `transition`, settling at `settlesTo` once
// `settlesAfterMs` has passed on the clock (never, when undefined). Until then every
// `UpdateEventSourceMapping` is refused with `ResourceInUseException`, as the API Reference's Errors
// section describes (lambda/API_UpdateEventSourceMapping).
const inTransition = (
  { account, lambda }: ReturnType<typeof harness>,
  clock: FakeClock,
  transition: string,
  settlesTo: string | undefined,
  settlesAfterMs = 0,
) => {
  const settlesAt = clock.now().getTime() + settlesAfterMs;
  account.mappingState = transition;
  const state = () => {
    if (
      account.mappingState === transition &&
      settlesTo !== undefined &&
      clock.now().getTime() >= settlesAt
    ) {
      account.mappingState = settlesTo;
    }
    return account.mappingState;
  };
  lambda
    .answer('GetEventSourceMapping', () => ({ UUID: mappingUuid, State: state(), ...metadata }))
    .answer('UpdateEventSourceMapping', (input) => {
      if (!['Enabled', 'Disabled'].includes(state())) {
        throw new ResourceInUseException({ message: 'in transition', ...metadata });
      }
      account.mappingState = input.Enabled === true ? 'Enabled' : 'Disabled';
      return { UUID: mappingUuid, ...metadata };
    });
};

// The trip's settle wait on a fake clock whose sleep advances it, so no test sleeps.
const fakeTime = (clock: FakeClock) => ({
  clock,
  sleep: async (ms: number) => clock.advance(ms),
});

const appFunctions = [
  'LedgerApp-ingest',
  'LedgerApp-worker',
  'LedgerApp-api',
  'LedgerApp-dispatcher',
];

describe('tripKillSwitch', () => {
  it('disables the mapping before any PutFunctionConcurrency', async () => {
    const { clients, log } = harness(steadyAccount());

    await tripKillSwitch(clients, names);

    const disabled = log.indexOf('UpdateEventSourceMapping');
    const firstConcurrency = log.indexOf('PutFunctionConcurrency');
    expect(disabled).toBeGreaterThanOrEqual(0);
    expect(firstConcurrency).toBeGreaterThan(disabled);
  });

  it('runs the steps in D29 order: mapping, concurrency, throttle, then the report', async () => {
    const { clients, log } = harness(steadyAccount());

    await tripKillSwitch(clients, names);

    const lastConcurrency = log.lastIndexOf('PutFunctionConcurrency');
    expect(log.indexOf('UpdateStage')).toBeGreaterThan(lastConcurrency);
    expect(log.at(-1)).toBe('Publish');
  });

  it('sets 0 on every LedgerApp- function across ListFunctions pages, and on no other', async () => {
    const { account, clients, lambda } = harness(steadyAccount());

    await tripKillSwitch(clients, names);

    expect(lambda.inputs('ListFunctions')).toEqual([{}, { Marker: '3' }, { Marker: '6' }]);
    expect(lambda.inputs('PutFunctionConcurrency')).toEqual(
      appFunctions.map((FunctionName) => ({ FunctionName, ReservedConcurrentExecutions: 0 })),
    );
    expect(Object.fromEntries(account.functions)).toEqual({
      'LedgerApp-ingest': 0,
      'LedgerApp-worker': 0,
      'LedgerApp-api': 0,
      'LedgerGuardrails-kill-switch': null,
      'LedgerApp-dispatcher': 0,
      'other-project-fn': 7,
      'LedgerApp2-lookalike': null,
    });
    expect(account.mappingState).toBe('Disabled');
  });

  it('lowers the default and every route throttle to 0 / 0 on the $default stage of LedgerApp-http', async () => {
    const { account, apiGateway, clients } = harness(steadyAccount());

    await tripKillSwitch(clients, names);

    expect(apiGateway.inputs('GetStage')).toEqual([{ ApiId: apiId, StageName: '$default' }]);
    expect(apiGateway.inputs('UpdateStage')).toEqual([
      {
        ApiId: apiId,
        StageName: '$default',
        DefaultRouteSettings: {
          DetailedMetricsEnabled: false,
          ThrottlingRateLimit: 0,
          ThrottlingBurstLimit: 0,
        },
        RouteSettings: {
          'POST /webhooks/resend': { ThrottlingRateLimit: 0, ThrottlingBurstLimit: 0 },
        },
      },
    ]);
    expect(account.defaultSettings).toMatchObject({
      ThrottlingRateLimit: 0,
      ThrottlingBurstLimit: 0,
    });
    expect(account.routeSettings).toEqual({
      'POST /webhooks/resend': { ThrottlingRateLimit: 0, ThrottlingBurstLimit: 0 },
    });
  });

  it('issues no update on a re-run over a tripped state, and reports the same state', async () => {
    const { account, clients, updates } = harness(steadyAccount());
    const first = await tripKillSwitch(clients, names);
    const updatesAfterFirst = updates().length;

    const second = await tripKillSwitch(clients, names);

    expect(updates()).toHaveLength(updatesAfterFirst);
    expect(second.changed).toEqual([]);
    expect(second.state).toEqual(first.state);
    expect(account.published).toHaveLength(2);
  });

  it('publishes to the alert topic a report of names and values with no ARN, URL, id or account', async () => {
    const { account, clients } = harness(steadyAccount());

    const report = await tripKillSwitch(clients, names);

    expect(account.published).toHaveLength(1);
    const [published] = account.published;
    expect(published?.TopicArn).toBe(names.alertTopicArn);
    const message = published?.Message ?? '';
    expect(JSON.parse(message)).toEqual(report);
    expect(message).not.toMatch(/arn:/);
    expect(message).not.toMatch(/https?:\/\//);
    expect(message).not.toMatch(/\d{12}/);
    expect(message).not.toContain(apiId);
    expect(message).not.toContain(mappingUuid);
    expect(report.state).toEqual({
      eventSource: 'paused',
      functions: appFunctions.map((name) => ({ name, reservedConcurrency: 0 })),
      defaultThrottle: { rateLimit: 0, burstLimit: 0 },
      routeThrottles: [{ routeKey: 'POST /webhooks/resend', rateLimit: 0, burstLimit: 0 }],
    });
    expect(report.changed).toEqual([
      'event_source',
      ...appFunctions.map((name) => `concurrency:${name}`),
      'default_throttle',
      'route_throttle:POST /webhooks/resend',
    ]);
  });

  it('fails with a constant internal_error when the app stack has no HTTP API, after stopping compute', async () => {
    const account = steadyAccount();
    account.apis = [{ Name: 'other-http', ApiId: 'zzzzzzzzzz' }];
    const { clients } = harness(account);

    const failure = await tripKillSwitch(clients, names).catch((caught: unknown) => caught);

    expect(failure).toBeInstanceOf(LedgerError);
    expect((failure as LedgerError).code).toBe('internal_error');
    expect(account.mappingState).toBe('Disabled');
    expect(account.functions.get('LedgerApp-ingest')).toBe(0);
    expect(account.published).toEqual([]);
  });

  it('rejects with the SDK error unchanged when a step fails (TooManyRequestsException)', async () => {
    const { clients, lambda } = harness(steadyAccount());
    lambda.answer('PutFunctionConcurrency', () => {
      throw new TooManyRequestsException({ message: 'slow', ...metadata });
    });

    const failure = await tripKillSwitch(clients, names).catch((caught: unknown) => caught);

    expect((failure as Error).name).toBe('TooManyRequestsException');
  });

  it('waits out a mapping in transition, then disables it before any cap and runs every step in D29 order', async () => {
    const h = harness(steadyAccount());
    const clock = new FakeClock();
    const started = clock.now().getTime();
    inTransition(h, clock, 'Enabling', 'Enabled', 2_500);

    const report = await tripKillSwitch(h.clients, names, fakeTime(clock));

    expect(h.account.mappingState).toBe('Disabled');
    const lastMappingUpdate = h.log.lastIndexOf('UpdateEventSourceMapping');
    expect(lastMappingUpdate).toBeLessThan(h.log.indexOf('PutFunctionConcurrency'));
    expect(h.log.lastIndexOf('PutFunctionConcurrency')).toBeLessThan(h.log.indexOf('UpdateStage'));
    expect(h.log.at(-1)).toBe('Publish');
    expect(clock.now().getTime() - started).toBe(3_000);
    expect(report.changed).toEqual([
      'event_source',
      ...appFunctions.map((name) => `concurrency:${name}`),
      'default_throttle',
      'route_throttle:POST /webhooks/resend',
    ]);
    expect(h.account.published).toHaveLength(1);
  });

  it('caps concurrency and every throttle when the mapping never settles, then rejects with ResourceInUseException and publishes nothing', async () => {
    const h = harness(steadyAccount());
    const clock = new FakeClock();
    const started = clock.now().getTime();
    inTransition(h, clock, 'Updating', undefined);

    const failure = await tripKillSwitch(h.clients, names, fakeTime(clock)).catch(
      (caught: unknown) => caught,
    );

    expect((failure as Error).name).toBe('ResourceInUseException');
    expect(clock.now().getTime() - started).toBe(KILL_SWITCH_SETTLE_TIMEOUT_MS);
    expect(h.account.mappingState).toBe('Updating');
    for (const name of appFunctions) expect(h.account.functions.get(name)).toBe(0);
    expect(h.account.defaultSettings).toMatchObject({
      ThrottlingRateLimit: 0,
      ThrottlingBurstLimit: 0,
    });
    expect(h.account.routeSettings).toEqual({
      'POST /webhooks/resend': { ThrottlingRateLimit: 0, ThrottlingBurstLimit: 0 },
    });
    expect(h.account.published).toEqual([]);
  });

  it("Lambda's retry after a failed step 1 disables the settled mapping and changes nothing else", async () => {
    const h = harness(steadyAccount());
    const clock = new FakeClock();
    inTransition(h, clock, 'Updating', undefined);
    await tripKillSwitch(h.clients, names, fakeTime(clock)).catch(() => undefined);
    // By the retry the transition has ended where it was heading.
    h.account.mappingState = 'Enabled';
    const settled = harness(h.account);

    const report = await tripKillSwitch(settled.clients, names, fakeTime(clock));

    expect(h.account.mappingState).toBe('Disabled');
    expect(report.changed).toEqual(['event_source']);
    expect(h.account.published).toHaveLength(1);
  });

  it('caps concurrency and every throttle when the mapping cannot be read, then rejects with the SDK error', async () => {
    const { account, clients, lambda } = harness(steadyAccount());
    lambda.answer('ListEventSourceMappings', () => {
      throw new TooManyRequestsException({ message: 'slow', ...metadata });
    });

    const failure = await tripKillSwitch(clients, names).catch((caught: unknown) => caught);

    expect((failure as Error).name).toBe('TooManyRequestsException');
    for (const name of appFunctions) expect(account.functions.get(name)).toBe(0);
    expect(account.defaultSettings).toMatchObject({
      ThrottlingRateLimit: 0,
      ThrottlingBurstLimit: 0,
    });
    expect(account.published).toEqual([]);
  });

  it('rejects with the SDK error unchanged when the stage rejects the stop values (BadRequestException, AWS-U02)', async () => {
    const { apiGateway, clients } = harness(steadyAccount());
    apiGateway.answer('UpdateStage', () => {
      throw new BadRequestException({ message: 'invalid', ...metadata });
    });

    const failure = await tripKillSwitch(clients, names).catch((caught: unknown) => caught);

    expect((failure as Error).name).toBe('BadRequestException');
  });
});

describe('restoreFromTrip', () => {
  const tripped = async () => {
    const h = harness(steadyAccount());
    await tripKillSwitch(h.clients, names);
    h.log.length = 0;
    return h;
  };

  it('deletes concurrency, enables the mapping, restores the declared throttle and deletes route settings', async () => {
    const { account, apiGateway, clients, lambda, log } = await tripped();

    const report = await restoreFromTrip(clients, names, declared);

    expect(lambda.inputs('DeleteFunctionConcurrency').slice(-4)).toEqual(
      appFunctions.map((FunctionName) => ({ FunctionName })),
    );
    expect(Object.fromEntries(account.functions)).toEqual({
      'LedgerApp-ingest': null,
      'LedgerApp-worker': null,
      'LedgerApp-api': null,
      'LedgerGuardrails-kill-switch': null,
      'LedgerApp-dispatcher': null,
      'other-project-fn': 7,
      'LedgerApp2-lookalike': null,
    });
    expect(account.mappingState).toBe('Enabled');
    expect(apiGateway.inputs('UpdateStage').at(-1)).toEqual({
      ApiId: apiId,
      StageName: '$default',
      DefaultRouteSettings: {
        DetailedMetricsEnabled: false,
        ThrottlingRateLimit: 100,
        ThrottlingBurstLimit: 200,
      },
    });
    expect(apiGateway.inputs('DeleteRouteSettings')).toEqual([
      { ApiId: apiId, StageName: '$default', RouteKey: 'POST /webhooks/resend' },
    ]);
    expect(account.routeSettings).toEqual({});
    expect(log.indexOf('DeleteFunctionConcurrency')).toBeLessThan(
      log.indexOf('UpdateEventSourceMapping'),
    );
    expect(log.indexOf('UpdateEventSourceMapping')).toBeLessThan(log.indexOf('UpdateStage'));
    expect(report.state).toEqual({
      eventSource: 'enabled',
      functions: appFunctions.map((name) => ({ name, reservedConcurrency: null })),
      defaultThrottle: declared,
      routeThrottles: [],
    });
  });

  it('issues no update on a re-run over a restored state', async () => {
    const { clients, updates } = await tripped();
    await restoreFromTrip(clients, names, declared);
    const updatesAfterFirst = updates().length;

    const second = await restoreFromTrip(clients, names, declared);

    expect(updates()).toHaveLength(updatesAfterFirst);
    expect(second.changed).toEqual([]);
  });
});

describe('readKillSwitchState', () => {
  it('reads the trip state without changing anything', async () => {
    const { clients, updates } = await (async () => {
      const h = harness(steadyAccount());
      await tripKillSwitch(h.clients, names);
      return h;
    })();
    const before = updates().length;

    const state = await readKillSwitchState(clients, names);

    expect(updates()).toHaveLength(before);
    expect(state.eventSource).toBe('paused');
    expect(state.functions.find((fn) => fn.name === 'LedgerApp-worker')?.reservedConcurrency).toBe(
      0,
    );
    expect(state.defaultThrottle).toEqual({ rateLimit: 0, burstLimit: 0 });
  });

  it('reads a steady stack as enabled, with no reserved concurrency and the declared throttle', async () => {
    const { clients } = harness(steadyAccount());

    const state = await readKillSwitchState(clients, names);

    expect(state).toEqual({
      eventSource: 'enabled',
      functions: appFunctions.map((name) => ({ name, reservedConcurrency: null })),
      defaultThrottle: declared,
      routeThrottles: [{ routeKey: 'POST /webhooks/resend', rateLimit: 500, burstLimit: 1000 }],
    });
  });
});
