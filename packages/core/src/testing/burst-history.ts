import type { LedgerEvent } from '../ledger-event.ts';
import { normalizeAddress } from '../normalize-address.ts';
import { baseInstant, testLocalParts } from './email-history.ts';
import type { LedgerHistory } from './ledger-history.ts';
import { testAddressSequences } from './test-address-sequences.ts';

// D25 step 5: the history `pnpm sim --burst` sends. Broadcast-shaped: one email per recipient, every
// recipient distinct (about.md → Platform scale assumptions), cycling over the RS-39 test addresses
// as `<local>+<namespace>-b<i>@resend.dev` (RS-32), each email replaying its address's observed
// sequence one second apart. The last email takes a prefix of its sequence, so the history holds
// exactly `events` events. The seed picks where the cycle starts; the rest is fixed by the
// sequences, so a seed and a namespace always give the same history.

export type BurstHistoryOptions = {
  // The run's seed, a uint32.
  seed: number;
  // Prefix of every id and `+label`, so two runs never share an email, `svix_id` or recipient.
  namespace: string;
  // How many events the history holds, 1 to 10,000 (`--burst`'s range).
  events: number;
};

export function burstHistory(options: BurstHistoryOptions): LedgerHistory {
  const { seed, namespace, events } = options;
  const start = seed % testLocalParts.length;
  // RS-27: every email of one broadcast carries its `broadcast_id`; projections never read it.
  const broadcastId = `${namespace}-broadcast`;
  const emails: LedgerHistory['emails'] = [];
  let total = 0;
  for (let index = 0; total < events; index += 1) {
    const local = testLocalParts[(start + index) % testLocalParts.length] ?? 'delivered';
    const sequence = testAddressSequences[local].slice(0, events - total);
    // Only a non-integer `events` leaves less than one event to take; stop rather than spin.
    if (sequence.length === 0) {
      break;
    }
    const emailId = `${namespace}-burst-${index}`;
    const to = [`${local}+${namespace}-b${index}@resend.dev`];
    emails.push({
      emailId,
      events: sequence.map(({ type, bounce }, counter): LedgerEvent => {
        const createdAt = new Date(baseInstant + counter * 1000);
        return {
          svixId: `${namespace}-svix-burst-${index}-${counter}`,
          type,
          eventCreatedAt: createdAt,
          recipientKeys: to.map(normalizeAddress),
          payload: {
            type,
            created_at: createdAt.toISOString(),
            data: {
              email_id: emailId,
              to,
              from: 'onboarding@resend.dev',
              subject: 'Ledger burst',
              broadcast_id: broadcastId,
              ...(bounce === undefined ? {} : { bounce: { ...bounce } }),
            },
          },
        };
      }),
    });
    total += sequence.length;
  }
  return { emails };
}
