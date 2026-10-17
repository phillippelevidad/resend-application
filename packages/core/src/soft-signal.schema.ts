import { z } from 'zod';

// D4 (C3): the latest delivery or non-`Permanent` bounce of an email-recipient row (D7), so a
// soft bounce can clear on a later delivery (D6).
export const softSignalSchema = z.enum(['delivered', 'bounced']);

export type SoftSignal = z.infer<typeof softSignalSchema>;
