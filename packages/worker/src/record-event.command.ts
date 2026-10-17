import {
  type EmailRecipientState,
  ingestEnvelopeSchema,
  maskAddress,
  normalizeAddress,
  projectEmail,
  projectRecipient,
  sanitizeForJsonb,
} from '@ledger/core';
import {
  type Database,
  type EmailRecipientRow,
  emailRecipientsRepository,
  emailStateRepository,
  recipientStateRepository,
  type Transaction,
  webhookEventsRepository,
} from '@ledger/db';
import { type ClockPort, LedgerError, type MetricsPort } from '@ledger/shared';
import { type LedgerRow, toLedgerRow } from './to-ledger-row.ts';

export type RecordEventDeps = {
  db: Database['db'];
  clock: ClockPort;
  metrics: MetricsPort;
  // D2: the 32-byte address-hash key the composition root decoded.
  addressHashKey: Uint8Array;
};

// One queue message: the envelope serialized as SQS holds it (D8).
export type RecordEventInput = { body: string };

// What the message's transaction committed.
export type RecordEventOutcome = 'projected' | 'duplicate' | 'unprojectable';

type ProjectableRow = Extract<LedgerRow, { projectable: true }>;

// ADR-004 orders recipient rows by `address_hash`, compared by code unit, never by a locale.
const compareCodeUnits = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

const toRecipientState = (row: EmailRecipientRow): EmailRecipientState => ({
  emailId: row.emailId,
  recipientKey: row.addressHash,
  addressMasked: row.addressMasked,
  status: row.status,
  statusAt: row.statusAt,
  bounceType: row.bounceType,
  bounceSubType: row.bounceSubType,
  stickySignal: row.stickySignal,
  stickySignalAt: row.stickySignalAt,
  stickySignalSvixId: row.stickySignalSvixId,
  softSignal: row.softSignal,
  softSignalAt: row.softSignalAt,
  softSignalSvixId: row.softSignalSvixId,
});

// D14: one transaction per message at READ COMMITTED (the Postgres default ADR-004 relies on): the
// ledger insert and every projection write commit together or not at all. No external call runs
// inside it, and the metrics are emitted after the commit, so a rolled-back attempt counts nothing.
export class RecordEventCommand {
  readonly #db: Database['db'];
  readonly #clock: ClockPort;
  readonly #metrics: MetricsPort;
  readonly #addressHashKey: Uint8Array;

  constructor({ db, clock, metrics, addressHashKey }: RecordEventDeps) {
    this.#db = db;
    this.#clock = clock;
    this.#metrics = metrics;
    this.#addressHashKey = addressHashKey;
  }

  async execute({ body }: RecordEventInput): Promise<RecordEventOutcome> {
    // Step 1: a body that is not an envelope, or a raw body that is not JSON, is a defect (ingest
    // verified it), so the message fails and is redelivered.
    const envelope = ingestEnvelopeSchema.parse(JSON.parse(body));
    const parsed: unknown = JSON.parse(envelope.rawBody);
    // Step 2: `jsonb` cannot store `\u0000` or a lone surrogate (D3).
    const { value: payload, sanitized } = sanitizeForJsonb(parsed);
    // D17.
    const ledgerRow = toLedgerRow(envelope, payload, this.#addressHashKey);

    const outcome = await this.#db.transaction(async (tx): Promise<RecordEventOutcome> => {
      // Step 3, ADR-004: the primary key dedupes; no row returned is a duplicate.
      if (!(await webhookEventsRepository.insertIfAbsent(tx, ledgerRow.row))) {
        return 'duplicate';
      }
      // Step 4: stored raw, never projected, never dead-listed (ADR-004).
      if (!ledgerRow.projectable) {
        return 'unprojectable';
      }
      await project(tx, ledgerRow);
      return 'projected';
    });

    // Step 9 and D16, after the commit.
    const svixId = envelope.svixId;
    const type = ledgerRow.row.type ?? undefined;
    if (outcome === 'duplicate') {
      this.#metrics.count('worker.duplicates', 1, { svix_id: svixId });
    } else {
      // Counted once per stored event: a redelivered copy is a duplicate, not a second sanitize.
      if (sanitized) {
        this.#metrics.count('worker.payload_sanitized', 1, { svix_id: svixId });
      }
      if (outcome === 'unprojectable') {
        this.#metrics.count('projection.unknown_event_type', 1, { svix_id: svixId, type });
      }
    }
    const lagMs = this.#clock.now().getTime() - new Date(envelope.receivedAt).getTime();
    this.#metrics.duration('worker.processing_lag', lagMs, { svix_id: svixId });
    return outcome;
  }
}

