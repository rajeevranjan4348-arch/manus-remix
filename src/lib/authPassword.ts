/**
 * Account Password & Security Manager
 * Used for authorizing critical operations like permanently deleting Permanent Chats.
 */

const PASSWORD_KEY = 'manus_account_password';
export const DEFAULT_PASSWORD = 'password123';

export function getAccountPassword(): string {
  try {
    const pwd = localStorage.getItem(PASSWORD_KEY);
    return pwd && pwd.trim() ? pwd.trim() : DEFAULT_PASSWORD;
  } catch {
    return DEFAULT_PASSWORD;
  }
}

export function setAccountPassword(newPassword: string): boolean {
  try {
    if (!newPassword || newPassword.trim().length < 4) {
      return false;
    }
    localStorage.setItem(PASSWORD_KEY, newPassword.trim());
    window.dispatchEvent(new CustomEvent('manus_password_updated', { detail: newPassword.trim() }));
    return true;
  } catch (err) {
    console.error('Failed to save account password:', err);
    return false;
  }
}

export function verifyAccountPassword(inputPassword: string): boolean {
  if (!inputPassword) return false;
  const current = getAccountPassword();
  return inputPassword.trim() === current.trim();
}
