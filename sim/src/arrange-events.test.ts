import { ledgerHistory } from '@ledger/core/testing';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { arrangeEvents } from './arrange-events.ts';
import { sampleOnce } from './sample-once.ts';

const seed = 42;
const history = sampleOnce(ledgerHistory({ namespace: 'walk' }), seed);
const generated = history.emails.flatMap(({ events }) => events);

describe('arrangeEvents', () => {
  it('leaves the generated order alone with no knob set', () => {
    const { events, repeats } = arrangeEvents(history, { seed, duplicates: 0, shuffle: false });

    expect(repeats).toBe(0);
    expect(events.map(({ event }) => event)).toEqual(generated);
  });

  // The e2e test shows the projection is unchanged under the knobs; this shows the knobs change
  // what is projected, so that equality is not vacuous.
  it('adds ⌊r·n⌋ redeliveries of generated events and permutes the result', () => {
    const plain = arrangeEvents(history, { seed, duplicates: 0.3, shuffle: false });
    const arranged = arrangeEvents(history, { seed, duplicates: 0.3, shuffle: true });

    expect(arranged.generated).toBe(generated.length);
    expect(arranged.repeats).toBe(Math.floor(0.3 * generated.length));
    expect(arranged.repeats).toBeGreaterThan(0);
    expect(arranged.events).toHaveLength(generated.length + arranged.repeats);
    // A redelivery is the same stored event again (ADR-004).
    expect(arranged.events.every(({ event }) => generated.includes(event))).toBe(true);
    // The same multiset as unshuffled, in another order.
    const svixIds = (events: typeof plain.events) => events.map(({ event }) => event.svixId);
    expect([...svixIds(arranged.events)].sort()).toEqual([...svixIds(plain.events)].sort());
    expect(svixIds(arranged.events)).not.toEqual(svixIds(plain.events));
  });

  // `sampleOnce` restarts fast-check's generator from the seed it is given, so a draw on the run's
  // own seed reads the stream that built the history. With every event repeated, or shuffled with
  // none, both knobs draw a permutation of the n events, so a shared stream shows as equality.
  it('draws the redeliveries and the shuffle each from its own stream, not the one that built the history', () => {
    const n = generated.length;
    const pairs = history.emails.flatMap(({ emailId, events }) =>
      events.map((event) => ({ emailId, event })),
    );
    const onRunSeed = sampleOnce(fc.shuffledSubarray(pairs, { minLength: n, maxLength: n }), seed);
    const repeated = arrangeEvents(history, { seed, duplicates: 1, shuffle: false });
    const shuffled = arrangeEvents(history, { seed, duplicates: 0, shuffle: true });
    const repeats = repeated.events.slice(n);

    expect(repeats).toHaveLength(n);
    expect(repeats).not.toEqual(onRunSeed);
    expect(shuffled.events).not.toEqual(onRunSeed);
    expect(repeats).not.toEqual(shuffled.events);
  });
});
