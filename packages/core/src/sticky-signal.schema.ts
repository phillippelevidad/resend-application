import { z } from 'zod';

// D4 (C3): the strongest sticky signal of an email-recipient row, ranked `hard_bounced` >
// `suppressed` > `complained` (D1). `projectRecipient` reads it instead of the row's `status`,
// which is not sticky-monotone (D5).
export const stickySignalSchema = z.enum(['hard_bounced', 'suppressed', 'complained']);

export type StickySignal = z.infer<typeof stickySignalSchema>;
