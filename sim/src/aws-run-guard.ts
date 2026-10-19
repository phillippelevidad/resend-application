import {
  APP_STACK_NAME,
  appOutputKeys,
  type createApiGatewayV2Client,
  type createCloudFormationClient,
  type createCloudWatchClient,
  type createLambdaClient,
  type createSqsClient,
  GUARDRAILS_STACK_NAME,
  guardrailsOutputKeys,
  type KillSwitchState,
  readKillSwitchState,
  readStackOutputs,
  SqsDlqAdapter,
  SqsQueueAttributesAdapter,
  type StackOutputs,
} from '@ledger/aws';
import type { DlqPort } from '@ledger/shared';
import type { SimFlags } from './read-sim-flags.ts';

// D23: `--burst`, `--chaos db-outage` and `--poison` make a run an AWS run, and an AWS run refuses,
// before it sends or changes anything, unless `LEDGER_URL` is the owner's armed, untripped deployment
// with an empty DLQ and the simulator secret. The readers are injected, so the guard's unit test needs
// no AWS; `awsRunGuardReaders` composes the real ones.

// The knobs in `read-sim-flags.ts`'s exclusion order; at most one is ever set.
export type AwsKnob = '--burst' | '--chaos' | '--poison';

// The AWS-run knob these flags set, or `undefined` for a plain run.
export function awsKnobOf(
  flags: Pick<SimFlags, 'burst' | 'chaos' | 'poison'>,
): AwsKnob | undefined {
  if (flags.burst !== undefined) return '--burst';
  if (flags.chaos !== undefined) return '--chaos';
  if (flags.poison !== undefined) return '--poison';
  return undefined;
}

// D23: an AWS knob without `LEDGER_URL` is a configuration error, exit `2`, before any network call.
// `main.ts` prints it (task 10.7): the run's mode is its to read.
export function offlineAwsKnobLine(knob: AwsKnob): string {
  return `sim: ${knob} needs a live run against the deployed stack: load .env.deployed.local`;
}

export type AwsRunGuardReaders = {
  // `null` when no stack of that name exists.
  readStackOutputs: (stackName: string) => Promise<StackOutputs | null>;
  readKillSwitchState: () => Promise<KillSwitchState>;
  // D1: visible plus in flight, of the DLQ these outputs name.
  readDlqDepth: (queues: DeployedQueues) => Promise<number>;
};

export type DeployedQueues = { readonly dlqUrl: string; readonly queueUrl: string };

// What a cleared guard hands the run: both stacks' outputs (read once, here) and the two queue URLs
// the DLQ adapter takes. Never printed: the outputs hold ARNs and URLs (D28).
export type AwsRunTarget = DeployedQueues & {
  readonly app: Readonly<Record<string, string>>;
  readonly guardrails: Readonly<Record<string, string>>;
};

export type AwsRunGuardResult =
  | { readonly status: 'clear'; readonly target: AwsRunTarget }
  // `line` is the whole stderr line, `sim: <reason>`; the run exits `1`.
  | { readonly status: 'refused'; readonly line: string };

const refused = (reason: string): AwsRunGuardResult => ({
  status: 'refused',
  line: `sim: ${reason}`,
});

const withoutTrailingSlash = (url: string): string => url.replace(/\/+$/, '');

// The kill switch's trip sets every app function's reserved concurrency to `0` (slice 2, D29 step 2);
// a `0` on any of them is the tripped signal the deploy and the drill refuse on too
// (simulator.md → The burst and the throttle).
const isTripped = (state: KillSwitchState): boolean =>
  state.functions.some((fn) => fn.reservedConcurrency === 0);

