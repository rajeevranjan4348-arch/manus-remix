import { describe, expect, it } from 'vitest';
import {
  disconnectUserToken,
  executeServerConnectorTool,
  getUserToken,
} from './connectorsService';

describe('connector failure handling', () => {
  it('requires an explicit user identity before executing a connector', async () => {
    const result = await executeServerConnectorTool('github', 'github_list_repos', {}, undefined);

    expect(result.success).toBe(false);
    expect(result.error).toBe('AUTHENTICATED_USER_REQUIRED');
  });

  it('does not return simulated success for an unimplemented provider', async () => {
    const result = await executeServerConnectorTool('notion', 'notion_search', { query: 'roadmap' }, 'test-user');

    expect(result.success).toBe(false);
    expect(result.error).toBe('CONNECTOR_NOT_IMPLEMENTED');
    expect(result.message).toContain('No sample or simulated data was returned');
  });

  it('does not claim a connector is connected without a stored user token', () => {
    expect(getUserToken('test-user-without-token', 'github')).toBeNull();
  });

  it('reports a missing connection instead of claiming it disconnected', () => {
    expect(disconnectUserToken('test-user-without-token', 'github')).toBe(false);
  });
});
