import { parseIngestEnvelope } from '@ledger/core';
import type { DlqPort } from '@ledger/shared';

// Simulator invariant 4 (architecture.md → Simulator invariants), read as D24 reads it: the DLQ holds
// exactly the run's poisoned events. A run with nothing poisoned passes only on an empty DLQ.

export type Invariant4Result =
  | { pass: true; depth: number; line: string }
  | {
      pass: false;
      depth: number;
      poisoned: number;
      collected: number;
      stray: string[];
      line: string;
    };

// D24: the largest sample a DLQ inspect takes (SQS's receive ceiling), and how many samples to take
// before checking what was collected. A sample is a long poll that may return a subset (AWS-59), so a
// few are taken; ten of ten fit every poisoned set, which `--poison` caps at 10.
const sampleLimit = 10;
const maxSamples = 10;
// The fail line names at most this many stray ids, so a large leak stays one readable line.
const shownIds = 5;

// The envelope's `svixId` only. The payload is never parsed, so no address or subject is read
// (simulator.md → Invariant checkers). A body that is not an envelope adds no id.
const svixIdOf = (body: string): string | undefined => parseIngestEnvelope(body)?.svixId;

// Pure, so its pass and fail cases need no queue. Ids and counts only on the line.
export function checkInvariant4(
  depth: number,
  collected: ReadonlySet<string>,
  poisoned: ReadonlySet<string>,
): Invariant4Result {
  const stray = [...collected].filter((svixId) => !poisoned.has(svixId));
  const missing = [...poisoned].filter((svixId) => !collected.has(svixId));
  if (depth === poisoned.size && stray.length === 0 && missing.length === 0) {
    return {
      pass: true,
      depth,
      line: `invariant 4 pass (dlq holds exactly the ${depth} poisoned)`,
    };
  }
  return {
    pass: false,
    depth,
    poisoned: poisoned.size,
    collected: collected.size,
    stray,
    line: `invariant 4 fail depth=${depth} poisoned=${poisoned.size} collected=${collected.size} stray=${stray.slice(0, shownIds).join(',')}`,
  };
}

// D24: up to ten samples of ten, collecting distinct `svix_id`s, until the collected count equals the
// latest depth reading. The depth is approximate (AWS-62) and can under-read a message the long-poll
// receive already returns (AWS-59), so a count above the depth samples again, re-reading it, rather
// than checking one stale reading. Sampling never removes or hides a message (the port's contract, D1).
export async function invariant4(
  dlq: DlqPort,
  poisoned: ReadonlySet<string>,
): Promise<Invariant4Result> {
  const collected = new Set<string>();
  let depth = 0;
  for (let attempt = 0; attempt < maxSamples; attempt += 1) {
    const sample = await dlq.sample(sampleLimit);
    depth = sample.depth;
    for (const { body } of sample.messages) {
      const svixId = svixIdOf(body);
      if (svixId !== undefined) collected.add(svixId);
    }
    if (collected.size === depth) break;
  }
  return checkInvariant4(depth, collected, poisoned);
}
