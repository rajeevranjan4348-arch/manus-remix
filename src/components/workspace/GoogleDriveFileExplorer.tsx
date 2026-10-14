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
  RefreshCw,
  ChevronRight,
  Home,
  LayoutGrid,
  List as ListIcon,
  Sparkles,
  Eye,
  FileCode,
  CheckSquare,
  Square,
  X,
  FileCheck,
  Copy,
  Info
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { 
  listGoogleDriveFiles, 
  GoogleDriveFileItem, 
  retrieveDriveDocumentContext,
  DriveDocumentContextResult 
} from '@/lib/workspaceTools';
import { googleSignIn } from '@/lib/workspaceAuth';
import { toast } from 'sonner';

export interface BreadcrumbItem {
  id: string;
  name: string;
}

export interface GoogleDriveFileExplorerProps {
  isOpen: boolean;
  onClose: () => void;
  onAttachContext: (contextString: string, fileItems: GoogleDriveFileItem[]) => void;
  title?: string;
}

export function GoogleDriveFileExplorer({
  isOpen,
  onClose,
  onAttachContext,
  title = "Google Drive File Explorer"
}: GoogleDriveFileExplorerProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [activeFilter, setActiveFilter] = useState<'all' | 'document' | 'spreadsheet' | 'presentation' | 'folder' | 'pdf'>('all');
  const [viewMode, setViewMode] = useState<'list' | 'grid'>('list');
  const [files, setFiles] = useState<GoogleDriveFileItem[]>([]);
  const [breadcrumbs, setBreadcrumbs] = useState<BreadcrumbItem[]>([
    { id: 'root', name: 'My Drive' }
  ]);
  const [currentFolderId, setCurrentFolderId] = useState<string>('');
  
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [needsAuth, setNeedsAuth] = useState(false);
  
  // Selection state (multi-select)
  const [selectedFileIds, setSelectedFileIds] = useState<Set<string>>(new Set());
  
  // Preview Drawer State
  const [previewFile, setPreviewFile] = useState<GoogleDriveFileItem | null>(null);
  const [previewData, setPreviewData] = useState<DriveDocumentContextResult | null>(null);
  const [isLoadingPreview, setIsLoadingPreview] = useState(false);
  
  const [isExtractingBatch, setIsExtractingBatch] = useState(false);

  const fetchFiles = async (
    query = searchQuery, 
    folderId = currentFolderId, 
    filter = activeFilter
  ) => {
    setIsLoading(true);
    setError(null);
    try {
      const driveFiles = await listGoogleDriveFiles({
        searchQuery: query,
        folderId: folderId,
        mimeTypeFilter: filter
      });
      setFiles(driveFiles);
      setNeedsAuth(false);
    } catch (err: any) {
      console.error('[Drive Explorer] Error listing files:', err);
      if (err.message?.includes('authentication') || err.message?.includes('OAuth') || err.message?.includes('401')) {
        setNeedsAuth(true);
      } else {
        setError(err.message || 'Failed to connect to Google Drive');
      }
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      setSelectedFileIds(new Set());
      setPreviewFile(null);
      setPreviewData(null);
      fetchFiles(searchQuery, currentFolderId, activeFilter);
    }
  }, [isOpen, currentFolderId, activeFilter]);

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    fetchFiles(searchQuery, currentFolderId, activeFilter);
  };

  const handleSignIn = async () => {
    try {
      setIsLoading(true);
      const res = await googleSignIn();
      if (res) {
        setNeedsAuth(false);
        fetchFiles(searchQuery, currentFolderId, activeFilter);
        toast.success('Connected to Google Drive');
      }
    } catch (err: any) {
      toast.error('Failed to sign in with Google');
    } finally {
      setIsLoading(false);
    }
  };

  const handleFolderClick = (file: GoogleDriveFileItem) => {
    setCurrentFolderId(file.id);
    setBreadcrumbs(prev => [...prev, { id: file.id, name: file.name }]);
    setSearchQuery('');
  };

  const handleBreadcrumbClick = (index: number) => {
    const newBreadcrumbs = breadcrumbs.slice(0, index + 1);
    setBreadcrumbs(newBreadcrumbs);
    const targetFolder = newBreadcrumbs[newBreadcrumbs.length - 1];
    setCurrentFolderId(targetFolder.id === 'root' ? '' : targetFolder.id);
    setSearchQuery('');
  };

  const toggleSelectFile = (fileId: string) => {
    setSelectedFileIds(prev => {
      const next = new Set(prev);
      if (next.has(fileId)) {
        next.delete(fileId);
      } else {
        next.add(fileId);
      }
      return next;
    });
  };

  const handleSelectAllToggle = () => {
    const selectableFiles = files.filter(f => !f.mimeType.includes('folder'));
    if (selectedFileIds.size === selectableFiles.length && selectableFiles.length > 0) {
      setSelectedFileIds(new Set());
    } else {
      setSelectedFileIds(new Set(selectableFiles.map(f => f.id)));
    }
  };

  const handlePreviewFile = async (file: GoogleDriveFileItem, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    setPreviewFile(file);
    setIsLoadingPreview(true);
    setPreviewData(null);
    try {
      const res = await retrieveDriveDocumentContext(file);
      setPreviewData(res);
    } catch (err: any) {
      toast.error(`Could not preview ${file.name}`);
    } finally {
      setIsLoadingPreview(false);
    }
  };

  const handleAttachSelectedContext = async () => {
    const selectedItems = files.filter(f => selectedFileIds.has(f.id));
    if (selectedItems.length === 0) return;

    setIsExtractingBatch(true);
    try {
      const results = await Promise.all(
        selectedItems.map(file => retrieveDriveDocumentContext(file))
      );

      const combinedContext = results.map(r => r.formattedContext).join('\n\n');
      onAttachContext(combinedContext, selectedItems);
      onClose();
      toast.success(`Attached ${selectedItems.length} Google Drive document(s) as context for AI Agent`);
    } catch (err: any) {
      toast.error('Error extracting Google Drive documents context');
    } finally {
      setIsExtractingBatch(false);
    }
  };

  const getFileIcon = (mimeType: string) => {
    if (mimeType.includes('document')) return <FileText className="text-blue-500 shrink-0" size={18} />;
    if (mimeType.includes('spreadsheet')) return <FileSpreadsheet className="text-emerald-500 shrink-0" size={18} />;
    if (mimeType.includes('presentation')) return <Presentation className="text-amber-500 shrink-0" size={18} />;
    if (mimeType.includes('image')) return <ImageIcon className="text-purple-500 shrink-0" size={18} />;
    if (mimeType.includes('folder')) return <Folder className="text-amber-400 fill-amber-400/20 shrink-0" size={18} />;
    if (mimeType.includes('pdf')) return <FileCode className="text-red-500 shrink-0" size={18} />;
    return <File className="text-muted-foreground shrink-0" size={18} />;
  };

  const getFormatBadge = (mimeType: string) => {
    if (mimeType.includes('document')) return <span className="px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-600 dark:text-blue-400 text-[10px] font-medium">Doc</span>;
    if (mimeType.includes('spreadsheet')) return <span className="px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 text-[10px] font-medium">Sheet</span>;
    if (mimeType.includes('presentation')) return <span className="px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-600 dark:text-amber-400 text-[10px] font-medium">Slides</span>;
    if (mimeType.includes('pdf')) return <span className="px-1.5 py-0.5 rounded bg-red-500/10 text-red-600 dark:text-red-400 text-[10px] font-medium">PDF</span>;
    if (mimeType.includes('folder')) return <span className="px-1.5 py-0.5 rounded bg-amber-400/10 text-amber-500 text-[10px] font-medium">Folder</span>;
    return <span className="px-1.5 py-0.5 rounded bg-muted text-muted-foreground text-[10px] font-medium">File</span>;
  };

  const selectableFilesCount = files.filter(f => !f.mimeType.includes('folder')).length;

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-4xl w-[95vw] h-[85vh] bg-card border-border/80 text-foreground p-0 overflow-hidden shadow-2xl rounded-2xl flex flex-col">
        
        {/* Header */}
        <DialogHeader className="p-4 sm:p-5 pb-3 border-b border-border/60 bg-muted/20 flex flex-row items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-blue-500/10 text-blue-500 shadow-2xs">
              <HardDrive size={22} />
            </div>
            <div>
              <DialogTitle className="text-base font-semibold text-foreground flex items-center gap-2">
                <span>{title}</span>
                <span className="px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 text-[10px] font-semibold border border-emerald-500/20">
                  Google Drive API Connected
                </span>
              </DialogTitle>
              <DialogDescription className="text-xs text-muted-foreground">
                Browse Google Drive documents, inspect contents, and attach text directly as context for AI agents
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        {/* Content Area */}
        <div className="flex-1 flex min-h-0 relative overflow-hidden">
          {needsAuth ? (
            <div className="w-full flex flex-col items-center justify-center p-8 text-center space-y-4 my-auto">
              <div className="w-14 h-14 rounded-2xl bg-blue-500/10 text-blue-500 flex items-center justify-center shadow-md animate-pulse">
                <HardDrive size={28} />
              </div>
              <div className="space-y-1 max-w-sm">
                <p className="text-sm font-semibold text-foreground">Google Drive Authorization Required</p>
                <p className="text-xs text-muted-foreground">
                  Sign in with your Google Workspace account to grant read access to your Drive documents as AI context.
                </p>
              </div>
              <button
                onClick={handleSignIn}
                className="gsi-material-button inline-flex items-center justify-center gap-2.5 px-6 py-3 rounded-xl bg-foreground text-background font-medium text-xs hover:opacity-90 transition-all cursor-pointer shadow-md"
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
            <div className="flex-1 flex flex-col min-w-0 h-full">
              
              {/* Toolbar & Search Bar */}
              <div className="p-3 sm:p-4 border-b border-border/60 bg-card space-y-3 shrink-0">
                
                {/* Search & Layout toggle */}
                <div className="flex items-center gap-2">
                  <form onSubmit={handleSearchSubmit} className="relative flex-1">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" size={14} />
                    <input
                      type="text"
                      placeholder="Search files or documents in Google Drive..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="w-full text-xs pl-9 pr-20 py-2 bg-muted/40 border border-border/70 rounded-xl text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-foreground/30"
                    />
                    {searchQuery && (
                      <button
                        type="button"
                        onClick={() => { setSearchQuery(''); fetchFiles('', currentFolderId, activeFilter); }}
                        className="absolute right-16 top-1/2 -translate-y-1/2 p-1 text-muted-foreground hover:text-foreground"
                      >
                        <X size={12} />
                      </button>
                    )}
                    <button
                      type="submit"
                      className="absolute right-1.5 top-1/2 -translate-y-1/2 px-2.5 py-1 bg-foreground text-background text-[11px] font-medium rounded-lg hover:opacity-90 transition-opacity cursor-pointer"
                    >
                      Search
                    </button>
                  </form>

                  <button
                    onClick={() => fetchFiles(searchQuery, currentFolderId, activeFilter)}
                    disabled={isLoading}
                    className="p-2 border border-border/70 rounded-xl hover:bg-muted text-muted-foreground hover:text-foreground transition-colors shrink-0"
                    title="Refresh list"
                  >
                    <RefreshCw size={14} className={cn(isLoading && "animate-spin")} />
                  </button>

                  <div className="flex items-center border border-border/70 rounded-xl overflow-hidden p-0.5 bg-muted/20 shrink-0">
                    <button
                      onClick={() => setViewMode('list')}
                      className={cn("p-1.5 rounded-lg text-xs transition-colors", viewMode === 'list' ? "bg-card text-foreground shadow-2xs font-medium" : "text-muted-foreground hover:text-foreground")}
                      title="List View"
                    >
                      <ListIcon size={14} />
                    </button>
                    <button
                      onClick={() => setViewMode('grid')}
                      className={cn("p-1.5 rounded-lg text-xs transition-colors", viewMode === 'grid' ? "bg-card text-foreground shadow-2xs font-medium" : "text-muted-foreground hover:text-foreground")}
                      title="Grid View"
                    >
                      <LayoutGrid size={14} />
                    </button>
                  </div>
                </div>

                {/* Breadcrumb Path & Filters */}
                <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                  
                  {/* Breadcrumbs */}
                  <div className="flex items-center gap-1 text-xs text-muted-foreground overflow-x-auto max-w-full pb-0.5">
                    {breadcrumbs.map((crumb, idx) => (
                      <React.Fragment key={crumb.id + idx}>
                        {idx > 0 && <ChevronRight size={12} className="shrink-0 text-muted-foreground/60" />}
                        <button
                          onClick={() => handleBreadcrumbClick(idx)}
                          className={cn(
                            "flex items-center gap-1 hover:text-foreground transition-colors shrink-0 px-1.5 py-0.5 rounded-md",
                            idx === breadcrumbs.length - 1 ? "font-semibold text-foreground bg-muted/60" : "hover:bg-muted/40"
                          )}
                        >
                          {idx === 0 ? <Home size={12} /> : <Folder size={12} className="text-amber-500" />}
                          <span>{crumb.name}</span>
                        </button>
                      </React.Fragment>
                    ))}
                  </div>

                  {/* Filter Tabs */}
                  <div className="flex items-center gap-1 overflow-x-auto text-[11px]">
                    {[
                      { id: 'all', label: 'All Files' },
                      { id: 'document', label: 'Docs' },
                      { id: 'spreadsheet', label: 'Sheets' },
                      { id: 'presentation', label: 'Slides' },
                      { id: 'pdf', label: 'PDFs' },
                      { id: 'folder', label: 'Folders' },
                    ].map(f => (
                      <button
                        key={f.id}
                        onClick={() => setActiveFilter(f.id as any)}
                        className={cn(
                          "px-2.5 py-1 rounded-lg transition-colors shrink-0 font-medium",
                          activeFilter === f.id
                            ? "bg-foreground text-background shadow-2xs"
                            : "bg-muted/30 text-muted-foreground hover:bg-muted/80 hover:text-foreground"
                        )}
                      >
                        {f.label}
                      </button>
                    ))}
                  </div>

                </div>

              </div>

              {/* Error banner */}
              {error && (
                <div className="m-3 p-3 rounded-xl bg-destructive/10 border border-destructive/20 text-destructive text-xs flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <AlertCircle size={15} className="shrink-0" />
                    <span>{error}</span>
                  </div>
                  <button 
                    onClick={() => fetchFiles()}
                    className="px-2.5 py-1 bg-destructive text-destructive-foreground font-medium rounded-lg text-[11px]"
                  >
                    Retry
                  </button>
                </div>
              )}

              {/* Main File List / Grid Container */}
              <div className="flex-1 overflow-y-auto p-3 sm:p-4 min-h-0 bg-muted/5">
                {isLoading ? (
                  <div className="h-full flex flex-col items-center justify-center text-muted-foreground gap-3 text-xs py-16">
                    <Loader2 size={24} className="animate-spin text-foreground" />
                    <span>Indexing Google Drive files...</span>
                  </div>
                ) : files.length === 0 ? (
                  <div className="h-full flex flex-col items-center justify-center text-muted-foreground text-xs py-16 space-y-2">
                    <Folder size={36} className="text-muted-foreground/30" />
                    <p className="font-medium text-foreground">No matching files found</p>
                    <p className="text-[11px] max-w-xs text-center">
                      Try adjusting your search query, selecting another folder, or changing the file filter.
                    </p>
                  </div>
                ) : viewMode === 'list' ? (
                  /* List View */
                  <div className="space-y-1">
                    
                    {/* Header bar */}
                    <div className="flex items-center justify-between px-3 py-1.5 text-[11px] font-medium text-muted-foreground border-b border-border/40 pb-2 mb-1">
                      <div className="flex items-center gap-3">
                        <button
                          onClick={handleSelectAllToggle}
                          className="flex items-center gap-1.5 hover:text-foreground transition-colors cursor-pointer"
                        >
                          {selectedFileIds.size > 0 && selectedFileIds.size === selectableFilesCount ? (
                            <CheckSquare size={14} className="text-foreground" />
                          ) : (
                            <Square size={14} />
                          )}
                          <span>Select All</span>
                        </button>
                        <span>Name</span>
                      </div>
                      <div className="flex items-center gap-6">
                        <span>Type</span>
                        <span>Actions</span>
                      </div>
                    </div>

                    {files.map((file) => {
                      const isFolder = file.mimeType.includes('folder');
                      const isSelected = selectedFileIds.has(file.id);

                      return (
                        <div
                          key={file.id}
                          onClick={() => {
                            if (isFolder) {
                              handleFolderClick(file);
                            } else {
                              toggleSelectFile(file.id);
                            }
                          }}
                          className={cn(
                            "group flex items-center justify-between p-2.5 rounded-xl cursor-pointer text-xs transition-all border",
                            isSelected 
                              ? "bg-foreground/5 border-foreground/30 shadow-2xs" 
                              : "hover:bg-muted/60 border-transparent hover:border-border/40"
                          )}
                        >
                          {/* File Icon & Name */}
                          <div className="flex items-center gap-3 min-w-0 pr-2">
                            {!isFolder ? (
                              <button
                                onClick={(e) => { e.stopPropagation(); toggleSelectFile(file.id); }}
                                className="p-0.5 text-muted-foreground hover:text-foreground transition-colors cursor-pointer shrink-0"
                              >
                                {isSelected ? (
                                  <CheckSquare size={15} className="text-foreground" />
                                ) : (
                                  <Square size={15} />
                                )}
                              </button>
                            ) : (
                              <div className="w-4 shrink-0" />
                            )}

                            {getFileIcon(file.mimeType)}

                            <div className="truncate min-w-0">
                              <p className="font-medium text-foreground truncate group-hover:text-foreground">
                                {file.name}
                              </p>
                              <p className="text-[10px] text-muted-foreground truncate">
                                {file.modifiedTime ? `Modified ${new Date(file.modifiedTime).toLocaleDateString()}` : 'Recent'}
                              </p>
                            </div>
                          </div>

                          {/* Actions & Badges */}
                          <div className="flex items-center gap-3 shrink-0">
                            {getFormatBadge(file.mimeType)}

                            <div className="flex items-center gap-1">
                              {!isFolder && (
                                <button
                                  onClick={(e) => handlePreviewFile(file, e)}
                                  className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors cursor-pointer"
                                  title="Preview Extracted Text Context"
                                >
                                  <Eye size={14} />
                                </button>
                              )}

                              {file.webViewLink && (
                                <a
                                  href={file.webViewLink}
                                  target="_blank"
                                  rel="noreferrer"
                                  onClick={(e) => e.stopPropagation()}
                                  className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                                  title="Open in Google Drive"
                                >
                                  <ExternalLink size={14} />
                                </a>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  /* Grid View */
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                    {files.map((file) => {
                      const isFolder = file.mimeType.includes('folder');
                      const isSelected = selectedFileIds.has(file.id);

                      return (
                        <div
                          key={file.id}
                          onClick={() => {
                            if (isFolder) {
                              handleFolderClick(file);
                            } else {
                              toggleSelectFile(file.id);
                            }
                          }}
                          className={cn(
                            "group relative p-3 rounded-2xl cursor-pointer border text-xs flex flex-col justify-between h-32 transition-all",
                            isSelected 
                              ? "bg-foreground/5 border-foreground/40 shadow-sm" 
                              : "bg-card hover:bg-muted/50 border-border/60 hover:border-border"
                          )}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="p-2 rounded-xl bg-muted/40 shrink-0">
                              {getFileIcon(file.mimeType)}
                            </div>

                            {!isFolder && (
                              <button
                                onClick={(e) => { e.stopPropagation(); toggleSelectFile(file.id); }}
                                className="p-1 text-muted-foreground hover:text-foreground transition-colors"
                              >
                                {isSelected ? (
                                  <CheckSquare size={16} className="text-foreground" />
                                ) : (
                                  <Square size={16} />
                                )}
                              </button>
                            )}
                          </div>

                          <div>
                            <p className="font-semibold text-foreground line-clamp-2 leading-snug">
                              {file.name}
                            </p>
                            <div className="flex items-center justify-between gap-1 mt-1 text-[10px] text-muted-foreground">
                              <span>{getFormatBadge(file.mimeType)}</span>
                              {!isFolder && (
                                <button
                                  onClick={(e) => handlePreviewFile(file, e)}
                                  className="text-muted-foreground hover:text-foreground flex items-center gap-0.5"
                                >
                                  <Eye size={11} />
                                  <span>Preview</span>
                                </button>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

            </div>
          )}

          {/* Side Drawer: Document Context Text Preview */}
          {previewFile && (
            <div className="w-80 sm:w-96 border-l border-border/60 bg-card flex flex-col h-full shrink-0 shadow-lg animate-in slide-in-from-right-5 duration-200">
              <div className="p-4 border-b border-border/60 flex items-center justify-between bg-muted/20 shrink-0">
                <div className="flex items-center gap-2 min-w-0 pr-2">
                  <Eye size={16} className="text-blue-500 shrink-0" />
                  <span className="font-semibold text-xs text-foreground truncate">{previewFile.name}</span>
                </div>
                <button
                  onClick={() => setPreviewFile(null)}
                  className="p-1 text-muted-foreground hover:text-foreground rounded-lg hover:bg-muted"
                >
                  <X size={14} />
                </button>
              </div>

              <div className="flex-1 p-4 overflow-y-auto space-y-3 min-h-0 text-xs">
                {isLoadingPreview ? (
                  <div className="h-full flex flex-col items-center justify-center text-muted-foreground gap-2 py-12">
                    <Loader2 size={20} className="animate-spin text-blue-500" />
                    <span>Extracting document text...</span>
                  </div>
                ) : previewData ? (
                  <>
                    <div className="p-2.5 rounded-xl bg-muted/40 border border-border/60 space-y-1 text-[11px]">
                      <div className="flex items-center justify-between text-muted-foreground">
                        <span>Characters: <strong className="text-foreground">{previewData.charCount}</strong></span>
                        <span>Words: <strong className="text-foreground">{previewData.wordCount}</strong></span>
                      </div>
                      <p className="text-[10px] text-muted-foreground truncate">MIME: {previewFile.mimeType}</p>
                    </div>

                    <div className="space-y-1">
                      <p className="text-[11px] font-semibold text-foreground">Extracted Text Content:</p>
                      <div className="p-3 bg-muted/30 border border-border/60 rounded-xl font-mono text-[11px] whitespace-pre-wrap text-foreground/90 max-h-72 overflow-y-auto leading-relaxed">
                        {previewData.content || "(No text content found in document)"}
                      </div>
                    </div>
                  </>
                ) : (
                  <p className="text-muted-foreground text-center py-8">Failed to preview file context.</p>
                )}
              </div>

              <div className="p-4 border-t border-border/60 bg-muted/10 shrink-0 space-y-2">
                <button
                  disabled={!previewData}
                  onClick={() => {
                    if (previewData) {
                      onAttachContext(previewData.formattedContext, [previewFile]);
                      onClose();
                      toast.success(`Attached "${previewFile.name}" as AI Agent context`);
                    }
                  }}
                  className="w-full py-2.5 px-3 rounded-xl bg-foreground text-background font-medium text-xs hover:opacity-90 disabled:opacity-40 transition-opacity flex items-center justify-center gap-2 cursor-pointer shadow-xs"
                >
                  <Sparkles size={14} />
                  <span>Attach This Document as Context</span>
                </button>
              </div>
            </div>
          )}

        </div>

        {/* Modal Footer */}
        {!needsAuth && (
          <div className="p-3 sm:p-4 border-t border-border/60 bg-muted/20 flex flex-wrap items-center justify-between gap-3 shrink-0">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span className="font-semibold text-foreground">{selectedFileIds.size}</span>
              <span>file(s) selected</span>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={onClose}
                className="px-4 py-2 rounded-xl text-xs font-medium border border-border/60 hover:bg-muted transition-colors cursor-pointer"
              >
                Cancel
              </button>

              <button
                disabled={selectedFileIds.size === 0 || isExtractingBatch}
                onClick={handleAttachSelectedContext}
                className="px-4 py-2 rounded-xl text-xs font-semibold bg-foreground text-background hover:opacity-90 disabled:opacity-40 transition-all flex items-center gap-2 cursor-pointer shadow-xs"
              >
                {isExtractingBatch ? (
                  <>
                    <Loader2 size={14} className="animate-spin" />
                    <span>Extracting Context...</span>
                  </>
                ) : (
                  <>
                    <Sparkles size={14} />
                    <span>Attach Selected ({selectedFileIds.size}) to AI Agent</span>
                  </>
                )}
              </button>
            </div>
          </div>
        )}

      </DialogContent>
    </Dialog>
  );
}
