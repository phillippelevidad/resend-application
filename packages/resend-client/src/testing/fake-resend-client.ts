import type { ErrorCode } from '@ledger/core';
import type {
  CallOptions,
  ListedWebhookEvent,
  ListedWebhookEvents,
  ResendClient,
  SendEmailInput,
  SendEmailOutcome,
} from '../create-resend-client.ts';
import { registryError } from '../registry-error.ts';

type Method = keyof ResendClient;

export type FakeResendCall = { readonly method: Method; readonly args: readonly unknown[] };

// Slice 4 D13: `ResendClient`'s fake, for the reconciler's unit tests only; a limiter or mapping
// claim is proven against the fake Resend API instead. It holds the webhook's status and events,
// records every call in order, and throws a registry code where a test scripts one.
export class FakeResendClient implements ResendClient {
  webhookStatus: 'enabled' | 'disabled' = 'enabled';
  // Paged newest first, `pageSize` a page, unless `pages` is set.
  events: ListedWebhookEvent[] = [];
  pageSize = 100;
  // Explicit pages, served in order whatever `after` says: an unsorted page, for one.
  pages: ListedWebhookEvents[] | undefined;
  readonly calls: FakeResendCall[] = [];
  readonly replayed: string[] = [];
  readonly #failures = new Map<Method, ErrorCode[]>();
  readonly #replayFailures = new Map<string, ErrorCode>();

  // The method's next call throws `code` (queued per method).
  fail(method: Method, code: ErrorCode): void {
    this.#failures.set(method, [...(this.#failures.get(method) ?? []), code]);
  }

  // Every replay of this event id throws `code`.
  failReplayOf(eventId: string, code: ErrorCode): void {
    this.#replayFailures.set(eventId, code);
  }

  #enter(method: Method, args: readonly unknown[]): void {
    this.calls.push({ method, args });
    const code = this.#failures.get(method)?.shift();
    if (code !== undefined) throw registryError(code);
  }

  async retrieveWebhook(webhookId: string, opts: CallOptions) {
    this.#enter('retrieveWebhook', [webhookId, opts]);
    return { status: this.webhookStatus };
  }

  async listWebhookEvents(
    webhookId: string,
    page: { readonly after?: string | undefined },
    opts: CallOptions,
  ): Promise<ListedWebhookEvents> {
    this.#enter('listWebhookEvents', [webhookId, page, opts]);
    if (this.pages !== undefined) {
      const served = this.calls.filter((c) => c.method === 'listWebhookEvents').length - 1;
      return this.pages[served] ?? { hasMore: false, events: [] };
    }
    const ordered = [...this.events].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    const start = page.after === undefined ? 0 : ordered.findIndex((e) => e.id === page.after) + 1;
    return {
      hasMore: start + this.pageSize < ordered.length,
      events: ordered.slice(start, start + this.pageSize),
    };
  }

  async replayWebhookEvent(webhookId: string, eventId: string, opts: CallOptions): Promise<void> {
    this.#enter('replayWebhookEvent', [webhookId, eventId, opts]);
    const code = this.#replayFailures.get(eventId);
    if (code !== undefined) throw registryError(code);
    this.replayed.push(eventId);
  }

  async retrieveWebhookEventCreatedAt(webhookId: string, eventId: string, opts: CallOptions) {
    this.#enter('retrieveWebhookEventCreatedAt', [webhookId, eventId, opts]);
    const event = this.events.find((e) => e.id === eventId);
    if (event === undefined) throw registryError('internal_error');
    return { createdAt: event.createdAt };
  }

  async sendEmail(
    email: SendEmailInput,
    request: { readonly idempotencyKey: string },
    opts: CallOptions,
  ): Promise<SendEmailOutcome> {
    this.#enter('sendEmail', [email, request, opts]);
    return { emailId: `fake-email-${this.calls.length}` };
  }
}
