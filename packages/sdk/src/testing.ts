// @ledger/sdk/testing: the fake client the CLI's tests run the real program over (pp-cli →
// cli-tests). Never imported by runtime code.
import type {
  CreatedToken,
  DlqMessageList,
  DlqRedrive,
  Email,
  EventSource,
  Health,
  LedgerClient,
  Recipient,
  ReconcileRun,
  ReconcileRunList,
  SdkResult,
  Token,
  TokenList,
} from './create-ledger-client.ts';

type TokensListParams = Parameters<LedgerClient['tokens']['list']>[0];
type TokensCreateInput = Parameters<LedgerClient['tokens']['create']>[0];
type DlqListMessagesParams = Parameters<LedgerClient['dlq']['listMessages']>[0];
type GapsListParams = Parameters<LedgerClient['gaps']['list']>[0];
type ReconcileStartInput = Parameters<LedgerClient['reconcile']['start']>[0];

// One entry per call, in order: the method and what it was called with (absent for a method that
// takes nothing).
export type FakeCall =
  | {
      readonly method: 'emails.get' | 'recipients.get' | 'tokens.revoke' | 'reconcile.getRun';
      readonly argument: string;
    }
  | {
      readonly method:
        | 'health.get'
        | 'worker.resumeEventSource'
        | 'tokens.getCurrent'
        | 'dlq.startRedrive';
    }
  | { readonly method: 'tokens.list'; readonly argument: TokensListParams }
  | { readonly method: 'tokens.create'; readonly argument: TokensCreateInput }
  | { readonly method: 'dlq.listMessages'; readonly argument: DlqListMessagesParams }
  | { readonly method: 'gaps.list'; readonly argument: GapsListParams }
  | { readonly method: 'reconcile.start'; readonly argument: ReconcileStartInput };

// Each answer is a result, or a function that may throw to stand in for a defect.
type Answer<T, A = undefined> =
  | SdkResult<T>
  | ((argument: A) => SdkResult<T> | Promise<SdkResult<T>>);

export type FakeAnswers = {
  readonly emailsGet?: Answer<Email, string>;
  readonly recipientsGet?: Answer<Recipient, string>;
  readonly healthGet?: Answer<Health>;
  readonly workerResumeEventSource?: Answer<EventSource>;
  readonly tokensGetCurrent?: Answer<Token>;
  readonly tokensList?: Answer<TokenList, TokensListParams>;
  readonly tokensCreate?: Answer<CreatedToken, TokensCreateInput>;
  readonly tokensRevoke?: Answer<Token, string>;
  readonly dlqListMessages?: Answer<DlqMessageList, DlqListMessagesParams>;
  readonly dlqStartRedrive?: Answer<DlqRedrive>;
  readonly gapsList?: Answer<ReconcileRunList, GapsListParams>;
  readonly reconcileGetRun?: Answer<ReconcileRun, string>;
  readonly reconcileStart?: Answer<ReconcileRun, ReconcileStartInput>;
};

async function answer<T, A>(answerFor: Answer<T, A> | undefined, argument: A) {
  if (answerFor === undefined) throw new TypeError('FakeLedgerClient: no answer configured.');
  return typeof answerFor === 'function' ? answerFor(argument) : answerFor;
}

// Typed against LedgerClient so it cannot drift from the real client; records every call in order.
export class FakeLedgerClient implements LedgerClient {
  readonly calls: FakeCall[] = [];
  readonly emails: LedgerClient['emails'];
  readonly recipients: LedgerClient['recipients'];
  readonly health: LedgerClient['health'];
  readonly worker: LedgerClient['worker'];
  readonly tokens: LedgerClient['tokens'];
  readonly dlq: LedgerClient['dlq'];
  readonly gaps: LedgerClient['gaps'];
  readonly reconcile: LedgerClient['reconcile'];

  constructor(answers: FakeAnswers = {}) {
    this.emails = {
      get: (emailId) => {
        this.calls.push({ method: 'emails.get', argument: emailId });
        return answer(answers.emailsGet, emailId);
      },
    };
    this.recipients = {
      get: (address) => {
        this.calls.push({ method: 'recipients.get', argument: address });
        return answer(answers.recipientsGet, address);
      },
    };
    this.health = {
      get: () => {
        this.calls.push({ method: 'health.get' });
        return answer(answers.healthGet, undefined);
      },
    };
    this.worker = {
      resumeEventSource: () => {
        this.calls.push({ method: 'worker.resumeEventSource' });
        return answer(answers.workerResumeEventSource, undefined);
      },
    };
    this.tokens = {
      getCurrent: () => {
        this.calls.push({ method: 'tokens.getCurrent' });
        return answer(answers.tokensGetCurrent, undefined);
      },
      list: (params) => {
        this.calls.push({ method: 'tokens.list', argument: params });
        return answer(answers.tokensList, params);
      },
      create: (input) => {
        this.calls.push({ method: 'tokens.create', argument: input });
        return answer(answers.tokensCreate, input);
      },
      revoke: (tokenId) => {
        this.calls.push({ method: 'tokens.revoke', argument: tokenId });
        return answer(answers.tokensRevoke, tokenId);
      },
    };
    this.dlq = {
      listMessages: (params) => {
        this.calls.push({ method: 'dlq.listMessages', argument: params });
        return answer(answers.dlqListMessages, params);
      },
      startRedrive: () => {
        this.calls.push({ method: 'dlq.startRedrive' });
        return answer(answers.dlqStartRedrive, undefined);
      },
    };
    this.gaps = {
      list: (params) => {
        this.calls.push({ method: 'gaps.list', argument: params });
        return answer(answers.gapsList, params);
      },
    };
    this.reconcile = {
      getRun: (runId) => {
        this.calls.push({ method: 'reconcile.getRun', argument: runId });
        return answer(answers.reconcileGetRun, runId);
      },
      start: (input) => {
        this.calls.push({ method: 'reconcile.start', argument: input });
        return answer(answers.reconcileStart, input);
      },
    };
  }
}
