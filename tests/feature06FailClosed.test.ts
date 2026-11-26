import { describe, expect, it } from 'vitest';
import { toolRegistry } from '../src/lib/toolFramework';

describe('Feature 06 fail-closed legacy execution tools', () => {
  it('fabricated-success handlers now report explicit unavailability', async () => {
    const del = await toolRegistry.executeTool('delete_file', { path: 'x.txt' }, { userId: 'u1' });
    expect(del.success).toBe(false);
    expect(del.error).toBe('WORKSPACE_RUNTIME_UNAVAILABLE');
    const commit = await toolRegistry.executeTool('commit_changes', { message: 'm' }, { userId: 'u1' });
    expect(commit.success).toBe(false);
    expect(commit.error).toBe('GIT_WORKSPACE_UNAVAILABLE');
    const push = await toolRegistry.executeTool('git_push', { branch: 'main' }, { userId: 'u1' });
    expect(push.success).toBe(false);
    const cmd = await toolRegistry.executeTool('run_command', { command: 'ls' }, { userId: 'u1' });
    expect(cmd.success).toBe(false);
    expect(cmd.error).toBe('SANDBOX_RUNTIME_UNAVAILABLE');
  });
});
