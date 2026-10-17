import { z } from 'zod';

// D4 (C3): the strongest sticky signal of an email-recipient row, ranked `hard_bounced` >
// `suppressed` > `complained` (D1). `projectRecipient` reads it instead of the row's `status`,
// which is not sticky-monotone (D5).
export const stickySignalSchema = z.enum(['hard_bounced', 'suppressed', 'complained']);

export type StickySignal = z.infer<typeof stickySignalSchema>;

// D1: sticky precedence, `hard_bounced` > `suppressed` > `complained`. One table for both
// projections: `projectEmail` keeps a row's strongest signal by it and `projectRecipient` picks
// across rows by it, so the two can never rank differently.
export const stickyPrecedence: Readonly<Record<StickySignal, number>> = {
  complained: 0,
  suppressed: 1,
  hard_bounced: 2,
};
