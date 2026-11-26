import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  permissionsGateway,
  CHALLENGES_COLLECTION,
} from '../server/permissionsGateway';
import { InMemoryDurableStore, type DurableStore } from '../server/durable/store';

const GATEWAY_ENV_KEYS = ['POLICY_GATEWAY_SECRET', 'NODE_ENV', 'CONTEXT'] as const;

function snapshotEnv(): Record<string, string | undefined> {
  const snap: Record<string, string | undefined> = {};
  for (const k of GATEWAY_ENV_KEYS) snap[k] = process.env[k];
  return snap;
}

function restoreEnv(snap: Record<string, string | undefined>) {
  for (const k of GATEWAY_ENV_KEYS) {
    if (snap[k] === undefined) delete process.env[k];
    else process.env[k] = snap[k];
  }
}

describe('Feature 02: Persistent permissions & security audit', () => {
  let store: InMemoryDurableStore;

  beforeEach(() => {
    store = new InMemoryDurableStore();
    permissionsGateway.attachDurableStore(store);
  });

  afterEach(() => {
    delete process.env.CONTEXT;
    if (process.env.NODE_ENV === 'production') process.env.NODE_ENV = 'test';
  });

  it('creates durable pending challenges for sensitive actions', async () => {
    const evaluation = permissionsGateway.evaluateAction({
      toolName: 'git_push',
      args: { branch: 'main' },
      userId: 'usr_alice',
    });
    expect(evaluation.allowed).toBe(false);
    expect(evaluation.challenge).toBeDefined();
    const persisted = await store.get(CHALLENGES_COLLECTION, evaluation.challenge!.challengeId);
    expect(persisted).not.toBeNull();
    expect(persisted!.status).toBe('pending');
    expect(persisted!.userId).toBe('usr_alice');
    expect(persisted!.toolName).toBe('git_push');
    expect(persisted!.parametersHash).toBeTruthy();
  });

  it('persists an approval with a one-time approval token', async () => {
    const evaluation = permissionsGateway.evaluateAction({
      toolName: 'filesystem_write',
      args: { key: 'k', value: 'v' },
      userId: 'usr_alice',
    });
    expect(evaluation.challenge).toBeDefined();
    const approval = await permissionsGateway.resolveChallenge({
      challengeId: evaluation.challenge!.challengeId,
      confirmed: true,
      userId: 'usr_alice',
    });
    expect(approval.success).toBe(true);
    expect(approval.approvalToken).toMatch(/^appr_/);
    const stored = await store.get(CHALLENGES_COLLECTION, evaluation.challenge!.challengeId);
    expect(stored!.status).toBe('approved');

    const verification = await permissionsGateway.verifyApprovalToken({
      approvalToken: approval.approvalToken!,
      toolName: 'filesystem_write',
      args: { key: 'k', value: 'v' },
      userId: 'usr_alice',
    });
    expect(verification.valid).toBe(true);
  });

  it('records user rejection durably and never issues a token', async () => {
    const evaluation = permissionsGateway.evaluateAction({
      toolName: 'git_push',
      args: { branch: 'main' },
      userId: 'usr_bob',
    });
    const rejection = await permissionsGateway.resolveChallenge({
      challengeId: evaluation.challenge!.challengeId,
      confirmed: false,
      userId: 'usr_bob',
      reason: 'Not authorized by policy',
    });
    expect(rejection.success).toBe(true);
    expect(rejection.status).toBe('rejected');
    expect(rejection.approvalToken).toBeUndefined();
    const stored = await store.get(CHALLENGES_COLLECTION, evaluation.challenge!.challengeId);
    expect(stored!.status).toBe('rejected');
  });

  it('prevents replay: a second verification of the same token is rejected', async () => {
    const evaluation = permissionsGateway.evaluateAction({
      toolName: 'filesystem_write',
      args: { key: 'k2', value: 'v' },
      userId: 'usr_alice',
    });
    const approval = await permissionsGateway.resolveChallenge({
      challengeId: evaluation.challenge!.challengeId,
      confirmed: true,
      userId: 'usr_alice',
    });
    const token = approval.approvalToken!;
    const first = await permissionsGateway.verifyApprovalToken({
      approvalToken: token,
      toolName: 'filesystem_write',
      args: { key: 'k2', value: 'v' },
      userId: 'usr_alice',
    });
    const second = await permissionsGateway.verifyApprovalToken({
      approvalToken: token,
      toolName: 'filesystem_write',
      args: { key: 'k2', value: 'v' },
      userId: 'usr_alice',
    });
    expect(first.valid).toBe(true);
    expect(second.valid).toBe(false);
    expect(second.reason).toContain('replay');
  });

  it('expires approval tokens and rejects verification after expiry', async () => {
    const evaluation = permissionsGateway.evaluateAction({
      toolName: 'filesystem_write',
      args: { key: 'k3', value: 'v' },
      userId: 'usr_alice',
    });
    const approval = await permissionsGateway.resolveChallenge({
      challengeId: evaluation.challenge!.challengeId,
      confirmed: true,
      userId: 'usr_alice',
    });
    const doc = await store.get(CHALLENGES_COLLECTION, evaluation.challenge!.challengeId);
    await store.set(CHALLENGES_COLLECTION, evaluation.challenge!.challengeId, {
      ...doc!,
      expiresAt: Date.now() - 1000,
    });
    const verification = await permissionsGateway.verifyApprovalToken({
      approvalToken: approval.approvalToken!,
      toolName: 'filesystem_write',
      args: { key: 'k3', value: 'v' },
      userId: 'usr_alice',
    });
    expect(verification.valid).toBe(false);
    expect(verification.reason).toContain('expired');
  });

  it('isolates approvals by user: other users cannot approve or verify', async () => {
    const evaluation = permissionsGateway.evaluateAction({
      toolName: 'filesystem_write',
      args: { key: 'k4', value: 'v' },
      userId: 'usr_owner',
    });
    const stranger = await permissionsGateway.resolveChallenge({
      challengeId: evaluation.challenge!.challengeId,
      confirmed: true,
      userId: 'usr_stranger',
    });
    expect(stranger.success).toBe(false);

    const approval = await permissionsGateway.resolveChallenge({
      challengeId: evaluation.challenge!.challengeId,
      confirmed: true,
      userId: 'usr_owner',
    });
    const stolen = await permissionsGateway.verifyApprovalToken({
      approvalToken: approval.approvalToken!,
      toolName: 'filesystem_write',
      args: { key: 'k4', value: 'v' },
      userId: 'usr_stranger',
    });
    expect(stolen.valid).toBe(false);
    expect(stolen.reason).toContain('different user');

    const owner = await permissionsGateway.verifyApprovalToken({
      approvalToken: approval.approvalToken!,
      toolName: 'filesystem_write',
      args: { key: 'k4', value: 'v' },
      userId: 'usr_owner',
    });
    expect(owner.valid).toBe(true);
  });

  it('binds approval to action and parameters: swapped args fail verification', async () => {
    const evaluation = permissionsGateway.evaluateAction({
      toolName: 'filesystem_write',
      args: { path: 'a.txt', content: 'hello' },
      userId: 'usr_alice',
    });
    const approval = await permissionsGateway.resolveChallenge({
      challengeId: evaluation.challenge!.challengeId,
      confirmed: true,
      userId: 'usr_alice',
    });
    const tampered = await permissionsGateway.verifyApprovalToken({
      approvalToken: approval.approvalToken!,
      toolName: 'filesystem_write',
      args: { path: '../../etc/passwd', content: 'hello' },
      userId: 'usr_alice',
    });
    expect(tampered.valid).toBe(false);
    expect(tampered.reason).toContain('Parameter hash mismatch');

    const wrongTool = await permissionsGateway.verifyApprovalToken({
      approvalToken: approval.approvalToken!,
      toolName: 'delete_file',
      args: { path: 'a.txt', content: 'hello' },
      userId: 'usr_alice',
    });
    expect(wrongTool.valid).toBe(false);
  });

  it('persists audit records for approvals and denials', async () => {
    const evaluation = permissionsGateway.evaluateAction({
      toolName: 'git_push',
      args: { branch: 'audit-branch' },
      userId: 'usr_auditor',
    });
    await permissionsGateway.resolveChallenge({
      challengeId: evaluation.challenge!.challengeId,
      confirmed: true,
      userId: 'usr_auditor',
    });
    const evaluation2 = permissionsGateway.evaluateAction({
      toolName: 'purge_memories',
      args: { all: true },
      userId: 'usr_auditor',
    });
    await permissionsGateway.resolveChallenge({
      challengeId: evaluation2.challenge!.challengeId,
      confirmed: false,
      userId: 'usr_auditor',
    });
    const audit = await store.query('system_permission_audit', {});
    expect(audit.length).toBeGreaterThanOrEqual(2);
    const statuses = audit.map((r) => (r as any).status);
    expect(statuses).toContain('approved');
    expect(statuses).toContain('rejected');
    const who = audit.find((r) => (r as any).status === 'approved') as any;
    expect(who.userId).toBe('usr_auditor');
    expect(who.toolName).toBe('git_push');
    expect(typeof who.timestamp).toBe('string');
    expect(who.challengeId ?? evaluation.challenge!.challengeId).toBeTruthy();
  });

  it('supports permission revocation that blocks later evaluation', async () => {
    await permissionsGateway.revokePermission({ userId: 'usr_revoked', toolName: 'git_push', reason: 'compromised session' });
    const persisted = await store.get('system_permission_revocations', 'usr_revoked:git_push');
    expect(persisted).not.toBeNull();
    expect(persisted!.revokedAt).toBeGreaterThan(0);

    const evaluation = permissionsGateway.evaluateAction({
      toolName: 'git_push',
      args: { branch: 'main' },
      userId: 'usr_revoked',
      approvalToken: 'appr_unknown_token',
    });
    expect(evaluation.allowed).toBe(false);
    expect(evaluation.reason ?? '').toContain('revoked');
  });

  it('never issues challenges without an authenticated user', () => {
    const result = permissionsGateway.evaluateAction({
      toolName: 'git_push',
      args: { branch: 'main' },
    });
    expect(result.allowed).toBe(false);
    expect(result.challenge).toBeUndefined();
  });

  it('fails closed in production when the stable signing secret is missing', () => {
    const snap = snapshotEnv();
    try {
      process.env.NODE_ENV = 'production';
      process.env.CONTEXT = 'production';
      delete process.env.POLICY_GATEWAY_SECRET;
      const gateway = new (permissionsGateway.constructor as any)();
      const reason = gateway.failClosedReason();
      expect(reason).toContain('POLICY_GATEWAY_SECRET');
      const evaluation = gateway.evaluateAction({
        toolName: 'git_push',
        args: { branch: 'main' },
        userId: 'usr_x',
      });
      expect(evaluation.allowed).toBe(false);
      expect(evaluation.unavailable).toBe(true);
    } finally {
      restoreEnv(snap);
    }
  });

  it('uses a stable cryptographic secret for parameter binding (same args, same hash)', () => {
    const a = permissionsGateway.hashParameters({ path: 'x.txt', content: 'abc' });
    const b = permissionsGateway.hashParameters({ content: 'abc', path: 'x.txt' });
    const c = permissionsGateway.hashParameters({ path: 'y.txt', content: 'abc' });
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });
});
