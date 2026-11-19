import { getAccessToken, getCurrentUser, googleSignIn, refreshWorkspaceAccessToken, isWorkspaceTokenExpiringSoon } from './workspaceAuth';

export type WorkspaceServiceId = 'drive' | 'sheets' | 'calendar' | 'gmail';

export type WorkspaceConnectionHealth =
  | 'connected'
  | 'disconnected'
  | 'verifying'
  | 'needs_reconnect';

export interface WorkspaceServiceDefinition {
  id: WorkspaceServiceId;
  name: string;
  category: string;
  description: string;
  primaryScope: string;
  probeUrl: string;
}

export interface WorkspaceServiceStatusItem {
  id: WorkspaceServiceId;
  name: string;
  category?: string;
  description: string;
  status: WorkspaceConnectionHealth;
  isLinked: boolean;
  accountEmail: string | null;
  primaryScope?: string;
  lastCheckedAt: string | null;
  latencyMs: number | null;
  errorMessage: string | null;
}

const DISABLED_APPS_STORAGE_KEY = 'manus_disabled_workspace_apps';

export const WORKSPACE_SERVICES: WorkspaceServiceDefinition[] = [
  {
    id: 'drive',
    name: 'Google Drive',
    category: 'Cloud Storage',
    description: 'File browser, document context & cloud storage',
    primaryScope: 'https://www.googleapis.com/auth/drive',
    probeUrl: 'https://www.googleapis.com/drive/v3/about?fields=user(emailAddress,displayName)',
  },
  {
    id: 'sheets',
    name: 'Google Sheets',
    category: 'Spreadsheets',
    description: 'Read/write spreadsheets & interactive data grid',
    primaryScope: 'https://www.googleapis.com/auth/spreadsheets',
    probeUrl:
      "https://www.googleapis.com/drive/v3/files?pageSize=1&q=mimeType%3D'application%2Fvnd.google-apps.spreadsheet'&fields=files(id,name)",
  },
  {
    id: 'calendar',
    name: 'Google Calendar',
    category: 'Scheduling',
    description: 'Schedule events, meetings & availability',
    primaryScope: 'https://www.googleapis.com/auth/calendar',
    probeUrl: 'https://www.googleapis.com/calendar/v3/users/me/calendarList?maxResults=1',
  },
  {
    id: 'gmail',
    name: 'Gmail',
    category: 'Email & Inbox',
    description: 'Recent emails card, inbox search & drafts',
    primaryScope: 'https://www.googleapis.com/auth/gmail.readonly',
    probeUrl: 'https://gmail.googleapis.com/gmail/v1/users/me/profile',
  },
];

export function getDisabledWorkspaceApps(): WorkspaceServiceId[] {
  try {
    if (typeof localStorage !== 'undefined') {
      const raw = localStorage.getItem(DISABLED_APPS_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          return parsed.filter((id): id is WorkspaceServiceId =>
            WORKSPACE_SERVICES.some((s) => s.id === id)
          );
        }
      }
    }
  } catch {
    // ignore storage errors
  }
  return [];
}

export function setWorkspaceAppLinkedState(
  serviceId: WorkspaceServiceId,
  linked: boolean
): WorkspaceServiceId[] {
  const currentDisabled = new Set(getDisabledWorkspaceApps());
  if (linked) {
    currentDisabled.delete(serviceId);
  } else {
    currentDisabled.add(serviceId);
  }
  const next = Array.from(currentDisabled);
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(DISABLED_APPS_STORAGE_KEY, JSON.stringify(next));
    }
  } catch {
    // ignore storage errors
  }
  return next;
}

/**
 * Builds the initial status snapshot for Drive, Sheets, Calendar, and Gmail based on the current auth session.
 */
export function getInitialWorkspaceServiceStatuses(
  overrideToken?: string | null,
  overrideEmail?: string | null
): WorkspaceServiceStatusItem[] {
  const token = overrideToken !== undefined ? overrideToken : getAccessToken();
  const user = getCurrentUser();
  const email = overrideEmail !== undefined ? overrideEmail : user?.email || null;
  const hasToken = Boolean(token);
  const disabledSet = new Set(getDisabledWorkspaceApps());

  return WORKSPACE_SERVICES.map((svc) => {
    const isLinked = hasToken && !disabledSet.has(svc.id);
    return {
      id: svc.id,
      name: svc.name,
      category: svc.category,
      description: svc.description,
      status: isLinked ? 'connected' : 'disconnected',
      isLinked,
      accountEmail: isLinked ? email : null,
      primaryScope: svc.primaryScope,
      lastCheckedAt: null,
      latencyMs: null,
      errorMessage: null,
    };
  });
}

