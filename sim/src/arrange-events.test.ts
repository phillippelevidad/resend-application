import { ledgerHistory } from '@ledger/core/testing';
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
});
