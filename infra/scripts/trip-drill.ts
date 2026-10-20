import { setTimeout as sleep } from 'node:timers/promises';
import { parseArgs } from 'node:util';
import {
  alarmControl,
  createApiGatewayV2Client,
  createCloudFormationClient,
  createCloudWatchClient,
  createLambdaClient,
  type DeclaredThrottle,
  KILL_SWITCH_STOP_THROTTLE,
  type KillSwitchState,
  readKillSwitchState,
  readStackOutputs,
  restoreFromTrip,
} from '@ledger/aws';
import {
  APP_STACK_NAME,
  appOutputKeys,
  GUARDRAILS_STACK_NAME,
  guardrailsOutputKeys,
  KILL_SWITCH_ERRORS_ALARM_NAME,
  USAGE_TRIP_ALARM_NAME,
} from './ledger-stacks.ts';
import { createScriptOutput, processSink } from './script-output.ts';

// `pnpm aws:trip-drill` (D36, aws.md → Budget alarms item 8): the alarm half of the recorded drill.
// It forces the usage-trip alarm, waits for the kill switch's end state (D29), records five unsigned
// ingest requests' status codes (AWS-U02), forces one kill-switch failure until its `Errors` alarm
// fires, restores, and prints a summary with no id or URL. The budget half runs on its own clock
// (`pnpm aws:deploy --budget-drill`, D36). It trips the whole stack: events queue meanwhile. The
// run is the owner's Ask-first run (root AGENTS.md → Permissions).

const out = createScriptOutput('aws:trip-drill', processSink);
const cloudFormation = createCloudFormationClient();
const lambda = createLambdaClient();
const apiGateway = createApiGatewayV2Client();
const cloudWatch = createCloudWatchClient();

// Bounds on each wait: the trip and the restore are a handful of API calls after an SNS delivery;
// the `Errors` alarm needs its 60 s period plus CloudWatch's evaluation delay.
const TRIP_TIMEOUT_MS = 5 * 60_000;
const ERRORS_ALARM_TIMEOUT_MS = 10 * 60_000;
const RESTORE_TIMEOUT_MS = 5 * 60_000;
const POLL_INTERVAL_MS = 10_000;
const UNSIGNED_REQUESTS = 5;

// Polls `read` until `reached` holds or the bound passes; answers the seconds waited, or
// `undefined` on a timeout. A failed read counts as not reached yet.
async function waitFor<T>(
  read: () => Promise<T>,
  reached: (value: T) => boolean,
  timeoutMs: number,
): Promise<number | undefined> {
  const started = performance.now();
  for (;;) {
    try {
      if (reached(await read())) return Math.round((performance.now() - started) / 1000);
    } catch {
      // Not reached: the next poll reads again.
    }
    if (performance.now() - started >= timeoutMs) return undefined;
    await sleep(POLL_INTERVAL_MS);
  }
}

const throttleIs = (
  throttle: { rateLimit: number | null; burstLimit: number | null },
  expected: DeclaredThrottle,
): boolean =>
  throttle.rateLimit === expected.rateLimit && throttle.burstLimit === expected.burstLimit;

// D29's end state: mapping disabled, every app function at `0`, every throttle at the stop values.
const isTripped = (state: KillSwitchState): boolean =>
  state.eventSource === 'paused' &&
  state.functions.length > 0 &&
  state.functions.every((fn) => fn.reservedConcurrency === 0) &&
  throttleIs(state.defaultThrottle, KILL_SWITCH_STOP_THROTTLE) &&
  state.routeThrottles.every((route) => throttleIs(route, KILL_SWITCH_STOP_THROTTLE));

// D35's end state: mapping enabled, no reserved concurrency, the declared throttle, no route setting.
const isRestored = (state: KillSwitchState, declared: DeclaredThrottle): boolean =>
  state.eventSource === 'enabled' &&
  state.functions.every((fn) => fn.reservedConcurrency === null) &&
  throttleIs(state.defaultThrottle, declared) &&
  state.routeThrottles.length === 0;

const readState = () =>
  readKillSwitchState({ lambda, apiGateway }, { appStackName: APP_STACK_NAME });

