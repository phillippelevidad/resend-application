import type { KillSwitchState, StackOutputs } from '@ledger/aws';
import { describe, expect, it } from 'vitest';
import {
  type AwsRunGuardReaders,
  awsKnobOf,
  guardAwsRun,
  offlineAwsKnobLine,
} from './aws-run-guard.ts';

// D23 over injected readers: each refusal line, in order, and a cleared guard's target. The values
// are placeholders shaped like the outputs, never a deployed URL, ARN or account.

const apiUrl = 'https://api.example.test/';

type Deployed = {
  app: Record<string, string> | null;
  guardrails: Record<string, string> | null;
  reservedConcurrency: number | null;
  dlqDepth: number;
};

const healthy = (): Deployed => ({
  app: {
    ApiUrl: apiUrl,
    QueueUrl: 'https://sqs.example.test/queue',
    DlqUrl: 'https://sqs.example.test/dlq',
    SimulatorSecretArn: 'simulator-secret-placeholder',
    ThrottleRateLimit: '100',
    ThrottleBurstLimit: '200',
  },
  guardrails: { KillSwitchArmed: 'true' },
  reservedConcurrency: null,
  dlqDepth: 0,
});

// The readers over a described deployment, recording what each read so a test can assert that a
// refusal stopped the reads after it.
function readersOf(deployed: Deployed): AwsRunGuardReaders & { reads: string[] } {
  const reads: string[] = [];
  const outputsOf = (outputs: Record<string, string> | null): StackOutputs | null =>
    outputs === null ? null : { status: 'UPDATE_COMPLETE', outputs };
  return {
    reads,
    readStackOutputs: async (stackName) => {
      reads.push(stackName);
      return outputsOf(stackName === 'LedgerApp' ? deployed.app : deployed.guardrails);
    },
    readKillSwitchState: async (): Promise<KillSwitchState> => {
      reads.push('kill-switch');
      return {
        eventSource: 'enabled',
        functions: [
          { name: 'LedgerApp-ingest', reservedConcurrency: deployed.reservedConcurrency },
          { name: 'LedgerApp-worker', reservedConcurrency: deployed.reservedConcurrency },
        ],
        defaultThrottle: { rateLimit: 100, burstLimit: 200 },
        routeThrottles: [],
      };
    },
    readDlqDepth: async (queues) => {
      reads.push(`dlq ${queues.dlqUrl}`);
      return deployed.dlqDepth;
    },
  };
}

