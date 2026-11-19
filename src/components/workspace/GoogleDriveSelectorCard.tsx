import React, { useState, useEffect, useCallback } from 'react';
import {
  HardDrive,
  Search,
  RefreshCw,
  FileText,
  FileSpreadsheet,
  Presentation,
  Folder,
  File,
  Check,
  ExternalLink,
  Loader2,
  AlertCircle,
  Plus,
  Trash2,
  ShieldAlert,
  Eye,
} from 'lucide-react';
import { getAccessToken, googleSignIn } from '@/lib/workspaceAuth';
import {
  googleDriveService,
  GoogleDriveFileItem,
  DriveDocumentContextResult,
} from '@/lib/googleDriveService';
import { toast } from 'sonner';

export interface GoogleDriveSelectorCardProps {
  initialSearchQuery?: string;
  initialMimeFilter?: string;
  onSelectFile?: (file: GoogleDriveFileItem, context?: DriveDocumentContextResult) => void;
}

type PendingDriveMutation =
  | {
      kind: 'create_file';
      fileName: string;
      content: string;
    }
  | {
      kind: 'trash_file';
      file: GoogleDriveFileItem;
    };

function renderDriveItemIcon(mimeType: string) {
  if (mimeType === 'application/vnd.google-apps.folder') {
    return <Folder className="w-4 h-4 text-amber-400 shrink-0" />;
  }
  if (mimeType === 'application/vnd.google-apps.document') {
    return <FileText className="w-4 h-4 text-blue-400 shrink-0" />;
  }
  if (mimeType === 'application/vnd.google-apps.spreadsheet') {
    return <FileSpreadsheet className="w-4 h-4 text-emerald-500 shrink-0" />;
  }
  if (mimeType === 'application/vnd.google-apps.presentation') {
    return <Presentation className="w-4 h-4 text-orange-400 shrink-0" />;
  }
  return <File className="w-4 h-4 text-muted-foreground shrink-0" />;
}

