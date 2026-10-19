import {
  type CloudWatchLogsClient,
  DescribeLogGroupsCommand,
} from '@aws-sdk/client-cloudwatch-logs';
import { GetEventSourceMappingCommand, type LambdaClient } from '@aws-sdk/client-lambda';
import {
  GetResourcesCommand,
  type ResourceGroupsTaggingAPIClient,
} from '@aws-sdk/client-resource-groups-tagging-api';
import { DescribeSecretCommand, type SecretsManagerClient } from '@aws-sdk/client-secrets-manager';

export type PostDestroyClients = {
  tagging: ResourceGroupsTaggingAPIClient;
  secretsManager: SecretsManagerClient;
  logs: CloudWatchLogsClient;
  lambda: LambdaClient;
};

export type PostDestroyScope = {
  // D27: the tag every Ledger resource carries (`ledger-project` = `ledger`).
  readonly tag: { readonly key: string; readonly value: string };
  // D26: the log group prefixes a function can leave behind, tagged or not (`/aws/lambda/LedgerApp-`,
  // `/ledger/`).
  readonly logGroupPrefixes: readonly string[];
};

// A resource still present, named by its service and the ARN's resource part: never the full ARN,
// which carries the account id the teardown output must not print.
export type Leftover = { readonly service: string; readonly resource: string };

export type PostDestroyListing = {
  readonly leftovers: readonly Leftover[];
  // Secrets in their recovery window: no charge while pending (AWS-11), so not leftovers.
  readonly pendingDeletion: number;
};

// D26, D34: what teardown lists after both destroys. Script-only. Every resource carrying the tag,
// across `GetResources` pages, plus every log group under the prefixes, across `DescribeLogGroups`
// pages (an implicit `/aws/lambda/*` group carries no tag, AWS-19). A tagged secret counts only when
// `DescribeSecret` shows no `DeletedDate`; one already gone (`ResourceNotFoundException`, which the
// tagging index can still list for a while) counts as nothing. A tagged event source mapping counts
// only while `GetEventSourceMapping` still finds it: the index kept listing a destroyed one
// (WALKTHROUGH-RUN F2). Teardown exits non-zero on any leftover.
export async function listPostDestroyLeftovers(
  clients: PostDestroyClients,
  scope: PostDestroyScope,
): Promise<PostDestroyListing> {
  const leftovers = new Map<string, Leftover>();
  const add = (leftover: Leftover) =>
    leftovers.set(`${leftover.service} ${leftover.resource}`, leftover);
  let pendingDeletion = 0;

  let paginationToken: string | undefined;
  do {
    const page = await clients.tagging.send(
      new GetResourcesCommand({
        TagFilters: [{ Key: scope.tag.key, Values: [scope.tag.value] }],
        ...(paginationToken === undefined ? {} : { PaginationToken: paginationToken }),
      }),
    );
    for (const mapping of page.ResourceTagMappingList ?? []) {
      if (mapping.ResourceARN === undefined) continue;
      const leftover = fromArn(mapping.ResourceARN);
      if (leftover.service === 'secretsmanager') {
        const state = await secretState(clients.secretsManager, mapping.ResourceARN);
        if (state === 'pending_deletion') pendingDeletion += 1;
        if (state !== 'present') continue;
      }
      if (leftover.service === 'lambda' && leftover.resource.startsWith(MAPPING_PREFIX)) {
        const uuid = leftover.resource.slice(MAPPING_PREFIX.length);
        if (!(await mappingExists(clients.lambda, uuid))) continue;
      }
      add(leftover);
    }
    // The GetResources API Reference ends the listing on a null token; its own example's last page
    // carries `""`, so an empty one ends it too.
    paginationToken = page.PaginationToken === '' ? undefined : page.PaginationToken;
  } while (paginationToken !== undefined);

  for (const prefix of scope.logGroupPrefixes) {
    let nextToken: string | undefined;
    do {
      const page = await clients.logs.send(
        new DescribeLogGroupsCommand({
          logGroupNamePrefix: prefix,
          ...(nextToken === undefined ? {} : { nextToken }),
        }),
      );
      for (const group of page.logGroups ?? []) {
        if (group.logGroupName !== undefined) {
          add({ service: 'logs', resource: `log-group:${group.logGroupName}` });
        }
      }
      nextToken = page.nextToken;
    } while (nextToken !== undefined);
  }

  return { leftovers: [...leftovers.values()], pendingDeletion };
}

// `arn:partition:service:region:account:resource`: the resource part may itself hold colons. A log
// group's ARN can end in `:*`, which names the same group.
const fromArn = (arn: string): Leftover => {
  const parts = arn.split(':');
  return { service: parts[2] ?? '', resource: parts.slice(5).join(':').replace(/:\*$/, '') };
};

const MAPPING_PREFIX = 'event-source-mapping:';

async function mappingExists(client: LambdaClient, uuid: string): Promise<boolean> {
  try {
    await client.send(new GetEventSourceMappingCommand({ UUID: uuid }));
    return true;
  } catch (error) {
    if ((error as Error).name === 'ResourceNotFoundException') return false;
    throw error;
  }
}

async function secretState(
  client: SecretsManagerClient,
  arn: string,
): Promise<'present' | 'pending_deletion' | 'gone'> {
  try {
    const secret = await client.send(new DescribeSecretCommand({ SecretId: arn }));
    return secret.DeletedDate === undefined ? 'present' : 'pending_deletion';
  } catch (error) {
    if ((error as Error).name === 'ResourceNotFoundException') return 'gone';
    throw error;
  }
}
