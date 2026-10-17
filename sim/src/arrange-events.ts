import type { LedgerEvent } from '@ledger/core';
import type { LedgerHistory } from '@ledger/core/testing';
import fc from 'fast-check';
import { deriveSeed } from './derive-seed.ts';
import { sampleOnce } from './sample-once.ts';

// One stored event and the email the history generated it for. Skipped events (an unknown type, a
// payload that fails the schema) may carry no usable `email_id`, so the email is kept beside it.
export type ArrangedEvent = { emailId: string; event: LedgerEvent };

export type ArrangeOptions = { seed: number; duplicates: number; shuffle: boolean };

export type ArrangedEvents = {
  events: ArrangedEvent[];
  // `n` on line 2: every generated event, skipped ones included.
  generated: number;
  // `d` on line 2: the repeats added.
  repeats: number;
};

// The draws after the history, each on its own seed derived from the run's (`deriveSeed`).
const repeatDraw = 1;
const shuffleDraw = 2;

// D16: the delivery knobs, both drawn from the run's seed, independently of the history and of
// each other. A repeat is the same stored event again, `svixId` included, as a redelivery is
// (ADR-004). Resend promises no delivery order, so the shuffle is any permutation.
export function arrangeEvents(history: LedgerHistory, options: ArrangeOptions): ArrangedEvents {
  const generated = history.emails.flatMap(({ emailId, events }) =>
    events.map((event) => ({ emailId, event })),
  );
  const count = Math.floor(options.duplicates * generated.length);
  const repeats =
    count === 0
      ? []
      : sampleOnce(
          fc.shuffledSubarray(generated, { minLength: count, maxLength: count }),
          deriveSeed(options.seed, repeatDraw),
        );
  const delivered = [...generated, ...repeats];
  const events = options.shuffle
    ? sampleOnce(
        fc.shuffledSubarray(delivered, {
          minLength: delivered.length,
          maxLength: delivered.length,
        }),
        deriveSeed(options.seed, shuffleDraw),
      )
    : delivered;
  return { events, generated: generated.length, repeats: repeats.length };
}
