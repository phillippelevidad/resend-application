// Slice 4 D20, D21: the reconciler Lambda's event adaptation over a recording reconciler, and the
// composition's not-configured decision, with no AWS client and no environment.
import { RECONCILE_SCHEDULED_EVENT } from '@ledger/core';
import type { Reconciler } from '@ledger/reconciler';
import { LedgerError, type LogFields } from '@ledger/shared';
import { describe, expect, it } from 'vitest';
import { createReconcilerHandler, type InvocationFields } from './create-reconciler-handler.ts';
import { reconcilerConfigSchema, resendConfiguration } from './reconciler.config.ts';

function setup(fail?: Error) {
  const calls: string[] = [];
  const reconciler: Reconciler = {
    runScheduled: async () => {
      calls.push('runScheduled');
      if (fail) throw fail;
      return undefined;
    },
    runClaimed: async (runId) => {
      calls.push(`runClaimed:${runId}`);
      if (fail) throw fail;
      return undefined;
    },
  };
  const lines: { message: string; fields: LogFields | undefined }[] = [];
  const log = (message: string, fields?: LogFields) => lines.push({ message, fields });
  const invocation: InvocationFields = { request_id: undefined, cold_start: true };
  const handler = createReconcilerHandler({
    reconciler,
    logger: { info: log, warn: log, error: log },
    invocation,
  });
  return { calls, lines, invocation, handler };
}

const context = { awsRequestId: 'req-1' };

describe('createReconcilerHandler', () => {
  it('routes the hourly schedule event to runScheduled', async () => {
    const { calls, handler, invocation } = setup();

    await handler(RECONCILE_SCHEDULED_EVENT, context);

    expect(calls).toEqual(['runScheduled']);
    expect(invocation).toEqual({ request_id: 'req-1', cold_start: true });
  });

  it("routes the read API's invoke to runClaimed with its run id", async () => {
    const { calls, handler } = setup();

    await handler({ ledger: 'reconcile-run', run_id: 42 }, context);

    expect(calls).toEqual(['runClaimed:42']);
  });

  it.each([
    ['an unknown ledger event', { ledger: 'resume-event-source' }],
    ['a run id that is not a positive integer', { ledger: 'reconcile-run', run_id: 0 }],
    ['an SQS batch', { Records: [] }],
    ['nothing', undefined],
  ])('rejects %s with a constant internal_error, calling nothing', async (_case, event) => {
    const { calls, handler } = setup();

    const failure = await handler(event, context).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(LedgerError);
    expect((failure as LedgerError).code).toBe('internal_error');
    expect(calls).toEqual([]);
  });

  it("rethrows a failure as a constant, logging only the error's name", async () => {
    const { handler, lines } = setup(new TypeError('failed near delivered@resend.dev'));

    const failure = await handler(RECONCILE_SCHEDULED_EVENT, context).catch(
      (error: unknown) => error,
    );

    expect((failure as LedgerError).message).toBe('An unexpected error occurred.');
    expect((failure as LedgerError).cause).toBeUndefined();
    expect(lines).toEqual([
      { message: 'reconcile.handler_failed', fields: { error_name: 'TypeError' } },
    ]);
  });
});

describe('resendConfiguration (D21)', () => {
  it('composes a Resend client for a re_ key and a webhook id', () => {
    expect(resendConfiguration('wh_fake', 're_fake_key\n')).toEqual({
      apiKey: 're_fake_key',
      webhookId: 'wh_fake',
    });
  });

  it('composes none for the CDK placeholder, a key not starting re_', () => {
    expect(resendConfiguration('wh_fake', 'ZmFrZS1wbGFjZWhvbGRlcg')).toBeUndefined();
    expect(resendConfiguration('wh_fake', '')).toBeUndefined();
  });

  it('composes none when RESEND_WEBHOOK_ID is unset', () => {
    const config = reconcilerConfigSchema.parse({
      DATABASE_SECRET_ARN: 'arn-database',
      RESEND_API_KEY_SECRET_ARN: 'arn-resend',
      RESEND_WEBHOOK_ID: 'unset',
      QUEUE_URL: 'https://sqs.invalid/queue',
      DLQ_URL: 'https://sqs.invalid/dlq',
    });

    expect(config.webhookId).toBeUndefined();
    expect(resendConfiguration(config.webhookId, 're_fake_key')).toBeUndefined();
  });

  it('names each missing variable, never a value', () => {
    const result = reconcilerConfigSchema.safeParse({ QUEUE_URL: 'not a url' });

    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error?.issues)).not.toContain('not a url');
  });
});
