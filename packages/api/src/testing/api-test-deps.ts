import type { TokenScope } from '@ledger/core';
import { apiTokensRepository, type Executor, STORAGE_LIMIT_BYTES } from '@ledger/db';
import { InProcessQueueAdapter, type Logger, mintApiToken } from '@ledger/shared';
import {
  FakeAsyncFunctionInvoke,
  FakeClock,
  FakeEventSourceControl,
  FakeFunctionInvoke,
  FakeQueueAttributes,
} from '@ledger/shared/testing';
import type { ApiDeps } from '../create-api.ts';

// The tag key every test app is built with; a token minted under another key fails the tag check.
export const TEST_TOKEN_TAG_KEY = new Uint8Array(32).fill(0x5a);

export type TestToken = { token: string; tokenId: number };

// Mints a token under the test tag key and inserts its row through the repository, as
// `token.create` does, so the middleware's lookup finds it. Fresh per call: a test asserts on its
// own token only.
export async function issueTestToken(
  db: Executor,
  {
    scope,
    name = `test-${scope}`,
    tagKey = TEST_TOKEN_TAG_KEY,
  }: {
    scope: TokenScope;
    name?: string;
    tagKey?: Uint8Array;
  },
): Promise<TestToken> {
  const { token, tokenHash } = mintApiToken(tagKey);
  const row = await apiTokensRepository.insert(db, { name, tokenHash, scope });
  return { token, tokenId: row.id };
}

// The request header a token travels in.
export function bearer(token: string): { authorization: string } {
  return { authorization: `Bearer ${token}` };
}

const silentLogger: Logger = { info: () => {}, warn: () => {}, error: () => {} };

// `ApiDeps` over `db`, the test tag key and stateful fakes at every port (pp-testing → Fakes at the
// port); a test overrides what it asserts on.
export function testApiDeps(db: Executor, overrides: Partial<ApiDeps> = {}): ApiDeps {
  return {
    db,
    logger: silentLogger,
    addressHashKey: new Uint8Array(32).fill(1),
    tokenTagKey: TEST_TOKEN_TAG_KEY,
    requestId: () => 'req-test',
    queueAttributes: new FakeQueueAttributes(),
    eventSource: new FakeEventSourceControl(),
    workerInvoke: new FakeFunctionInvoke({ outcome: 'already_enabled', state: 'enabled' }),
    // The real in-process queue, as local mode composes it (slice 3 D9); its dead list starts empty.
    dlq: new InProcessQueueAdapter({ clock: new FakeClock(), logger: silentLogger }),
    reconcilerInvoke: new FakeAsyncFunctionInvoke(),
    // Wall-clock time: `reconcile_runs.started_at` is Postgres's `now()`, so a run's derived
    // outcome and the start's horizon read a clock near it (slice 4 D43).
    clock: { now: () => new Date() },
    storageLimitBytes: STORAGE_LIMIT_BYTES,
    ...overrides,
  };
}
