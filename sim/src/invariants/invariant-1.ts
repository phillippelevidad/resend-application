import type { LedgerHistory } from '@ledger/core/testing';
import { type Executor, webhookEventsRepository } from '@ledger/db';

// Simulator invariant 1 (architecture.md → Simulator invariants): every generated event is in
// `webhook_events` exactly once. "More than once" cannot happen: `svix_id` is the primary key
// (ADR-004, proven by `webhook-events.repository.int.test.ts`), so what can fail is a lost event.

export type Invariant1Result =
  | { pass: true; stored: number; generated: number; line: string }
  | { pass: false; missing: string[]; generated: number; line: string };

// The fail line names at most this many ids, so a large loss stays one readable line.
const shownIds = 5;

// The ground truth is the set of distinct events (simulator.md → Ground truth and runs): a
// redelivery adds no truth, so the arranged repeats never reach this list.
export function generatedSvixIds(history: LedgerHistory): string[] {
  const ids = history.emails.flatMap(({ events }) => events.map(({ svixId }) => svixId));
  return [...new Set(ids)];
}

// Pure, so its pass and fail cases need no database. `stored` is the subset of `generated` the
// ledger holds. Ids only, never a payload or an address (simulator.md → Invariant checkers).
export function checkInvariant1(
  generated: readonly string[],
  stored: ReadonlySet<string>,
): Invariant1Result {
  const missing = generated.filter((svixId) => !stored.has(svixId));
  if (missing.length === 0) {
    const count = generated.length;
    return {
      pass: true,
      stored: count,
      generated: count,
      line: `invariant 1 pass stored=${count}/${count}`,
    };
  }
  return {
    pass: false,
    missing,
    generated: generated.length,
    line: `invariant 1 fail missing=${missing.length} svix_ids=${missing.slice(0, shownIds).join(',')}`,
  };
}

// D37: one `countPresent` over every id settles the common case. Only on a shortfall is each id
// counted alone, so the fail line can name the missing ones through the same `packages/db` read.
async function readStored(db: Executor, generated: readonly string[]): Promise<Set<string>> {
  const present = await webhookEventsRepository.countPresent(db, generated);
  if (present === generated.length) {
    return new Set(generated);
  }
  const stored = new Set<string>();
  for (const svixId of generated) {
    if ((await webhookEventsRepository.countPresent(db, [svixId])) === 1) {
      stored.add(svixId);
    }
  }
  return stored;
}

export async function invariant1(db: Executor, history: LedgerHistory): Promise<Invariant1Result> {
  const generated = generatedSvixIds(history);
  return checkInvariant1(generated, await readStored(db, generated));
}
