import { describe, expect, it } from 'vitest';
import { emailEventTypes } from './email-event-types.ts';
import { eventRank } from './event-rank.ts';

describe('eventRank', () => {
  // D1, owner-ruled 2026-10-16. A change here changes every stored projection (a rebuild).
  it('pins the owner-ruled order, so a reordering fails here before it changes any projection', () => {
    expect(
      [
        'email.scheduled',
        'email.sent',
        'email.delivery_delayed',
        'email.delivered',
        'email.opened',
        'email.clicked',
        'email.complained',
        'email.suppressed',
        'email.failed',
        'email.bounced',
      ].map(eventRank),
    ).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it('ranks every outbound type below any other type, so the tie-break is total', () => {
    for (const type of emailEventTypes) {
      expect(eventRank(type)).toBeLessThan(10);
    }
    for (const type of ['email.received', 'contact.created', 'email.unknown', 'toString', '']) {
      expect(eventRank(type)).toBe(10);
    }
  });
});
