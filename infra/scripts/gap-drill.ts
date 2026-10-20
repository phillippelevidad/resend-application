import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import {
  createApiGatewayV2Client,
  createCloudFormationClient,
  createCloudWatchClient,
  createLambdaClient,
  createSqsClient,
  ingestRouteSettingExists,
  lowerIngestRouteThrottle,
  readKillSwitchState,
  readStackOutputs,
  restoreIngestRouteThrottle,
  SqsQueueAttributesAdapter,
} from '@ledger/aws';
import { createResendClient } from '@ledger/resend-client';
import { createLedgerClient } from '@ledger/sdk';
import { LedgerError, type Logger } from '@ledger/shared';
import { APP_STACK_NAME, appOutputKeys } from './ledger-stacks.ts';
import { type GapDrillConfig, type GapDrillSteps, runGapDrill } from './run-gap-drill.ts';
import { processSink } from './script-output.ts';

// `pnpm aws:gap-drill` (slice 4 D32): the real steps runGapDrill orders. Every AWS call goes through
// `@ledger/aws`, every Resend call through `@ledger/resend-client`, the health read through
// `@ledger/sdk`, and the reconcile through the CLI as child processes, as the operator runs it.

const CLI_MAIN = fileURLToPath(new URL('../../apps/cli/src/main.ts', import.meta.url));
// D9: the Resend API base URL, explicit, and the drill's own `User-Agent` (RS-21).
const RESEND_API_BASE_URL = 'https://api.resend.com';
const USER_AGENT = 'ledger-gap-drill';
// RS-42: a test send needs no verified domain; RS-39: two events from `delivered@resend.dev`.
const FROM = 'onboarding@resend.dev';
const TO = 'delivered@resend.dev';
const SUBJECT = 'Ledger gap drill';
const TEXT = 'One send by pnpm aws:gap-drill, to make one real gap and recover it.';
// One Resend call's own bound: the drill never waits past it.
const CALL_DEADLINE_MS = 60_000;
// One ingest probe's own bound, so a hung request cannot stall the confirmation.
const PROBE_TIMEOUT_MS = 5_000;

// The client's default-branch log line would bypass the script's prefix: nothing is logged.
const silent: Logger = { info: () => {}, warn: () => {}, error: () => {} };

const required = (outputs: Readonly<Record<string, string>>, key: string): string => {
  const value = outputs[key];
  if (value === undefined) throw new LedgerError('internal_error', 'A stack output is missing.');
  return value;
};

function createSteps(config: GapDrillConfig): GapDrillSteps {
  const cloudFormation = createCloudFormationClient();
  const lambda = createLambdaClient();
  const apiGateway = createApiGatewayV2Client();
  const clock = { now: () => new Date() };
  const resend = createResendClient({
    apiKey: config.resendApiKey,
    baseUrl: RESEND_API_BASE_URL,
    userAgent: USER_AGENT,
    clock,
    sleep: (ms) => sleep(ms),
    logger: silent,
  });
  const names = { appStackName: APP_STACK_NAME };
  const deadline = () => ({ deadline: new Date(Date.now() + CALL_DEADLINE_MS) });
  const appOutputs = async () => (await readStackOutputs(cloudFormation, APP_STACK_NAME))?.outputs;

  return {
    apiUrlOutput: async () => (await appOutputs())?.[appOutputKeys.apiUrl],
    isTripped: async () =>
      (await readKillSwitchState({ lambda, apiGateway }, names)).functions.some(
        (fn) => fn.reservedConcurrency === 0,
      ),
    async queueDepths() {
      const outputs = (await appOutputs()) ?? {};
      const snapshot = await new SqsQueueAttributesAdapter({
        sqs: createSqsClient(),
        cloudWatch: createCloudWatchClient(),
        queueUrl: required(outputs, appOutputKeys.queueUrl),
        dlqUrl: required(outputs, appOutputKeys.dlqUrl),
      }).read();
      return {
        queue: snapshot.visible + snapshot.inFlight,
        dlq: snapshot.dlqVisible + snapshot.dlqInFlight,
      };
    },
    async lastRunFinished() {
      const { data, error } = await createLedgerClient({
        baseUrl: config.ledgerUrl,
        token: config.ledgerToken,
      }).health.get();
      if (error !== null) throw new LedgerError('internal_error', 'ledger health failed.');
      const run = data.last_reconcile_run;
      // An abandoned run carries `run_abandoned` and blocks no start.
      return run === null ? null : run.finished_at !== null || run.error !== null;
    },
    ingestRouteSettingExists: () => ingestRouteSettingExists(apiGateway, names),
    newestEvents: async () =>
      (await resend.listWebhookEvents(config.webhookId, {}, deadline())).events,
    async sendEmail(idempotencyKey) {
      const outcome = await resend.sendEmail(
        { from: FROM, to: TO, subject: SUBJECT, text: TEXT },
        { idempotencyKey },
        deadline(),
      );
      return 'emailId' in outcome
        ? { emailId: outcome.emailId }
        : { rejectedStatus: outcome.rejected.status };
    },
    eventCreatedAt: async (eventId) =>
      (await resend.retrieveWebhookEventCreatedAt(config.webhookId, eventId, deadline())).createdAt,
    lowerIngestRoute: () => lowerIngestRouteThrottle(apiGateway, names),
    restoreIngestRoute: () => restoreIngestRouteThrottle({ apiGateway, lambda }, names),
    // Unsigned, so a request the route lets through is refused by ingest (`401`) and stores nothing;
    // the same probe as the trip drill's.
    async probeIngest() {
      const response = await fetch(`${config.ledgerUrl.replace(/\/+$/, '')}/webhooks/resend`, {
        method: 'POST',
        body: '{}',
        signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
      });
      await response.body?.cancel();
      return response.status;
    },
    // No shell, the drill's own LEDGER_URL and LEDGER_TOKEN, and no `.env.local`.
    async ledger(args) {
      const child = spawn(process.execPath, [CLI_MAIN, ...args], {
        env: { ...process.env, LEDGER_URL: config.ledgerUrl, LEDGER_TOKEN: config.ledgerToken },
        stdio: ['ignore', 'pipe', 'ignore'],
      });
      let stdout = '';
      child.stdout.setEncoding('utf8');
      child.stdout.on('data', (chunk: string) => {
        stdout += chunk;
      });
      const [code] = (await once(child, 'close')) as [number | null];
      let json: unknown;
      try {
        json = JSON.parse(stdout);
      } catch {
        json = undefined;
      }
      return { code: code ?? 1, json };
    },
    now: () => new Date(),
    sleep: (ms) => sleep(ms),
  };
}

process.exitCode = await runGapDrill({ env: process.env, steps: createSteps, sink: processSink });