describe('the AWS-run guard (D23)', () => {
  it('clears the owner deployment and hands the run both stacks and the queue URLs', async () => {
    const readers = readersOf(healthy());

    const result = await guardAwsRun('https://api.example.test', readers);

    expect(result).toEqual({
      status: 'clear',
      target: {
        app: healthy().app,
        guardrails: { KillSwitchArmed: 'true' },
        dlqUrl: 'https://sqs.example.test/dlq',
        queueUrl: 'https://sqs.example.test/queue',
      },
    });
    expect(readers.reads).toEqual([
      'LedgerApp',
      'LedgerGuardrails',
      'kill-switch',
      'dlq https://sqs.example.test/dlq',
    ]);
  });

  it('ignores a trailing slash on either side of the LEDGER_URL comparison', async () => {
    const deployed = healthy();
    deployed.app = { ...deployed.app, ApiUrl: 'https://api.example.test' };

    const result = await guardAwsRun('https://api.example.test/', readersOf(deployed));

    expect(result.status).toBe('clear');
  });

  it('refuses a LEDGER_URL that is not the deployed ApiUrl, before reading anything else', async () => {
    const readers = readersOf(healthy());

    const result = await guardAwsRun('http://127.0.0.1:3200', readers);

    expect(result).toEqual({
      status: 'refused',
      line: 'sim: LEDGER_URL is not the deployed LedgerApp API; load .env.deployed.local',
    });
    expect(readers.reads).toEqual(['LedgerApp', 'LedgerGuardrails']);
  });

  it('refuses as the wrong target when no LedgerApp stack is deployed', async () => {
    const deployed = healthy();
    deployed.app = null;

    const result = await guardAwsRun(apiUrl, readersOf(deployed));

    expect(result).toEqual({
      status: 'refused',
      line: 'sim: LEDGER_URL is not the deployed LedgerApp API; load .env.deployed.local',
    });
  });

  it('refuses a tripped stack (a reserved concurrency of 0)', async () => {
    const deployed = healthy();
    deployed.reservedConcurrency = 0;
    const readers = readersOf(deployed);

    const result = await guardAwsRun(apiUrl, readers);

    expect(result).toEqual({
      status: 'refused',
      line: 'sim: the stack is tripped; run pnpm aws:rearm first',
    });
    expect(readers.reads).not.toContain('dlq https://sqs.example.test/dlq');
  });

  it('refuses when KillSwitchArmed is not true', async () => {
    const deployed = healthy();
    deployed.guardrails = { KillSwitchArmed: 'false' };

    const result = await guardAwsRun(apiUrl, readersOf(deployed));

    expect(result).toEqual({
      status: 'refused',
      line: "sim: the kill switch is not armed; AWS runs need the owner's armed deployment",
    });
  });

  it('refuses as unarmed when no LedgerGuardrails stack is deployed', async () => {
    const deployed = healthy();
    deployed.guardrails = null;

    const result = await guardAwsRun(apiUrl, readersOf(deployed));

    expect(result).toEqual({
      status: 'refused',
      line: "sim: the kill switch is not armed; AWS runs need the owner's armed deployment",
    });
  });

  it('refuses a DLQ that holds messages, naming the depth', async () => {
    const deployed = healthy();
    deployed.dlqDepth = 2;

    const result = await guardAwsRun(apiUrl, readersOf(deployed));

    expect(result).toEqual({
      status: 'refused',
      line: 'sim: the DLQ holds 2 messages; inspect and redrive them first',
    });
  });

  it('refuses a stack deployed without the SimulatorSecretArn output', async () => {
    const deployed = healthy();
    const { SimulatorSecretArn: _dropped, ...withoutSimulator } = deployed.app ?? {};
    deployed.app = withoutSimulator;

    const result = await guardAwsRun(apiUrl, readersOf(deployed));

    expect(result).toEqual({
      status: 'refused',
      line: 'sim: the deployed stack has no simulator secret; set LEDGER_SIMULATOR=on and run pnpm aws:deploy',
    });
  });

  it('refuses a partial stack without its queue outputs, before any DLQ read', async () => {
    const deployed = healthy();
    const { DlqUrl: _dropped, ...withoutDlq } = deployed.app ?? {};
    deployed.app = withoutDlq;
    const readers = readersOf(deployed);

    const result = await guardAwsRun(apiUrl, readers);

    expect(result).toEqual({
      status: 'refused',
      line: 'sim: the deployed LedgerApp stack has no queue outputs; run pnpm aws:deploy',
    });
    expect(readers.reads.some((read) => read.startsWith('dlq'))).toBe(false);
  });

  // D23's order: with every precondition broken, the first one is the line.
  it('names the first failing precondition in D23 order', async () => {
    const deployed = healthy();
    deployed.reservedConcurrency = 0;
    deployed.guardrails = { KillSwitchArmed: 'false' };
    deployed.dlqDepth = 3;

    const result = await guardAwsRun(apiUrl, readersOf(deployed));

    expect(result).toEqual({
      status: 'refused',
      line: 'sim: the stack is tripped; run pnpm aws:rearm first',
    });
  });

  it('never puts a URL or output value on a refusal line', async () => {
    const deployed = healthy();
    deployed.dlqDepth = 1;

    const result = await guardAwsRun(apiUrl, readersOf(deployed));

    expect(result.status).toBe('refused');
    if (result.status === 'refused') {
      expect(result.line).not.toMatch(/https?:|example\.test|placeholder/);
    }
  });
});

describe('an AWS knob without LEDGER_URL (D23)', () => {
  it('names the knob each flag sets, and none for a plain run', () => {
    const none = { burst: undefined, chaos: undefined, poison: undefined };

    expect(awsKnobOf({ ...none, burst: { events: 10, seconds: 1 } })).toBe('--burst');
    expect(awsKnobOf({ ...none, chaos: 'db-outage' })).toBe('--chaos');
    expect(awsKnobOf({ ...none, poison: 1 })).toBe('--poison');
    expect(awsKnobOf(none)).toBeUndefined();
  });

  it('prints the load-the-deployed-env line for the knob', () => {
    expect(offlineAwsKnobLine('--burst')).toBe(
      'sim: --burst needs a live run against the deployed stack: load .env.deployed.local',
    );
  });
});
