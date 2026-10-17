// @ledger/sdk/testing: the fake client the CLI's tests run the real program over (pp-cli →
// cli-tests). Never imported by runtime code.
import type { Email, LedgerClient, Recipient, SdkResult } from './create-ledger-client.ts';

export type FakeCall = {
  readonly method: 'emails.get' | 'recipients.get';
  readonly argument: string;
};

// Each answer is a result, or a function that may throw to stand in for a defect.
type Answer<T> = SdkResult<T> | ((argument: string) => SdkResult<T> | Promise<SdkResult<T>>);

export type FakeAnswers = {
  readonly emailsGet?: Answer<Email>;
  readonly recipientsGet?: Answer<Recipient>;
};

async function answer<T>(answerFor: Answer<T> | undefined, argument: string) {
  if (answerFor === undefined) throw new TypeError('FakeLedgerClient: no answer configured.');
  return typeof answerFor === 'function' ? answerFor(argument) : answerFor;
}

// Typed against LedgerClient so it cannot drift from the real client; records every call in order.
export class FakeLedgerClient implements LedgerClient {
  readonly calls: FakeCall[] = [];
  readonly emails: LedgerClient['emails'];
  readonly recipients: LedgerClient['recipients'];

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
  }
}
