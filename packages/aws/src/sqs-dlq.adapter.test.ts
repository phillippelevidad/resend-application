// D4, D31: DLQ inspect and redrive over a stubbed SQS client that holds a small DLQ: its messages,
// the ones a receive hid, and its move tasks. The commands sent are the consequence at this seam; the
// DLQ they leave is asserted too. Status values from ListMessageMoveTasksResultEntry
// (https://docs.aws.amazon.com/AWSSimpleQueueService/latest/APIReference/API_ListMessageMoveTasksResultEntry.html):
// RUNNING, COMPLETED, CANCELLING, CANCELLED and FAILED. Error names from the Errors sections of
// ListMessageMoveTasks and StartMessageMoveTask
// (https://docs.aws.amazon.com/AWSSimpleQueueService/latest/APIReference/API_StartMessageMoveTask.html#API_StartMessageMoveTask_Errors):
// InvalidAddress, InvalidSecurity, RequestThrottled, ResourceNotFoundException and
// UnsupportedOperation (AWS-60). Neither names a "task already running" error (AWS-U14).
import {
  InvalidAddress,
  InvalidSecurity,
  QueueDoesNotExist,
  RequestThrottled,
  ResourceNotFoundException,
  type SQSClient,
  UnsupportedOperation,
} from '@aws-sdk/client-sqs';
import { LedgerError } from '@ledger/shared';
import { dlqPortContract } from '@ledger/shared/testing';
import { describe, expect, it } from 'vitest';
import { SqsDlqAdapter } from './sqs-dlq.adapter.ts';
import { type CommandInput, type ScriptedAnswer, StubClient } from './testing/stub-client.ts';

const metadata = { $metadata: {} };
const queueUrl = 'https://sqs.us-east-2.amazonaws.com/000000000000/LedgerApp-SourceQueue7A1B2C';
const dlqUrl = 'https://sqs.us-east-2.amazonaws.com/000000000000/LedgerApp-DeadLetterQueue3D4E';
const dlqArn = 'arn:aws:sqs:us-east-2:000000000000:LedgerApp-DeadLetterQueue3D4E';
// AWS-61: a handle embeds the DLQ's ARN, account id included.
const taskHandle = Buffer.from(JSON.stringify({ taskId: 'task-1', sourceArn: dlqArn })).toString(
  'base64',
);

const countAttributes = ['ApproximateNumberOfMessages', 'ApproximateNumberOfMessagesNotVisible'];

type DeadMessage = { body: string; receiveCount: number };

type DlqState = {
  // Visible to a receive, in order.
  visible: DeadMessage[];
  // Hidden by a receive whose visibility timeout has not expired; still counted in the depth.
  hidden: DeadMessage[];
  // Most recent first, as ListMessageMoveTasks returns them.
  tasks: { Status: string }[];
};

const emptyDlq = (): DlqState => ({ visible: [], hidden: [], tasks: [] });

const asksForArn = (input: CommandInput): boolean =>
  (input.AttributeNames as string[]).includes('QueueArn');

// `GetQueueAttributes` on the DLQ: its ARN, or its visible and hidden counts.
const attributesOf =
  (state: DlqState): ScriptedAnswer =>
  (input) => {
    expect(input.QueueUrl).toBe(dlqUrl);
    if (asksForArn(input)) return { Attributes: { QueueArn: dlqArn }, ...metadata };
    return {
      Attributes: {
        ApproximateNumberOfMessages: String(state.visible.length),
        ApproximateNumberOfMessagesNotVisible: String(state.hidden.length),
      },
      ...metadata,
    };
  };

// The DLQ as SQS answers for it: a receive with a visibility timeout above 0 hides what it returns
// (AWS-59), and a start moves every message back to its source queue at once.
const sqsHolding = (state: DlqState) =>
  new StubClient()
    .answer('GetQueueAttributes', attributesOf(state))
    .answer('ReceiveMessage', (input) => {
      const received = state.visible.slice(0, input.MaxNumberOfMessages as number);
      for (const message of received) message.receiveCount += 1;
      if (input.VisibilityTimeout !== 0) {
        state.visible = state.visible.slice(received.length);
        state.hidden.push(...received);
      }
      return {
        Messages: received.map((message, index) => ({
          MessageId: `m-${index}`,
          ReceiptHandle: `rh-${index}`,
          Body: message.body,
          Attributes: { ApproximateReceiveCount: String(message.receiveCount) },
        })),
        ...metadata,
      };
    })
    .answer('ListMessageMoveTasks', (input) => ({
      Results: state.tasks.slice(0, input.MaxResults as number).map((task) => ({
        ...task,
        SourceArn: dlqArn,
        ...(task.Status === 'RUNNING' ? { TaskHandle: taskHandle } : {}),
      })),
      ...metadata,
    }))
    .answer('StartMessageMoveTask', () => {
      state.visible = [];
      state.hidden = [];
      state.tasks.unshift({ Status: 'COMPLETED' });
      return { TaskHandle: taskHandle, ...metadata };
    });

const adapter = (sqs: StubClient) =>
  new SqsDlqAdapter({ sqs: sqs.as<SQSClient>(), dlqUrl, queueUrl });

