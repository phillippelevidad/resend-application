import { ledgerHistory } from '@ledger/core/testing';
import { POISON_ID_PREFIX } from '@ledger/db/testing';
import { FakeClock } from '@ledger/shared/testing';
import { describe, expect, it } from 'vitest';
import { generatedSvixIds } from './invariants/invariant-1.ts';
import { settleBound } from './live-run.ts';
import { type PoisonRunInput, poisonHistory, poisonRun } from './poison-run.ts';
import { sampleOnce } from './sample-once.ts';

const namespace = 'walk';
const history = sampleOnce(ledgerHistory({ namespace, labelEveryAddress: true }), 7);
const minute = 60_000;

type World = {
  run: PoisonRunInput;
  stdout: string[];
  stderr: string[];
  // The database state the run changes: whether `ledger_sim_poison` exists.
  fault: { present: boolean; events: string[] };
  sent: { count: number };
};

// A deployed stack in miniature: the poisoned events reach the DLQ 31 min after the send, as five
// 360 s visibility timeouts would move them (AWS-08, AWS-09).
function world(count: number, overrides: Partial<PoisonRunInput> = {}): World {
  const clock = new FakeClock();
  const stdout: string[] = [];
  const stderr: string[] = [];
  const fault = { present: false, events: [] as string[] };
  const sent = { count: 0 };
  const pick = poisonHistory(history, { seed: 7, namespace, count });
  let sentAt: number | undefined;
  const run: PoisonRunInput = {
    pick,
    clock,
    sleep: async (ms) => {
      clock.advance(ms);
    },
    guard: async () => undefined,
    removeFault: async () => {
      fault.present = false;
      fault.events.push('remove');
    },
    addFault: async () => {
      fault.present = true;
      fault.events.push('add');
    },
    send: async () => {
      sent.count += 1;
      sentAt = clock.now().getTime();
      return { requests: 24, accepted: 24 };
    },
    settle: async (ids, generatedEvents) => ({
      expected: ids.length,
      present: ids.length,
      settled: true,
      bound: settleBound(generatedEvents),
      elapsedMs: 3_000,
    }),
    dlqDepth: async () =>
      sentAt !== undefined && clock.now().getTime() - sentAt >= 31 * minute ? count : 0,
    invariant4: async (marked) => ({
      pass: true,
      line: `invariant 4 pass (dlq holds exactly the ${marked.size} poisoned)`,
    }),
    out: (line) => stdout.push(line),
    err: (line) => stderr.push(line),
    ...overrides,
  };
  return { run, stdout, stderr, fault, sent };
}

// D28: ids and counts only; no line holds an address or a URL.
function expectNoAddressOrUrl(lines: readonly string[]): void {
  for (const line of lines) {
    expect(line).not.toContain('@');
    expect(line).not.toContain('://');
    expect(line).not.toContain('postgres');
  }
}

describe('poisonHistory', () => {
  it('re-ids n seeded events to simpoison_<namespace>_<k>, never from the walk probe, and leaves every other event as it was', () => {
    const pick = poisonHistory(history, { seed: 7, namespace, count: 3 });

    expect(pick.svixIds).toEqual([
      `${POISON_ID_PREFIX}${namespace}_0`,
      `${POISON_ID_PREFIX}${namespace}_1`,
      `${POISON_ID_PREFIX}${namespace}_2`,
    ]);
    expect(pick.emailIds).not.toContain(`${namespace}-probe`);
    const before = generatedSvixIds(history);
    const after = generatedSvixIds(pick.history);
    expect(after).toHaveLength(before.length);
    expect(after.filter((svixId) => svixId.startsWith(POISON_ID_PREFIX))).toEqual(pick.svixIds);
    // Exactly three ids changed; the rest are the same ids in the same places.
    expect(after.filter((svixId, i) => svixId !== before[i])).toHaveLength(3);
    // The poisoned events' emails are the ones the line names.
    const poisonedEmails = pick.history.emails
      .filter(({ events }) => events.some(({ svixId }) => svixId.startsWith(POISON_ID_PREFIX)))
      .map(({ emailId }) => emailId);
    expect(poisonedEmails).toEqual(pick.emailIds);
  });

  it('picks the same events for the same seed and namespace, and other events for another seed', () => {
    const ids = (seed: number) =>
      generatedSvixIds(poisonHistory(history, { seed, namespace, count: 5 }).history);
    expect(ids(7)).toEqual(ids(7));
    expect(ids(7)).not.toEqual(ids(8));
  });

  it('never picks from the walk probe, even when it asks for every other event', () => {
    const probe = history.emails.find(({ emailId }) => emailId === `${namespace}-probe`);
    const others = generatedSvixIds(history).length - (probe?.events.length ?? 0);
    const pick = poisonHistory(history, { seed: 7, namespace, count: others });

    expect(probe?.events.length).toBeGreaterThan(0);
    expect(pick.svixIds).toHaveLength(others);
    expect(pick.emailIds).not.toContain(`${namespace}-probe`);
  });
});