async function drill(): Promise<0 | 1> {
  try {
    parseArgs({ args: process.argv.slice(2), options: {}, strict: true, allowPositionals: false });
  } catch {
    return out.refused('usage: pnpm aws:trip-drill');
  }

  let apiUrl: string;
  let killSwitchFunctionName: string;
  let declared: DeclaredThrottle;
  try {
    const app = await readStackOutputs(cloudFormation, APP_STACK_NAME);
    const guardrails = await readStackOutputs(cloudFormation, GUARDRAILS_STACK_NAME);
    if (app === null || guardrails === null) {
      return out.refused('both stacks must be deployed; run pnpm aws:deploy first');
    }
    if (guardrails.outputs[guardrailsOutputKeys.killSwitchArmed] !== 'true') {
      return out.refused(
        'the kill switch is not armed (KillSwitchArmed false); deploy with LEDGER_KILL_SWITCH=on first',
      );
    }
    const url = app.outputs[appOutputKeys.apiUrl];
    const fn = guardrails.outputs[guardrailsOutputKeys.killSwitchFunctionName];
    declared = {
      rateLimit: Number(app.outputs[appOutputKeys.throttleRateLimit]),
      burstLimit: Number(app.outputs[appOutputKeys.throttleBurstLimit]),
    };
    if (
      url === undefined ||
      fn === undefined ||
      !Number.isFinite(declared.rateLimit) ||
      !Number.isFinite(declared.burstLimit)
    ) {
      return out.failed('a stack output the drill needs is missing');
    }
    apiUrl = url.replace(/\/+$/, '');
    killSwitchFunctionName = fn;
    const state = await readState();
    if (state.functions.some((fn) => fn.reservedConcurrency === 0)) {
      return out.refused('the stack is tripped; run pnpm aws:rearm first');
    }
  } catch {
    return out.failed('reading the deployed stacks failed');
  }

  // 1. Alarm → trip topic → kill switch.
  try {
    await alarmControl.setState(
      cloudWatch,
      USAGE_TRIP_ALARM_NAME,
      'ALARM',
      'Ledger trip drill (D36)',
    );
  } catch {
    return out.failed('forcing the usage-trip alarm failed');
  }
  out.line('step 1: usage-trip alarm forced to ALARM');

  // 2. D29's end state; the stage update succeeding under D29's grant settles AWS-U11.
  const tripSeconds = await waitFor(readState, isTripped, TRIP_TIMEOUT_MS);
  if (tripSeconds === undefined) {
    return out.failed(
      'the tripped state was not reached within 5 minutes; check the kill switch, then run pnpm aws:rearm',
    );
  }
  out.line(
    `step 2: tripped after ${tripSeconds}s (mapping paused, every function at 0, throttle at the stop values)`,
  );

  // 3. AWS-U02: what an unsigned request meets on a tripped stack (expected `429`).
  const codes: string[] = [];
  for (let request = 0; request < UNSIGNED_REQUESTS; request += 1) {
    try {
      const response = await fetch(`${apiUrl}/webhooks/resend`, { method: 'POST', body: '{}' });
      codes.push(String(response.status));
    } catch {
      codes.push('error');
    }
  }
  out.line(`step 3: unsigned ingest requests answered ${codes.join(' ')}`);
  if (!codes.every((code) => code === '429')) {
    out.line('warning: not every request was throttled; AWS-U02 expects 429');
  }

  // 4. Item 8's forced failure: a non-SNS payload the kill switch rejects.
  try {
    await alarmControl.invokeAsync(lambda, killSwitchFunctionName, { ledger: 'trip-drill' });
  } catch {
    return out.failed('invoking the kill switch failed; the stack is tripped: run pnpm aws:rearm');
  }
  const errorsSeconds = await waitFor(
    () => alarmControl.readState(cloudWatch, KILL_SWITCH_ERRORS_ALARM_NAME),
    (state) => state === 'ALARM',
    ERRORS_ALARM_TIMEOUT_MS,
  );
  if (errorsSeconds === undefined) {
    return out.failed(
      "the kill switch's Errors alarm did not fire within 10 minutes; the stack is tripped: run pnpm aws:rearm",
    );
  }
  out.line(`step 4: the kill switch's Errors alarm reached ALARM after ${errorsSeconds}s`);

  // 5. The re-arm's own restore, then its end state.
  try {
    await restoreFromTrip({ lambda, apiGateway }, { appStackName: APP_STACK_NAME }, declared);
  } catch {
    return out.failed('restoring from the trip failed; run pnpm aws:rearm');
  }
  const restoreSeconds = await waitFor(
    readState,
    (state) => isRestored(state, declared),
    RESTORE_TIMEOUT_MS,
  );
  if (restoreSeconds === undefined) {
    return out.failed('the restored state was not reached within 5 minutes; run pnpm aws:rearm');
  }
  out.line(`step 5: restored after ${restoreSeconds}s`);

  // 6. Names, counts and timings only.
  out.line(
    `summary: trip ${tripSeconds}s; ingest ${codes.join(' ')}; Errors alarm ${errorsSeconds}s; restore ${restoreSeconds}s`,
  );
  // Slice 4 D30: recovers the events Resend gave up on while the stack was stopped.
  out.line('then: pnpm -s ledger reconcile');
  return out.done();
}

process.exitCode = await drill();
