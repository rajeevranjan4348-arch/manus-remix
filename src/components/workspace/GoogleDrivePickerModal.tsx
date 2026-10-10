import React, { useState, useEffect } from 'react';
import { 
  Dialog, 
  DialogContent, 
  DialogHeader, 
  DialogTitle, 
  DialogDescription 
} from '@/components/ui/dialog';
import { 
  Search, 
  FileText, 
  FileSpreadsheet, 
  Presentation, 
  Image as ImageIcon, 
  File, 
  ExternalLink, 
  Check, 
  Folder, 
  Loader2, 
  AlertCircle,
  HardDrive,
  Plug
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { listGoogleDriveFiles, GoogleDriveFileItem } from '@/lib/workspaceTools';
import { googleSignIn, getAccessToken } from '@/lib/workspaceAuth';
import { toast } from 'sonner';

interface GoogleDrivePickerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectFile: (file: GoogleDriveFileItem) => void;
}

export function GoogleDrivePickerModal({
  isOpen,
  onClose,
  onSelectFile
}: GoogleDrivePickerModalProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [files, setFiles] = useState<GoogleDriveFileItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedFileId, setSelectedFileId] = useState<string | null>(null);
  const [needsAuth, setNeedsAuth] = useState(false);

  const fetchFiles = async (query?: string) => {
    setIsLoading(true);
    setError(null);
    try {
      const driveFiles = await listGoogleDriveFiles(query);
      setFiles(driveFiles);
      setNeedsAuth(false);
    } catch (err: any) {
      console.error('Error listing Drive files:', err);
      if (err.message?.includes('authentication') || err.message?.includes('OAuth') || err.message?.includes('401')) {
        setNeedsAuth(true);
      } else {
        setError(err.message || 'Failed to load Google Drive files');
      }
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      setSelectedFileId(null);
      fetchFiles();
    }
  }, [isOpen]);

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    fetchFiles(searchQuery);
  };

  const handleSignIn = async () => {
    try {
      setIsLoading(true);
      const res = await googleSignIn();
      if (res) {
        setNeedsAuth(false);
        fetchFiles(searchQuery);
        toast.success('Connected to Google Drive');
      }
    } catch (err: any) {
      toast.error('Failed to sign in with Google');
    } finally {
      setIsLoading(false);
    }
  };

  const getFileIcon = (mimeType: string) => {
    if (mimeType.includes('document')) return <FileText className="text-blue-500 shrink-0" size={18} />;
    if (mimeType.includes('spreadsheet')) return <FileSpreadsheet className="text-emerald-500 shrink-0" size={18} />;
    if (mimeType.includes('presentation')) return <Presentation className="text-amber-500 shrink-0" size={18} />;
    if (mimeType.includes('image')) return <ImageIcon className="text-purple-500 shrink-0" size={18} />;
    if (mimeType.includes('folder')) return <Folder className="text-amber-400 shrink-0" size={18} />;
    return <File className="text-gray-400 shrink-0" size={18} />;
  };

  const handleConfirmSelect = () => {
    const selected = files.find(f => f.id === selectedFileId);
    if (selected) {
      onSelectFile(selected);
      onClose();
      toast.success(`Attached "${selected.name}" from Google Drive`);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl bg-card border-border/80 text-foreground p-0 overflow-hidden shadow-2xl rounded-2xl">
        <DialogHeader className="p-5 pb-3 border-b border-border/60 bg-muted/20">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-blue-500/10 text-blue-500">
              <Plug size={20} />
            </div>
            <div>
              <DialogTitle className="text-base font-semibold text-foreground">Connectors & Google Drive</DialogTitle>
              <DialogDescription className="text-xs text-muted-foreground">
                Connect Google Workspace services and select files directly from Google Drive
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="p-5 space-y-4">
          {needsAuth ? (
            <div className="py-10 text-center space-y-4">
              <div className="w-12 h-12 rounded-full bg-blue-500/10 text-blue-500 flex items-center justify-center mx-auto">
                <HardDrive size={24} />
              </div>
              <div className="space-y-1">
                <p className="text-sm font-semibold text-foreground">Google Drive Authentication Required</p>
                <p className="text-xs text-muted-foreground max-w-sm mx-auto">
                  Sign in with your Google account to grant access to your Google Drive files.
                </p>
              </div>
              <button
                onClick={handleSignIn}
                className="gsi-material-button inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl bg-foreground text-background font-medium text-xs hover:opacity-90 transition-opacity cursor-pointer shadow-sm"
              >
                <svg version="1.1" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" className="w-4 h-4">
                  <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"></path>
                  <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"></path>
                  <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"></path>
                  <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"></path>
                </svg>
                <span>Sign in with Google</span>
              </button>
            </div>
          ) : (
            <>
              {/* Search Bar */}
              <form onSubmit={handleSearchSubmit} className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" size={15} />
                <input
                  type="text"
                  placeholder="Search files in Google Drive..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full text-xs pl-9 pr-20 py-2.5 bg-muted/40 border border-border/70 rounded-xl text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-foreground/30"
                />
                <button
                  type="submit"
                  className="absolute right-1.5 top-1/2 -translate-y-1/2 px-3 py-1 bg-foreground text-background text-[11px] font-medium rounded-lg hover:opacity-90 transition-opacity"
                >
                  Search
                </button>
              </form>

              {/* Error banner */}
              {error && (
                <div className="p-3 rounded-xl bg-destructive/10 border border-destructive/20 text-destructive text-xs flex items-center gap-2">
                  <AlertCircle size={15} className="shrink-0" />
                  <span>{error}</span>
                </div>
              )}

              {/* File List */}
              <div className="h-64 overflow-y-auto pr-1 space-y-1 border border-border/50 rounded-xl p-1.5 bg-muted/10">
                {isLoading ? (
                  <div className="h-full flex items-center justify-center text-muted-foreground gap-2 text-xs">
                    <Loader2 size={16} className="animate-spin" />
                    <span>Fetching Drive items...</span>
                  </div>
                ) : files.length === 0 ? (
                  <div className="h-full flex items-center justify-center text-muted-foreground text-xs">
                    No files found in Google Drive
                  </div>
                ) : (
                  files.map((file) => {
                    const isSelected = selectedFileId === file.id;
                    return (
                      <div
                        key={file.id}
                        onClick={() => setSelectedFileId(file.id)}
                        className={cn(
                          "flex items-center justify-between p-2.5 rounded-lg cursor-pointer text-xs transition-colors group",
                          isSelected 
                            ? "bg-foreground/10 border border-foreground/30 font-medium" 
                            : "hover:bg-muted/60 border border-transparent"
                        )}
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          {getFileIcon(file.mimeType)}
                          <div className="truncate">
                            <p className="font-medium text-foreground truncate">{file.name}</p>
                            <p className="text-[10px] text-muted-foreground truncate">
                              Modified: {file.modifiedTime ? new Date(file.modifiedTime).toLocaleDateString() : 'Recent'}
                            </p>
                          </div>
                        </div>

                        <div className="flex items-center gap-2 shrink-0">
                          {file.webViewLink && (
                            <a
                              href={file.webViewLink}
                              target="_blank"
                              rel="noreferrer"
                              onClick={(e) => e.stopPropagation()}
                              className="p-1 text-muted-foreground hover:text-foreground opacity-0 group-hover:opacity-100 transition-opacity"
                              title="Open in Drive"
                            >
                              <ExternalLink size={13} />
                            </a>
                          )}
                          <div className={cn(
                            "w-4 h-4 rounded-full border flex items-center justify-center transition-colors",
                            isSelected ? "border-foreground bg-foreground text-background" : "border-border"
                          )}>
                            {isSelected && <Check size={10} />}
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </>
          )}
        </div>

        {/* Modal Footer */}
        {!needsAuth && (
          <div className="p-4 border-t border-border/60 bg-muted/20 flex items-center justify-between">
            <p className="text-[11px] text-muted-foreground">
              {files.length} file(s) available
            </p>
            <div className="flex gap-2">
              <button
                onClick={onClose}
                className="px-4 py-2 rounded-xl text-xs font-medium border border-border/60 hover:bg-muted transition-colors"
              >
                Cancel
              </button>
              <button
                disabled={!selectedFileId}
                onClick={handleConfirmSelect}
                className="px-4 py-2 rounded-xl text-xs font-medium bg-foreground text-background hover:opacity-90 disabled:opacity-40 transition-opacity cursor-pointer"
              >
                Attach Selected File
              </button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
