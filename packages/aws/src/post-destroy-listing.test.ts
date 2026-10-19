// D26, D34: the post-destroy listing over stubbed Tagging, Secrets Manager and Logs clients.
// Paging and error names from the API References: GetResources
// (https://docs.aws.amazon.com/resourcegroupstagging/latest/APIReference/API_GetResources.html),
// DescribeSecret (`DeletedDate`, `ResourceNotFoundException`;
// https://docs.aws.amazon.com/secretsmanager/latest/apireference/API_DescribeSecret.html) and
// DescribeLogGroups
// (https://docs.aws.amazon.com/AmazonCloudWatchLogs/latest/APIReference/API_DescribeLogGroups.html).
import type { CloudWatchLogsClient } from '@aws-sdk/client-cloudwatch-logs';
import {
  type LambdaClient,
  ResourceNotFoundException as LambdaResourceNotFoundException,
} from '@aws-sdk/client-lambda';
import {
  type ResourceGroupsTaggingAPIClient,
  ThrottledException,
} from '@aws-sdk/client-resource-groups-tagging-api';
import {
  InternalServiceError,
  ResourceNotFoundException,
  type SecretsManagerClient,
} from '@aws-sdk/client-secrets-manager';
import { describe, expect, it } from 'vitest';
import { listPostDestroyLeftovers } from './post-destroy-listing.ts';
import { StubClient } from './testing/stub-client.ts';

const metadata = { $metadata: {} };
const account = '123456789012';
const arn = (service: string, resource: string) =>
  `arn:aws:${service}:us-east-2:${account}:${resource}`;

const pendingSecret = arn('secretsmanager', 'secret:LedgerAppDatabase-AbCdEf');
const goneSecret = arn('secretsmanager', 'secret:LedgerAppSigning-GhIjKl');
const liveSecret = arn('secretsmanager', 'secret:LedgerAppOther-MnOpQr');

const scope = {
  tag: { key: 'ledger-project', value: 'ledger' },
  logGroupPrefixes: ['/aws/lambda/LedgerApp-', '/ledger/'],
};

// Two tagging pages; the second ends with the empty token the API Reference's example shows.
const tagging = (arnsByPage: readonly (readonly string[])[]) =>
  new StubClient().answer('GetResources', (input) => {
    const index = input.PaginationToken === undefined ? 0 : Number(input.PaginationToken);
    const next = index + 1;
    return {
      ResourceTagMappingList: (arnsByPage[index] ?? []).map((ResourceARN) => ({ ResourceARN })),
      PaginationToken: next < arnsByPage.length ? String(next) : '',
      ...metadata,
    };
  });

const secretsManager = () =>
  new StubClient().answer('DescribeSecret', (input) => {
    if (input.SecretId === goneSecret) {
      throw new ResourceNotFoundException({ message: 'missing', ...metadata });
    }
    return {
      ARN: input.SecretId,
      ...(input.SecretId === pendingSecret ? { DeletedDate: new Date(Date.UTC(2026, 9, 17)) } : {}),
      ...metadata,
    };
  });

const logs = (groupsByPrefix: Readonly<Record<string, readonly string[]>>) =>
  new StubClient().answer('DescribeLogGroups', (input) => {
    const groups = groupsByPrefix[input.logGroupNamePrefix as string] ?? [];
    // One group per page.
    const index = input.nextToken === undefined ? 0 : Number(input.nextToken);
    const next = index + 1;
    return {
      logGroups: groups.slice(index, next).map((logGroupName) => ({ logGroupName })),
      ...(next < groups.length ? { nextToken: String(next) } : {}),
      ...metadata,
    };
  });

const liveMappingUuid = '11111111-2222-3333-4444-555555555555';
const goneMappingUuid = '66666666-7777-8888-9999-000000000000';

// GetEventSourceMapping
// (https://docs.aws.amazon.com/lambda/latest/api/API_GetEventSourceMapping.html): a destroyed
// mapping answers `ResourceNotFoundException`, while the tagging index can still list it (F2).
const lambda = () =>
  new StubClient().answer('GetEventSourceMapping', (input) => {
    if (input.UUID === goneMappingUuid) {
      throw new LambdaResourceNotFoundException({ message: 'missing', ...metadata });
    }
    return { UUID: input.UUID, ...metadata };
  });

