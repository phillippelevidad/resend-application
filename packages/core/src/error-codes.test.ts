import { describe, expect, it } from 'vitest';
import {
  type ErrorCode,
  errorCodeSchema,
  errorCodes,
  errorRegistry,
  RUNBOOK_BASE_URL,
} from './error-codes.ts';

// api-contract.md → Error codes: run-outcome codes are stored on the run, and `api_unavailable` is
// raised by the SDK; none is an HTTP status of its own.
const statuslessCodes: readonly ErrorCode[] = [
  'webhook_disabled',
  'rate_limited',
  'resend_auth_failed',
  'resend_unavailable',
  'run_abandoned',
  'api_unavailable',
];

describe('errorRegistry', () => {
  it('has exactly one entry per code, so every surface finds a status, message, hint and docs', () => {
    expect(Object.keys(errorRegistry).sort()).toEqual([...errorCodes].sort());
    expect(new Set(errorCodes).size).toBe(errorCodes.length);
  });

  it.each(errorCodes)('%s has a non-empty message, hint and an https docs link', (code) => {
    const entry = errorRegistry[code];
    expect(entry.message).not.toBe('');
    expect(entry.hint).not.toBe('');
    expect(entry.docs).toMatch(/^https:\/\//);
  });

  it('gives run-outcome and client-side codes a null status, so the API never guesses one', () => {
    for (const code of errorCodes) {
      const { status } = errorRegistry[code];
      if (statuslessCodes.includes(code)) {
        expect(status, code).toBeNull();
      } else {
        expect(status, code).toBeGreaterThanOrEqual(400);
      }
    }
  });

  it('holds no { placeholder in any message, so no message is ever filled with an input value', () => {
    for (const code of errorCodes) {
      expect(errorRegistry[code].message, code).not.toContain('{');
    }
  });

  it('links each runbook entry by its code under the one base URL', () => {
    expect(errorRegistry.route_not_found.docs).toBe(`${RUNBOOK_BASE_URL}#route_not_found`);
    expect(RUNBOOK_BASE_URL).toBe(
      'https://github.com/phillippelevidad/resend-application/blob/main/docs/runbook.md',
    );
  });

  it('accepts every registered code and rejects an unregistered one', () => {
    for (const code of errorCodes) {
      expect(errorCodeSchema.parse(code)).toBe(code);
    }
    expect(errorCodeSchema.safeParse('not_found').success).toBe(false);
  });
});
