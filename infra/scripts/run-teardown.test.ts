// Ships 9, R15 (D34): teardown refuses to destroy queued events, destroys the app stack before the
// guardrails stack and only after the app's destroy succeeded, and exits `1` on a billable
// leftover but not on a secret pending deletion.
import type { PostDestroyListing } from '@ledger/aws';
import { describe, expect, it } from 'vitest';
import {
  OUTSIDE_AWS_STEPS,
  type QueueDepths,
  runTeardown,
  type TeardownSteps,
} from './run-teardown.ts';

type World = {
  calls: string[];
  depths: QueueDepths | undefined;
  failingStack: string | undefined;
  listing: PostDestroyListing;
  destroyed: string[];
};

const empty: QueueDepths = { visible: 0, inFlight: 0, dlqVisible: 0, dlqInFlight: 0 };

const newWorld = (overrides: Partial<World> = {}): World => ({
  calls: [],
  depths: empty,
  failingStack: undefined,
  listing: { leftovers: [], pendingDeletion: 2 },
  destroyed: [],
  ...overrides,
});

const fakeSteps = (world: World): TeardownSteps => ({
  async readQueueDepths() {
    world.calls.push('readQueueDepths');
    return world.depths;
  },
  async destroyStack(stackName) {
    world.calls.push(`destroyStack:${stackName}`);
    if (stackName === world.failingStack) throw new Error('cdk destroy exited 1');
    world.destroyed.push(stackName);
  },
  async listLeftovers() {
    world.calls.push('listLeftovers');
    return world.listing;
  },
});

async function teardown(world: World, argv: string[] = []) {
  const lines: string[] = [];
  const code = await runTeardown({
    argv,
    steps: fakeSteps(world),
    sink: (_stream, text) => lines.push(text),
  });
  return { code, lines, last: lines.at(-1) ?? '' };
}

describe('the queued-event refusal', () => {
  it.each([
    ['a visible message in the source queue', { ...empty, visible: 1 }],
    ['an in-flight message in the source queue', { ...empty, inFlight: 1 }],
    ['a visible message in the DLQ', { ...empty, dlqVisible: 1 }],
    ['an in-flight message in the DLQ', { ...empty, dlqInFlight: 1 }],
  ])('refuses %s without --discard-queued and destroys nothing', async (_name, depths) => {
    const world = newWorld({ depths });
    const run = await teardown(world);
    expect(run.code).toBe(1);
    expect(run.last).toMatch(/^aws:teardown: refused: .*--discard-queued/);
    expect(world.calls).toEqual(['readQueueDepths']);
    expect(world.destroyed).toEqual([]);
  });

  it('destroys a non-empty queue with --discard-queued', async () => {
    const world = newWorld({ depths: { ...empty, visible: 3 } });
    const run = await teardown(world, ['--discard-queued']);
    expect(run.code).toBe(0);
    expect(world.destroyed).toEqual(['LedgerApp', 'LedgerGuardrails']);
  });

  it('proceeds with no app stack, so no queue', async () => {
    const world = newWorld({ depths: undefined });
    const run = await teardown(world);
    expect(run.code).toBe(0);
    expect(world.destroyed).toEqual(['LedgerApp', 'LedgerGuardrails']);
  });

  it('refuses an unknown flag before reading anything', async () => {
    const world = newWorld();
    const run = await teardown(world, ['--force']);
    expect(run.last).toMatch(/^aws:teardown: refused: usage/);
    expect(world.calls).toEqual([]);
  });
});

describe('the destroy order', () => {
  it('destroys the app stack, then the guardrails stack, then lists', async () => {
    const world = newWorld();
    await teardown(world);
    expect(world.calls).toEqual([
      'readQueueDepths',
      'destroyStack:LedgerApp',
      'destroyStack:LedgerGuardrails',
      'listLeftovers',
    ]);
  });

  it('keeps the guardrails stack when the app destroy fails', async () => {
    const world = newWorld({ failingStack: 'LedgerApp' });
    const run = await teardown(world);
    expect(run.code).toBe(1);
    expect(run.last).toMatch(/^aws:teardown: failed: cdk destroy LedgerApp failed/);
    expect(world.calls).not.toContain('destroyStack:LedgerGuardrails');
  });
});

describe('the post-destroy listing', () => {
  it('exits 0 when only secrets pending deletion remain, after printing the three outside steps', async () => {
    const run = await teardown(newWorld());
    expect(run.code).toBe(0);
    // Slice 4 D30: the reconciler's key is revoked at Resend, which no destroy does.
    expect(run.lines).toContain(
      'aws:teardown: outside AWS: revoke the Resend API key you made for the reconciler (dashboard, or DELETE /api-keys/{id})\n',
    );
    expect(run.lines.slice(-4)).toEqual([
      ...OUTSIDE_AWS_STEPS.map((step) => `aws:teardown: ${step}\n`),
      'aws:teardown: done\n',
    ]);
  });

  it('exits 1 on a billable leftover, naming it without an account id', async () => {
    const world = newWorld({
      listing: {
        leftovers: [{ service: 'logs', resource: 'log-group:/ledger/LedgerApp-worker' }],
        pendingDeletion: 0,
      },
    });
    const run = await teardown(world);
    expect(run.code).toBe(1);
    expect(run.lines).toContain('aws:teardown: leftover logs log-group:/ledger/LedgerApp-worker\n');
    expect(run.last).toMatch(/^aws:teardown: failed: billable resources remain/);
    for (const step of OUTSIDE_AWS_STEPS) expect(run.lines).toContain(`aws:teardown: ${step}\n`);
  });
});