const holding = (...bodies: string[]): DlqState => ({
  ...emptyDlq(),
  visible: bodies.map((body) => ({ body, receiveCount: 5 })),
});

const failureOf = (promise: Promise<unknown>): Promise<unknown> =>
  promise.then(
    () => undefined,
    (caught: unknown) => caught,
  );

describe('SqsDlqAdapter.sample', () => {
  it('reads the depth, then receives with visibility 0 and a 1 s long poll, and never deletes', async () => {
    const sqs = sqsHolding(holding('a', 'b'));

    await adapter(sqs).sample(10);

    expect(sqs.sent).toEqual([
      { name: 'GetQueueAttributes', input: { QueueUrl: dlqUrl, AttributeNames: countAttributes } },
      {
        name: 'ReceiveMessage',
        input: {
          QueueUrl: dlqUrl,
          MaxNumberOfMessages: 10,
          VisibilityTimeout: 0,
          WaitTimeSeconds: 1,
          MessageSystemAttributeNames: ['ApproximateReceiveCount'],
        },
      },
    ]);
    expect(sqs.names()).not.toContain('DeleteMessage');
  });

  it('asks for at most `limit` messages and counts the whole DLQ, hidden messages included', async () => {
    const state = holding('a', 'b', 'c');
    state.hidden.push({ body: 'in-flight', receiveCount: 6 });
    const sqs = sqsHolding(state);

    const sample = await adapter(sqs).sample(2);

    expect(sqs.inputs('ReceiveMessage')[0]?.MaxNumberOfMessages).toBe(2);
    expect(sample).toEqual({
      depth: 4,
      messages: [
        { body: 'a', receiveCount: 6 },
        { body: 'b', receiveCount: 6 },
      ],
    });
  });

  it('leaves every sampled message visible to the next sample and to a redrive', async () => {
    const state = holding('a', 'b');
    const port = adapter(sqsHolding(state));

    await port.sample(10);
    const second = await port.sample(10);

    expect(second.messages.map((message) => message.body)).toEqual(['a', 'b']);
    expect(state.hidden).toEqual([]);
    expect(await port.startRedrive()).toEqual({ status: 'started', depth: 2 });
  });

  it('rejects a message without a receive count as a constant internal_error', async () => {
    const sqs = sqsHolding(holding('a')).answer('ReceiveMessage', () => ({
      Messages: [{ MessageId: 'm-0', Body: 'a', Attributes: {} }],
      ...metadata,
    }));

    const failure = await failureOf(adapter(sqs).sample(10));

    expect(failure).toBeInstanceOf(LedgerError);
    expect((failure as LedgerError).code).toBe('internal_error');
  });

  it('rejects with the SDK error unchanged when a read fails (QueueDoesNotExist)', async () => {
    const gone = new QueueDoesNotExist({ message: 'gone', ...metadata });
    const sqs = sqsHolding(holding('a')).answer('GetQueueAttributes', () => {
      throw gone;
    });

    expect(await failureOf(adapter(sqs).sample(10))).toBe(gone);
    expect(sqs.names()).not.toContain('ReceiveMessage');
  });
});

