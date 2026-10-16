import { maskAddress } from './mask-address.ts';
import { maskText } from './mask-text.ts';

// D13: masks a sender. `Name <address>` masks the name as text and the address as an address,
// keeping `<` and `>`. Splitting at the last `<` keeps the length, and the masked parts hold no
// new `<` or `>`, so a second pass splits at the same place and the mask stays idempotent.
export function maskFrom(from: string): string {
  const lt = from.lastIndexOf('<');
  if (lt === -1 || !from.endsWith('>')) {
    return maskAddress(from);
  }
  return `${maskText(from.slice(0, lt))}<${maskAddress(from.slice(lt + 1, -1))}>`;
}
