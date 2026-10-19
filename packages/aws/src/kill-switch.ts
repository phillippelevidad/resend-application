import {
  type ApiGatewayV2Client,
  DeleteRouteSettingsCommand,
  UpdateStageCommand,
} from '@aws-sdk/client-apigatewayv2';
import {
  DeleteFunctionConcurrencyCommand,
  GetFunctionConcurrencyCommand,
  type LambdaClient,
  ListFunctionsCommand,
  PutFunctionConcurrencyCommand,
} from '@aws-sdk/client-lambda';
import { PublishCommand, type SNSClient } from '@aws-sdk/client-sns';
import type { EventSourceState } from '@ledger/core';
import {
  type DeclaredThrottle,
  hasThrottle,
  type ReadThrottle,
  readStage,
  STAGE_NAME,
  throttleOf,
  withThrottle,
} from './http-api-stage.ts';
import {
  type EventSourceSettle,
  LambdaEventSourceControlAdapter,
} from './lambda-event-source-control.adapter.ts';

export type { DeclaredThrottle } from './http-api-stage.ts';

export type KillSwitchClients = {
  lambda: LambdaClient;
  apiGateway: ApiGatewayV2Client;
  sns: SNSClient;
};

// D29: the kill switch finds every target at trip time from the app stack's name, so the guardrails
// stack imports nothing from it (aws.md → Budget alarms item 1). `alertTopicArn` is where the trip's
// report goes; the report itself never carries it.
export type KillSwitchNames = { appStackName: string; alertTopicArn: string };

// D30: the stop values. AWS-U02 is open: if the trip drill finds `UpdateStage` rejects `0`, the lowest
// accepted value replaces it here, recorded with its worst-case spend.
export const KILL_SWITCH_STOP_THROTTLE: DeclaredThrottle = { rateLimit: 0, burstLimit: 0 };

// D29 step 1: how long the trip waits out a mapping in transition before it caps anyway. Half the
// kill switch's 60 s timeout (D28), so the caps' few dozen calls and the rethrow still run inside it.
export const KILL_SWITCH_SETTLE_TIMEOUT_MS = 30_000;

type Throttle = ReadThrottle;

// What a trip or a restore leaves, as names and numbers only: function names, the event source's
// state and the throttle values. No ARN, id, URL or account (D29 step 4).
export type KillSwitchState = {
  readonly eventSource: EventSourceState;
  readonly functions: readonly { name: string; reservedConcurrency: number | null }[];
  readonly defaultThrottle: Throttle;
  readonly routeThrottles: readonly ({ routeKey: string } & Throttle)[];
};

export type KillSwitchReport = {
  readonly action: 'trip' | 'restore';
  // The steps that changed something on this run; empty on a re-run over the same state.
  readonly changed: readonly string[];
  readonly state: KillSwitchState;
};

// D27: the physical names derived from the app stack's name; the stage's are in `http-api-stage.ts`
// (slice 3, D33).
const workerName = (appStackName: string): string => `${appStackName}-worker`;
// The trailing dash keeps `LedgerApp2-…` out; the kill switch's own `LedgerGuardrails-kill-switch`
// never matches, so it is exempt by construction (aws.md → Budget alarms item 4).
const functionPrefix = (appStackName: string): string => `${appStackName}-`;

