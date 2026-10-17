import {
  compareCodeUnits,
  type EmailRecipientState,
  type EmailState,
  projectEmail,
  projectRecipient,
  type RecipientState,
} from '@ledger/core';
import type { LedgerHistory } from '@ledger/core/testing';
import {
  type EmailRecipientRow,
  type EmailStateRow,
  type Executor,
  emailRecipientsRepository,
  emailStateRepository,
  type RecipientStateRow,
  recipientStateRepository,
} from '@ledger/db';
import { asStoredEvent } from '../as-stored-event.ts';

// Simulator invariant 2 (architecture.md → Simulator invariants): every `email_state`,
// `email_recipients` and `recipient_state` row of the run equals `projectEmail` /
// `projectRecipient` of the ground truth. The rows are compared column for column as the worker
// writes them (D14), so a wrong mask, status, timestamp, count, signal or cause fails it.

// The ground truth's projection, keyed as the ledger keys it: by the keyed address hash (D1).
export type ExpectedLedger = {
  emails: EmailState[];
  recipients: RecipientState[];
};

// What the ledger holds for the run's emails. The database's own `created_at` / `updated_at` are no
// projection's output, so they are left out, and a row read through `packages/db` fits as is.
export type StoredLedger = {
  emailStates: readonly Omit<EmailStateRow, 'createdAt' | 'updatedAt'>[];
  emailRecipients: readonly Omit<EmailRecipientRow, 'createdAt' | 'updatedAt'>[];
  recipientStates: readonly Omit<RecipientStateRow, 'createdAt' | 'updatedAt'>[];
};

export type Invariant2Result =
  | { pass: true; emails: number; recipients: number; line: string }
  | { pass: false; emailIds: string[]; line: string };

// D37: the ground truth projected as the ledger would, every email and every recipient it names.
// A duplicate adds no truth, so the history's distinct events are the whole input.
export function expectedLedger(history: LedgerHistory, addressHashKey: Uint8Array): ExpectedLedger {
  const emails = history.emails.map(({ emailId, events }) =>
    projectEmail(
      emailId,
      events.map((event) => asStoredEvent(event, addressHashKey)),
    ),
  );
  const rows = emails.flatMap(({ recipients }) => recipients);
  const keys = [...new Set(rows.map(({ recipientKey }) => recipientKey))].sort(compareCodeUnits);
  return { emails, recipients: keys.map((key) => projectRecipient(key, rows)) };
}

// Timestamps by instant (`timestamptz` reads back a new `Date`), everything else by value.
function sameValue(a: unknown, b: unknown): boolean {
  if (a instanceof Date && b instanceof Date) {
    return a.getTime() === b.getTime();
  }
  return a === b;
}

function sameColumns<T extends object>(expected: T, stored: T, columns: readonly (keyof T)[]) {
  return columns.every((column) => sameValue(expected[column], stored[column]));
}

const emailColumns = [
  'status',
  'fromMasked',
  'subjectMasked',
  'openCount',
  'clickCount',
  'firstOpenedAt',
  'firstClickedAt',
  'lastEventAt',
  'eventCount',
] as const satisfies readonly (keyof EmailState & keyof EmailStateRow)[];

const recipientRowColumns = [
  'addressMasked',
  'status',
  'statusAt',
  'bounceType',
  'bounceSubType',
  'stickySignal',
  'stickySignalAt',
  'stickySignalSvixId',
  'softSignal',
  'softSignalAt',
  'softSignalSvixId',
] as const satisfies readonly (keyof EmailRecipientState & keyof EmailRecipientRow)[];

const recipientStateColumns = [
  'addressMasked',
  'deliverability',
  'since',
  'causeEmailId',
] as const satisfies readonly (keyof RecipientState & keyof RecipientStateRow)[];

type StoredEmailState = StoredLedger['emailStates'][number];
type StoredRecipientRow = StoredLedger['emailRecipients'][number];

// D37: an email with no projectable event has no `email_state` row (the worker writes one only
// under a projectable event's lock, D14 step 4), and that counts as equal.
function emailStateEqual(expected: EmailState, stored: StoredEmailState | undefined): boolean {
  if (stored === undefined) {
    return expected.eventCount === 0;
  }
  return sameColumns<Pick<EmailState, (typeof emailColumns)[number]>>(
    expected,
    stored,
    emailColumns,
  );
}

