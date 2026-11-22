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

  let verifiedEmail: string | null = null;
  let grantedScopeString = '';
  let tokenVerified = false;

  // A non-empty bearer token, email header, JWT shape, or network failure is not proof
  // that this is a valid Google OAuth access token.
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);
    try {
      const res = await fetch(
        `https://oauth2.googleapis.com/tokeninfo?access_token=${encodeURIComponent(token)}`,
        { signal: controller.signal }
      );
      if (res.ok) {
        const data: any = await res.json();
        if (typeof data?.scope === 'string' && data.scope.trim()) {
          tokenVerified = true;
          grantedScopeString = data.scope.trim();
          verifiedEmail = typeof data.email === 'string' && data.email.trim() ? data.email.trim() : null;
        }
      }
    } finally {
      clearTimeout(timeout);
    }
  } catch {
    // Fail closed if Google tokeninfo cannot verify the token.
  }

  if (!tokenVerified) {
    return {
      authenticated: false,
      accountEmail: null,
      checkedAt,
      source: 'backend',
      integrations: GOOGLE_INTEGRATION_CATALOG.map((item) => {
        const isManuallyUnlinked = disabledSet.has(item.id);
        return {
          id: item.id,
          name: item.name,
          category: item.category,
          description: item.description,
          status: isManuallyUnlinked || !token ? 'disconnected' : 'needs_reconnect',
          isLinked: false,
          accountEmail: null,
          primaryScope: item.primaryScope,
          scopeGranted: false,
          lastVerifiedAt: checkedAt,
        };
      }),
    };
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

    const scopeGranted = item.scopeKeywords.some((kw) => grantedScopeString.includes(kw));

    return {
      id: item.id,
      name: item.name,
      category: item.category,
      description: item.description,
      status: scopeGranted ? 'connected' : 'needs_reconnect',
      isLinked: true,
      accountEmail: verifiedEmail,
      primaryScope: item.primaryScope,
      scopeGranted,
      lastVerifiedAt: checkedAt,
    };
  });

  return {
    authenticated: true,
    accountEmail: verifiedEmail,
    checkedAt,
    source: 'backend',
    integrations,
  };
}
