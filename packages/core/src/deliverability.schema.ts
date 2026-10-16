import { z } from 'zod';

// D2: `recipient_state.deliverability`. `hard_bounced`, `complained` and `suppressed` are sticky;
// `soft_bouncing` clears to `ok` on a later delivery (D6). Slice 1's `CHECK` mirrors this set.
export const deliverabilitySchema = z.enum([
  'ok',
  'soft_bouncing',
  'hard_bounced',
  'complained',
  'suppressed',
]);

export type Deliverability = z.infer<typeof deliverabilitySchema>;
