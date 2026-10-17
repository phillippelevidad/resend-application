import { describe, expect, it } from 'vitest';
import { maskFrom } from './mask-from.ts';

describe('maskFrom', () => {
  it('masks a Name <addr> sender: name as text, address as an address, < and > kept', () => {
    expect(maskFrom('Billing Team <onboarding@resend.dev>')).toBe(
      'Bi***** T*** <onb*******@r*****.d**>',
    );
  });

  it('masks a bare sender as an address', () => {
    expect(maskFrom('delivered@resend.dev')).toBe('del******@r*****.d**');
  });

  it('masks a sender with < but no closing > as one address', () => {
    expect(maskFrom('Billing <delivered@resend.dev')).toBe('Bil***************@r*****.d**');
  });

  it('splits at the last <, so a < inside the display name stays part of the name', () => {
    expect(maskFrom('a<b Team <delivered@resend.dev>')).toBe('*<* T*** <del******@r*****.d**>');
  });

  it('maps an ESC in the display name to *, so no terminal escape reaches CLI output', () => {
    const masked = maskFrom('\u001b[31mBilling <delivered@resend.dev>');
    expect(masked).toBe('*[**m******* <del******@r*****.d**>');
    expect(masked).not.toMatch(/\p{Cc}/u);
  });

  it('masks digits in the display name and the address', () => {
    const masked = maskFrom('Team 42 <user123456@resend.dev>');
    expect(masked).toBe('T*** ** <use*******@r*****.d**>');
    expect(masked).not.toMatch(/\p{Nd}/u);
  });
});