// D14 steps 5–8, under the email lock and then the recipient locks.
async function project(tx: Transaction, event: ProjectableRow): Promise<void> {
  const { emailId, eventCreatedAt } = event;

  // The new event's distinct recipients, sorted by code unit, each with the address its mask comes
  // from (the first position naming it, as `projectEmail` takes it).
  const addressByHash = new Map<string, string>();
  event.toHashes.forEach((hash, index) => {
    if (!addressByHash.has(hash)) {
      addressByHash.set(hash, event.to[index] ?? '');
    }
  });
  const hashes = [...addressByHash.keys()].sort(compareCodeUnits);
  const maskOf = (hash: string): string =>
    maskAddress(normalizeAddress(addressByHash.get(hash) ?? ''));

  // Step 5, ADR-004's lock order: the email row, then the new event's `recipient_state` rows, then
  // its `email_recipients` rows, each inserted if absent and then locked, the recipients in sorted
  // `address_hash` order (C9). The placeholders satisfy every NOT NULL and are overwritten below,
  // before commit, so no other transaction reads them.
  await emailStateRepository.createIfAbsent(tx, { emailId, lastEventAt: eventCreatedAt });
  await emailStateRepository.lockEmail(tx, emailId);
  await recipientStateRepository.createIfAbsent(
    tx,
    hashes.map((addressHash) => ({
      addressHash,
      addressMasked: maskOf(addressHash),
      deliverability: 'ok' as const,
    })),
  );
  await recipientStateRepository.lockRecipients(tx, hashes);
  await emailRecipientsRepository.createIfAbsent(
    tx,
    hashes.map((addressHash) => ({ emailId, addressHash, addressMasked: maskOf(addressHash) })),
  );
  await emailRecipientsRepository.lockRows(tx, emailId, hashes);

  // Step 6: the email's whole event set, read after the locks (ADR-003, ADR-004).
  const events = await webhookEventsRepository.loadForEmail(tx, emailId);

  // Step 7: a full recompute, never a patch.
  const state = projectEmail(emailId, events);
  if (state.lastEventAt === null) {
    // The new event is projectable and names this email, so the fold cannot be empty.
    throw new LedgerError('internal_error', 'The projection folded no event for a locked email.');
  }
  await emailStateRepository.update(tx, emailId, {
    status: state.status,
    fromMasked: state.fromMasked,
    subjectMasked: state.subjectMasked,
    openCount: state.openCount,
    clickCount: state.clickCount,
    firstOpenedAt: state.firstOpenedAt,
    firstClickedAt: state.firstClickedAt,
    lastEventAt: state.lastEventAt,
    eventCount: state.eventCount,
  });
  // Rows the new event did not name: inserted if absent, then locked, in sorted order (C9). Under
  // the email lock no other transaction writes this email's rows.
  const locked = new Set(hashes);
  const others = state.recipients.filter((row) => !locked.has(row.recipientKey));
  await emailRecipientsRepository.createIfAbsent(
    tx,
    others.map((row) => ({
      emailId,
      addressHash: row.recipientKey,
      addressMasked: row.addressMasked,
    })),
  );
  await emailRecipientsRepository.lockRows(
    tx,
    emailId,
    others.map((row) => row.recipientKey),
  );
  for (const row of state.recipients) {
    await emailRecipientsRepository.update(tx, emailId, row.recipientKey, {
      addressMasked: row.addressMasked,
      status: row.status,
      statusAt: row.statusAt,
      bounceType: row.bounceType,
      bounceSubType: row.bounceSubType,
      stickySignal: row.stickySignal,
      stickySignalAt: row.stickySignalAt,
      stickySignalSvixId: row.stickySignalSvixId,
      softSignal: row.softSignal,
      softSignalAt: row.softSignalAt,
      softSignalSvixId: row.softSignalSvixId,
    });
  }

  // Step 8, RS-27: only the new event's recipients are recomputed, each from every
  // `email_recipients` row for its hash.
  for (const addressHash of hashes) {
    const rows = await emailRecipientsRepository.listByAddressHash(tx, addressHash);
    const recipient = projectRecipient(addressHash, rows.map(toRecipientState));
    await recipientStateRepository.update(tx, addressHash, {
      addressMasked: recipient.addressMasked,
      deliverability: recipient.deliverability,
      since: recipient.since,
      causeEmailId: recipient.causeEmailId,
    });
  }
}