export function GoogleDriveSelectorCard({
  initialSearchQuery = '',
  initialMimeFilter = 'all',
  onSelectFile,
}: GoogleDriveSelectorCardProps) {
  const [needsAuth, setNeedsAuth] = useState<boolean>(() => !getAccessToken());
  const [searchQuery, setSearchQuery] = useState<string>(initialSearchQuery);
  const [mimeFilter, setMimeFilter] = useState<string>(initialMimeFilter);
  const [files, setFiles] = useState<GoogleDriveFileItem[]>([]);
  const [selectedFile, setSelectedFile] = useState<GoogleDriveFileItem | null>(null);
  const [selectedContext, setSelectedContext] = useState<DriveDocumentContextResult | null>(null);

  const [loading, setLoading] = useState<boolean>(false);
  const [loadingPreview, setLoadingPreview] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const [showCreateForm, setShowCreateForm] = useState<boolean>(false);
  const [newFileName, setNewFileName] = useState<string>('Workspace Note.txt');
  const [newFileContent, setNewFileContent] = useState<string>('');
  const [pendingMutation, setPendingMutation] = useState<PendingDriveMutation | null>(null);
  const [mutating, setMutating] = useState<boolean>(false);

  const loadDriveFiles = useCallback(
    async (customSearch?: string, customFilter?: string) => {
      if (!getAccessToken()) {
        setNeedsAuth(true);
        return;
      }
      setNeedsAuth(false);
      setLoading(true);
      setErrorMessage(null);
      try {
        const list = await googleDriveService.listFiles({
          searchQuery: customSearch !== undefined ? customSearch : searchQuery,
          mimeTypeFilter: customFilter !== undefined ? customFilter : mimeFilter,
          pageSize: 25,
        });
        setFiles(list);
      } catch (err: any) {
        const msg = err?.message || 'Failed to load files from Google Drive.';
        setErrorMessage(msg);
      } finally {
        setLoading(false);
      }
    },
    [searchQuery, mimeFilter]
  );

  useEffect(() => {
    if (getAccessToken()) {
      loadDriveFiles(initialSearchQuery, initialMimeFilter);
    }
  }, [initialSearchQuery, initialMimeFilter, loadDriveFiles]);

  const handleGoogleSignIn = async () => {
    setErrorMessage(null);
    const res = await googleSignIn();
    if (res?.accessToken) {
      setNeedsAuth(false);
      toast.success('Connected to Google Drive');
      await loadDriveFiles(searchQuery, mimeFilter);
    } else {
      setNeedsAuth(true);
    }
  };

  const handleSelectFile = async (file: GoogleDriveFileItem) => {
    setSelectedFile(file);
    setSelectedContext(null);

    if (file.mimeType === 'application/vnd.google-apps.folder') {
      onSelectFile?.(file);
      toast.success(`Selected folder "${file.name}"`);
      return;
    }

    setLoadingPreview(true);
    try {
      const ctx = await googleDriveService.readFileContent(file);
      setSelectedContext(ctx);
      onSelectFile?.(file, ctx);
      toast.success(`Selected "${file.name}" from Google Drive`);
    } catch {
      onSelectFile?.(file);
    } finally {
      setLoadingPreview(false);
    }
  };

  const executeConfirmedMutation = async () => {
    if (!pendingMutation) return;
    setMutating(true);
    setErrorMessage(null);
    try {
      if (pendingMutation.kind === 'create_file') {
        const created = await googleDriveService.createFile(
          pendingMutation.fileName,
          pendingMutation.content,
          'text/plain'
        );
        toast.success(`Created "${created.name}" in Google Drive`);
        setShowCreateForm(false);
        setNewFileContent('');
        await loadDriveFiles(searchQuery, mimeFilter);
      } else if (pendingMutation.kind === 'trash_file') {
        await googleDriveService.trashFile(pendingMutation.file.id);
        setFiles((prev) => prev.filter((f) => f.id !== pendingMutation.file.id));
        if (selectedFile?.id === pendingMutation.file.id) {
          setSelectedFile(null);
          setSelectedContext(null);
        }
        toast.success(`Moved "${pendingMutation.file.name}" to Trash`);
      }
      setPendingMutation(null);
    } catch (err: any) {
      const msg = err?.message || 'Google Drive operation failed.';
      setErrorMessage(msg);
      toast.error(msg);
    } finally {
      setMutating(false);
    }
  };

  return (
    <div
      data-testid="google-drive-selector-card"
      className="my-3 rounded-xl border border-border/80 bg-card/60 backdrop-blur-md p-3.5 shadow-sm transition-all hover:border-border max-w-xl"
    >
      {/* Header */}
      <div className="flex items-center justify-between gap-2 pb-2.5 border-b border-border/50">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-blue-500/10 border border-blue-500/20">
            <HardDrive className="w-4 h-4 text-blue-400" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h4 className="text-xs font-semibold text-foreground truncate">
                Google Drive File Browser & Selector
              </h4>
              {files.length > 0 && (
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-400 font-medium">
                  {files.length} items
                </span>
              )}
            </div>
            <p className="text-[11px] text-muted-foreground truncate">
              List, filter, preview, and select files from your Google Drive
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setShowCreateForm((prev) => !prev)}
            className="inline-flex items-center gap-1 px-2 py-1.5 rounded-lg text-[11px] font-medium bg-secondary/70 hover:bg-secondary text-foreground transition-colors"
            title="Create new text file in Drive"
          >
            <Plus className="w-3.5 h-3.5 text-blue-400" />
            <span>New File</span>
          </button>
          <button
            type="button"
            onClick={() => loadDriveFiles(searchQuery, mimeFilter)}
            disabled={loading}
            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-medium bg-secondary/70 hover:bg-secondary text-foreground transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            <span>{files.length > 0 ? 'Refresh' : 'List Files'}</span>
          </button>
        </div>
      </div>

      {/* Search & MIME Type Filter */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          loadDriveFiles(searchQuery, mimeFilter);
        }}
        className="mt-2.5 flex flex-wrap items-center gap-1.5"
      >
        <div className="relative flex-1 min-w-[160px]">
          <Search className="w-3.5 h-3.5 text-muted-foreground absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search files in Google Drive..."
            className="w-full pl-8 pr-2.5 py-1.5 rounded-lg text-xs bg-background/80 border border-border/70 text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-blue-400"
          />
        </div>
        <select
          value={mimeFilter}
          onChange={(e) => {
            const nextFilter = e.target.value;
            setMimeFilter(nextFilter);
            loadDriveFiles(searchQuery, nextFilter);
          }}
          aria-label="Filter by Drive file type"
          className="px-2.5 py-1.5 rounded-lg text-xs bg-background/80 border border-border/70 text-foreground focus:outline-none focus:border-blue-400"
        >
          <option value="all">All Types</option>
          <option value="document">Google Docs</option>
          <option value="spreadsheet">Google Sheets</option>
          <option value="presentation">Google Slides</option>
          <option value="pdf">PDFs</option>
          <option value="folder">Folders</option>
        </select>
        <button
          type="submit"
          disabled={loading}
          className="px-2.5 py-1.5 rounded-lg text-xs font-medium bg-secondary hover:bg-secondary/80 text-foreground transition-colors disabled:opacity-50"
        >
          Search
        </button>
      </form>

      {/* Optional New File Creation Form */}
      {showCreateForm && (
        <div className="mt-2.5 rounded-lg border border-border/70 bg-background/80 p-2.5 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-foreground">Create New File in Drive</span>
            <button
              type="button"
              onClick={() => setShowCreateForm(false)}
              className="text-[11px] text-muted-foreground hover:text-foreground"
            >
              Close
            </button>
          </div>
          <input
            type="text"
            value={newFileName}
            onChange={(e) => setNewFileName(e.target.value)}
            placeholder="File name (e.g. Project Notes.txt)"
            className="w-full px-2.5 py-1.5 rounded-md text-xs bg-background border border-border/70 text-foreground"
          />
          <textarea
            rows={2}
            value={newFileContent}
            onChange={(e) => setNewFileContent(e.target.value)}
            placeholder="File text content..."
            className="w-full px-2.5 py-1.5 rounded-md text-xs bg-background border border-border/70 text-foreground"
          />
          <div className="flex justify-end">
            <button
              type="button"
              onClick={() => {
                if (!newFileName.trim()) {
                  toast.error('Please enter a file name.');
                  return;
                }
                setPendingMutation({
                  kind: 'create_file',
                  fileName: newFileName.trim(),
                  content: newFileContent,
                });
              }}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium bg-blue-600 hover:bg-blue-500 text-white"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Create File</span>
            </button>
          </div>
        </div>
      )}

      {/* Official Google Sign-In prompt if unauthenticated */}
      {needsAuth && (
        <div className="mt-3 rounded-lg border border-border/60 bg-background/50 p-3 flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-muted-foreground">
            Sign in with Google to browse and select your Google Drive files.
          </p>
          <button
            type="button"
            onClick={handleGoogleSignIn}
            className="gsi-material-button"
            style={{ height: '32px', padding: '0 10px', fontSize: '12px' }}
          >
            <div className="gsi-material-button-state"></div>
            <div className="gsi-material-button-content-wrapper">
              <div
                className="gsi-material-button-icon"
                style={{ width: '14px', height: '14px', marginRight: '8px' }}
              >
                <svg
                  version="1.1"
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 48 48"
                  style={{ display: 'block' }}
                >
                  <path
                    fill="#EA4335"
                    d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
                  ></path>
                  <path
                    fill="#4285F4"
                    d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
                  ></path>
                  <path
                    fill="#FBBC05"
                    d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
                  ></path>
                  <path
                    fill="#34A853"
                    d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
                  ></path>
                  <path fill="none" d="M0 0h48v48H0z"></path>
                </svg>
              </div>
              <span className="gsi-material-button-contents">Sign in with Google</span>
            </div>
          </button>
        </div>
      )}

      {/* Loading Indicator */}
      {loading && (
        <div className="mt-3 flex items-center justify-center gap-2 py-5 text-xs text-muted-foreground">
          <Loader2 className="w-4 h-4 animate-spin text-blue-400" />
          <span>Loading files from Google Drive...</span>
        </div>
      )}

      {/* Drive File List */}
      {!loading && files.length > 0 && (
        <div className="mt-2.5 max-h-60 overflow-y-auto divide-y divide-border/40 rounded-lg border border-border/60 bg-background/50">
          {files.map((file) => {
            const isSelected = selectedFile?.id === file.id;
            return (
              <div
                key={file.id}
                data-testid="drive-selector-file-row"
                className={`flex items-center justify-between gap-2 px-2.5 py-2 text-xs transition-colors ${
                  isSelected ? 'bg-blue-500/10' : 'hover:bg-secondary/50'
                }`}
              >
                <button
                  type="button"
                  onClick={() => handleSelectFile(file)}
                  className="flex items-center gap-2 min-w-0 flex-1 text-left"
                >
                  {renderDriveItemIcon(file.mimeType)}
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-foreground truncate">{file.name}</p>
                    <p className="text-[10px] text-muted-foreground truncate">
                      {googleDriveService.formatMimeTypeLabel(file.mimeType)}
                      {file.modifiedTime
                        ? ` • Modified ${new Date(file.modifiedTime).toLocaleDateString()}`
                        : ''}
                    </p>
                  </div>
                </button>

                <div className="flex items-center gap-1 shrink-0">
                  <button
                    type="button"
                    onClick={() => handleSelectFile(file)}
                    className={`inline-flex items-center gap-1 px-2 py-1 rounded text-[11px] font-medium transition-colors ${
                      isSelected
                        ? 'bg-blue-600 text-white'
                        : 'bg-secondary/80 hover:bg-secondary text-foreground'
                    }`}
                  >
                    {isSelected ? (
                      <>
                        <Check className="w-3 h-3" />
                        <span>Selected</span>
                      </>
                    ) : (
                      <>
                        <Eye className="w-3 h-3" />
                        <span>Select</span>
                      </>
                    )}
                  </button>

                  {file.webViewLink && (
                    <a
                      href={file.webViewLink}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-secondary/60"
                      title="Open in Google Drive"
                    >
                      <ExternalLink className="w-3.5 h-3.5" />
                    </a>
                  )}

                  <button
                    type="button"
                    onClick={() =>
                      setPendingMutation({
                        kind: 'trash_file',
                        file,
                      })
                    }
                    className="p-1 rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                    title="Move file to Trash"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {!loading && !needsAuth && files.length === 0 && !errorMessage && (
        <div className="mt-3 rounded-lg border border-border/50 bg-background/40 p-3 text-center text-xs text-muted-foreground">
          No files found in Google Drive matching your filter.
        </div>
      )}

      {/* Selected File Preview Panel */}
      {selectedFile && (
        <div
          data-testid="drive-selected-file-preview"
          className="mt-2.5 rounded-lg border border-blue-500/30 bg-blue-500/5 p-2.5 space-y-1.5"
        >
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 min-w-0">
              {renderDriveItemIcon(selectedFile.mimeType)}
              <span className="text-xs font-semibold text-foreground truncate">
                {selectedFile.name}
              </span>
            </div>
            {selectedContext && (
              <span className="text-[10px] text-muted-foreground shrink-0">
                {selectedContext.wordCount} words
              </span>
            )}
          </div>
          {loadingPreview ? (
            <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground py-1">
              <Loader2 className="w-3 h-3 animate-spin text-blue-400" />
              <span>Reading file content...</span>
            </div>
          ) : selectedContext?.content ? (
            <pre className="max-h-28 overflow-y-auto rounded bg-background/80 p-2 text-[11px] text-muted-foreground whitespace-pre-wrap font-mono">
              {selectedContext.content.slice(0, 600)}
              {selectedContext.content.length > 600 ? '...' : ''}
            </pre>
          ) : null}
        </div>
      )}

      {/* Explicit Confirmation Banner for Drive Mutations */}
      {pendingMutation && (
        <div
          data-testid="drive-mutation-confirmation"
          className="mt-3 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 space-y-2"
        >
          <div className="flex items-start gap-2">
            <ShieldAlert className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
            <div className="text-xs text-foreground space-y-1">
              <p className="font-semibold">Confirm Google Drive Change</p>
              {pendingMutation.kind === 'create_file' ? (
                <p className="text-muted-foreground">
                  Create new file{' '}
                  <span className="font-medium text-foreground">
                    "{pendingMutation.fileName}"
                  </span>{' '}
                  in your Google Drive?
                </p>
              ) : (
                <p className="text-muted-foreground">
                  Move{' '}
                  <span className="font-medium text-foreground">
                    "{pendingMutation.file.name}"
                  </span>{' '}
                  to Google Drive Trash?
                </p>
              )}
            </div>
          </div>
          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => setPendingMutation(null)}
              disabled={mutating}
              className="px-2.5 py-1 rounded-md text-xs font-medium bg-secondary hover:bg-secondary/80 text-foreground"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={executeConfirmedMutation}
              disabled={mutating}
              className="inline-flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-medium bg-blue-600 hover:bg-blue-500 text-white disabled:opacity-50"
            >
              {mutating ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Check className="w-3.5 h-3.5" />
              )}
              <span>Confirm</span>
            </button>
          </div>
        </div>
      )}

      {/* Error Message */}
      {errorMessage && (
        <div className="mt-2.5 flex items-center gap-1.5 text-xs text-destructive">
          <AlertCircle className="w-3.5 h-3.5 shrink-0" />
          <span className="truncate">{errorMessage}</span>
        </div>
      )}
    </div>
  );
}

export default GoogleDriveSelectorCard;
