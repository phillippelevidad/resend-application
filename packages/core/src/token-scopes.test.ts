import { describe, expect, it } from 'vitest';
import { tokenScopeSchema, tokenScopes } from './token-scopes.ts';

describe('tokenScopeSchema', () => {
  it.each(tokenScopes)('accepts %s, so a token of that scope can be stored', (scope) => {
    expect(tokenScopeSchema.parse(scope)).toBe(scope);
  });

  it('rejects admin, so no scope outside read and operate is ever granted', () => {
    expect(tokenScopeSchema.safeParse('admin').success).toBe(false);
  });

  it('holds exactly read and operate, the two scopes api_tokens CHECK allows', () => {
    expect([...tokenScopes]).toEqual(['read', 'operate']);
  });
});
