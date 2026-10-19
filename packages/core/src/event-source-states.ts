import { z } from 'zod';

// D4: the worker event source as `health.get` and `worker.resumeEventSource` report it (ADR-015).
export const eventSourceStates = ['enabled', 'paused', 'changing'] as const;

export const eventSourceStateSchema = z.enum(eventSourceStates);

export type EventSourceState = z.infer<typeof eventSourceStateSchema>;

// D17: the event the worker answers with its `resume()`. One definition for its three users: the
// hourly schedule's input (infra), the read API's invoke payload and the worker handler's match, so
// none can drift from the others and silently stop the resume.
export const RESUME_EVENT = { ledger: 'resume-event-source' } as const;

// D16: what the resume answers, the read API's `worker.resumeEventSource` included (D20).
export const resumeOutcomes = ['resumed', 'already_enabled', 'probe_failed'] as const;

export type ResumeOutcome = (typeof resumeOutcomes)[number];

// D4, AWS-18: the event source mapping's `State` string. Only `Enabled` polls and only `Disabled` is
// settled off; every transitional value (`Creating`, `Enabling`, `Disabling`, `Updating`) and an
// absent one read `changing`. Takes a plain string, so core stays free of the AWS SDK (ADR-013).
export const eventSourceStateFromLambda = (lambdaState: string | undefined): EventSourceState => {
  if (lambdaState === 'Enabled') return 'enabled';
  if (lambdaState === 'Disabled') return 'paused';
  return 'changing';
};
