import type { Command } from '@commander-js/extra-typings';
import type { Email } from '@ledger/sdk';
import { printable } from '../create-output.ts';
import type { CliDeps } from '../create-program.ts';
import { runOperation } from '../run-operation.ts';

// `email.get` → `ledger email <email_id> [--json]` (api-contract → email.get). No argParser and no
// CLI-side validation: the API answers validation_failed (D28).
export function emailGetCli(parent: Command, deps: CliDeps): void {
  parent
    .command('email')
    .description("show an email's projected state, its recipients and its event timeline")
    .argument('<email_id>', 'the Resend email id')
    .option('--json', 'print the result or the error object as JSON')
    .action(async (emailId, options) => {
      await runOperation(deps, options, (client) => client.emails.get(emailId), renderEmail);
    });
}

const COLUMN_GAP = '   ';
const LABEL_WIDTH = 12;
const EMPTY_SECTION = '  —';

// Space-padded columns, each as wide as its widest cell plus the gap; the last cell is not padded,
// so no line ends in spaces.
function columns(rows: readonly (readonly string[])[]): string[] {
  const widths: number[] = [];
  for (const row of rows) {
    row.forEach((cell, index) => {
      widths[index] = Math.max(widths[index] ?? 0, cell.length);
    });
  }
  return rows.map((row) =>
    `  ${row.map((cell, index) => (index < row.length - 1 ? cell.padEnd(widths[index] ?? 0) : cell)).join(COLUMN_GAP)}`.trimEnd(),
  );
}

const field = (label: string, value: string): string => `${label.padEnd(LABEL_WIDTH)}${value}`;

// A missing bounce pair prints nothing (D34).
function bouncePair(type: string | null, subType: string | null): string[] {
  if (type === null && subType === null) return [];
  return [`${printable(type)} / ${printable(subType)}`];
}

// `0`, or `<n>, first <timestamp>` when non-zero.
const counter = (count: number, firstAt: string | null): string =>
  count === 0 ? '0' : `${count}, first ${printable(firstAt)}`;

function section(title: string, lines: string[]): string[] {
  return ['', title, ...(lines.length > 0 ? lines : [EMPTY_SECTION])];
}

// D34 and design.md → Surfaces: every value passes through printable; masks only.
export function renderEmail(email: Email): string {
  const recipients = columns(
    email.recipients.map((recipient) => [
      printable(recipient.address_masked),
      printable(recipient.status),
      printable(recipient.status_at),
      ...bouncePair(recipient.bounce_type, recipient.bounce_sub_type),
    ]),
  );
  const timeline = columns(
    email.timeline.map((event) => [
      printable(event.event_created_at),
      printable(event.type),
      printable(event.svix_id),
      ...bouncePair(event.bounce_type, event.bounce_sub_type),
    ]),
  );
  return [
    field('email', printable(email.email_id)),
    field('status', printable(email.status)),
    field('from', printable(email.from_masked)),
    field('subject', printable(email.subject_masked)),
    field('events', `${email.event_count}, last ${printable(email.last_event_at)}`),
    field('opens', counter(email.open_count, email.first_opened_at)),
    field('clicks', counter(email.click_count, email.first_clicked_at)),
    ...section('recipients', recipients),
    ...section('timeline', timeline),
  ].join('\n');
}
