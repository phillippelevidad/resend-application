import { z } from 'zod';

// D2: the outcome-bearing email types of RS-25, listed low to high precedence (D1, owner-ruled
// 2026-10-16). `opened` and `clicked` are counters, never a status; status is null until the
// event set holds an outcome (C9). Slice 1's `CHECK` mirrors this set.
export const emailStatusSchema = z.enum([
  'scheduled',
  'sent',
  'delivery_delayed',
  'delivered',
  'complained',
  'suppressed',
  'failed',
  'bounced',
]);

export type EmailStatus = z.infer<typeof emailStatusSchema>;
