import crypto from 'crypto';

export interface OAuthSessionState {
  stateToken: string;
  connectorId: string;
  userId?: string;
  createdAt: number;
}

export interface EncryptedTokenData {
  iv: string;
  encryptedData: string;
  authTag: string;
  expiresAt?: number;
  user?: any;
}

// AES-256-GCM Encryption key derived securely
const ENCRYPTION_ALGORITHM = 'aes-256-gcm';
const MASTER_KEY = process.env.TOKEN_ENCRYPTION_SECRET
  ? crypto.scryptSync(process.env.TOKEN_ENCRYPTION_SECRET, 'manus_connector_salt_2026', 32)
  : null;

function requireMasterKey(): Buffer {
  if (!MASTER_KEY) {
    throw new Error('TOKEN_ENCRYPTION_SECRET must be configured before connector tokens can be stored.');
  }
  return MASTER_KEY;
}

/**
 * Encrypt token string at rest using AES-256-GCM
 */
export function encryptToken(plainText: string): { iv: string; encryptedData: string; authTag: string } {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ENCRYPTION_ALGORITHM, requireMasterKey(), iv);
  let encrypted = cipher.update(plainText, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag().toString('hex');
  return { iv: iv.toString('hex'), encryptedData: encrypted, authTag };
}

/**
 * Decrypt token string from encrypted data structure
 */
