import { errorRegistry } from '@ledger/core';
import {
  type EmailRecipientRow,
  type EmailStateRow,
  type Executor,
  emailRecipientsRepository,
  emailStateRepository,
  type TimelineRow,
  webhookEventsRepository,
} from '@ledger/db';
import { LedgerError } from '@ledger/shared';

export type GetEmailInput = { emailId: string };

// The read shape `emailResponseMapper` turns into the wire object. It still holds the stored
// payloads and recipient rows, so only the mapper decides what leaves (pp-backend → Mappers).
export type EmailRead = {
  emailId: string;
  // Absent when every stored event of the email was unprojectable (ADR-004).
  state: EmailStateRow | undefined;
  recipients: EmailRecipientRow[];
  timeline: TimelineRow[];
};

// `email.get` (api-contract.md): the projection rows plus every ledger row of the email. Reads only;
// the state is the worker's projection, never recomputed here (pp-backend → Commands and readers).
export class GetEmailReader {
  readonly #db: Executor;

  constructor(db: Executor) {
    this.#db = db;
  }

  async execute(input: GetEmailInput): Promise<EmailRead> {
    // One snapshot for the three reads: a worker commit between them would otherwise answer a
    // timeline of n events beside the state of n + 1. REPEATABLE READ takes the snapshot at the
    // first statement; transaction-scoped, so pooler-safe (integrations.md → Decision — Neon).
    return this.#db.transaction(
      async (tx) => {
        const timeline = await webhookEventsRepository.listTimeline(tx, input.emailId);
        // The ledger is the truth: no row with this `email_id` means no event was recorded for it.
        if (timeline.length === 0) {
          throw new LedgerError('email_not_found', errorRegistry.email_not_found.message);
        }
        const state = await emailStateRepository.get(tx, input.emailId);
        const recipients = await emailRecipientsRepository.listByEmail(tx, input.emailId);
        return { emailId: input.emailId, state, recipients, timeline };
      },
      { isolationLevel: 'repeatable read', accessMode: 'read only' },
    );
  }
}