describe('SqsDlqAdapter.startRedrive', () => {
  it('a RUNNING task refuses with redrive_in_progress and sends no start (AWS-21)', async () => {
    const state = holding('a');
    state.tasks.push({ Status: 'RUNNING' });
    const sqs = sqsHolding(state);

    const failure = await failureOf(adapter(sqs).startRedrive());

    expect(failure).toBeInstanceOf(LedgerError);
    expect((failure as LedgerError).code).toBe('redrive_in_progress');
    expect(sqs.names()).toEqual(['GetQueueAttributes', 'ListMessageMoveTasks']);
    expect(sqs.inputs('ListMessageMoveTasks')).toEqual([{ SourceArn: dlqArn, MaxResults: 1 }]);
    expect(state.visible).toHaveLength(1);
  });

  it.each(['COMPLETED', 'CANCELLED', 'FAILED', 'CANCELLING'])(
    'a most recent task reading %s does not refuse: the start is sent',
    async (status) => {
      const state = holding('a');
      state.tasks.push({ Status: status });
      const sqs = sqsHolding(state);

      expect(await adapter(sqs).startRedrive()).toEqual({ status: 'started', depth: 1 });
      expect(sqs.names()).toContain('StartMessageMoveTask');
    },
  );

  it('an empty DLQ answers empty and sends no start', async () => {
    const sqs = sqsHolding(emptyDlq());

    expect(await adapter(sqs).startRedrive()).toEqual({ status: 'empty', depth: 0 });
    expect(sqs.names()).toEqual([
      'GetQueueAttributes',
      'ListMessageMoveTasks',
      'GetQueueAttributes',
    ]);
  });

  // Measured on the deployed stack (2026-10-19): a second redrive 1.5 s after the first found its task
  // COMPLETED, yet the approximate depth still read 1, and a second task started that moved nothing.
  it('a depth that lags a just-completed move is confirmed by a receive: nothing received answers empty and sends no start', async () => {
    const state = emptyDlq();
    state.tasks.push({ Status: 'COMPLETED' });
    const answer = attributesOf(state);
    const sqs = sqsHolding(state).answer('GetQueueAttributes', (input) =>
      asksForArn(input)
        ? answer(input)
        : {
            Attributes: {
              ApproximateNumberOfMessages: '1',
              ApproximateNumberOfMessagesNotVisible: '0',
            },
            ...metadata,
          },
    );

    expect(await adapter(sqs).startRedrive()).toEqual({ status: 'empty', depth: 0 });
    expect(sqs.names()).toEqual([
      'GetQueueAttributes',
      'ListMessageMoveTasks',
      'GetQueueAttributes',
      'ReceiveMessage',
    ]);
    expect(sqs.names()).not.toContain('StartMessageMoveTask');
  });

  it('a depth above 0 confirmed by a receive at visibility 0 and a 1 s long poll starts once and answers started with the depth', async () => {
    const state = holding('a', 'b');
    const sqs = sqsHolding(state);

    expect(await adapter(sqs).startRedrive()).toEqual({ status: 'started', depth: 2 });
    expect(sqs.names()).toEqual([
      'GetQueueAttributes',
      'ListMessageMoveTasks',
      'GetQueueAttributes',
      'ReceiveMessage',
      'StartMessageMoveTask',
    ]);
    expect(sqs.inputs('ReceiveMessage')).toEqual([
      {
        QueueUrl: dlqUrl,
        MaxNumberOfMessages: 1,
        VisibilityTimeout: 0,
        WaitTimeSeconds: 1,
        MessageSystemAttributeNames: ['ApproximateReceiveCount'],
      },
    ]);
    expect(sqs.names()).not.toContain('DeleteMessage');
    expect(state.visible).toEqual([]);
  });

  it('starts with the DLQ as SourceArn and no DestinationArn, and answers started with the depth, no TaskHandle', async () => {
    const state = holding('a', 'b');
    state.hidden.push({ body: 'c', receiveCount: 6 });
    const sqs = sqsHolding(state);

    const result = await adapter(sqs).startRedrive();

    expect(sqs.inputs('StartMessageMoveTask')).toEqual([{ SourceArn: dlqArn }]);
    expect(result).toEqual({ status: 'started', depth: 3 });
    expect(JSON.stringify(result)).not.toContain(taskHandle);
    expect(Object.keys(result)).toEqual(['status', 'depth']);
  });

  it.each([
    ['InvalidAddress', () => new InvalidAddress({ message: 'x', ...metadata })],
    ['InvalidSecurity', () => new InvalidSecurity({ message: 'x', ...metadata })],
    ['RequestThrottled', () => new RequestThrottled({ message: 'x', ...metadata })],
    [
      'ResourceNotFoundException',
      () => new ResourceNotFoundException({ message: 'x', ...metadata }),
    ],
    ['UnsupportedOperation', () => new UnsupportedOperation({ message: 'x', ...metadata })],
  ])(
    'a start that fails with %s propagates the error unchanged, and no second start is sent (AWS-U14)',
    async (_name, make) => {
      const error = make();
      const sqs = sqsHolding(holding('a')).answer('StartMessageMoveTask', () => {
        throw error;
      });

      expect(await failureOf(adapter(sqs).startRedrive())).toBe(error);
      expect(sqs.inputs('StartMessageMoveTask')).toHaveLength(1);
    },
  );

  it('a failed ListMessageMoveTasks propagates unchanged and sends no start', async () => {
    const error = new ResourceNotFoundException({ message: 'x', ...metadata });
    const sqs = sqsHolding(holding('a')).answer('ListMessageMoveTasks', () => {
      throw error;
    });

    expect(await failureOf(adapter(sqs).startRedrive())).toBe(error);
    expect(sqs.names()).not.toContain('StartMessageMoveTask');
  });

  it("reads the DLQ's ARN once per instance, and retries a failed read", async () => {
    const state = emptyDlq();
    const answer = attributesOf(state);
    let failNext = true;
    const sqs = sqsHolding(state).answer('GetQueueAttributes', (input) => {
      if (asksForArn(input) && failNext) {
        failNext = false;
        throw new RequestThrottled({ message: 'x', ...metadata });
      }
      return answer(input);
    });
    const port = adapter(sqs);

    expect(await failureOf(port.startRedrive())).toBeInstanceOf(RequestThrottled);
    await port.startRedrive();
    await port.startRedrive();

    const arnReads = sqs.inputs('GetQueueAttributes').filter(asksForArn);
    expect(arnReads).toEqual([
      { QueueUrl: dlqUrl, AttributeNames: ['QueueArn'] },
      { QueueUrl: dlqUrl, AttributeNames: ['QueueArn'] },
    ]);
  });
});

dlqPortContract('SqsDlqAdapter', () => {
  const state = emptyDlq();
  return {
    port: adapter(sqsHolding(state)),
    // SQS moved it here after `maxReceiveCount` receives (AWS-09).
    deadLetter: async (body) => {
      state.visible.push({ body, receiveCount: 5 });
    },
  };
});