// D23's refusals, in its order, each read only once the one before it passed. A missing app stack
// fails the first (it has no `ApiUrl`), a missing guardrails stack the armed check.
export async function guardAwsRun(
  ledgerUrl: string,
  readers: AwsRunGuardReaders,
): Promise<AwsRunGuardResult> {
  const app = (await readers.readStackOutputs(APP_STACK_NAME))?.outputs ?? {};
  const guardrails = (await readers.readStackOutputs(GUARDRAILS_STACK_NAME))?.outputs ?? {};

  const apiUrl = app[appOutputKeys.apiUrl];
  if (apiUrl === undefined || withoutTrailingSlash(apiUrl) !== withoutTrailingSlash(ledgerUrl)) {
    return refused('LEDGER_URL is not the deployed LedgerApp API; load .env.deployed.local');
  }
  if (isTripped(await readers.readKillSwitchState())) {
    return refused('the stack is tripped; run pnpm aws:rearm first');
  }
  if (guardrails[guardrailsOutputKeys.killSwitchArmed] !== 'true') {
    return refused("the kill switch is not armed; AWS runs need the owner's armed deployment");
  }
  const dlqUrl = app[appOutputKeys.dlqUrl];
  const queueUrl = app[appOutputKeys.queueUrl];
  if (dlqUrl === undefined || queueUrl === undefined) {
    // Not one of D23's lines: a stack that has `ApiUrl` but lacks its queue outputs is a partial
    // deploy, and the depth check below cannot run without them.
    return refused('the deployed LedgerApp stack has no queue outputs; run pnpm aws:deploy');
  }
  const depth = await readers.readDlqDepth({ dlqUrl, queueUrl });
  if (depth !== 0) {
    return refused(`the DLQ holds ${depth} messages; inspect and redrive them first`);
  }
  // D23, D13: without it ingest answers every simulator-signed request `401`, so the run would spend
  // its requests (and a burst its raised throttle) to fail.
  if (app[appOutputKeys.simulatorSecretArn] === undefined) {
    return refused(
      'the deployed stack has no simulator secret; set LEDGER_SIMULATOR=on and run pnpm aws:deploy',
    );
  }
  return { status: 'clear', target: { app, guardrails, dlqUrl, queueUrl } };
}

// The clients `main.ts` builds once with `@ledger/aws`'s factories (D26 of slice 2).
export type AwsRunClients = {
  readonly cloudFormation: ReturnType<typeof createCloudFormationClient>;
  readonly lambda: ReturnType<typeof createLambdaClient>;
  readonly apiGateway: ReturnType<typeof createApiGatewayV2Client>;
  readonly sqs: ReturnType<typeof createSqsClient>;
};

// D24: the DLQ an AWS run reads, the sim's `SqsDlqAdapter` over the stack's two queue URLs.
export const deployedDlq = (sqs: AwsRunClients['sqs'], queues: DeployedQueues): DlqPort =>
  new SqsDlqAdapter({ sqs, dlqUrl: queues.dlqUrl, queueUrl: queues.queueUrl });

// The DLQ's depth, visible plus in flight, from the queue attributes: a read that receives nothing,
// so no dead message's receive count moves (the db-outage and poison runs' polls, D27).
export async function deployedDlqDepth(
  clients: Pick<AwsRunClients, 'sqs'> & {
    readonly cloudWatch: ReturnType<typeof createCloudWatchClient>;
  },
  queues: DeployedQueues,
): Promise<number> {
  const snapshot = await new SqsQueueAttributesAdapter({
    sqs: clients.sqs,
    cloudWatch: clients.cloudWatch,
    queueUrl: queues.queueUrl,
    dlqUrl: queues.dlqUrl,
  }).read();
  return snapshot.dlqVisible + snapshot.dlqInFlight;
}

// The guard's real readers. The depth is a one-message sample's: the port's only read, which never
// removes or hides a message (D1, D4).
export function awsRunGuardReaders(clients: AwsRunClients): AwsRunGuardReaders {
  return {
    readStackOutputs: (stackName) => readStackOutputs(clients.cloudFormation, stackName),
    readKillSwitchState: () =>
      readKillSwitchState(
        { lambda: clients.lambda, apiGateway: clients.apiGateway },
        { appStackName: APP_STACK_NAME },
      ),
    readDlqDepth: async (queues) => (await deployedDlq(clients.sqs, queues).sample(1)).depth,
  };
}
