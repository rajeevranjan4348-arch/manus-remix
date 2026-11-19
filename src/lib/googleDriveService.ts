import { ensureValidWorkspaceAccessToken } from './workspaceAuth';
import {
  GoogleDriveFileItem,
  ListDriveOptions,
  DriveDocumentContextResult,
  listGoogleDriveFiles,
  searchGoogleDriveFiles,
  retrieveDriveDocumentContext,
  createGoogleDriveFile,
  createGoogleDriveFolder,
  renameGoogleDriveFile,
  deleteGoogleDriveFile,
  shareGoogleDriveFile,
  fetchGoogleApiWithTokenRefresh,
} from './workspaceTools';

export type { GoogleDriveFileItem, ListDriveOptions, DriveDocumentContextResult };

async function ensureDriveAccessToken(): Promise<string> {
  return ensureValidWorkspaceAccessToken({ connectorId: 'drive' });
}

/**
 * Fetches metadata for a single Google Drive file by ID.
 */
export async function getDriveFileMetadata(fileId: string): Promise<GoogleDriveFileItem> {
  await ensureDriveAccessToken();
  const fields = 'id,name,mimeType,webViewLink,iconLink,thumbnailLink,modifiedTime,size';
  const res = await fetchGoogleApiWithTokenRefresh(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?fields=${encodeURIComponent(fields)}`
  );

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`Failed to fetch Drive file metadata (${res.status}): ${errText}`);
  }

  return await res.json();
}

/**
 * Updates the text content of an existing Google Drive file.
 */
export async function updateDriveFileContent(
  fileId: string,
  content: string,
  mimeType: string = 'text/plain'
): Promise<{ id: string; name?: string; mimeType?: string }> {
  await ensureDriveAccessToken();
  const res = await fetchGoogleApiWithTokenRefresh(
    `https://www.googleapis.com/upload/drive/v3/files/${encodeURIComponent(fileId)}?uploadType=media`,
    {
      method: 'PATCH',
      headers: {
        'Content-Type': mimeType,
      },
      body: content,
    }
  );

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`Failed to update Drive file content (${res.status}): ${errText}`);
  }

  return await res.json();
}

/**
 * Lists Google Sheets spreadsheets from the user's Google Drive.
 */
export async function listDriveSpreadsheets(
  searchQuery?: string,
  pageSize: number = 25
): Promise<GoogleDriveFileItem[]> {
  return listGoogleDriveFiles({
    searchQuery,
    mimeTypeFilter: 'spreadsheet',
    pageSize,
  });
}

/**
 * Formats a Drive MIME type into a human-readable label.
 */
export function formatDriveMimeTypeLabel(mimeType: string): string {
  switch (mimeType) {
    case 'application/vnd.google-apps.folder':
      return 'Folder';
    case 'application/vnd.google-apps.document':
      return 'Google Doc';
    case 'application/vnd.google-apps.spreadsheet':
      return 'Google Sheet';
    case 'application/vnd.google-apps.presentation':
      return 'Google Slides';
    case 'application/pdf':
      return 'PDF';
    default:
      if (mimeType.startsWith('image/')) return 'Image';
      if (mimeType.startsWith('text/')) return 'Text';
      return 'File';
  }
}

/**
 * Centralized Google Drive service for listing, searching, selecting, reading, and mutating Drive files.
 */
export const googleDriveService = {
  listFiles: (options?: string | ListDriveOptions) => listGoogleDriveFiles(options),
  searchFiles: (query?: string) => searchGoogleDriveFiles(query),
  listSpreadsheets: (searchQuery?: string, pageSize?: number) =>
    listDriveSpreadsheets(searchQuery, pageSize),
  getFileMetadata: (fileId: string) => getDriveFileMetadata(fileId),
  readFileContent: (file: GoogleDriveFileItem) => retrieveDriveDocumentContext(file),
  createFile: (
    fileName: string,
    content: string,
    mimeType: string = 'text/plain',
    parentFolderId?: string
  ) => createGoogleDriveFile(fileName, content, mimeType, parentFolderId),
  updateFileContent: (fileId: string, content: string, mimeType?: string) =>
    updateDriveFileContent(fileId, content, mimeType),
  createFolder: (folderName: string, parentFolderId?: string) =>
    createGoogleDriveFolder(folderName, parentFolderId),
  renameFile: (fileId: string, newName: string) => renameGoogleDriveFile(fileId, newName),
  trashFile: (fileId: string) => deleteGoogleDriveFile(fileId),
  shareFile: (
    fileId: string,
    role: 'reader' | 'commenter' | 'writer' = 'reader',
    emailAddress?: string
  ) => shareGoogleDriveFile(fileId, role, emailAddress),
  formatMimeTypeLabel: formatDriveMimeTypeLabel,
};

export default googleDriveService;
