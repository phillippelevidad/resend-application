import { z } from 'zod';

// D27: both required from slice 1, so no client changes when the API starts enforcing tokens. The
// token comes only from the environment, never a flag (Conventions → Client configuration). The
// output is the SDK's config, so main.ts passes it straight to createLedgerClient.
export const cliConfig = z
  .object({
    LEDGER_URL: z.url({ protocol: /^https?$/ }),
    LEDGER_TOKEN: z.string().min(1),
  })
  .transform((env) => ({ baseUrl: env.LEDGER_URL, token: env.LEDGER_TOKEN }));