// D29: trip, in order, each step reading the current state first so a re-run changes nothing:
// 1. disable the worker's event source mapping (AWS-18), so queued events wait in SQS instead of
//    being throttled toward the DLQ; a mapping in transition is waited out for up to
//    `KILL_SWITCH_SETTLE_TIMEOUT_MS`;
// 2. reserved concurrency `0` (AWS-16) on every function carrying the app stack's prefix, found by
//    `ListFunctions`, so a later slice's function is covered with no edit (C18);
// 3. the `$default` stage's default-route throttle and every route-level throttle to the stop
//    values, because a route setting overrides the default (AWS-14);
// 4. publish the report to the alert topic.
// A step 1 that still fails does not stop the trip: steps 2 and 3 cap the spend anyway, then its
// error is rethrown before step 4, so Lambda's async retry runs the trip again (owner: "Wait, then
// cap"). `settle` is the test's clock and sleep; the budget stays the kill switch's own.
export async function tripKillSwitch(
  clients: KillSwitchClients,
  names: KillSwitchNames,
  settle: Partial<Omit<EventSourceSettle, 'timeoutMs'>> = {},
): Promise<KillSwitchReport> {
  const changed: string[] = [];

  const eventSource = new LambdaEventSourceControlAdapter({
    client: clients.lambda,
    functionName: workerName(names.appStackName),
    settle: { ...settle, timeoutMs: KILL_SWITCH_SETTLE_TIMEOUT_MS },
  });
  // What a successful step 1 leaves; a failed one never reaches the report.
  const eventSourceState: EventSourceState = 'paused';
  let eventSourceFailure: { error: unknown } | undefined;
  try {
    if ((await eventSource.getState()) !== 'paused') {
      await eventSource.disable();
      changed.push('event_source');
    }
  } catch (error) {
    eventSourceFailure = { error };
  }

  const functions: { name: string; reservedConcurrency: number | null }[] = [];
  for (const name of await appFunctionNames(clients.lambda, names.appStackName)) {
    if ((await reservedConcurrency(clients.lambda, name)) !== 0) {
      await clients.lambda.send(
        new PutFunctionConcurrencyCommand({ FunctionName: name, ReservedConcurrentExecutions: 0 }),
      );
      changed.push(`concurrency:${name}`);
    }
    functions.push({ name, reservedConcurrency: 0 });
  }

  const stage = await readStage(clients.apiGateway, names.appStackName);
  const stop = KILL_SWITCH_STOP_THROTTLE;
  const defaultAtStop = hasThrottle(stage.defaultSettings, stop);
  const routesToStop = Object.entries(stage.routeSettings).filter(
    ([, settings]) => !hasThrottle(settings, stop),
  );
  if (!defaultAtStop || routesToStop.length > 0) {
    await clients.apiGateway.send(
      new UpdateStageCommand({
        ApiId: stage.apiId,
        StageName: STAGE_NAME,
        ...(defaultAtStop
          ? {}
          : { DefaultRouteSettings: withThrottle(stage.defaultSettings, stop) }),
        ...(routesToStop.length === 0
          ? {}
          : {
              RouteSettings: Object.fromEntries(
                routesToStop.map(([routeKey, settings]) => [
                  routeKey,
                  withThrottle(settings, stop),
                ]),
              ),
            }),
      }),
    );
    if (!defaultAtStop) changed.push('default_throttle');
    for (const [routeKey] of routesToStop) changed.push(`route_throttle:${routeKey}`);
  }

  // Compute and traffic are capped; the mapping is not yet paused, so the trip fails for its retry.
  if (eventSourceFailure !== undefined) throw eventSourceFailure.error;

  const report: KillSwitchReport = {
    action: 'trip',
    changed,
    state: {
      eventSource: eventSourceState,
      functions,
      defaultThrottle: { ...stop },
      routeThrottles: Object.keys(stage.routeSettings).map((routeKey) => ({ routeKey, ...stop })),
    },
  };
  await clients.sns.send(
    new PublishCommand({
      TopicArn: names.alertTopicArn,
      Subject: 'Ledger kill switch tripped',
      Message: JSON.stringify(report, null, 2),
    }),
  );
  return report;
}