export function decryptToken(encrypted: { iv: string; encryptedData: string; authTag: string }): string {
  const decipher = crypto.createDecipheriv(
    ENCRYPTION_ALGORITHM,
    requireMasterKey(),
    Buffer.from(encrypted.iv, 'hex')
  );
  decipher.setAuthTag(Buffer.from(encrypted.authTag, 'hex'));
  let decrypted = decipher.update(encrypted.encryptedData, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

// Per-User Secure Encrypted Token Store (at rest in server memory vault)
// Key: `${userId}:${connectorId}` -> EncryptedTokenData
const userTokenVault = new Map<string, EncryptedTokenData>();
const oauthStateStore = new Map<string, OAuthSessionState>();

/**
 * Store provider token securely encrypted at rest for a user
 */
export function storeUserToken(
  userId: string,
  connectorId: string,
  token: string,
  extra?: { refreshToken?: string; expiresAt?: number; user?: any }
): void {
  const key = `${userId}:${connectorId}`;
  const enc = encryptToken(token);
  userTokenVault.set(key, {
    ...enc,
    expiresAt: extra?.expiresAt,
    user: extra?.user
  });
}

/**
 * Retrieve and decrypt user's provider token
 */
export function getUserToken(userId: string, connectorId: string): { accessToken: string; user?: any } | null {
  const key = `${userId}:${connectorId}`;
  const stored = userTokenVault.get(key);
  // Never fall back to another user's token. Missing credentials must fail closed.
  if (!stored) return null;

  if (stored.expiresAt && Date.now() > stored.expiresAt) {
    userTokenVault.delete(key);
    return null;
  }

  try {
    const accessToken = decryptToken(stored);
    return { accessToken, user: stored.user };
  } catch (err) {
    console.warn('[Token Vault Decryption Failed]', err);
    return null;
  }
}

/**
 * Disconnect a provider for the specified user.
 * Returns false when there was no stored credential to remove.
 */
export function disconnectUserToken(userId: string, connectorId: string): boolean {
  if (!userId?.trim() || !connectorId?.trim()) return false;
  return userTokenVault.delete(`${userId.trim()}:${connectorId.trim()}`);
}

/**
 * Generate CSRF protected OAuth Auth URL
 */
export function generateOAuthUrl(connectorId: string, redirectUri: string, userId?: string): { url: string; stateToken: string } {
  if (!userId || !userId.trim()) {
    throw new Error('An authenticated user ID is required to start connector OAuth.');
  }
  if (connectorId !== 'github') {
    throw new Error(`OAuth is not implemented for ${connectorId} yet.`);
  }
  if (!process.env.GITHUB_CLIENT_ID || !process.env.GITHUB_CLIENT_SECRET) {
    throw new Error('GitHub OAuth is not configured. Set GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET on the server.');
  }

  const stateToken = crypto.randomBytes(24).toString('hex');
  oauthStateStore.set(stateToken, {
    stateToken,
    connectorId,
    userId: userId.trim(),
    createdAt: Date.now()
  });

  const appUrl = process.env.APP_URL || 'https://manus.im';
  const finalRedirect = redirectUri || `${appUrl}/api/connectors/oauth/callback`;

  const authUrl = `https://github.com/login/oauth/authorize?client_id=${process.env.GITHUB_CLIENT_ID}&redirect_uri=${encodeURIComponent(finalRedirect)}&state=${stateToken}&scope=repo,user,read:org,notifications`;

  return { url: authUrl, stateToken };
}

/**
 * Verify OAuth Callback Code and CSRF State Token, then encrypt & store access token
 */
export async function handleOAuthCallback(
  code: string,
  stateToken: string,
  userId?: string
): Promise<{ success: boolean; connectorId?: string; error?: string }> {
  if (!stateToken || !code) {
    return { success: false, error: 'OAuth callback is missing the authorization code or state token.' };
  }

  const session = oauthStateStore.get(stateToken);
  if (!session) {
    return { success: false, error: 'Invalid or expired CSRF state token' };
  }

  // State tokens are single-use and valid for 15 minutes.
  oauthStateStore.delete(stateToken);
  if (Date.now() - session.createdAt > 15 * 60 * 1000) {
    return { success: false, error: 'OAuth authorization request expired' };
  }

  // The user identity is bound to the original OAuth request, never to callback input.
  if (userId && session.userId && userId !== session.userId) {
    return { success: false, error: 'OAuth user does not match the initiating session.' };
  }

  const activeUserId = session.userId || userId;
  if (!activeUserId) {
    return { success: false, error: 'Unable to identify the user who initiated OAuth.' };
  }

  const connectorId = session.connectorId;
  if (connectorId !== 'github') {
    return { success: false, connectorId, error: `OAuth token exchange is not implemented for ${connectorId} yet.` };
  }

  if (!process.env.GITHUB_CLIENT_ID || !process.env.GITHUB_CLIENT_SECRET) {
    return { success: false, connectorId, error: 'GitHub OAuth is not configured. Set GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET on the server.' };
  }

  let realAccessToken = '';
  let userInfo: any = { name: 'GitHub Account' };

  try {
    const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify({
        client_id: process.env.GITHUB_CLIENT_ID,
        client_secret: process.env.GITHUB_CLIENT_SECRET,
        code
      }),
      signal: AbortSignal.timeout(15000)
    });

    if (!tokenRes.ok) {
      return { success: false, connectorId, error: `GitHub token exchange failed (HTTP ${tokenRes.status}). Please retry authorization.` };
    }

    const tokenData = await tokenRes.json();
    if (typeof tokenData?.access_token !== 'string' || !tokenData.access_token) {
      return { success: false, connectorId, error: 'GitHub did not return an access token. Check the OAuth app configuration and callback URL.' };
    }
    realAccessToken = tokenData.access_token;

    const userRes = await fetch('https://api.github.com/user', {
      headers: {
        'Authorization': `Bearer ${realAccessToken}`,
        'User-Agent': 'Manus-App-Connector',
        'Accept': 'application/vnd.github+json'
      },
      signal: AbortSignal.timeout(10000)
    });

    if (!userRes.ok) {
      return { success: false, connectorId, error: `GitHub returned an access token but profile verification failed (HTTP ${userRes.status}). Please reconnect.` };
    }

    const githubProfile = await userRes.json();
    userInfo = {
      id: githubProfile.id,
      name: githubProfile.name || githubProfile.login,
      login: githubProfile.login,
      email: githubProfile.email || undefined,
      avatarUrl: githubProfile.avatar_url
    };
  } catch (err: any) {
    return { success: false, connectorId, error: err?.name === 'TimeoutError'
      ? 'GitHub OAuth timed out. Please retry.'
      : 'GitHub OAuth could not be completed. Check server connectivity and OAuth settings.' };
  }

  try {
    storeUserToken(activeUserId, connectorId, realAccessToken, {
      expiresAt: Date.now() + 30 * 86400 * 1000,
      user: userInfo
    });
  } catch {
    return { success: false, connectorId, error: 'Token storage is not configured. Set TOKEN_ENCRYPTION_SECRET on the server.' };
  }

  return { success: true, connectorId };
}

