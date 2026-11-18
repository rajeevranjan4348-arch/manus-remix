export type AuthAction = 'sign-in' | 'sign-up' | 'google' | 'reset' | 'verify' | 'general';

export function validateEmailAddress(email: string): string | null {
  const value = email.trim();
  if (!value) return 'Enter your email address.';
  if (value.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
    return 'Enter a valid email address.';
  }
  return null;
}

export function validateNewPassword(password: string): string | null {
  if (password.length < 8) return 'Use at least 8 characters for your password.';
  if (password.length > 128) return 'Your password must be 128 characters or fewer.';
  return null;
}

export function authErrorMessage(error: unknown, action: AuthAction): string {
  const value = error as { code?: string; message?: string } | null;
  const code = value?.code || '';
  const message = value?.message || '';

  if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request' || /cancelled|canceled|popup closed/i.test(message)) {
    return 'Google sign-in was cancelled. You can try again whenever you’re ready.';
  }
  if (code === 'app/password-too-short') return 'Use at least 8 characters for your password.';
  if (code === 'app/google-client-not-configured' || code === 'app/google-token-missing') {
    return 'Google sign-in is not configured for this app yet. Please use email sign-in or contact the app administrator.';
  }
  if (code === 'auth/invalid-email' || code === 'auth/missing-email') return 'Enter a valid email address.';
  if (code === 'auth/email-already-in-use') return 'An account already uses this email. Sign in instead or reset your password.';
  if (code === 'auth/weak-password') return 'Choose a stronger password with at least 8 characters.';
  if (code === 'auth/invalid-credential' || code === 'auth/user-not-found' || code === 'auth/wrong-password' || code === 'auth/invalid-login-credentials') {
    return 'The email or password is incorrect. Check your details and try again.';
  }
  if (code === 'auth/too-many-requests') return 'Too many attempts. Wait a little while, then try again.';
  if (code === 'auth/network-request-failed') return 'You appear to be offline. Check your connection and try again.';
  if (code === 'auth/unauthorized-domain') return 'This app domain is not authorized for sign-in. Please contact the app administrator.';
  if (code === 'auth/operation-not-allowed') return 'This sign-in method is not enabled yet. Please contact the app administrator.';
  if (code === 'auth/popup-blocked') return 'Your browser blocked the Google sign-in window. Allow pop-ups for this app and try again.';
  if (code === 'auth/account-exists-with-different-credential') return 'An account already exists with this email using another sign-in method. Try that method.';
  if (code === 'auth/expired-action-code' || code === 'auth/invalid-action-code') return 'This email link has expired or was already used. Request a new link and try again.';

  switch (action) {
    case 'sign-in': return 'We couldn’t sign you in. Check your details and try again.';
    case 'sign-up': return 'We couldn’t create your account. Please try again.';
    case 'google': return 'Google sign-in couldn’t be completed. Please try again.';
    case 'reset': return 'We couldn’t send the reset email. Check the address and try again.';
    case 'verify': return 'We couldn’t send the verification email. Please try again.';
    default: return 'Something went wrong. Please try again.';
  }
}
