import { randomBytes } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createApiGatewayV2Client,
  createCloudFormationClient,
  createLambdaClient,
  createSecretsManagerClient,
  LambdaEventSourceControlAdapter,
  readKillSwitchState,
  readStackOutputs,
  SecretsManagerSecretReaderAdapter,
  writeSecretIfChanged,
} from '@ledger/aws';
import {
  apiTokensRepository,
  createDatabase,
  type Database,
  pendingContractSteps,
  prepareDatabase,
  RUNTIME_ROLE_TIMEOUTS,
  storedAddressHashKeyId,
} from '@ledger/db';
import { createLogger, LedgerError } from '@ledger/shared';
import { infraContextKeys } from '../src/infra.config.ts';
import { CDK_OUT_DIR, REPO_DIR, runCdk } from './cdk-cli.ts';
import type { DeployEnv } from './deploy-env.schema.ts';
import { headCommit, isAncestor, isTreeClean } from './git.ts';
import {
  APP_STACK_NAME,
  appOutputKeys,
  GUARDRAILS_STACK_NAME,
  guardrailsOutputKeys,
} from './ledger-stacks.ts';
import { type DeployContext, type DeploySteps, runDeploy } from './run-deploy.ts';
import { createScriptOutput, processSink } from './script-output.ts';
import { findTemplateSecret } from './template-secrets.ts';

// `pnpm aws:deploy` (D33): the composition root. It reads `process.env` once (runDeploy parses it),
// builds the AWS clients through `@ledger/aws` and the database through `@ledger/db`, and hands
// `runDeploy` the real steps. Building a client contacts nothing; every AWS call happens in a step,
// after the input assertion. Each run against AWS is the owner's Ask-first run (root AGENTS.md →
// Permissions).

const notes = createScriptOutput('aws:deploy', processSink);

const cloudFormation = createCloudFormationClient();
const lambda = createLambdaClient();
const apiGateway = createApiGatewayV2Client();
const secretsManager = createSecretsManagerClient();
const secretReader = new SecretsManagerSecretReaderAdapter({ client: secretsManager });

// The owner connection over the direct URL, for the deploy's own reads and the token inserts,
// opened on first use and closed at exit.
let database: Database | undefined;

const required = (outputs: Readonly<Record<string, string>>, key: string): string => {
  const value = outputs[key];
  if (value === undefined) throw new LedgerError('internal_error', 'A stack output is missing.');
  return value;
};

const armedOutput = (
  outputs: Readonly<Record<string, string>> | undefined,
): boolean | undefined => {
  const value = outputs?.[guardrailsOutputKeys.killSwitchArmed];
  return value === undefined ? undefined : value === 'true';
};

// D33: the deploy inputs reach the CDK app as context (pp-infra → Deploy inputs), under the keys
// `infra/src/infra.config.ts` parses.
function contextArgs(context: DeployContext): string[] {
  const values: Record<string, string> = {
    [infraContextKeys.commit]: context.commit,
    [infraContextKeys.alertEmail]: context.alertEmail,
    [infraContextKeys.budgetUsd]: String(context.budgetUsd),
    [infraContextKeys.killSwitch]: context.killSwitch ? 'on' : 'off',
    [infraContextKeys.budgetDrill]: context.budgetDrill ? 'true' : 'false',
    [infraContextKeys.simulator]: context.simulator ? 'true' : 'false',
  };
  return Object.entries(values).flatMap(([key, value]) => ['-c', `${key}=${value}`]);
}

