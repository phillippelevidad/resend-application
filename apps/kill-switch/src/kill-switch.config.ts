import { killSwitchEnv } from '@ledger/shared';
import { z } from 'zod';

// D2, D32: the kill switch's boot assertion, parsed once by `main.ts` through `loadConfig` at module
// scope. Its keys are `killSwitchEnv`'s, the object `infra` sets them from, so the two sides cannot
// drift. A failure names the variable, never its value (pp-general → config-and-env).
export const killSwitchConfigSchema = z
  .object({
    // The app stack's name, from which every target's physical name derives (D27, D29).
    [killSwitchEnv.APP_STACK_NAME]: z
      .string({ error: 'must be set' })
      .min(1, { error: 'must be set' }),
    // Where the trip's report is published (D29 step 4).
    [killSwitchEnv.ALERT_TOPIC_ARN]: z
      .string({ error: 'must be set' })
      .min(1, { error: 'must be set' }),
  })
  .transform((env) => ({
    appStackName: env[killSwitchEnv.APP_STACK_NAME],
    alertTopicArn: env[killSwitchEnv.ALERT_TOPIC_ARN],
  }));

export type KillSwitchConfig = z.output<typeof killSwitchConfigSchema>;
