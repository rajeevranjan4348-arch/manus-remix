import { beforeEach, describe, expect, it, vi } from 'vitest';

const { authMock } = vi.hoisted(() => ({ authMock: { currentUser: null as any } }));
vi.mock('../src/lib/firebase', () => ({ auth: authMock }));

import { getFirebaseAuthorizationHeader } from '../src/lib/firebaseAuthorization';

describe('Firebase API authorization header', () => {
  beforeEach(() => {
    authMock.currentUser = null;
  });

  it('returns null when the app has no signed-in Firebase user', async () => {
    await expect(getFirebaseAuthorizationHeader()).resolves.toBeNull();
  });

  it('uses the current Firebase ID token as a Bearer header', async () => {
    authMock.currentUser = { getIdToken: vi.fn().mockResolvedValue('firebase-id-token') };
    await expect(getFirebaseAuthorizationHeader()).resolves.toBe('Bearer firebase-id-token');
    expect(authMock.currentUser.getIdToken).toHaveBeenCalledOnce();
  });

  it('fails closed when Firebase cannot refresh the ID token', async () => {
    authMock.currentUser = { getIdToken: vi.fn().mockRejectedValue(new Error('network')) };
    await expect(getFirebaseAuthorizationHeader()).resolves.toBeNull();
  });
});
