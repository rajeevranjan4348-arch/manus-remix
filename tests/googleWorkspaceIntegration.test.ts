import { describe, it, expect } from 'vitest';
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
});
