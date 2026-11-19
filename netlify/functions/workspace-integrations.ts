import { resolveBackendGoogleIntegrations } from '../../server/workspaceIntegrationsHandler';

export const handler = async (event: any) => {
  const headers = {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
  };

  try {
    const reqHeaders = event?.headers || {};
    const authHeader =
      reqHeaders.authorization || reqHeaders.Authorization || '';
    const userEmailHeader =
      reqHeaders['x-user-email'] || reqHeaders['X-User-Email'] || '';
    const disabledHeader =
      reqHeaders['x-disabled-apps'] || reqHeaders['X-Disabled-Apps'] || '';
    const disabledAppIds = disabledHeader
      ? String(disabledHeader)
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
      : [];

    const payload = await resolveBackendGoogleIntegrations({
      authorizationHeader: authHeader,
      userEmailHeader,
      disabledAppIds,
    });

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify(payload),
    };
  } catch (err: any) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        authenticated: false,
        accountEmail: null,
        checkedAt: new Date().toISOString(),
        source: 'backend',
        integrations: [],
        error: err?.message || 'Failed to inspect Google integrations',
      }),
    };
  }
};
