import type { Token } from '@ledger/sdk';
import { printable } from './create-output.ts';

// The token lines `ledger token create`, `revoke` and `current` share (design.md → Surfaces, Token
// object): `token`, `name`, `scope`, `created`. Never a hash; each command adds its own lines.

const LABEL_WIDTH = 12;

export const tokenField = (label: string, value: string): string =>
  `${label.padEnd(LABEL_WIDTH)}${value}`;

export function renderTokenLines(token: Token): string[] {
  return [
    tokenField('token', printable(token.token_id)),
    tokenField('name', printable(token.name)),
    tokenField('scope', printable(token.scope)),
    tokenField('created', printable(token.created_at)),
  ];
}
