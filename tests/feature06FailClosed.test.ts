import { describe, expect, it } from 'vitest';
import { toolRegistry } from '../src/lib/toolFramework';

describe('Feature 06 fail-closed legacy execution tools', () => {
  it('fabricated-success handlers now report explicit unavailability', async () => {
    const fails = async (name: string, args: Record<string, unknown>) => {
      const out = await toolRegistry.executeTool(name, args, { userId: 'u1' });
      expect(out.success).toBe(false);
      expect(String(out.error || out.summary)).not.toMatch(/success|executed successfully|created verified commit|pushed/i);
    };

    await Promise.all(
      ['delete_file', 'commit_changes', 'git_push', 'run_command'].map((name) => fails(name, { path: 'x.txt', message: 'm', branch: 'main', command: 'ls' })),
    );
  });

  it('handler-level errors stay explicit when the approval gate is already satisfied', async () => {
    const approved = { userId: 'u1', isApprovalGranted: true } as any;
    const del = await toolRegistry.executeTool('delete_file', { path: 'x.txt' }, approved);
    expect(del.success).toBe(false);
    expect(String(del.error)).toContain('isolated sandbox workspace');
    const commit = await toolRegistry.executeTool('commit_changes', { message: 'm' }, approved);
    expect(commit.success).toBe(false);
    expect(commit.error).toBe('GIT_WORKSPACE_UNAVAILABLE');
    const push = await toolRegistry.executeTool('git_push', { branch: 'main' }, approved);
    expect(push.success).toBe(false);
    const cmd = await toolRegistry.executeTool('run_command', { command: 'ls' }, approved);
    expect(cmd.success).toBe(false);
  });
});
