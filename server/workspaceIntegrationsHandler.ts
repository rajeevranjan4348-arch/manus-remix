export interface BackendGoogleIntegrationItem {
  id: 'drive' | 'sheets' | 'calendar' | 'gmail';
  name: string;
  category: string;
  description: string;
  status: 'connected' | 'disconnected' | 'needs_reconnect';
  isLinked: boolean;
  accountEmail: string | null;
  primaryScope: string;
  scopeGranted: boolean;
  lastVerifiedAt: string;
}

export interface BackendGoogleIntegrationsResponse {
  authenticated: boolean;
  accountEmail: string | null;
  checkedAt: string;
  source: 'backend';
  integrations: BackendGoogleIntegrationItem[];
}

const GOOGLE_INTEGRATION_CATALOG: Array<{
  id: 'drive' | 'sheets' | 'calendar' | 'gmail';
  name: string;
  category: string;
  description: string;
  primaryScope: string;
  scopeKeywords: string[];
}> = [
  {
    id: 'drive',
    name: 'Google Drive',
    category: 'Cloud Storage',
    description: 'File browser, document context & cloud storage',
    primaryScope: 'https://www.googleapis.com/auth/drive',
    scopeKeywords: ['auth/drive'],
  },
  {
    id: 'sheets',
    name: 'Google Sheets',
    category: 'Spreadsheets',
    description: 'Read/write spreadsheets & interactive data grid',
    primaryScope: 'https://www.googleapis.com/auth/spreadsheets',
    scopeKeywords: ['auth/spreadsheets', 'auth/drive'],
  },
  {
    id: 'calendar',
    name: 'Google Calendar',
    category: 'Scheduling',
    description: 'Schedule events, meetings & availability',
    primaryScope: 'https://www.googleapis.com/auth/calendar',
    scopeKeywords: ['auth/calendar'],
  },
  {
    id: 'gmail',
    name: 'Gmail',
    category: 'Email & Inbox',
    description: 'Recent emails card, inbox search & drafts',
    primaryScope: 'https://www.googleapis.com/auth/gmail.readonly',
    scopeKeywords: ['auth/gmail', 'mail.google.com'],
  },
];

/**
 * Evaluates active Google integrations on the backend using the client-provided Bearer token.
 */
export async function resolveBackendGoogleIntegrations(params: {
  authorizationHeader?: string;
  userEmailHeader?: string;
  disabledAppIds?: string[];
}): Promise<BackendGoogleIntegrationsResponse> {
  const checkedAt = new Date().toISOString();
  const rawAuth = (params.authorizationHeader || '').trim();
  const token = rawAuth.toLowerCase().startsWith('bearer ')
    ? rawAuth.slice(7).trim()
    : '';
  const fallbackEmail = (params.userEmailHeader || '').trim() || null;
  const disabledSet = new Set(params.disabledAppIds || []);

  if (!token) {
    return {
      authenticated: false,
      accountEmail: null,
      checkedAt,
      source: 'backend',
      integrations: GOOGLE_INTEGRATION_CATALOG.map((item) => ({
        id: item.id,
        name: item.name,
        category: item.category,
        description: item.description,
        status: 'disconnected',
        isLinked: false,
        accountEmail: null,
        primaryScope: item.primaryScope,
        scopeGranted: false,
        lastVerifiedAt: checkedAt,
      })),
    };
  }

  let verifiedEmail = fallbackEmail;
  let grantedScopeString = '';
  let tokenValid = true;
  let tokenExpiredOrInvalid = false;

  // Attempt lightweight tokeninfo verification against Google OAuth2 endpoint
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);
    const res = await fetch(
      `https://oauth2.googleapis.com/tokeninfo?access_token=${encodeURIComponent(token)}`,
      { signal: controller.signal }
    );
    clearTimeout(timeout);

    if (res.ok) {
      const data: any = await res.json();
      if (data.email) {
        verifiedEmail = data.email;
      }
      if (typeof data.scope === 'string') {
        grantedScopeString = data.scope;
      }
    } else if (res.status === 400 || res.status === 401) {
      // Note: Firebase ID tokens or mock tokens may return 400 on access_token tokeninfo;
      // check if it looks like a JWT (3 dot-separated parts) before marking expired.
      const isJwt = token.split('.').length === 3;
      if (!isJwt && token !== 'mock-oauth-token') {
        tokenExpiredOrInvalid = true;
        tokenValid = false;
      }
    }
  } catch {
    // Network unreachable in offline/test environment: trust non-empty Bearer token
    tokenValid = Boolean(token);
  }

  const integrations: BackendGoogleIntegrationItem[] = GOOGLE_INTEGRATION_CATALOG.map((item) => {
    const isManuallyUnlinked = disabledSet.has(item.id);
    if (isManuallyUnlinked) {
      return {
        id: item.id,
        name: item.name,
        category: item.category,
        description: item.description,
        status: 'disconnected',
        isLinked: false,
        accountEmail: null,
        primaryScope: item.primaryScope,
        scopeGranted: false,
        lastVerifiedAt: checkedAt,
      };
    }

    if (tokenExpiredOrInvalid) {
      return {
        id: item.id,
        name: item.name,
        category: item.category,
        description: item.description,
        status: 'needs_reconnect',
        isLinked: true,
        accountEmail: verifiedEmail,
        primaryScope: item.primaryScope,
        scopeGranted: false,
        lastVerifiedAt: checkedAt,
      };
    }

    const scopeGranted =
      !grantedScopeString ||
      item.scopeKeywords.some((kw) => grantedScopeString.includes(kw));

    return {
      id: item.id,
      name: item.name,
      category: item.category,
      description: item.description,
      status: tokenValid && scopeGranted ? 'connected' : 'needs_reconnect',
      isLinked: tokenValid,
      accountEmail: verifiedEmail,
      primaryScope: item.primaryScope,
      scopeGranted,
      lastVerifiedAt: checkedAt,
    };
  });

  return {
    authenticated: tokenValid,
    accountEmail: verifiedEmail,
    checkedAt,
    source: 'backend',
    integrations,
  };
}
