import { describe, expect, it } from 'vitest';
import { authErrorMessage, validateEmailAddress, validateNewPassword } from '../src/lib/authUi';

describe('authentication input validation', () => {
  it('rejects missing, malformed, and overlong email addresses', () => {
    expect(validateEmailAddress('  ')).toContain('Enter your email');
    expect(validateEmailAddress('not-an-email')).toContain('valid email');
    expect(validateEmailAddress(`${'a'.repeat(250)}@b.com`)).toContain('valid email');
  });

  it('accepts valid email addresses after trimming surrounding whitespace', () => {
    expect(validateEmailAddress('  person@example.com  ')).toBeNull();
  });

  it('requires a password length from 8 through 128 characters', () => {
    expect(validateNewPassword('short')).toContain('8 characters');
    expect(validateNewPassword('12345678')).toBeNull();
    expect(validateNewPassword('x'.repeat(129))).toContain('128 characters');
  });
});

describe('authentication error messaging', () => {
  it('uses a generic credential error rather than revealing account existence', () => {
    const unknown = authErrorMessage({ code: 'auth/user-not-found' }, 'sign-in');
    const wrongPassword = authErrorMessage({ code: 'auth/wrong-password' }, 'sign-in');
    expect(unknown).toBe(wrongPassword);
    expect(unknown).not.toContain('not found');
  });

  it('explains admin configuration failures without exposing raw provider details', () => {
    expect(authErrorMessage({ code: 'auth/unauthorized-domain', message: 'private error payload' }, 'google'))
      .toContain('not authorized');
    expect(authErrorMessage({ code: 'auth/unauthorized-domain', message: 'private error payload' }, 'google'))
      .not.toContain('private error payload');
  });

  it('treats a cancelled Google flow as recoverable', () => {
    expect(authErrorMessage({ code: 'auth/popup-closed-by-user' }, 'google')).toContain('cancelled');
  });
});
