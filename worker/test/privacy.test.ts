import { describe, expect, it } from 'vitest';

import { firstName, maskPhone } from '../src/lib/privacy';

describe('privacy', () => {
  it('keeps only the first name', () => {
    expect(firstName('Juan Dela Cruz')).toBe('Juan');
    expect(firstName('  Ana  ')).toBe('Ana');
    expect(firstName('')).toBe('');
  });

  it('masks the middle of a phone number', () => {
    expect(maskPhone('09171234567')).toBe('0917•••4567');
    expect(maskPhone('+639171234567')).toBe('+639•••4567');
    expect(maskPhone('12345')).toBe('•••');
    expect(maskPhone('')).toBe('');
  });
});
