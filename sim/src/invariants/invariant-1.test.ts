import type { LedgerEvent } from '@ledger/core';
import type { LedgerHistory } from '@ledger/core/testing';
import { describe, expect, it } from 'vitest';
import { checkInvariant1, generatedSvixIds } from './invariant-1.ts';

const at = new Date('2026-10-17T12:00:00.000Z');

// Invariant 1 reads `svix_id`s only, so the payload is the smallest well-formed one.
function sent(emailId: string, svixId: string): LedgerEvent {
  const to = ['delivered+walk-0@resend.dev'];
  return {
    svixId,
    type: 'email.sent',
    eventCreatedAt: at,
    recipientKeys: to,
    payload: { type: 'email.sent', created_at: at.toISOString(), data: { email_id: emailId, to } },
  };
}

function history(eventsPerEmail: number): LedgerHistory {
  return {
    emails: ['walk-email-0', 'walk-email-1'].map((emailId, index) => ({
      emailId,
      events: Array.from({ length: eventsPerEmail }, (_, counter) =>
        sent(emailId, `walk-svix-${index}-${counter}`),
      ),
    })),
  };
}

describe('invariant 1: every generated event stored exactly once', () => {
  it('passes with stored=<n>/<n> when the ledger holds every generated svix_id', () => {
    const generated = generatedSvixIds(history(2));

    const result = checkInvariant1(generated, new Set(generated));

    expect(result.pass).toBe(true);
    expect(result.line).toBe('invariant 1 pass stored=4/4');
  });

  it('fails naming the lost svix_id when the ledger rows lack one', () => {
    const generated = generatedSvixIds(history(2));
    const stored = new Set(generated.filter((svixId) => svixId !== 'walk-svix-1-0'));

    const result = checkInvariant1(generated, stored);

    expect(result.pass).toBe(false);
    expect(result.line).toBe('invariant 1 fail missing=1 svix_ids=walk-svix-1-0');
  });

  it('counts every lost event but names at most five, so a large loss stays one line', () => {
    const generated = generatedSvixIds(history(4));

    const result = checkInvariant1(generated, new Set(['walk-svix-0-0']));

    expect(result.pass).toBe(false);
    expect(result.line).toBe(
      'invariant 1 fail missing=7 svix_ids=walk-svix-0-1,walk-svix-0-2,walk-svix-0-3,walk-svix-1-0,walk-svix-1-1',
    );
  });

  // A redelivery is the same stored event again (ADR-004): it adds no truth to check.
  it('takes each svix_id once from the history, so a repeated event is not counted twice', () => {
    const base = history(1);
    const [first] = base.emails;
    const repeated: LedgerHistory = {
      emails: first === undefined ? [] : [{ ...first, events: [...first.events, ...first.events] }],
    };

    expect(generatedSvixIds(repeated)).toEqual(['walk-svix-0-0']);
  });
});
