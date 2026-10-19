import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createCloudFormationClient,
  createCloudWatchClient,
  createCloudWatchLogsClient,
  createLambdaClient,
  createResourceGroupsTaggingClient,
  createSecretsManagerClient,
  createSqsClient,
  listPostDestroyLeftovers,
  readStackOutputs,
  SqsQueueAttributesAdapter,
} from '@ledger/aws';
import { LedgerError } from '@ledger/shared';
import { runCdk } from './cdk-cli.ts';
import { APP_STACK_NAME, appOutputKeys, LOG_GROUP_PREFIXES, PROJECT_TAG } from './ledger-stacks.ts';
import { runTeardown, type TeardownSteps } from './run-teardown.ts';
import { createScriptOutput, processSink } from './script-output.ts';

// `pnpm aws:teardown [--discard-queued]` (D34): the composition root. Every AWS call goes through
// `@ledger/aws`; building a client contacts nothing. Each run is the owner's Ask-first run (root
// AGENTS.md → Permissions).

const notes = createScriptOutput('aws:teardown', processSink);
const cloudFormation = createCloudFormationClient();
const sqs = createSqsClient();
const cloudWatch = createCloudWatchClient();
const tagging = createResourceGroupsTaggingClient();
const secretsManager = createSecretsManagerClient();
const logs = createCloudWatchLogsClient();
const lambda = createLambdaClient();

// CDK's own output goes to a file outside the repository, never to the terminal (cdk-cli.ts).
const cdkLog = join(mkdtempSync(join(tmpdir(), 'ledger-aws-teardown-')), 'cdk.log');

const steps: TeardownSteps = {
  async readQueueDepths() {
    const appStack = await readStackOutputs(cloudFormation, APP_STACK_NAME);
    if (appStack === null) return undefined;
    const queueUrl = appStack.outputs[appOutputKeys.queueUrl];
    const dlqUrl = appStack.outputs[appOutputKeys.dlqUrl];
    if (queueUrl === undefined || dlqUrl === undefined) {
      throw new LedgerError('internal_error', 'The app stack has no queue outputs.');
    }
    return new SqsQueueAttributesAdapter({ sqs, cloudWatch, queueUrl, dlqUrl }).read();
  },

  async destroyStack(stackName) {
    if ((await runCdk(['destroy', stackName, '--force'], cdkLog, process.env)) !== 0) {
      notes.line(`the CDK CLI's output is in ${cdkLog} (it holds account ids: never publish it)`);
      throw new LedgerError('internal_error', 'The CDK CLI exited non-zero.');
    }
  },

  listLeftovers: () =>
    listPostDestroyLeftovers(
      { tagging, secretsManager, logs, lambda },
      { tag: PROJECT_TAG, logGroupPrefixes: LOG_GROUP_PREFIXES },
    ),
};

process.exitCode = await runTeardown({ argv: process.argv.slice(2), steps, sink: processSink });
