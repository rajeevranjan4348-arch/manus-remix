import { describe, expect, it } from 'vitest';
import { toolRegistry } from '../src/lib/toolFramework';

describe('Feature 06 fail-closed execution placeholders', () => {
  it.each([
    ['run_command', { command: 'node -v' }, 'SANDBOX_PROVIDER_UNAVAILABLE'],
    ['delete_file', { path: 'src/important.ts' }, 'WORKSPACE_RUNTIME_UNAVAILABLE'],
    ['commit_changes', { message: 'test commit' }, 'GIT_WORKSPACE_UNAVAILABLE'],
    ['git_push', { branch: 'main' }, 'GIT_REMOTE_UNAVAILABLE'],
  ])('%s never reports success without a real provider', async (name, args, expectedError) => {
    const result = await toolRegistry.executeTool(name, args, {
      userId: 'test-user',
      isApprovalGranted: true,
    });
    expect(result.success).toBe(false);
    expect(result.error).toBe(expectedError);
  });
});
