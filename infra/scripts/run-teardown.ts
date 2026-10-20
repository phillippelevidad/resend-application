import { parseArgs } from 'node:util';
import type { PostDestroyListing } from '@ledger/aws';
import { APP_STACK_NAME, GUARDRAILS_STACK_NAME } from './ledger-stacks.ts';
import { createScriptOutput, type ScriptSink } from './script-output.ts';

// `pnpm aws:teardown [--discard-queued]` (D34, aws.md → Teardown): refuse while events are queued,
// destroy the app stack, then the guardrails stack only when that succeeded, then list what is
// left. Steps are injected, so the refusal and the order are unit-tested (run-teardown.test.ts);
// teardown.ts composes the real ones. Never automatic and never part of the kill switch.

// Visible and in-flight messages in the source queue and the DLQ (`QueueSnapshot`'s counts).
export type QueueDepths = {
  visible: number;
  inFlight: number;
  dlqVisible: number;
  dlqInFlight: number;
};

export type TeardownSteps = {
  // `undefined` when no app stack exists, so no queue does either.
  readQueueDepths(): Promise<QueueDepths | undefined>;
  destroyStack(stackName: string): Promise<void>;
  listLeftovers(): Promise<PostDestroyListing>;
};

export type RunTeardownOptions = {
  argv: readonly string[];
  steps: TeardownSteps;
  sink: ScriptSink;
};

const SCRIPT = 'aws:teardown';

// features.md → Adopter lifecycle: what teardown cannot do for the owner. Slice 4 D30: a destroyed
// secret does not revoke the reconciler's key at Resend, and a full_access key can read every signing
// secret (RS-05, RS-18).
export const OUTSIDE_AWS_STEPS = [
  'outside AWS: delete the Resend webhook that points at the ingest URL (dashboard, or DELETE /webhooks/{id})',
  'outside AWS: revoke the Resend API key you made for the reconciler (dashboard, or DELETE /api-keys/{id})',
  'outside AWS, optional: delete the Neon project (recoverable for 7 days)',
] as const;

export async function runTeardown({ argv, steps, sink }: RunTeardownOptions): Promise<0 | 1> {
  const out = createScriptOutput(SCRIPT, sink);

  let discardQueued: boolean;
  try {
    const { values } = parseArgs({
      args: [...argv],
      options: { 'discard-queued': { type: 'boolean' } },
      strict: true,
      allowPositionals: false,
    });
    discardQueued = values['discard-queued'] === true;
  } catch {
    return out.refused('usage: pnpm aws:teardown [--discard-queued]');
  }

  // A queued event is not in `webhook_events` yet: destroying its queue loses it.
  let depths: QueueDepths | undefined;
  try {
    depths = await steps.readQueueDepths();
  } catch {
    return out.failed('reading the queue depths failed');
  }
  if (depths === undefined) {
    out.line('no app stack is deployed, so no queue holds an event');
  } else {
    out.line(
      `queue ${depths.visible} visible, ${depths.inFlight} in flight; dlq ${depths.dlqVisible} visible, ${depths.dlqInFlight} in flight`,
    );
    const queued = depths.visible + depths.inFlight + depths.dlqVisible + depths.dlqInFlight;
    if (queued > 0) {
      if (!discardQueued) {
        return out.refused(
          'the source queue or the DLQ holds messages that are not in webhook_events yet; let the worker drain them, or pass --discard-queued to lose them',
        );
      }
      out.line('--discard-queued: the queued messages are destroyed with their queues');
    }
  }

  // The stacks declare no dependency, so the order is enforced here: a failed app destroy keeps
  // the guardrails stack, whose budget alarms still watch what remains (aws.md → Budget alarms
  // item 1).
  for (const stackName of [APP_STACK_NAME, GUARDRAILS_STACK_NAME]) {
    out.line(`destroying ${stackName}`);
    try {
      await steps.destroyStack(stackName);
    } catch {
      return out.failed(
        stackName === APP_STACK_NAME
          ? `cdk destroy ${stackName} failed; ${GUARDRAILS_STACK_NAME} is kept`
          : `cdk destroy ${stackName} failed`,
      );
    }
  }

  let listing: PostDestroyListing | undefined;
  try {
    listing = await steps.listLeftovers();
  } catch {
    listing = undefined;
  }
  if (listing !== undefined) {
    for (const leftover of listing.leftovers) {
      out.line(`leftover ${leftover.service} ${leftover.resource}`);
    }
    out.line(`${listing.pendingDeletion} secret(s) pending deletion, not billed (AWS-11)`);
  }
  for (const outside of OUTSIDE_AWS_STEPS) out.line(outside);

  if (listing === undefined) return out.failed('the post-destroy listing failed');
  if (listing.leftovers.length > 0) {
    return out.failed(
      'billable resources remain; delete each leftover listed, or rerun in a few minutes if the tagging index lags',
    );
  }
  return out.done();
}