/**
 * SSRF Validation Helper
 */
export function isSafeUrl(targetUrl: string): boolean {
  try {
    const parsed = new URL(targetUrl);
    const hostname = parsed.hostname.toLowerCase();

    if (
      hostname === 'localhost' ||
      hostname === '127.0.0.1' ||
      hostname === '0.0.0.0' ||
      hostname === '169.254.169.254' ||
      hostname.startsWith('10.') ||
      hostname.startsWith('192.168.') ||
      hostname.startsWith('172.16.') ||
      hostname.startsWith('172.17.') ||
      hostname.startsWith('172.18.') ||
      hostname.startsWith('172.19.') ||
      hostname.startsWith('172.20.') ||
      hostname.startsWith('172.21.') ||
      hostname.startsWith('172.22.') ||
      hostname.startsWith('172.23.') ||
      hostname.startsWith('172.24.') ||
      hostname.startsWith('172.25.') ||
      hostname.startsWith('172.26.') ||
      hostname.startsWith('172.27.') ||
      hostname.startsWith('172.28.') ||
      hostname.startsWith('172.29.') ||
      hostname.startsWith('172.30.') ||
      hostname.startsWith('172.31.')
    ) {
      return false;
    }

    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * GitHub API execution engine
 */
async function executeGitHubApiTool(
  toolName: string, 
  args: Record<string, any>, 
  token: string | null
): Promise<{ success: boolean; data?: any; error?: string; message?: string }> {
  const headers: Record<string, string> = {
    'User-Agent': 'Manus-App-Connector',
    'Accept': 'application/vnd.github.v3+json'
  };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  try {
    // 1. github_list_repos / listRepositories
    if (toolName === 'github_list_repos' || toolName === 'listRepositories') {
      const visibility = args.visibility || 'all';
      const sort = args.sort || 'updated';
      const perPage = args.perPage || 10;

      if (token) {
        const url = `https://api.github.com/user/repos?visibility=${visibility}&sort=${sort}&per_page=${perPage}`;
        const res = await fetch(url, { headers });
        if (res.ok) {
          const repos = await res.json();
          const mapped = repos.map((r: any) => ({
            id: r.id,
            name: r.name,
            fullName: r.full_name,
            description: r.description || 'No description provided',
            url: r.html_url,
            stars: r.stargazers_count,
            forks: r.forks_count,
            language: r.language || 'Code',
            openIssuesCount: r.open_issues_count,
            defaultBranch: r.default_branch,
            isPrivate: r.private,
            updatedAt: r.updated_at
          }));
          return {
            success: true,
            data: mapped,
            message: `Retrieved ${mapped.length} repository/repositories from GitHub`
          };
        }
      }

      return {
        success: false,
        error: 'GITHUB_AUTH_REQUIRED',
        message: 'GitHub repository access failed. Connect your own GitHub account and retry; no sample repository data was returned.'
      };
    }

    // 2. github_create_issue
    if (toolName === 'github_create_issue') {
      const repoInput = args.repo || 'rajeevranjan4348-arch/manus-remix';
      const [owner, repoName] = repoInput.includes('/') ? repoInput.split('/') : ['rajeevranjan4348-arch', repoInput];
      const title = args.title || 'New issue created by Manus AI';
      const body = args.body || 'Issue details logged from agent conversation.';
      const labels = args.labels ? args.labels.split(',').map((l: string) => l.trim()) : ['manus-agent'];

      if (token || process.env.GITHUB_TOKEN) {
        const url = `https://api.github.com/repos/${owner}/${repoName}/issues`;
        const res = await fetch(url, {
          method: 'POST',
          headers: { ...headers, 'Content-Type': 'application/json' },
          body: JSON.stringify({ title, body, labels })
        });
        if (res.ok) {
          const issue = await res.json();
          return {
            success: true,
            data: {
              issueNumber: issue.number,
              title: issue.title,
              state: issue.state,
              url: issue.html_url,
              createdAt: issue.created_at,
              author: issue.user?.login || 'authorized-user'
            },
            message: `Created GitHub Issue #${issue.number} "${issue.title}" in ${owner}/${repoName}`
          };
        }
      }

      return {
        success: false,
        error: 'GITHUB_ISSUE_CREATE_FAILED',
        message: 'GitHub did not confirm issue creation. Check account connection and repository permissions; no fake issue was reported.'
      };
    }

    // 3. github_summarize_prs
    if (toolName === 'github_summarize_prs' || toolName === 'github_list_prs') {
      const repoInput = args.repo || 'rajeevranjan4348-arch/manus-remix';
      const [owner, repoName] = repoInput.includes('/') ? repoInput.split('/') : ['rajeevranjan4348-arch', repoInput];
      const state = args.state || 'open';
      const limit = args.limit || 5;

      if (token || process.env.GITHUB_TOKEN) {
        const url = `https://api.github.com/repos/${owner}/${repoName}/pulls?state=${state}&per_page=${limit}`;
        const res = await fetch(url, { headers });
        if (res.ok) {
          const prs = await res.json();
          const mappedPrs = prs.map((p: any) => ({
            number: p.number,
            title: p.title,
            author: p.user?.login || 'unknown',
            state: p.state,
            draft: p.draft,
            createdAt: p.created_at,
            updatedAt: p.updated_at,
            head: p.head?.ref,
            base: p.base?.ref,
            url: p.html_url,
            summary: p.body ? (p.body.length > 200 ? p.body.slice(0, 200) + '...' : p.body) : 'No description provided'
          }));

          const prSummaryText = mappedPrs.length > 0
            ? mappedPrs.map((p: any) => `- PR #${p.number}: "${p.title}" by @${p.author} (${p.state}${p.draft ? ', Draft' : ''}) - Head: ${p.head} -> Base: ${p.base}`).join('\n')
            : `No ${state} pull requests found for ${owner}/${repoName}.`;

          return {
            success: true,
            data: {
              repository: `${owner}/${repoName}`,
              total: mappedPrs.length,
              pullRequests: mappedPrs,
              formattedSummary: prSummaryText
            },
            message: `Summarized ${mappedPrs.length} pull request(s) for ${owner}/${repoName}`
          };
        }
      }

      return {
        success: false,
        error: 'GITHUB_PULL_REQUESTS_FAILED',
        message: 'GitHub did not return pull requests. Verify the connected account and repository permissions.'
      };
    }

    // 4. github_search_repositories
    if (toolName === 'github_search_repositories') {
      const query = args.query || 'agent';
      if (token || process.env.GITHUB_TOKEN) {
        const url = `https://api.github.com/search/repositories?q=${encodeURIComponent(query)}&per_page=5`;
        const res = await fetch(url, { headers });
        if (res.ok) {
          const searchRes = await res.json();
          const repos = searchRes.items.map((r: any) => ({
            name: r.name,
            fullName: r.full_name,
            url: r.html_url,
            stars: r.stargazers_count,
            description: r.description,
            language: r.language
          }));
          return {
            success: true,
            data: repos,
            message: `Found ${repos.length} repository search results for "${query}"`
          };
        }
      }

      return {
        success: false,
        error: 'GITHUB_REPOSITORY_SEARCH_FAILED',
        message: 'GitHub repository search failed. Check the connected account and try again.'
      };
    }

    return {
      success: false,
      error: 'GITHUB_TOOL_NOT_SUPPORTED',
      message: `GitHub tool "${toolName}" is not supported by this connector.`
    };

  } catch (err: any) {
    return {
      success: false,
      error: 'GITHUB_API_ERROR',
      message: `GitHub API error: ${err.message}`
    };
  }
}

/**
 * Server Tool Execution Dispatcher
 */
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