function createSteps(config: DeployEnv): DeploySteps {
  // CDK's own output goes to a file outside the repository, never to the terminal (cdk-cli.ts).
  const cdkLog = join(mkdtempSync(join(tmpdir(), 'ledger-aws-deploy-')), 'cdk.log');
  const cdk = async (args: readonly string[]): Promise<void> => {
    if ((await runCdk(args, cdkLog, process.env)) !== 0) {
      notes.line(`the CDK CLI's output is in ${cdkLog} (it holds account ids: never publish it)`);
      throw new LedgerError('internal_error', 'The CDK CLI exited non-zero.');
    }
  };

  const ownerDatabase = (): Database => {
    database ??= createDatabase({
      url: config.databaseUrl,
      max: 1,
      // Pool errors carry the error's name only (create-database.ts), prefixed like every line.
      logger: createLogger({
        functionName: 'aws-deploy',
        stream: { write: (line: string) => process.stderr.write(`aws:deploy: ${line}`) },
      }),
    });
    return database;
  };

  return {
    isTreeClean: async () => isTreeClean(REPO_DIR),
    headCommit: async () => headCommit(REPO_DIR),

    async readDeployedState() {
      const appStack = await readStackOutputs(cloudFormation, APP_STACK_NAME);
      const guardrails = await readStackOutputs(cloudFormation, GUARDRAILS_STACK_NAME);
      const killSwitchArmed = armedOutput(guardrails?.outputs);
      const deployedCommit = appStack?.outputs[appOutputKeys.deployedCommit];
      if (appStack === null || deployedCommit === undefined) {
        return { app: undefined, killSwitchArmed };
      }
      const workerName = required(appStack.outputs, appOutputKeys.workerFunctionName);
      const state = await readKillSwitchState(
        { lambda, apiGateway },
        { appStackName: APP_STACK_NAME },
      );
      const worker = state.functions.find((fn) => fn.name === workerName);
      if (worker === undefined) throw new LedgerError('internal_error', 'No worker function.');
      return {
        app: {
          deployedCommit,
          workerReservedConcurrency: worker.reservedConcurrency,
          eventSourcePaused: state.eventSource === 'paused',
          databaseSecretArn: required(appStack.outputs, appOutputKeys.databaseSecretArn),
        },
        killSwitchArmed,
      };
    },

    pendingContractSteps: () => pendingContractSteps(ownerDatabase().db),
    isAncestor: async (sha, deployedCommit) => isAncestor(REPO_DIR, sha, deployedCommit),

    synthesize: (context) =>
      cdk(['synth', '--quiet', '--output', CDK_OUT_DIR, ...contextArgs(context)]),
    findTemplateSecret: async () => findTemplateSecret(CDK_OUT_DIR),

    readSecret: (secretArn) => secretReader.read(secretArn),
    // D33 step 6: 24 random bytes as hex, URL-safe inside the pooled URL.
    randomPassword: () => randomBytes(24).toString('hex'),
    prepareDatabase: ({ runtimePassword, resetPassword }) =>
      prepareDatabase({
        ownerUrl: config.databaseUrl,
        runtimePassword,
        roleTimeouts: RUNTIME_ROLE_TIMEOUTS,
        resetPassword,
      }),
    storedAddressHashKeyId: () => storedAddressHashKeyId(ownerDatabase().db),

    // The assembly step 5 synthesized and scanned is the one deployed: `--app` names it, so nothing
    // is synthesized again between the scan and the deploy.
    deployStack: (stackName) =>
      cdk(['deploy', stackName, '--app', CDK_OUT_DIR, '--require-approval', 'never']),

    async readDeployOutputs() {
      const appStack = await readStackOutputs(cloudFormation, APP_STACK_NAME);
      const guardrails = await readStackOutputs(cloudFormation, GUARDRAILS_STACK_NAME);
      const killSwitchArmed = armedOutput(guardrails?.outputs);
      if (appStack === null || killSwitchArmed === undefined) {
        throw new LedgerError(
          'internal_error',
          'A stack or its output is missing after the deploy.',
        );
      }
      return {
        apiUrl: required(appStack.outputs, appOutputKeys.apiUrl),
        databaseSecretArn: required(appStack.outputs, appOutputKeys.databaseSecretArn),
        signingSecretsArn: required(appStack.outputs, appOutputKeys.signingSecretsArn),
        // Present only with the simulator (D12); runDeploy fails when `on` finds it absent.
        simulatorSecretArn: appStack.outputs[appOutputKeys.simulatorSecretArn],
        killSwitchArmed,
      };
    },

    writeSecret: (secretArn, value) => writeSecretIfChanged(secretsManager, secretArn, value),
    insertBootstrapToken: async (row) =>
      (await apiTokensRepository.insertBootstrapIfAbsent(ownerDatabase().db, row)) !== undefined,
    insertToken: async (row) => {
      await apiTokensRepository.insert(ownerDatabase().db, row);
    },

    // A fresh adapter, because a stack update may have replaced the mapping step 2 read, and the
    // adapter caches its mapping's UUID (D16).
    async pauseEventSource() {
      const eventSource = new LambdaEventSourceControlAdapter({
        client: lambda,
        functionName: `${APP_STACK_NAME}-worker`,
      });
      if ((await eventSource.getState()) !== 'paused') await eventSource.disable();
    },
  };
}

try {
  process.exitCode = await runDeploy({
    env: process.env,
    argv: process.argv.slice(2),
    steps: createSteps,
    sink: processSink,
  });
} finally {
  await database?.pool.end();
}
