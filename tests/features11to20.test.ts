import { describe, it, expect, beforeEach } from 'vitest';
import { approvalManager } from '../src/lib/approvalManager';
import { taskCheckpoint } from '../src/lib/taskCheckpoint';
import { modelRouter, SUPPORTED_MODELS } from '../src/lib/modelRouter';
import { sanitizeFilename, formatFileSize } from '../src/lib/fileValidation';
import { scheduledAgents } from '../src/lib/scheduledAgents';

describe('Features 11-20: Security, Recovery, Scheduling & Intelligence Test Suite', () => {
  beforeEach(() => {
    if (typeof localStorage !== 'undefined') {
      localStorage.clear();
    }
  });

  describe('Feature 11: Human Approval & Permission Gateway', () => {
    it('proposes sensitive action with pending status and explicit consequences', () => {
      const action = approvalManager.proposeAction({
        toolName: 'delete_file',
        title: 'Delete build directory',
        description: 'Remove legacy build output from filesystem',
        target: '/dist/legacy',
        parameters: { path: '/dist/legacy', recursive: true },
        riskLevel: 'destructive',
        consequences: ['This permanently removes all generated build artifacts.'],
      });

      expect(action.id).toBeDefined();
      expect(action.status).toBe('pending');
      expect(action.riskLevel).toBe('destructive');
      expect(action.target).toBe('/dist/legacy');
      expect(action.consequences).toHaveLength(1);
      
      const pendingList = approvalManager.getPendingActions();
      expect(pendingList.some(a => a.id === action.id)).toBe(true);
    });

    it('approves pending action and transitions status to approved', () => {
      const action = approvalManager.proposeAction({
        toolName: 'git_push',
        title: 'Git Push to main',
        description: 'Push verified commits to remote repository',
        parameters: { branch: 'main' },
        riskLevel: 'sensitive',
      });

      const approved = approvalManager.approveAction(action.id);
      expect(approved).toBe(true);

      const actionDetails = approvalManager.getAction(action.id);
      expect(actionDetails?.status).toBe('approved');
      expect(actionDetails?.resolvedAt).toBeDefined();
    });

    it('rejects pending action with user reason', () => {
      const action = approvalManager.proposeAction({
        toolName: 'run_command',
        title: 'Execute arbitrary script',
        description: 'Run unverified shell script',
        parameters: { cmd: 'rm -rf /' },
        riskLevel: 'destructive',
      });

      const rejected = approvalManager.rejectAction(action.id, 'Unsafe operation forbidden by policy');
      expect(rejected).toBe(true);

      const actionDetails = approvalManager.getAction(action.id);
      expect(actionDetails?.status).toBe('rejected');
    });

    it('expires stale actions when expiry time has elapsed', () => {
      const action = approvalManager.proposeAction({
        toolName: 'webhook_dispatch',
        title: 'Dispatch webhook',
        description: 'Notify remote listener',
        parameters: { url: 'https://api.example.com' },
        riskLevel: 'moderate',
        expiresInMs: -1000, // already expired
      });

      // Querying should automatically trigger expiry check
      const actionDetails = approvalManager.getAction(action.id);
      expect(actionDetails?.status).toBe('expired');
    });
  });

  describe('Feature 12: Checkpoint & Session Recovery', () => {
    it('saves task checkpoint with intermediate steps and accumulated results', () => {
      const checkpoint = taskCheckpoint.saveCheckpoint({
        taskId: 'tsk_alpha_01',
        conversationId: 'conv_123',
        stepIndex: 3,
        stepLabel: 'Synthesizing market research',
        completedToolCalls: [
          { toolName: 'web_search', args: { query: 'AI agents 2026' }, outputSummary: 'Found 10 sources' },
          { toolName: 'file_read', args: { path: 'notes.txt' }, outputSummary: 'Loaded notes' },
        ],
        accumulatedResult: 'Preliminary research draft...',
      });

      expect(checkpoint.id).toBe('chk_tsk_alpha_01_step_3');
      expect(checkpoint.completedToolCalls).toHaveLength(2);

      const loaded = taskCheckpoint.getLatestCheckpoint('tsk_alpha_01');
      expect(loaded).toBeDefined();
      expect(loaded?.stepIndex).toBe(3);
      expect(loaded?.stepLabel).toBe('Synthesizing market research');
    });

    it('clears checkpoint once task finishes successfully', () => {
      taskCheckpoint.saveCheckpoint({
        taskId: 'tsk_alpha_02',
        conversationId: 'conv_456',
        stepIndex: 1,
        stepLabel: 'Initial step',
      });

      expect(taskCheckpoint.getLatestCheckpoint('tsk_alpha_02')).toBeDefined();
      taskCheckpoint.clearCheckpoint('tsk_alpha_02');
      expect(taskCheckpoint.getLatestCheckpoint('tsk_alpha_02')).toBeNull();
    });
  });

  describe('Feature 7: Model Router & Provider Affinity', () => {
    it('routes coding tasks to code-specialized model profile', () => {
      const route = modelRouter.route(
        'Refactor this TypeScript interface and write a recursive sorting function in Python'
      );

      expect(route.taskType).toBe('coding');
      expect(route.selectedModel).toBeDefined();
      expect(route.fallbackModels.length).toBeGreaterThan(0);
      expect(route.temperature).toBeLessThanOrEqual(0.3); // coding uses deterministic low temp
    });

    it('routes web research tasks with appropriate search-grounded temperature', () => {
      const route = modelRouter.route(
        'Search the web for the latest updates on quantum computing breakthroughs'
      );

      expect(route.taskType).toBe('web_research');
      expect(route.selectedModel).toBe('gemini-3.8-flash');
      expect(route.fallbackModels).toContain('gemini-3.1-pro-preview');
    });

    it('routes quick greetings and chats to fast chat model profile', () => {
      const route = modelRouter.route('Hello! How are you doing today?');

      expect(route.taskType).toBe('fast_chat');
      expect(route.temperature).toBeGreaterThanOrEqual(0.7);
    });

    it('supports 2 Million context window and routes massive context tasks accordingly', () => {
      const route = modelRouter.route('Analyze this full repository with the 2 million context window enabled');
      expect(route.selectedModel).toBe('gemini-3.1-pro-preview');
      expect(route.reason).toContain('2,000,000 token context window');

      const model2M = SUPPORTED_MODELS.find(m => m.id === 'gemini-3.1-pro-preview');
      expect(model2M).toBeDefined();
      expect(model2M?.contextWindow).toBe(2097152); // 2 Million tokens

      const manus2M = SUPPORTED_MODELS.find(m => m.id === 'manus-1.6-max');
      expect(manus2M).toBeDefined();
      expect(manus2M?.contextWindow).toBe(2097152); // 2 Million tokens
    });
  });

  describe('Feature 9: File Validation & Security Sanitization', () => {
    it('sanitizes filename to prevent directory traversal and invalid characters', () => {
      expect(sanitizeFilename('../../../etc/passwd')).toBe('passwd');
      expect(sanitizeFilename('..\\..\\windows\\system32\\cmd.exe')).toBe('cmd.exe');
      expect(sanitizeFilename('report_quarterly_v2.pdf')).toBe('report_quarterly_v2.pdf');
      expect(sanitizeFilename('')).toBe('unnamed_file');
    });

    it('formats file sizes into human-readable units accurately', () => {
      expect(formatFileSize(0)).toBe('0 B');
      expect(formatFileSize(1024)).toBe('1.0 KB');
      expect(formatFileSize(1048576)).toBe('1.0 MB');
      expect(formatFileSize(5242880)).toBe('5.0 MB');
    });
  });

  describe('Feature 10: Scheduled Agents Manager', () => {
    it('calculates accurate next run timestamps for hourly, daily, and weekly schedules', () => {
      const now = Date.now();

      const nextHourly = new Date(scheduledAgents.calculateNextRun('hourly')).getTime();
      expect(nextHourly).toBeGreaterThan(now + 50 * 60 * 1000);
      expect(nextHourly).toBeLessThanOrEqual(now + 65 * 60 * 1000);

      const nextDaily = new Date(scheduledAgents.calculateNextRun('daily')).getTime();
      expect(nextDaily).toBeGreaterThan(now + 23 * 60 * 60 * 1000);
      expect(nextDaily).toBeLessThanOrEqual(now + 25 * 60 * 60 * 1000);

      const nextWeekly = new Date(scheduledAgents.calculateNextRun('weekly')).getTime();
      expect(nextWeekly).toBeGreaterThan(now + 6 * 24 * 60 * 60 * 1000);
    });

    it('calculates custom minutes interval accurately', () => {
      const now = Date.now();
      const next15Min = new Date(scheduledAgents.calculateNextRun('custom_minutes', 15)).getTime();
      expect(next15Min).toBeGreaterThan(now + 14 * 60 * 1000);
      expect(next15Min).toBeLessThanOrEqual(now + 16 * 60 * 1000);
    });
  });
});
