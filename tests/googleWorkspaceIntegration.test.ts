import { afterEach, describe, it, expect, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  parseGmailSenderHeader,
  resolveGoogleSheetRange,
  GoogleSheetTabProperty,
} from '../src/lib/workspaceTools';
import {
  formatDriveMimeTypeLabel,
  googleDriveService,
} from '../src/lib/googleDriveService';
import {
  WORKSPACE_SERVICES,
  getInitialWorkspaceServiceStatuses,
  verifyWorkspaceServiceConnection,
  fetchActiveGoogleIntegrationsFromBackend,
} from '../src/lib/workspaceConnectionStatus';
import {
  setCachedAccessToken,
  getWorkspaceTokenMetadata,
  isWorkspaceTokenExpiringSoon,
} from '../src/lib/workspaceAuth';
import {
  isConnectorTokenExpiringSoon,
  refreshConnectorAccessToken,
  executeWithConnectorTokenRefresh,
} from '../src/lib/connectors';
import {
  storeUserToken,
  getUserToken,
  isUserTokenExpiringSoon,
  refreshUserConnectorToken,
} from '../server/connectorsService';
import { resolveBackendGoogleIntegrations } from '../server/workspaceIntegrationsHandler';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Google Workspace Integration: Sheets, Gmail, and Drive', () => {
  describe('Gmail Sender Parsing & Compact Email Card', () => {
    it('extracts sender display name and email address from standard From headers', () => {
      const parsed = parseGmailSenderHeader('"Priya Sharma" <priya.sharma@example.com>');
      expect(parsed.senderName).toBe('Priya Sharma');
      expect(parsed.senderEmail).toBe('priya.sharma@example.com');
    });

    it('handles bare email addresses gracefully', () => {
      const parsed = parseGmailSenderHeader('alerts@workspace.google.com');
      expect(parsed.senderName).toBe('alerts@workspace.google.com');
      expect(parsed.senderEmail).toBe('alerts@workspace.google.com');
    });
  });

  describe('Google Sheets Dynamic Tab Resolution (No Hardcoded Sheet1)', () => {
    const sampleTabs: GoogleSheetTabProperty[] = [
      { sheetId: 101, title: 'Q4 Financials', index: 0 },
      { sheetId: 102, title: 'Team Roster', index: 1 },
    ];

    it('resolves omitted range to the actual first sheet tab from metadata instead of Sheet1', async () => {
      const resolved = await resolveGoogleSheetRange('sheet-123', undefined, sampleTabs);
      expect(resolved.sheetTitle).toBe('Q4 Financials');
      expect(resolved.resolvedRange).toBe('Q4 Financials!A1:Z100');
    });

    it('replaces an unverified Sheet1 prefix with the actual first tab title when Sheet1 does not exist', async () => {
      const resolved = await resolveGoogleSheetRange('sheet-123', 'Sheet1!A1:D20', sampleTabs);
      expect(resolved.sheetTitle).toBe('Q4 Financials');
      expect(resolved.resolvedRange).toBe('Q4 Financials!A1:D20');
    });

    it('preserves a valid non-first sheet tab name when it matches spreadsheet metadata', async () => {
      const resolved = await resolveGoogleSheetRange('sheet-123', 'Team Roster!A1:C10', sampleTabs);
      expect(resolved.sheetTitle).toBe('Team Roster');
      expect(resolved.resolvedRange).toBe('Team Roster!A1:C10');
    });
  });

  describe('Google Drive Service Operations', () => {
    it('exposes complete Drive file management methods and formats MIME types accurately', () => {
      expect(typeof googleDriveService.listFiles).toBe('function');
      expect(typeof googleDriveService.searchFiles).toBe('function');
      expect(typeof googleDriveService.listSpreadsheets).toBe('function');
      expect(typeof googleDriveService.getFileMetadata).toBe('function');
      expect(typeof googleDriveService.readFileContent).toBe('function');
      expect(typeof googleDriveService.createFile).toBe('function');
      expect(typeof googleDriveService.updateFileContent).toBe('function');
      expect(typeof googleDriveService.trashFile).toBe('function');

      expect(formatDriveMimeTypeLabel('application/vnd.google-apps.spreadsheet')).toBe('Google Sheet');
      expect(formatDriveMimeTypeLabel('application/vnd.google-apps.document')).toBe('Google Doc');
      expect(formatDriveMimeTypeLabel('application/vnd.google-apps.folder')).toBe('Folder');
    });
  });

  describe('In-Chat UI Components & Mandatory Mutation Confirmations', () => {
    it('verifies GoogleSheetsDataGridCard, GmailRecentEmailsCard, and GoogleDriveSelectorCard are wired into ChatView', () => {
      const chatViewSource = fs.readFileSync(
        path.resolve(__dirname, '../src/components/agent/ChatView.tsx'),
        'utf-8'
      );
      expect(chatViewSource).toContain('GoogleSheetsDataGridCard');
      expect(chatViewSource).toContain('GmailRecentEmailsCard');
      expect(chatViewSource).toContain('GoogleDriveSelectorCard');

      const sheetsCardSource = fs.readFileSync(
        path.resolve(__dirname, '../src/components/workspace/GoogleSheetsDataGridCard.tsx'),
        'utf-8'
      );
      expect(sheetsCardSource).toContain('sheets-mutation-confirmation');
      expect(sheetsCardSource).toContain('getGoogleSpreadsheetMetadata');
      expect(sheetsCardSource).toContain('updateGoogleSheetValues');

      const gmailCardSource = fs.readFileSync(
        path.resolve(__dirname, '../src/components/workspace/GmailRecentEmailsCard.tsx'),
        'utf-8'
      );
      expect(gmailCardSource).toContain('gmail-recent-emails-card');
      expect(gmailCardSource).toContain('fetchRecentGmailMessages');
      expect(gmailCardSource).toContain('gmail-mutation-confirmation');

      const driveCardSource = fs.readFileSync(
        path.resolve(__dirname, '../src/components/workspace/GoogleDriveSelectorCard.tsx'),
        'utf-8'
      );
      expect(driveCardSource).toContain('google-drive-selector-card');
      expect(driveCardSource).toContain('googleDriveService');
      expect(driveCardSource).toContain('drive-mutation-confirmation');
    });
  });

  describe('Connected Apps Backend & Settings Dashboard (Link Account & Manage Connection)', () => {
    it('resolves active and unlinked Google integrations via backend handler', async () => {
      const unauthResult = await resolveBackendGoogleIntegrations({});
      expect(unauthResult.authenticated).toBe(false);
      expect(unauthResult.integrations).toHaveLength(4);
      expect(unauthResult.integrations.every((i) => !i.isLinked && i.status === 'disconnected')).toBe(
        true
      );

      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
        email: 'verified-google@example.com',
        scope: [
          'https://www.googleapis.com/auth/drive',
          'https://www.googleapis.com/auth/spreadsheets',
          'https://www.googleapis.com/auth/calendar',
          'https://www.googleapis.com/auth/gmail.readonly',
        ].join(' '),
      }), { status: 200 })));
      const authResult = await resolveBackendGoogleIntegrations({
        authorizationHeader: 'Bearer mock-oauth-token',
        userEmailHeader: 'unverified-header@example.com',
        disabledAppIds: ['calendar'],
      });
      expect(authResult.authenticated).toBe(true);
      expect(authResult.accountEmail).toBe('verified-google@example.com');
      const driveApp = authResult.integrations.find((i) => i.id === 'drive');
      const calendarApp = authResult.integrations.find((i) => i.id === 'calendar');
      expect(driveApp?.isLinked).toBe(true);
      expect(driveApp?.status).toBe('connected');
      expect(calendarApp?.isLinked).toBe(false);
      expect(calendarApp?.status).toBe('disconnected');
    });

    it('fails closed when Google tokeninfo rejects a token, even if it resembles a JWT or has a caller email', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 401 })));
      const result = await resolveBackendGoogleIntegrations({
        authorizationHeader: 'Bearer header.payload.signature',
        userEmailHeader: 'spoofed@example.com',
        disabledAppIds: ['calendar'],
      });

      expect(result.authenticated).toBe(false);
      expect(result.accountEmail).toBeNull();
      expect(result.integrations.filter((item) => item.id !== 'calendar').every((item) => !item.isLinked && item.status === 'needs_reconnect')).toBe(true);
      expect(result.integrations.every((item) => item.accountEmail === null && !item.scopeGranted)).toBe(true);
      expect(result.integrations.find((item) => item.id === 'calendar')?.status).toBe('disconnected');
    });

    it('fails closed on tokeninfo network errors and does not treat missing scopes as granted', async () => {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
      const offlineResult = await resolveBackendGoogleIntegrations({
        authorizationHeader: 'Bearer mock-oauth-token',
        userEmailHeader: 'spoofed@example.com',
      });
      expect(offlineResult.authenticated).toBe(false);
      expect(offlineResult.integrations.every((item) => !item.isLinked)).toBe(true);

      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ email: 'claimed@example.com' }), { status: 200 })));
      const missingScopeResult = await resolveBackendGoogleIntegrations({
        authorizationHeader: 'Bearer mock-oauth-token',
      });
      expect(missingScopeResult.authenticated).toBe(false);
      expect(missingScopeResult.accountEmail).toBeNull();
      expect(missingScopeResult.integrations.every((item) => !item.scopeGranted && !item.isLinked)).toBe(true);
    });

    it('tracks connection status for all 4 core Google Workspace services', async () => {
      expect(WORKSPACE_SERVICES.map((s) => s.id)).toEqual([
        'drive',
        'sheets',
        'calendar',
        'gmail',
      ]);

      const disconnectedStatuses = getInitialWorkspaceServiceStatuses(null, null);
      expect(disconnectedStatuses).toHaveLength(4);
      expect(disconnectedStatuses.every((s) => s.status === 'disconnected')).toBe(true);

      const connectedStatuses = getInitialWorkspaceServiceStatuses(
        'mock-oauth-token',
        'user@example.com'
      );
      expect(connectedStatuses.every((s) => s.status === 'connected')).toBe(true);
      expect(connectedStatuses[0].accountEmail).toBe('user@example.com');

      const unauthCheck = await verifyWorkspaceServiceConnection('drive', null);
      expect(unauthCheck.status).toBe('disconnected');
      expect(typeof fetchActiveGoogleIntegrationsFromBackend).toBe('function');
    });

    it('verifies ConnectedAppsDashboard queries backend and renders Link Account and Manage Connection actions inside SettingsModal', () => {
      const settingsSource = fs.readFileSync(
        path.resolve(__dirname, '../src/components/settings/SettingsModal.tsx'),
        'utf-8'
      );
      expect(settingsSource).toContain('ConnectedAppsDashboard');
      expect(settingsSource).toContain('WorkspaceConnectionsDashboard');

      const connectedAppsSource = fs.readFileSync(
        path.resolve(__dirname, '../src/components/workspace/ConnectedAppsDashboard.tsx'),
        'utf-8'
      );
      expect(connectedAppsSource).toContain('connected-apps-dashboard');
      expect(connectedAppsSource).toContain('Connected Apps');
      expect(connectedAppsSource).toContain('fetchActiveGoogleIntegrationsFromBackend');
      expect(connectedAppsSource).toContain('connected-app-link-${service.id}');
      expect(connectedAppsSource).toContain('Link Account');
      expect(connectedAppsSource).toContain('connected-app-manage-${service.id}');
      expect(connectedAppsSource).toContain('Manage Connection');
      expect(connectedAppsSource).toContain('workspace-status-${service.id}');
      expect(connectedAppsSource).toContain('workspace-reconnect-${service.id}');
    });
  });

  describe('Connectors Service Automatic Token Refresh Mechanism', () => {
    it('detects near-expiry tokens, refreshes silently, and retries 401 operations transparently', async () => {
      // Seed an access token that is within the 5-minute expiry buffer (expires in 30 seconds)
      setCachedAccessToken('ya29.test-expiring-token', {
        expiresInMs: 30 * 1000,
        source: 'google_oauth',
      });

      expect(isWorkspaceTokenExpiringSoon()).toBe(true);
      expect(isConnectorTokenExpiringSoon('drive')).toBe(true);

      const refreshResult = await refreshConnectorAccessToken('drive', { silentOnly: true });
      expect(refreshResult.success).toBe(true);
      expect(refreshResult.refreshed).toBe(true);
      expect(refreshResult.accessToken).toBe('ya29.test-expiring-token');
      expect(isWorkspaceTokenExpiringSoon()).toBe(false);

      const meta = getWorkspaceTokenMetadata();
      expect(meta?.refreshCount).toBeGreaterThanOrEqual(1);

      // Verify executeWithConnectorTokenRefresh automatically refreshes and retries once on a 401/expired error
      let attempts = 0;
      const result = await executeWithConnectorTokenRefresh('gmail', async (token) => {
        attempts += 1;
        if (attempts === 1) {
          throw new Error('Gmail API Error (401): invalid_token - token expired');
        }
        return { ok: true, usedToken: token, attempts };
      });

      expect(attempts).toBe(2);
      expect(result.ok).toBe(true);
      expect(result.usedToken).toBe('ya29.test-expiring-token');

      setCachedAccessToken(null);
    });

    it('renews expired Google tokens in the server connectors vault without dropping active user sessions', async () => {
      const prevSecret = process.env.TOKEN_ENCRYPTION_SECRET;
      process.env.TOKEN_ENCRYPTION_SECRET = 'manus-test-encryption-secret-key-32-chars-minimum!';
      try {
        const userId = 'usr_refresh_test';
        storeUserToken(userId, 'drive', 'ya29.server-vault-token', {
          refreshToken: '1//0g-test-refresh-token',
          expiresAt: Date.now() - 10_000, // already expired 10s ago
          user: { email: 'rajeev@example.com' },
        });

        expect(isUserTokenExpiringSoon(userId, 'drive')).toBe(true);

        // Accessing getUserToken on an expired Google connector with a refresh token auto-renews instead of returning null
        const autoRenewed = getUserToken(userId, 'drive');
        expect(autoRenewed).not.toBeNull();
        expect(autoRenewed?.accessToken).toBe('ya29.server-vault-token');
        expect(autoRenewed?.refreshCount).toBe(1);
        expect(isUserTokenExpiringSoon(userId, 'drive')).toBe(false);

        // Force-refresh via refreshUserConnectorToken increments refreshCount and updates expiration
        const forcedRefresh = await refreshUserConnectorToken(userId, 'drive', {
          force: true,
          clientAccessToken: 'ya29.rotated-google-token',
        });
        expect(forcedRefresh.success).toBe(true);
        expect(forcedRefresh.refreshed).toBe(true);
        expect(forcedRefresh.accessToken).toBe('ya29.rotated-google-token');
        expect(forcedRefresh.refreshCount).toBe(2);
      } finally {
        if (prevSecret === undefined) {
          delete process.env.TOKEN_ENCRYPTION_SECRET;
        } else {
          process.env.TOKEN_ENCRYPTION_SECRET = prevSecret;
        }
      }
    });
  });
});
