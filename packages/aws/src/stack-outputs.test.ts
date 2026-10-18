// D26: reading a stack's outputs over a stubbed CloudFormation client. DescribeStacks
// (https://docs.aws.amazon.com/AWSCloudFormation/latest/APIReference/API_DescribeStacks.html) pages
// with `NextToken`; its Errors section lists none of its own, so absence is read from the listing.
import type { CloudFormationClient } from '@aws-sdk/client-cloudformation';
import { describe, expect, it } from 'vitest';
import { readStackOutputs } from './stack-outputs.ts';
import { StubClient } from './testing/stub-client.ts';

const metadata = { $metadata: {} };

const pages = [
  {
    Stacks: [
      { StackName: 'CDKToolkit', StackStatus: 'CREATE_COMPLETE', Outputs: [] },
      { StackName: 'LedgerApp', StackStatus: 'DELETE_COMPLETE', Outputs: [] },
    ],
    NextToken: 'page-2',
  },
  {
    Stacks: [
      {
        StackName: 'LedgerApp',
        StackStatus: 'UPDATE_COMPLETE',
        Outputs: [
          { OutputKey: 'DeployedCommit', OutputValue: '0123abcd' },
          { OutputKey: 'ThrottleRateLimit', OutputValue: '100' },
          { OutputKey: 'Unset' },
        ],
      },
    ],
  },
];

const cloudFormation = () =>
  new StubClient().answer('DescribeStacks', (input) => ({
    ...(input.NextToken === 'page-2' ? pages[1] : pages[0]),
    ...metadata,
  }));

describe('readStackOutputs', () => {
  it('pages DescribeStacks and answers the live stack of that name with its outputs by key', async () => {
    const stub = cloudFormation();

    const stack = await readStackOutputs(stub.as<CloudFormationClient>(), 'LedgerApp');

    expect(stub.inputs('DescribeStacks')).toEqual([{}, { NextToken: 'page-2' }]);
    expect(stack).toEqual({
      status: 'UPDATE_COMPLETE',
      outputs: { DeployedCommit: '0123abcd', ThrottleRateLimit: '100' },
    });
  });

  it('answers null when no live stack has that name, a deleted one included', async () => {
    const stub = cloudFormation();
    const onlyDeleted = new StubClient().answer('DescribeStacks', () => ({
      Stacks: [{ StackName: 'LedgerGuardrails', StackStatus: 'DELETE_COMPLETE' }],
      ...metadata,
    }));

    expect(await readStackOutputs(stub.as<CloudFormationClient>(), 'LedgerGuardrails')).toBeNull();
    expect(
      await readStackOutputs(onlyDeleted.as<CloudFormationClient>(), 'LedgerGuardrails'),
    ).toBeNull();
  });
});