describe('poisonRun', () => {
  it('adds the fault, sends, settles the others, waits for the DLQ, reports, then removes the fault, in the order Surfaces prints', async () => {
    const { run, stdout, stderr, fault } = world(2);
    const others = generatedSvixIds(run.pick.history).length - 2;

    expect(await poisonRun(run)).toBe(0);

    expect(stdout).toEqual([
      `poison count=2 svix_ids=${run.pick.svixIds.join(',')} email_ids=${run.pick.emailIds.join(',')}`,
      'sent requests=24 accepted=24',
      `others stored ${others}/${others} exactly once (2 poisoned wait in the DLQ)`,
      'invariant 1 not checked (2 poisoned events wait in the DLQ)',
      'invariant 2 not checked (2 poisoned events wait in the DLQ)',
      'invariant 4 pass (dlq holds exactly the 2 poisoned)',
      'poison fixed; next: pnpm -s ledger dlq inspect, then pnpm -s ledger dlq redrive; the depth returns to 0 in pnpm -s ledger health',
    ]);
    expect(stderr).toEqual([]);
    // A leftover goes first, then the fault, then the fix.
    expect(fault.events).toEqual(['remove', 'add', 'remove']);
    expect(fault.present).toBe(false);
    expectNoAddressOrUrl(stdout);
  });

  it('settles the non-poisoned ids only, with the bound of every generated event (D22)', async () => {
    const seen: { ids: readonly string[]; generatedEvents: number }[] = [];
    const base = world(2);
    const { run } = world(2, {
      settle: async (ids, generatedEvents) => {
        seen.push({ ids, generatedEvents });
        return base.run.settle(ids, generatedEvents);
      },
    });

    expect(await poisonRun(run)).toBe(0);

    const generated = generatedSvixIds(run.pick.history);
    expect(seen).toHaveLength(1);
    expect(seen[0]?.generatedEvents).toBe(generated.length);
    expect(seen[0]?.ids).toEqual(generated.filter((id) => !run.pick.svixIds.includes(id)));
  });

  it('drops the constraint when a step fails after the fault, and exits 1', async () => {
    const { run, stderr, fault } = world(1, {
      send: async () => {
        throw Object.assign(new Error('connect ECONNREFUSED https://ledger.example.test'), {
          name: 'TypeError',
        });
      },
    });

    expect(await poisonRun(run)).toBe(1);

    expect(fault.present).toBe(false);
    expect(stderr).toEqual(['sim: the poison run failed (TypeError)']);
    expectNoAddressOrUrl(stderr);
  });

  it('drops the constraint and fails at the 40 min bound when the DLQ never reaches n', async () => {
    const { run, stdout, stderr, fault } = world(2, {
      dlqDepth: async () => 1,
      invariant4: async () => ({
        pass: false,
        line: 'invariant 4 fail depth=1 poisoned=2 collected=1 stray=',
      }),
    });

    expect(await poisonRun(run)).toBe(1);

    expect(stderr).toEqual(['sim: the DLQ holds 1 of the 2 poisoned after 40m']);
    expect(stdout).toContain('invariant 4 fail depth=1 poisoned=2 collected=1 stray=');
    expect(fault.present).toBe(false);
  });

  it('fails the run like an invariant when the others are short', async () => {
    const { run, stdout } = world(1, {
      settle: async (ids, generatedEvents) => ({
        expected: ids.length,
        present: ids.length - 1,
        settled: true,
        bound: settleBound(generatedEvents),
        elapsedMs: 3_000,
      }),
    });
    const others = generatedSvixIds(run.pick.history).length - 1;

    expect(await poisonRun(run)).toBe(1);

    expect(stdout).toContain(
      `others stored ${others - 1}/${others} exactly once (1 poisoned wait in the DLQ)`,
    );
  });

  it('refuses with the owner line, sends nothing and adds no fault when DATABASE_URL is the runtime role (42501)', async () => {
    const { run, stderr, fault, sent } = world(1, {
      removeFault: async () => {
        throw Object.assign(new Error('must be owner of table webhook_events'), {
          // pg's error shape: a SQLSTATE `code` and a `severity`.
          code: '42501',
          severity: 'ERROR',
        });
      },
    });

    expect(await poisonRun(run)).toBe(1);

    expect(stderr).toEqual([
      "sim: --poison needs DATABASE_URL to own webhook_events (the owner's pooled URL, not the runtime role's)",
    ]);
    expect(fault.events).toEqual([]);
    expect(sent.count).toBe(0);
  });

  it("prints the guard's refusal and touches nothing", async () => {
    const { run, stdout, stderr, fault, sent } = world(1, {
      guard: async () => 'sim: the DLQ holds 2 messages; inspect and redrive them first',
    });

    expect(await poisonRun(run)).toBe(1);

    expect(stderr).toEqual(['sim: the DLQ holds 2 messages; inspect and redrive them first']);
    expect(stdout).toEqual([]);
    expect(fault.events).toEqual([]);
    expect(sent.count).toBe(0);
  });

  it('prints the not-removed line and exits 1 when the fix fails', async () => {
    let removals = 0;
    const { run, stdout, stderr } = world(1, {
      removeFault: async () => {
        removals += 1;
        if (removals > 1) throw new Error('connection lost');
      },
    });

    expect(await poisonRun(run)).toBe(1);

    expect(stderr).toEqual([
      'sim: the poison fault was not removed; drop the constraint ledger_sim_poison on webhook_events as its owner',
    ]);
    expect(stdout.at(-1)).toBe('invariant 4 pass (dlq holds exactly the 1 poisoned)');
  });
});
