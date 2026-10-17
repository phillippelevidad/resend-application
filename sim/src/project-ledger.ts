import {
  type EmailRecipientState,
  type EmailState,
  type LedgerEvent,
  projectEmail,
  projectRecipient,
  type RecipientState,
} from '@ledger/core';
import type { ArrangedEvent } from './arrange-events.ts';

// D16: masks only. `recipientKey` is the normalized address in slice 0, so it is left out
// everywhere (data-modeling → PII & retention).
export type PrintedRecipientRow = Omit<EmailRecipientState, 'recipientKey'>;

export type PrintedEmailState = Omit<EmailState, 'recipients'> & {
  recipients: PrintedRecipientRow[];
};

export type PrintedRecipientState = Omit<RecipientState, 'recipientKey'>;

export type LedgerProjection = {
  emails: PrintedEmailState[];
  recipients: PrintedRecipientState[];
};

// By code unit, so the order never depends on a locale.
function compareCodeUnits(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function withoutKey({ recipientKey: _recipientKey, ...row }: EmailRecipientState) {
  return row;
}

// D16: `projectEmail` per email, then `projectRecipient` per recipient key over every email's rows.
// Emails are sorted by `emailId` and recipients by recipient key, so the printed document depends on
// the event set only, never on the order the events arrived in (ADR-003).
export function projectLedger(
  emailIds: readonly string[],
  events: readonly ArrangedEvent[],
): LedgerProjection {
  // One pass to group, in arrival order, instead of one filter over every event per email.
  const byEmail = new Map<string, LedgerEvent[]>();
  for (const { emailId, event } of events) {
    const group = byEmail.get(emailId);
    if (group === undefined) {
      byEmail.set(emailId, [event]);
    } else {
      group.push(event);
    }
  }
  const states = [...emailIds]
    .sort(compareCodeUnits)
    .map((emailId) => projectEmail(emailId, byEmail.get(emailId) ?? []));
  const rows = states.flatMap((state) => state.recipients);
  const keys = [...new Set(rows.map((row) => row.recipientKey))].sort(compareCodeUnits);
  return {
    emails: states.map((state) => ({ ...state, recipients: state.recipients.map(withoutKey) })),
    recipients: keys.map((key) => {
      const { recipientKey: _recipientKey, ...state } = projectRecipient(key, rows);
      return state;
    }),
  };
}