const clients = (
  taggingStub: StubClient,
  secretsStub: StubClient,
  logsStub: StubClient,
  lambdaStub: StubClient = lambda(),
) => ({
  tagging: taggingStub.as<ResourceGroupsTaggingAPIClient>(),
  secretsManager: secretsStub.as<SecretsManagerClient>(),
  logs: logsStub.as<CloudWatchLogsClient>(),
  lambda: lambdaStub.as<LambdaClient>(),
});

describe('listPostDestroyLeftovers', () => {
  it('counts a tagged event source mapping only while GetEventSourceMapping still finds it (F2)', async () => {
    const lambdaStub = lambda();
    const result = await listPostDestroyLeftovers(
      clients(
        tagging([
          [
            arn('lambda', `event-source-mapping:${goneMappingUuid}`),
            arn('lambda', `event-source-mapping:${liveMappingUuid}`),
          ],
        ]),
        secretsManager(),
        logs({}),
        lambdaStub,
      ),
      scope,
    );

    expect(lambdaStub.inputs('GetEventSourceMapping')).toEqual([
      { UUID: goneMappingUuid },
      { UUID: liveMappingUuid },
    ]);
    expect(result).toEqual({
      leftovers: [{ service: 'lambda', resource: `event-source-mapping:${liveMappingUuid}` }],
      pendingDeletion: 0,
    });
  });

  it('counts a secret pending deletion and one already gone as no leftover', async () => {
    const result = await listPostDestroyLeftovers(
      clients(tagging([[pendingSecret], [goneSecret]]), secretsManager(), logs({})),
      scope,
    );

    expect(result).toEqual({ leftovers: [], pendingDeletion: 1 });
  });

  it('lists every other tagged resource and every log group under the prefixes, by service and resource only', async () => {
    const taggingStub = tagging([
      [liveSecret, arn('sqs', 'LedgerApp-SourceQueue7A1B2C')],
      [arn('logs', 'log-group:/ledger/LedgerApp-ingest:*'), pendingSecret],
    ]);
    const logsStub = logs({
      '/aws/lambda/LedgerApp-': ['/aws/lambda/LedgerApp-worker'],
      '/ledger/': ['/ledger/LedgerApp-ingest', '/ledger/LedgerApp-api'],
    });

    const result = await listPostDestroyLeftovers(
      clients(taggingStub, secretsManager(), logsStub),
      scope,
    );

    expect(taggingStub.inputs('GetResources')).toEqual([
      { TagFilters: [{ Key: 'ledger-project', Values: ['ledger'] }] },
      { TagFilters: [{ Key: 'ledger-project', Values: ['ledger'] }], PaginationToken: '1' },
    ]);
    expect(logsStub.inputs('DescribeLogGroups')).toEqual([
      { logGroupNamePrefix: '/aws/lambda/LedgerApp-' },
      { logGroupNamePrefix: '/ledger/' },
      { logGroupNamePrefix: '/ledger/', nextToken: '1' },
    ]);
    expect(result.pendingDeletion).toBe(1);
    expect(result.leftovers).toEqual([
      { service: 'secretsmanager', resource: 'secret:LedgerAppOther-MnOpQr' },
      { service: 'sqs', resource: 'LedgerApp-SourceQueue7A1B2C' },
      { service: 'logs', resource: 'log-group:/ledger/LedgerApp-ingest' },
      { service: 'logs', resource: 'log-group:/aws/lambda/LedgerApp-worker' },
      { service: 'logs', resource: 'log-group:/ledger/LedgerApp-api' },
    ]);
    expect(JSON.stringify(result)).not.toContain(account);
  });

  it('rejects with the SDK error unchanged on any other DescribeSecret failure (InternalServiceError)', async () => {
    const secretsStub = new StubClient().answer('DescribeSecret', () => {
      throw new InternalServiceError({ message: 'oops', ...metadata });
    });

    const failure = await listPostDestroyLeftovers(
      clients(tagging([[liveSecret]]), secretsStub, logs({})),
      scope,
    ).catch((caught: unknown) => caught);

    expect((failure as Error).name).toBe('InternalServiceError');
  });

  it('rejects with the SDK error unchanged when the tagging read fails (ThrottledException)', async () => {
    const taggingStub = new StubClient().answer('GetResources', () => {
      throw new ThrottledException({ message: 'slow', ...metadata });
    });

    const failure = await listPostDestroyLeftovers(
      clients(taggingStub, secretsManager(), logs({})),
      scope,
    ).catch((caught: unknown) => caught);

    expect((failure as Error).name).toBe('ThrottledException');
  });
});
