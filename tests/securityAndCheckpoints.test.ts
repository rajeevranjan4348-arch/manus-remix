import { describe, it, expect, beforeEach } from 'vitest';
import { permissionsGateway } from '../server/permissionsGateway';
import { taskCheckpoint } from '../src/lib/taskCheckpoint';
import { toolRegistry } from '../src/lib/toolFramework';
import { settingsStore } from '../src/lib/settingsStore';

describe('Centralized Permission Gateway, Security Review & Durable Checkpoints', () => {
  beforeEach(() => {
    if (typeof localStorage !== 'undefined') {
      localStorage.clear();
    }
  });

  describe('Centralized Server-Side Permission / Policy Gateway', () => {
    it('categorizes tool actions by risk into read-only, destructive, and privileged', () => {
      const readOnlyPolicy = permissionsGateway.getPolicy('web_search');
      expect(readOnlyPolicy.riskLevel).toBe('read-only');
      expect(readOnlyPolicy.requiresConfirmation).toBe(false);

      const destructivePolicy = permissionsGateway.getPolicy('delete_file');
      expect(destructivePolicy.riskLevel).toBe('destructive');
      expect(destructivePolicy.requiresConfirmation).toBe(true);

      const privilegedPolicy = permissionsGateway.getPolicy('git_push');
      expect(privilegedPolicy.riskLevel).toBe('privileged');
      expect(privilegedPolicy.requiresConfirmation).toBe(true);
    });

    it('automatically allows read-only operations without requiring user confirmation', () => {
      const result = permissionsGateway.evaluateAction({
        toolName: 'web_search',
        args: { query: 'latest typescript features 2026' },
        userId: 'usr_alice',
      });

      expect(result.allowed).toBe(true);
      expect(result.riskLevel).toBe('read-only');
      expect(result.requiresApproval).toBe(false);
      expect(result.challenge).toBeUndefined();
    });

    it('blocks destructive operations and creates an explicit confirmation challenge', () => {
      const result = permissionsGateway.evaluateAction({
        toolName: 'delete_file',
        args: { path: 'src/legacy/data.json' },
        userId: 'usr_alice',
      });

      expect(result.allowed).toBe(false);
      expect(result.riskLevel).toBe('destructive');
      expect(result.requiresApproval).toBe(true);
      expect(result.challenge).toBeDefined();
      expect(result.challenge?.toolName).toBe('delete_file');
      expect(result.challenge?.status).toBe('pending');
      expect(result.challenge?.parametersHash).toBeDefined();
    });

    it('blocks privileged operations (such as git_push or run_command) pending explicit confirmation', () => {
      const result = permissionsGateway.evaluateAction({
        toolName: 'git_push',
        args: { branch: 'main' },
        userId: 'usr_alice',
      });

      expect(result.allowed).toBe(false);
      expect(result.riskLevel).toBe('privileged');
      expect(result.requiresApproval).toBe(true);
      expect(result.challenge).toBeDefined();
      expect(result.challenge?.toolName).toBe('git_push');
    });

    it('detects parameter tampering via cryptographic hash', () => {
      const evaluation = permissionsGateway.evaluateAction({
        toolName: 'delete_file',
        args: { path: 'test_temp.txt' },
        userId: 'usr_alice',
      });

      const challengeId = evaluation.challenge!.challengeId;
      const approval = permissionsGateway.resolveChallenge({
        challengeId,
        confirmed: true,
        userId: 'usr_alice',
      });

      expect(approval.success).toBe(true);
      expect(approval.approvalToken).toBeDefined();

      // Attempt execution with TAMPERED args (trying to delete package.json instead of test_temp.txt)
      const verification = permissionsGateway.verifyApprovalToken({
        approvalToken: approval.approvalToken!,
        toolName: 'delete_file',
        args: { path: 'package.json' }, // TAMPERED!
        userId: 'usr_alice',
      });

      expect(verification.valid).toBe(false);
      expect(verification.reason).toContain('Parameter hash mismatch');
    });

    it('mints single-use approval token and prevents replay attacks by burning on execution', () => {
      const evaluation = permissionsGateway.evaluateAction({
        toolName: 'run_command',
        args: { command: 'npm run test' },
        userId: 'usr_alice',
      });

      const challengeId = evaluation.challenge!.challengeId;
      const approval = permissionsGateway.resolveChallenge({
        challengeId,
        confirmed: true,
        userId: 'usr_alice',
      });

      const token = approval.approvalToken!;

      // 1st Execution: valid
      const firstExec = permissionsGateway.verifyApprovalToken({
        approvalToken: token,
        toolName: 'run_command',
        args: { command: 'npm run test' },
        userId: 'usr_alice',
      });
      expect(firstExec.valid).toBe(true);

      // 2nd Execution attempt: REPLAY ATTACK BLOCKED
      const secondExec = permissionsGateway.verifyApprovalToken({
        approvalToken: token,
        toolName: 'run_command',
        args: { command: 'npm run test' },
        userId: 'usr_alice',
      });
      expect(secondExec.valid).toBe(false);
      expect(secondExec.reason).toContain('replay attack');
    });

    it('rejects expired challenges', () => {
      const evaluation = permissionsGateway.evaluateAction({
        toolName: 'purge_memories',
        args: { all: true },
        userId: 'usr_alice',
      });

      const challenge = evaluation.challenge!;
      // Artificially expire the challenge
      challenge.expiresAt = Date.now() - 5000;

      const resolution = permissionsGateway.resolveChallenge({
        challengeId: challenge.challengeId,
        confirmed: true,
        userId: 'usr_alice',
      });

      expect(resolution.success).toBe(false);
      expect(resolution.status).toBe('expired');
    });
  });

  describe('Application Security Review: Secrets & Validation', () => {
    it('ensures settingsStore has no hardcoded API keys by default', () => {
      const settings = settingsStore.get();
      expect(settings.openRouterApiKey).toBe('');
      expect(settings.workModeApiKey).toBe('');
    });

    it('enforces tool framework execution gates for destructive and privileged actions', async () => {
      // Destructive tool without approval must fail with APPROVAL_REQUIRED
      const res = await toolRegistry.executeTool(
        'delete_file',
        { path: 'test.txt' },
        { userId: 'usr_test', isApprovalGranted: false }
      );

      expect(res.success).toBe(false);
      expect(res.error).toBe('APPROVAL_REQUIRED');
      expect(res.summary).toContain('requires explicit user confirmation');
    });

    it('allows destructive tool execution when explicit approval is granted', async () => {
      const res = await toolRegistry.executeTool(
        'delete_file',
        { path: 'test.txt' },
        { userId: 'usr_test', isApprovalGranted: true }
      );

      expect(res.success).toBe(true);
      expect(res.data?.deleted).toBe(true);
    });
  });

  describe('Durable Task Checkpoints & State Revalidation', () => {
    it('creates durable checkpoint with integrity checksum', () => {
      const cp = taskCheckpoint.saveCheckpoint({
        taskId: 'task_resilience_101',
        conversationId: 'conv_resilience',
        stepIndex: 2,
        totalSteps: 5,
        stepLabel: 'Data processing complete',
        completedToolCalls: [
          { toolName: 'web_search', args: { query: 'crypto prices' }, outputSummary: 'Retrieved 5 assets' },
          { toolName: 'calculate', args: { expression: '100 * 1.05' }, outputSummary: '105' },
        ],
        accumulatedResult: 'Phase 1 and 2 synthesis...',
      });

      expect(cp.id).toBe('chk_task_resilience_101_step_2');
      expect(cp.checksum).toBeDefined();
      expect(cp.checksum.startsWith('chk_')).toBe(true);

      const latest = taskCheckpoint.getLatestCheckpoint('task_resilience_101');
      expect(latest?.stepIndex).toBe(2);
      expect(latest?.accumulatedResult).toBe('Phase 1 and 2 synthesis...');
    });

    it('revalidates state and enables task resumption after interruption or session refresh', () => {
      taskCheckpoint.saveCheckpoint({
        taskId: 'task_resilience_102',
        conversationId: 'conv_resilience_2',
        stepIndex: 3,
        totalSteps: 6,
        stepLabel: 'Compiling final summary',
        completedToolCalls: [
          { toolName: 'calculate', args: { expression: '50 * 2' }, outputSummary: '100' },
        ],
        accumulatedResult: 'Interrupted mid-way result',
        status: 'in_progress',
      });

      const reval = taskCheckpoint.revalidateAndResume('task_resilience_102');
      expect(reval.canResume).toBe(true);
      expect(reval.nextStepIndex).toBe(4); // Advances to step 4 seamlessly
      expect(reval.restoredContext).toBe('Interrupted mid-way result');
      expect(reval.checkpoint?.taskId).toBe('task_resilience_102');
    });

    it('rejects resumption if checkpoint state checksum is corrupted or tampered with', () => {
      const cp = taskCheckpoint.saveCheckpoint({
        taskId: 'task_resilience_103',
        conversationId: 'conv_resilience_3',
        stepIndex: 1,
        stepLabel: 'Valid initial step',
        status: 'in_progress',
      });

      // Tamper with the checkpoint data (simulating corruption in storage)
      cp.accumulatedResult = 'TAMPERED OR CORRUPTED PAYLOAD';

      const reval = taskCheckpoint.revalidateAndResume('task_resilience_103');
      expect(reval.canResume).toBe(false);
      expect(reval.reason).toContain('integrity check failed');
    });

    it('prevents resuming an already completed task', () => {
      taskCheckpoint.saveCheckpoint({
        taskId: 'task_resilience_104',
        conversationId: 'conv_resilience_4',
        stepIndex: 5,
        totalSteps: 5,
        stepLabel: 'All steps done',
        status: 'completed',
        accumulatedResult: 'Final completed report',
      });

      const reval = taskCheckpoint.revalidateAndResume('task_resilience_104');
      expect(reval.canResume).toBe(false);
      expect(reval.reason).toContain('already completed');
    });
  });
});