// D35: undo a trip, for the re-arm and the trip drill, each step reading the current state first:
// delete every prefixed function's reserved concurrency, enable the worker's mapping, restore the
// `$default` throttle the app stack declares, and delete every route setting (the stack declares
// none). Publishes nothing: the script that calls it prints its own summary.
export async function restoreFromTrip(
  clients: Pick<KillSwitchClients, 'lambda' | 'apiGateway'>,
  names: Pick<KillSwitchNames, 'appStackName'>,
  declared: DeclaredThrottle,
): Promise<KillSwitchReport> {
  const changed: string[] = [];

  const functions: { name: string; reservedConcurrency: number | null }[] = [];
  for (const name of await appFunctionNames(clients.lambda, names.appStackName)) {
    if ((await reservedConcurrency(clients.lambda, name)) !== null) {
      await clients.lambda.send(new DeleteFunctionConcurrencyCommand({ FunctionName: name }));
      changed.push(`concurrency:${name}`);
    }
    functions.push({ name, reservedConcurrency: null });
  }

  const eventSource = new LambdaEventSourceControlAdapter({
    client: clients.lambda,
    functionName: workerName(names.appStackName),
  });
  let eventSourceState = await eventSource.getState();
  if (eventSourceState !== 'enabled') {
    await eventSource.enable();
    // Enabling is asynchronous (AWS-18): the mapping reads `Enabling`, then `Enabled`.
    eventSourceState = await eventSource.getState();
    changed.push('event_source');
  }

  const stage = await readStage(clients.apiGateway, names.appStackName);
  if (!hasThrottle(stage.defaultSettings, declared)) {
    await clients.apiGateway.send(
      new UpdateStageCommand({
        ApiId: stage.apiId,
        StageName: STAGE_NAME,
        DefaultRouteSettings: withThrottle(stage.defaultSettings, declared),
      }),
    );
    changed.push('default_throttle');
  }
  for (const routeKey of Object.keys(stage.routeSettings)) {
    await clients.apiGateway.send(
      new DeleteRouteSettingsCommand({
        ApiId: stage.apiId,
        StageName: STAGE_NAME,
        RouteKey: routeKey,
      }),
    );
    changed.push(`route_throttle:${routeKey}`);
  }

  return {
    action: 'restore',
    changed,
    state: {
      eventSource: eventSourceState,
      functions,
      defaultThrottle: { ...declared },
      routeThrottles: [],
    },
  };
}

// D36 step 2, D33 step 2: the current state, read only, for the deploy command's tripped check and
// the drill's polls.
export async function readKillSwitchState(
  clients: Pick<KillSwitchClients, 'lambda' | 'apiGateway'>,
  names: Pick<KillSwitchNames, 'appStackName'>,
): Promise<KillSwitchState> {
  const eventSource = new LambdaEventSourceControlAdapter({
    client: clients.lambda,
    functionName: workerName(names.appStackName),
  });
  const functions: { name: string; reservedConcurrency: number | null }[] = [];
  for (const name of await appFunctionNames(clients.lambda, names.appStackName)) {
    functions.push({ name, reservedConcurrency: await reservedConcurrency(clients.lambda, name) });
  }
  const stage = await readStage(clients.apiGateway, names.appStackName);
  return {
    eventSource: await eventSource.getState(),
    functions,
    defaultThrottle: throttleOf(stage.defaultSettings),
    routeThrottles: Object.entries(stage.routeSettings).map(([routeKey, settings]) => ({
      routeKey,
      ...throttleOf(settings),
    })),
  };
}

// Every function whose name carries the app stack's prefix, across every `ListFunctions` page.
async function appFunctionNames(lambda: LambdaClient, appStackName: string): Promise<string[]> {
  const prefix = functionPrefix(appStackName);
  const found: string[] = [];
  let marker: string | undefined;
  do {
    const page = await lambda.send(
      new ListFunctionsCommand(marker === undefined ? {} : { Marker: marker }),
    );
    for (const fn of page.Functions ?? []) {
      if (fn.FunctionName?.startsWith(prefix)) found.push(fn.FunctionName);
    }
    marker = page.NextMarker;
  } while (marker !== undefined);
  return found;
}

// `null` when the function has no reserved concurrency set.
async function reservedConcurrency(
  lambda: LambdaClient,
  functionName: string,
): Promise<number | null> {
  const output = await lambda.send(
    new GetFunctionConcurrencyCommand({ FunctionName: functionName }),
  );
  return output.ReservedConcurrentExecutions ?? null;
}
