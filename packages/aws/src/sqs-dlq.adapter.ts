import {
  GetQueueAttributesCommand,
  ListMessageMoveTasksCommand,
  type Message,
  ReceiveMessageCommand,
  type SQSClient,
  StartMessageMoveTaskCommand,
} from '@aws-sdk/client-sqs';
import { errorRegistry } from '@ledger/core';
import type { DlqPort, DlqRawMessage, DlqSample, RedriveStart } from '@ledger/shared';
import { LedgerError } from '@ledger/shared';

export type SqsDlqAdapterDeps = {
  sqs: SQSClient;
  dlqUrl: string;
  // The source queue the DLQ belongs to. A start names no `DestinationArn`, so SQS redrives each
  // message to its original source queue (AWS-60) and no call here names this queue: it is held so
  // the composition root states both ends of the redrive (D9).
  queueUrl: string;
};

// D4: the inspect's long poll. Any wait above 0 queries every server, where a short poll samples a
// subset and can answer nothing from a small queue (AWS-59).
const SAMPLE_WAIT_SECONDS = 1;

// D1, D4: the DLQ for `dlq.listMessages` and `dlq.startRedrive`.
// - `sample` reads the depth (visible plus in flight, as `health.get` sums it, AWS-22), then receives
//   with visibility 0, so a sampled message is never hidden from a following redrive or depth
//   (AWS-59), and never deletes one. Each receive still adds to the receive count (AWS-50).
// - `startRedrive` lists the DLQ's most recent move task first: a `RUNNING` one refuses with
//   `redrive_in_progress` and sends no start, because SQS runs one task per queue (AWS-21) and names
//   no "task already running" error (AWS-60, AWS-U14). No depth reading decides alone, because the
//   attributes lag both ways (AWS-62): every answer is confirmed by a 1 s long-poll receive at
//   visibility 0 (AWS-59). A receive that returns nothing answers `empty` and starts nothing, though
//   the depth still counts messages a just-completed move took; one that returns a message starts
//   the task, though the depth reads 0, and reports at least the message seen, as
//   `dlq.listMessages` does. The start's `TaskHandle` embeds the DLQ's ARN and account id (AWS-61),
//   so it is dropped. Any SDK error propagates unchanged: a start that still loses the race surfaces
//   as `internal_error`, never as a second task.
// The DLQ's ARN, which both move-task calls take, is read once with `GetQueueAttributes` and cached
// for the instance's life; a failed read is not cached, so the next call retries.
export class SqsDlqAdapter implements DlqPort {
  readonly #sqs: SQSClient;
  readonly #dlqUrl: string;
  #dlqArn: string | undefined;

  constructor({ sqs, dlqUrl }: SqsDlqAdapterDeps) {
    this.#sqs = sqs;
    this.#dlqUrl = dlqUrl;
  }

  async sample(limit: number): Promise<DlqSample> {
    const depth = await this.#depth();
    const messages: DlqRawMessage[] = (await this.#receive(limit)).map((message) => {
      if (message.Body === undefined) {
        throw new LedgerError('internal_error', 'A dead message came back without a body.');
      }
      return {
        body: message.Body,
        receiveCount: count(message.Attributes?.ApproximateReceiveCount),
      };
    });
    return { depth, messages };
  }

  async startRedrive(): Promise<RedriveStart> {
    const dlqArn = await this.#arn();
    const tasks = await this.#sqs.send(
      new ListMessageMoveTasksCommand({ SourceArn: dlqArn, MaxResults: 1 }),
    );
    if (tasks.Results?.[0]?.Status === 'RUNNING') {
      throw new LedgerError('redrive_in_progress', errorRegistry.redrive_in_progress.message);
    }
    const depth = await this.#depth();
    const received = await this.#receive(1);
    if (received.length === 0) return { status: 'empty', depth: 0 };
    await this.#sqs.send(new StartMessageMoveTaskCommand({ SourceArn: dlqArn }));
    return { status: 'started', depth: Math.max(depth, received.length) };
  }

  // Up to `limit` messages, with visibility 0 and the long poll (AWS-59), never deleted.
  async #receive(limit: number): Promise<Message[]> {
    const output = await this.#sqs.send(
      new ReceiveMessageCommand({
        QueueUrl: this.#dlqUrl,
        MaxNumberOfMessages: limit,
        VisibilityTimeout: 0,
        WaitTimeSeconds: SAMPLE_WAIT_SECONDS,
        MessageSystemAttributeNames: ['ApproximateReceiveCount'],
      }),
    );
    return output.Messages ?? [];
  }

  async #depth(): Promise<number> {
    const output = await this.#sqs.send(
      new GetQueueAttributesCommand({
        QueueUrl: this.#dlqUrl,
        AttributeNames: ['ApproximateNumberOfMessages', 'ApproximateNumberOfMessagesNotVisible'],
      }),
    );
    return (
      count(output.Attributes?.ApproximateNumberOfMessages) +
      count(output.Attributes?.ApproximateNumberOfMessagesNotVisible)
    );
  }

  async #arn(): Promise<string> {
    if (this.#dlqArn !== undefined) return this.#dlqArn;
    const output = await this.#sqs.send(
      new GetQueueAttributesCommand({ QueueUrl: this.#dlqUrl, AttributeNames: ['QueueArn'] }),
    );
    const arn = output.Attributes?.QueueArn;
    if (arn === undefined || arn === '') {
      throw new LedgerError('internal_error', 'The DLQ reported no ARN.');
    }
    this.#dlqArn = arn;
    return arn;
  }
}

// An attribute SQS always returns when asked; a missing or non-numeric one means the answer is not
// what this adapter asked for.
const count = (value: string | undefined): number => {
  const parsed = Number(value);
  if (value === undefined || !Number.isInteger(parsed) || parsed < 0) {
    throw new LedgerError('internal_error', 'A queue attribute was missing or not a count.');
  }
  return parsed;
};
