import { type CloudFormationClient, DescribeStacksCommand } from '@aws-sdk/client-cloudformation';

// A deployed stack as the scripts read it: its status and its outputs by key.
export type StackOutputs = {
  readonly status: string;
  readonly outputs: Readonly<Record<string, string>>;
};

// D26, D33 step 2, D34, D35, D36: a stack's outputs, or `null` when no stack of that name exists.
// Script-only. It pages through `DescribeStacks` without a name and matches on `StackName`, rather
// than describing the stack by name: the API Reference lists no error for a missing stack, so
// telling "absent" from any other failure by error text would rest on unverified behavior. A listing
// without a name omits deleted stacks.
export async function readStackOutputs(
  client: CloudFormationClient,
  stackName: string,
): Promise<StackOutputs | null> {
  let nextToken: string | undefined;
  do {
    const page = await client.send(
      new DescribeStacksCommand(nextToken === undefined ? {} : { NextToken: nextToken }),
    );
    const stack = page.Stacks?.find(
      (candidate) =>
        candidate.StackName === stackName && candidate.StackStatus !== 'DELETE_COMPLETE',
    );
    if (stack !== undefined) {
      const outputs: Record<string, string> = {};
      for (const output of stack.Outputs ?? []) {
        if (output.OutputKey !== undefined && output.OutputValue !== undefined) {
          outputs[output.OutputKey] = output.OutputValue;
        }
      }
      return { status: stack.StackStatus ?? 'UNKNOWN', outputs };
    }
    nextToken = page.NextToken;
  } while (nextToken !== undefined);
  return null;
}
