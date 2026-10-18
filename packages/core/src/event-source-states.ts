import { z } from 'zod';

// D4: the worker event source as `health.get` and `worker.resumeEventSource` report it (ADR-015).
export const eventSourceStates = ['enabled', 'paused', 'changing'] as const;

export const eventSourceStateSchema = z.enum(eventSourceStates);

export type EventSourceState = z.infer<typeof eventSourceStateSchema>;

// D4, AWS-18: the event source mapping's `State` string. Only `Enabled` polls and only `Disabled` is
// settled off; every transitional value (`Creating`, `Enabling`, `Disabling`, `Updating`) and an
// absent one read `changing`. Takes a plain string, so core stays free of the AWS SDK (ADR-013).
export const eventSourceStateFromLambda = (lambdaState: string | undefined): EventSourceState => {
  if (lambdaState === 'Enabled') return 'enabled';
  if (lambdaState === 'Disabled') return 'paused';
  return 'changing';
};
