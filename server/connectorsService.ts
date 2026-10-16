export async function executeServerConnectorTool(
  connectorId: string, 
  toolName: string, 
  args: Record<string, any>,
  userId?: string
): Promise<{ success: boolean; data?: any; error?: string; message?: string }> {
  if (!userId || !userId.trim()) {
    return { success: false, error: 'AUTHENTICATED_USER_REQUIRED', message: 'Sign in before using a connector. A shared default user is not permitted.' };
  }
  const activeUserId = userId.trim();
  const query = args.query || args.search || args.topic || 'latest updates';

  if (connectorId === 'github' || toolName.startsWith('github_')) {
    const userTokenObj = getUserToken(activeUserId, 'github');
    const token = userTokenObj?.accessToken || null;
    return executeGitHubApiTool(toolName, args, token);
  }

  if (connectorId === 'github' || toolName.startsWith('github_')) {
    const userTokenObj = getUserToken(activeUserId, 'github');
    if (!userTokenObj?.accessToken) {
      return { success: false, error: 'GITHUB_NOT_CONNECTED', message: 'Connect your own GitHub account in Settings before running GitHub tools.' };
    }
    return executeGitHubApiTool(toolName, args, userTokenObj.accessToken);
  }

  return {
    success: false,
    error: 'CONNECTOR_NOT_IMPLEMENTED',
    message: `The ${connectorId} connector is not connected to a live provider API yet. No sample or simulated data was returned.`
  };
}

/**
 * Return current connectors registry and connection statuses for a user
 */
export function getConnectorsRegistry(userId: string) {
  const supported = [
    { id: 'github', name: 'GitHub', slug: 'github', key: 'github', keywords: ['github', 'repository', 'repos', 'pull request', 'issue'] },
    { id: 'slack', name: 'Slack', slug: 'slack', key: 'slack', keywords: ['slack', 'channel', 'message'] },
    { id: 'notion', name: 'Notion', slug: 'notion', key: 'notion', keywords: ['notion', 'page', 'database'] },
    { id: 'linear', name: 'Linear', slug: 'linear', key: 'linear', keywords: ['linear', 'issue', 'ticket'] },
    { id: 'dropbox', name: 'Dropbox', slug: 'dropbox', key: 'dropbox', keywords: ['dropbox', 'file'] },
    { id: 'outlook', name: 'Outlook', slug: 'outlook', key: 'outlook', keywords: ['outlook', 'email', 'calendar'] },
    { id: 'onedrive', name: 'OneDrive', slug: 'onedrive', key: 'onedrive', keywords: ['onedrive', 'document'] },
  ];
  return supported.map(c => {
    const token = getUserToken(userId, c.id);
    return {
      ...c,
      connected: Boolean(token),
      authenticated: Boolean(token),
      status: token ? 'connected' : 'not_connected',
    };
  });
}