// The email's recipient rows: the same set of hashes, and each row equal column for column.
function recipientRowsEqual(
  expected: readonly EmailRecipientState[],
  stored: readonly StoredRecipientRow[],
): boolean {
  if (expected.length !== stored.length) {
    return false;
  }
  const byHash = new Map(stored.map((row) => [row.addressHash, row]));
  return expected.every((row) => {
    const match = byHash.get(row.recipientKey);
    return (
      match !== undefined &&
      sameColumns<Pick<EmailRecipientState, (typeof recipientRowColumns)[number]>>(
        row,
        match,
        recipientRowColumns,
      )
    );
  });
}

// Pure, so its pass and fail cases need no database. A differing `recipient_state` row is reported
// by the emails that name the recipient: the fail line carries ids only, never a hash or an address
// (simulator.md → Invariant checkers; the simulator spec: no keyed hash in stdout).
export function checkInvariant2(expected: ExpectedLedger, stored: StoredLedger): Invariant2Result {
  const failed = new Set<string>();
  const states = new Map(stored.emailStates.map((row) => [row.emailId, row]));
  const storedRows = (emailId: string) =>
    stored.emailRecipients.filter((row) => row.emailId === emailId);

  for (const email of expected.emails) {
    const equal =
      emailStateEqual(email, states.get(email.emailId)) &&
      recipientRowsEqual(email.recipients, storedRows(email.emailId));
    if (!equal) {
      failed.add(email.emailId);
    }
  }

  // Every hash a row of either side names, so a stored recipient the truth lacks is compared too.
  const namingEmails = new Map<string, Set<string>>();
  const name = (hash: string, emailId: string) => {
    const emails = namingEmails.get(hash) ?? new Set<string>();
    emails.add(emailId);
    namingEmails.set(hash, emails);
  };
  for (const { emailId, recipients } of expected.emails) {
    for (const { recipientKey } of recipients) {
      name(recipientKey, emailId);
    }
  }
  for (const { emailId, addressHash } of stored.emailRecipients) {
    name(addressHash, emailId);
  }
  const expectedStates = new Map(expected.recipients.map((state) => [state.recipientKey, state]));
  const storedStates = new Map(stored.recipientStates.map((row) => [row.addressHash, row]));
  for (const [hash, emailIds] of namingEmails) {
    const want = expectedStates.get(hash);
    const have = storedStates.get(hash);
    const equal =
      want !== undefined &&
      have !== undefined &&
      sameColumns<Pick<RecipientState, (typeof recipientStateColumns)[number]>>(
        want,
        have,
        recipientStateColumns,
      );
    if (!equal) {
      for (const emailId of emailIds) {
        failed.add(emailId);
      }
    }
  }

  if (failed.size === 0) {
    const emails = expected.emails.length;
    const recipients = expected.recipients.length;
    return {
      pass: true,
      emails,
      recipients,
      line: `invariant 2 pass emails=${emails} recipients=${recipients}`,
    };
  }
  const emailIds = [...failed].sort(compareCodeUnits);
  return { pass: false, emailIds, line: `invariant 2 fail email_ids=${emailIds.join(',')}` };
}

// D37: the run's rows, read through `packages/db` (simulator.md → Invariant checkers), then compared.
// `recipient_state` is read for every hash either side names.
export async function invariant2(
  db: Executor,
  history: LedgerHistory,
  addressHashKey: Uint8Array,
): Promise<Invariant2Result> {
  const expected = expectedLedger(history, addressHashKey);
  const emailIds = expected.emails.map(({ emailId }) => emailId);
  const emailStates = await emailStateRepository.listByEmailIds(db, emailIds);
  const emailRecipients: EmailRecipientRow[] = [];
  for (const emailId of emailIds) {
    emailRecipients.push(...(await emailRecipientsRepository.listByEmail(db, emailId)));
  }
  const hashes = new Set([
    ...expected.recipients.map(({ recipientKey }) => recipientKey),
    ...emailRecipients.map(({ addressHash }) => addressHash),
  ]);
  const recipientStates = await recipientStateRepository.listByAddressHashes(db, [...hashes]);
  return checkInvariant2(expected, { emailStates, emailRecipients, recipientStates });
}