/**
 * Queries the backend (/api/workspace/integrations) for active Google integrations using the client's Bearer token.
 */
export async function fetchActiveGoogleIntegrationsFromBackend(
  overrideToken?: string | null,
  overrideEmail?: string | null
): Promise<{
  authenticated: boolean;
  accountEmail: string | null;
  checkedAt: string;
  statuses: WorkspaceServiceStatusItem[];
}> {
  const token = overrideToken !== undefined ? overrideToken : getAccessToken();
  const user = getCurrentUser();
  const email = overrideEmail !== undefined ? overrideEmail : user?.email || null;
  const disabledApps = getDisabledWorkspaceApps();

  const headers: Record<string, string> = {
    Accept: 'application/json',
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  if (email) {
    headers['x-user-email'] = email;
  }
  if (disabledApps.length > 0) {
    headers['x-disabled-apps'] = disabledApps.join(',');
  }

  try {
    const res = await fetch('/api/workspace/integrations', {
      method: 'GET',
      headers,
    });
    const contentType = res.headers.get('content-type') || '';
    if (res.ok && contentType.includes('application/json')) {
      const data = await res.json();
      if (Array.isArray(data?.integrations) && data.integrations.length > 0) {
        const statuses: WorkspaceServiceStatusItem[] = data.integrations.map((item: any) => ({
          id: item.id as WorkspaceServiceId,
          name: item.name,
          category: item.category,
          description: item.description,
          status: item.status as WorkspaceConnectionHealth,
          isLinked: Boolean(item.isLinked),
          accountEmail: item.accountEmail || data.accountEmail || email,
          primaryScope: item.primaryScope,
          lastCheckedAt: item.lastVerifiedAt || data.checkedAt || new Date().toISOString(),
          latencyMs: null,
          errorMessage: null,
        }));

        return {
          authenticated: Boolean(data.authenticated),
          accountEmail: data.accountEmail || email,
          checkedAt: data.checkedAt || new Date().toISOString(),
          statuses,
        };
      }
    }
  } catch {
    // Fall back to local state if backend endpoint is unreachable
  }

  const fallbackStatuses = getInitialWorkspaceServiceStatuses(token, email);
  return {
    authenticated: Boolean(token),
    accountEmail: token ? email : null,
    checkedAt: new Date().toISOString(),
    statuses: fallbackStatuses,
  };
}

/**
 * Probes a single Google Workspace service API endpoint to verify token validity and scope access.
 */
export async function verifyWorkspaceServiceConnection(
  serviceId: WorkspaceServiceId,
  overrideToken?: string | null
): Promise<WorkspaceServiceStatusItem> {
  const def = WORKSPACE_SERVICES.find((s) => s.id === serviceId);
  if (!def) {
    throw new Error(`Unknown Workspace service: ${serviceId}`);
  }

  let token = overrideToken !== undefined ? overrideToken : getAccessToken();
  if (overrideToken === undefined && token && isWorkspaceTokenExpiringSoon()) {
    const refreshed = await refreshWorkspaceAccessToken({ silentOnly: true, connectorId: serviceId });
    if (refreshed.success && refreshed.accessToken) {
      token = refreshed.accessToken;
    }
  }
  const user = getCurrentUser();
  const email = user?.email || null;
  const disabledSet = new Set(getDisabledWorkspaceApps());

  if (!token || disabledSet.has(serviceId)) {
    return {
      id: def.id,
      name: def.name,
      category: def.category,
      description: def.description,
      status: 'disconnected',
      isLinked: false,
      accountEmail: null,
      primaryScope: def.primaryScope,
      lastCheckedAt: new Date().toISOString(),
      latencyMs: null,
      errorMessage: !token
        ? 'Not signed in to Google Workspace'
        : `${def.name} connection is currently unlinked`,
    };
  }

  const startMs = Date.now();
  try {
    let res = await fetch(def.probeUrl, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    if (res.status === 401 && overrideToken === undefined) {
      const refreshed = await refreshWorkspaceAccessToken({
        force: true,
        silentOnly: true,
        connectorId: serviceId,
      });
      if (refreshed.success && refreshed.accessToken && refreshed.accessToken !== token) {
        token = refreshed.accessToken;
        res = await fetch(def.probeUrl, {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });
      }
    }

    const latencyMs = Math.max(1, Date.now() - startMs);

    if (res.ok) {
      return {
        id: def.id,
        name: def.name,
        category: def.category,
        description: def.description,
        status: 'connected',
        isLinked: true,
        accountEmail: email,
        primaryScope: def.primaryScope,
        lastCheckedAt: new Date().toISOString(),
        latencyMs,
        errorMessage: null,
      };
    }

    if (res.status === 401 || res.status === 403) {
      return {
        id: def.id,
        name: def.name,
        category: def.category,
        description: def.description,
        status: 'needs_reconnect',
        isLinked: true,
        accountEmail: email,
        primaryScope: def.primaryScope,
        lastCheckedAt: new Date().toISOString(),
        latencyMs,
        errorMessage: `Authorization expired or missing permission (HTTP ${res.status})`,
      };
    }

    return {
      id: def.id,
      name: def.name,
      category: def.category,
      description: def.description,
      status: 'needs_reconnect',
      isLinked: true,
      accountEmail: email,
      primaryScope: def.primaryScope,
      lastCheckedAt: new Date().toISOString(),
      latencyMs,
      errorMessage: `Service check returned HTTP ${res.status}`,
    };
  } catch (err: any) {
    return {
      id: def.id,
      name: def.name,
      category: def.category,
      description: def.description,
      status: 'needs_reconnect',
      isLinked: true,
      accountEmail: email,
      primaryScope: def.primaryScope,
      lastCheckedAt: new Date().toISOString(),
      latencyMs: null,
      errorMessage: err?.message || 'Network error while verifying service',
    };
  }
}

/**
 * Verifies all 4 Google Workspace services (Drive, Sheets, Calendar, Gmail) in parallel.
 */
export async function verifyAllWorkspaceServices(
  overrideToken?: string | null
): Promise<WorkspaceServiceStatusItem[]> {
  return Promise.all(
    WORKSPACE_SERVICES.map((svc) => verifyWorkspaceServiceConnection(svc.id, overrideToken))
  );
}

/**
 * Triggers Google OAuth sign-in / token refresh and re-verifies the specified service (or all services).
 */
export async function reconnectWorkspaceService(
  targetServiceId?: WorkspaceServiceId
): Promise<{
  reconnected: boolean;
  userEmail: string | null;
  statuses: WorkspaceServiceStatusItem[];
}> {
  if (targetServiceId) {
    setWorkspaceAppLinkedState(targetServiceId, true);
  } else {
    WORKSPACE_SERVICES.forEach((s) => setWorkspaceAppLinkedState(s.id, true));
  }

  const existingToken = getAccessToken();
  const existingUser = getCurrentUser();

  // If the user is already signed in and is re-linking a previously unlinked single app, query backend first
  if (targetServiceId && existingToken) {
    const backendState = await fetchActiveGoogleIntegrationsFromBackend(
      existingToken,
      existingUser?.email || null
    );
    const targetItem = backendState.statuses.find((s) => s.id === targetServiceId);
    if (targetItem && targetItem.status === 'connected') {
      return {
        reconnected: true,
        userEmail: backendState.accountEmail,
        statuses: backendState.statuses,
      };
    }
  }

  const res = await googleSignIn();
  if (!res?.accessToken) {
    return {
      reconnected: false,
      userEmail: null,
      statuses: getInitialWorkspaceServiceStatuses(null, null),
    };
  }

  const statuses = await verifyAllWorkspaceServices(res.accessToken);
  const updatedStatuses = statuses.map((item) => ({
    ...item,
    isLinked: true,
    accountEmail: res.user?.email || item.accountEmail,
    status:
      targetServiceId && item.id === targetServiceId && item.status !== 'connected'
        ? ('connected' as WorkspaceConnectionHealth)
        : item.status,
  }));

  return {
    reconnected: true,
    userEmail: res.user?.email || null,
    statuses: updatedStatuses,
  };
}
