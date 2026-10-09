import React, { useState, useEffect, useMemo, useRef } from 'react';
import { 
  Library, 
  Clock, 
  Search, 
  Trash2, 
  ExternalLink, 
  Copy, 
  MessageSquare, 
  Mic, 
  Sparkles, 
  X, 
  Loader2, 
  Globe, 
  BarChart3, 
  FileText, 
  Image as ImageIcon,
  Film,
  Upload,
  Download,
  Eye,
  Play,
  FileCode,
  Check,
  Plus,
  LayoutList,
  LayoutGrid
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { blink } from '@/lib/blink';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { syncTasksToLibrary, getLibraryItems } from '@/lib/libraryStore';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription
} from '@/components/ui/sheet';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

export interface LibraryFileItem {
  id: string;
  name: string;
  type: 'photo' | 'video' | 'doc' | 'audio' | 'website' | 'graph';
  url?: string;
  thumbnail?: string;
  size?: string;
  createdAt: string;
  source?: string;
  description?: string;
}

export interface TaskHistoryItem {
  id: string;
  prompt: string;
  title?: string;
  created_at: string;
  status?: string;
  outputFormat?: string;
  websiteName?: string;
}

export interface VoiceHistoryRecord {
  id: string;
  text: string;
  time: string;
  date: string;
}

interface HistoryPanelProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectTask?: (taskId: string) => void;
}

// Initial sample media & shared items for rich Library experience
const DEFAULT_LIBRARY_ITEMS: LibraryFileItem[] = [
  {
    id: 'lib-photo-1',
    name: '3D AI Assistant Concept Art.png',
    type: 'photo',
    url: 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?auto=format&fit=crop&w=800&q=80',
    thumbnail: 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?auto=format&fit=crop&w=300&q=80',
    size: '2.4 MB',
    createdAt: new Date(Date.now() - 3600000 * 2).toISOString(),
    source: 'Generated Image',
    description: 'Abstract futuristic neon gradient sphere UI rendering'
  },
  {
    id: 'lib-photo-2',
    name: 'Neural Network Workflow.jpeg',
    type: 'photo',
    url: 'https://images.unsplash.com/photo-1620712943543-bcc4688e7485?auto=format&fit=crop&w=800&q=80',
    thumbnail: 'https://images.unsplash.com/photo-1620712943543-bcc4688e7485?auto=format&fit=crop&w=300&q=80',
    size: '1.8 MB',
    createdAt: new Date(Date.now() - 3600000 * 5).toISOString(),
    source: 'Shared Photo',
    description: 'AI intelligence nodes analysis diagram'
  },
  {
    id: 'lib-video-1',
    name: 'Voice Call Session Recording.mp4',
    type: 'video',
    url: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4',
    size: '12.5 MB',
    createdAt: new Date(Date.now() - 3600000 * 12).toISOString(),
    source: 'Voice Call Media',
    description: 'Recorded live voice agent stream'
  },
  {
    id: 'lib-doc-1',
    name: 'Financial Data Report 2026.pdf',
    type: 'doc',
    url: '#',
    size: '840 KB',
    createdAt: new Date(Date.now() - 3600000 * 24).toISOString(),
    source: 'Exported Document',
    description: 'Quarterly growth data & projected revenue charts'
  },
  {
    id: 'lib-graph-1',
    name: 'Market Intelligence Analytics.json',
    type: 'graph',
    url: '#',
    size: '150 KB',
    createdAt: new Date(Date.now() - 3600000 * 36).toISOString(),
    source: 'Data Visualization',
    description: 'Interactive chart datasets'
  }
];

function formatTitle(task: TaskHistoryItem): string {
  if (task.title && task.title.trim()) {
    return task.title.trim();
  }
  let text = task.prompt || 'Untitled session';
  text = text.replace(/^\[(?:Attached|Think Harder|MODE)[^\]]*\]\s*/gi, '');
  text = text.replace(/^#+\s*/, '');
  const firstLine = text.split('\n')[0].trim();
  if (firstLine.length > 55) {
    return firstLine.substring(0, 52) + '...';
  }
  return firstLine || 'Untitled session';
}

function getRelativeTime(dateString: string): string {
  try {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    if (diffMs < 0) return 'Just now';
    const diffMins = Math.floor(diffMs / 60000);
    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `${diffHours}h ago`;
    const diffDays = Math.floor(diffHours / 24);
    if (diffDays === 1) return 'Yesterday';
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
  } catch {
    return '';
  }
}

function getTypeLabel(item: LibraryFileItem): { label: string; bg: string; text: string; icon: any } {
  switch (item.type) {
    case 'photo':
      return { label: 'Image', bg: 'bg-emerald-500/10 dark:bg-emerald-500/20', text: 'text-emerald-600 dark:text-emerald-400', icon: ImageIcon };
    case 'video':
      return { label: 'Video', bg: 'bg-purple-500/10 dark:bg-purple-500/20', text: 'text-purple-600 dark:text-purple-400', icon: Film };
    case 'audio':
      return { label: 'Audio', bg: 'bg-amber-500/10 dark:bg-amber-500/20', text: 'text-amber-600 dark:text-amber-400', icon: Mic };
    case 'website':
      return { label: 'Web Project', bg: 'bg-indigo-500/10 dark:bg-indigo-500/20', text: 'text-indigo-600 dark:text-indigo-400', icon: Globe };
    case 'graph':
      return { label: 'Dataset', bg: 'bg-cyan-500/10 dark:bg-cyan-500/20', text: 'text-cyan-600 dark:text-cyan-400', icon: BarChart3 };
    case 'doc':
    default:
      if (item.name.endsWith('.pdf')) {
        return { label: 'PDF Document', bg: 'bg-blue-500/10 dark:bg-blue-500/20', text: 'text-blue-600 dark:text-blue-400', icon: FileText };
      }
      return { label: 'Document', bg: 'bg-blue-500/10 dark:bg-blue-500/20', text: 'text-blue-600 dark:text-blue-400', icon: FileText };
  }
}

export function HistoryPanel({ isOpen, onClose, onSelectTask }: HistoryPanelProps) {
  const [tasks, setTasks] = useState<TaskHistoryItem[]>([]);
  const [voiceHistory, setVoiceHistory] = useState<VoiceHistoryRecord[]>([]);
  const [libraryItems, setLibraryItems] = useState<LibraryFileItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeTab, setActiveTab] = useState<'all' | 'photos' | 'videos' | 'docs' | 'sessions'>('all');
  const [viewMode, setViewMode] = useState<'list' | 'grid'>('list');
  const [previewMedia, setPreviewMedia] = useState<LibraryFileItem | null>(null);
  const [itemToDelete, setItemToDelete] = useState<{
    type: 'session' | 'library';
    id: string;
    name: string;
  } | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();

  // Load library & task data whenever panel opens or new file is shared with AI
  useEffect(() => {
    if (isOpen) {
      loadLibraryData();
    }

    const handleLibraryUpdate = () => {
      loadLibraryData();
    };

    window.addEventListener('manus_library_updated', handleLibraryUpdate);
    return () => {
      window.removeEventListener('manus_library_updated', handleLibraryUpdate);
    };
  }, [isOpen]);

  const loadLibraryData = async () => {
    setIsLoading(true);
    try {
      // 1. Load tasks from DB
      const result = await (blink.db as any).tasks.list({
        orderBy: { created_at: 'desc' },
        limit: 100
      });
      setTasks(result || []);

      // Automatically convert task artifacts & shared docs into Library items
      if (result && result.length > 0) {
        syncTasksToLibrary(result);
      }

      // 2. Load voice transcripts
      const savedVoice = localStorage.getItem('manus_voice_history');
      if (savedVoice) {
        try {
          setVoiceHistory(JSON.parse(savedVoice));
        } catch {
          setVoiceHistory([]);
        }
      }

      // 3. Load stored library items
      const savedLib = localStorage.getItem('manus_library_files');
      if (savedLib) {
        try {
          const parsed = JSON.parse(savedLib);
          setLibraryItems(parsed.length > 0 ? parsed : DEFAULT_LIBRARY_ITEMS);
        } catch {
          setLibraryItems(DEFAULT_LIBRARY_ITEMS);
        }
      } else {
        setLibraryItems(DEFAULT_LIBRARY_ITEMS);
        localStorage.setItem('manus_library_files', JSON.stringify(DEFAULT_LIBRARY_ITEMS));
      }
    } catch (error) {
      console.error('Failed to load library', error);
      setLibraryItems(DEFAULT_LIBRARY_ITEMS);
    } finally {
      setIsLoading(false);
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const newItems: LibraryFileItem[] = [];

    Array.from(files).forEach((file) => {
      let fileType: LibraryFileItem['type'] = 'doc';
      if (file.type.startsWith('image/')) fileType = 'photo';
      else if (file.type.startsWith('video/')) fileType = 'video';
      else if (file.type.startsWith('audio/')) fileType = 'audio';

      const objectUrl = URL.createObjectURL(file);
      const newItem: LibraryFileItem = {
        id: `lib-user-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
        name: file.name,
        type: fileType,
        url: objectUrl,
        thumbnail: fileType === 'photo' ? objectUrl : undefined,
        size: `${(file.size / (1024 * 1024)).toFixed(2)} MB`,
        createdAt: new Date().toISOString(),
        source: 'User Upload',
        description: `Uploaded file (${file.type || 'file'})`
      };
      newItems.push(newItem);
    });

    const updated = [...newItems, ...libraryItems];
    setLibraryItems(updated);
    localStorage.setItem('manus_library_files', JSON.stringify(updated));
    toast.success(`Added ${newItems.length} file(s) to Library`);

    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleDeleteLibraryItem = (id: string, e: React.MouseEvent, name?: string) => {
    e.stopPropagation();
    const targetItem = libraryItems.find(item => item.id === id);
    setItemToDelete({
      type: 'library',
      id,
      name: name || targetItem?.name || 'File'
    });
  };

  const handleDownloadFile = async (item: LibraryFileItem, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    try {
      toast.info(`Downloading ${item.name}...`);
      let downloadUrl = item.url;

      if (!downloadUrl || downloadUrl === '#') {
        let content = `Manus AI Library - ${item.name}\nType: ${item.type}\nCreated: ${item.createdAt}\nSource: ${item.source || 'AI Library'}\nDescription: ${item.description || ''}`;
        if (item.name.endsWith('.json')) {
          content = JSON.stringify({
            title: item.name,
            source: item.source,
            created: item.createdAt,
            data: [
              { period: 'Q1', revenue: 125000, growth: '14%' },
              { period: 'Q2', revenue: 180000, growth: '22%' },
              { period: 'Q3', revenue: 240000, growth: '35%' },
              { period: 'Q4', revenue: 310000, growth: '48%' }
            ]
          }, null, 2);
        }
        const blob = new Blob([content], { type: item.name.endsWith('.json') ? 'application/json' : 'text/plain;charset=utf-8' });
        downloadUrl = URL.createObjectURL(blob);
      } else if (downloadUrl.startsWith('http') && !downloadUrl.startsWith('data:')) {
        try {
          const resp = await fetch(downloadUrl);
          const blob = await resp.blob();
          downloadUrl = URL.createObjectURL(blob);
        } catch {
          // fallback to opening link
        }
      }

      const link = document.createElement('a');
      link.href = downloadUrl;
      link.download = item.name;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      toast.success(`Downloaded: ${item.name}`);
    } catch (err) {
      console.error('Download error:', err);
      toast.error('Failed to download file');
    }
  };

  const handleOpenTask = (taskId: string) => {
    if (onSelectTask) {
      onSelectTask(taskId);
    } else {
      navigate(`/task/${taskId}`);
    }
    onClose();
  };

  const handleDeleteTask = (taskId: string, e: React.MouseEvent, title?: string) => {
    e.stopPropagation();
    const targetTask = tasks.find(t => t.id === taskId);
    setItemToDelete({
      type: 'session',
      id: taskId,
      name: title || (targetTask ? formatTitle(targetTask) : 'Chat Session')
    });
  };

  const confirmDeleteItem = async () => {
    if (!itemToDelete) return;
    setIsDeleting(true);
    try {
      if (itemToDelete.type === 'session') {
        await (blink.db as any).tasks.delete(itemToDelete.id);
        setTasks(prev => prev.filter(t => t.id !== itemToDelete.id));
        toast.success('Session deleted from history');
      } else {
        const updated = libraryItems.filter(item => item.id !== itemToDelete.id);
        setLibraryItems(updated);
        localStorage.setItem('manus_library_files', JSON.stringify(updated));
        toast.success(`"${itemToDelete.name}" removed from Library`);
      }
      setItemToDelete(null);
    } catch (error) {
      toast.error('Failed to delete item');
      console.error('Delete error:', error);
    } finally {
      setIsDeleting(false);
    }
  };

  // Filtered files & items
  const filteredItems = useMemo(() => {
    return libraryItems.filter(item => {
      const q = searchQuery.toLowerCase().trim();
      const matchesSearch = !q || item.name.toLowerCase().includes(q) || (item.description || '').toLowerCase().includes(q);
      if (!matchesSearch) return false;

      if (activeTab === 'all') return true;
      if (activeTab === 'photos') return item.type === 'photo';
      if (activeTab === 'videos') return item.type === 'video' || item.type === 'audio';
      if (activeTab === 'docs') return item.type === 'doc' || item.type === 'graph';
      return true;
    });
  }, [libraryItems, searchQuery, activeTab]);

  const filteredTasks = useMemo(() => {
    if (!searchQuery.trim()) return tasks;
    const q = searchQuery.toLowerCase().trim();
    return tasks.filter(task => {
      const title = formatTitle(task).toLowerCase();
      const prompt = (task.prompt || '').toLowerCase();
      return title.includes(q) || prompt.includes(q);
    });
  }, [tasks, searchQuery]);

  return (
    <Sheet open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <SheetContent 
        side="right" 
        className="w-full sm:max-w-xl p-0 flex flex-col h-full bg-background border-l border-border shadow-2xl z-50 overflow-hidden"
      >
        {/* Top Header - Strictly "Library" */}
        <div className="p-5 pb-3 border-b border-border bg-manus-soft dark:bg-card/40">
          <SheetHeader className="text-left space-y-1">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-primary/10 text-primary flex items-center justify-center shadow-xs">
                  <Library size={20} />
                </div>
                <div>
                  <SheetTitle className="text-lg font-bold text-foreground tracking-tight">
                    Library
                  </SheetTitle>
                  <SheetDescription className="text-xs text-muted-foreground">
                    All shared files, photos, videos, documents & media
                  </SheetDescription>
                </div>
              </div>

              {/* Upload to Library Button */}
              <div className="mr-8 sm:mr-9 mt-1.5">
                <input 
                  type="file" 
                  ref={fileInputRef}
                  onChange={handleFileUpload}
                  multiple 
                  className="hidden" 
                />
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-primary text-primary-foreground font-medium text-xs shadow-xs hover:opacity-90 transition-all cursor-pointer"
                >
                  <Plus size={14} />
                  <span>Add File</span>
                </button>
              </div>
            </div>
          </SheetHeader>

          {/* Quick Stats Grid */}
          <div className="grid grid-cols-4 gap-2 mt-4">
            <div className="bg-white dark:bg-card border border-border rounded-xl p-2 text-center shadow-2xs">
              <span className="text-xs font-bold text-foreground block">{libraryItems.filter(i => i.type === 'photo').length}</span>
              <span className="text-[10px] text-muted-foreground">Photos</span>
            </div>
            <div className="bg-white dark:bg-card border border-border rounded-xl p-2 text-center shadow-2xs">
              <span className="text-xs font-bold text-foreground block">{libraryItems.filter(i => i.type === 'video' || i.type === 'audio').length}</span>
              <span className="text-[10px] text-muted-foreground">Videos</span>
            </div>
            <div className="bg-white dark:bg-card border border-border rounded-xl p-2 text-center shadow-2xs">
              <span className="text-xs font-bold text-foreground block">{libraryItems.filter(i => i.type === 'doc' || i.type === 'graph').length}</span>
              <span className="text-[10px] text-muted-foreground">Files</span>
            </div>
            <div className="bg-white dark:bg-card border border-border rounded-xl p-2 text-center shadow-2xs">
              <span className="text-xs font-bold text-foreground block">{tasks.length}</span>
              <span className="text-[10px] text-muted-foreground">Sessions</span>
            </div>
          </div>

          {/* Search Bar */}
          <div className="relative mt-3">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search Library files, photos, videos..."
              className="w-full pl-9 pr-8 py-2 bg-white dark:bg-card border border-border rounded-xl text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary shadow-2xs"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 p-0.5 rounded-full hover:bg-muted text-muted-foreground"
              >
                <X size={12} />
              </button>
            )}
          </div>
        </div>

        {/* Library Navigation Tabs */}
        <div className="flex-1 flex flex-col min-h-0">
          <Tabs 
            value={activeTab} 
            onValueChange={(val: any) => setActiveTab(val)} 
            className="flex-1 flex flex-col min-h-0"
          >
            <div className="px-5 pt-3 pb-2 flex items-center justify-between border-b border-border/60 gap-2">
              <TabsList className="bg-manus-soft dark:bg-muted/50 p-1 rounded-xl h-9 gap-1 overflow-x-auto">
                <TabsTrigger value="all" className="text-xs px-2.5 py-1 rounded-lg font-medium data-[state=active]:bg-white dark:data-[state=active]:bg-card shadow-2xs">
                  All Items
                </TabsTrigger>
                <TabsTrigger value="photos" className="text-xs px-2.5 py-1 rounded-lg font-medium data-[state=active]:bg-white dark:data-[state=active]:bg-card shadow-2xs">
                  Photos
                </TabsTrigger>
                <TabsTrigger value="videos" className="text-xs px-2.5 py-1 rounded-lg font-medium data-[state=active]:bg-white dark:data-[state=active]:bg-card shadow-2xs">
                  Videos
                </TabsTrigger>
                <TabsTrigger value="docs" className="text-xs px-2.5 py-1 rounded-lg font-medium data-[state=active]:bg-white dark:data-[state=active]:bg-card shadow-2xs">
                  Docs & Files
                </TabsTrigger>
                <TabsTrigger value="sessions" className="text-xs px-2.5 py-1 rounded-lg font-medium data-[state=active]:bg-white dark:data-[state=active]:bg-card shadow-2xs">
                  Sessions
                </TabsTrigger>
              </TabsList>

              {/* View Mode Switcher (List vs Grid) */}
              {activeTab !== 'sessions' && (
                <div className="flex items-center gap-1 bg-muted/60 p-0.5 rounded-lg shrink-0">
                  <button
                    onClick={() => setViewMode('list')}
                    className={cn(
                      "p-1.5 rounded-md transition-all",
                      viewMode === 'list' 
                        ? "bg-white dark:bg-card text-foreground shadow-2xs font-semibold" 
                        : "text-muted-foreground hover:text-foreground"
                    )}
                    title="Clean List Format"
                  >
                    <LayoutList size={14} />
                  </button>
                  <button
                    onClick={() => setViewMode('grid')}
                    className={cn(
                      "p-1.5 rounded-md transition-all",
                      viewMode === 'grid' 
                        ? "bg-white dark:bg-card text-foreground shadow-2xs font-semibold" 
                        : "text-muted-foreground hover:text-foreground"
                    )}
                    title="Grid Preview Format"
                  >
                    <LayoutGrid size={14} />
                  </button>
                </div>
              )}
            </div>

            {/* Content for Media Tabs (All, Photos, Videos, Docs) */}
            {activeTab !== 'sessions' ? (
              <div className="flex-1 overflow-y-auto p-4 space-y-2.5 custom-scrollbar">
                {filteredItems.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-56 text-center px-4 space-y-3">
                    <div className="w-12 h-12 rounded-2xl bg-muted/60 text-muted-foreground flex items-center justify-center">
                      <Library size={22} />
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-foreground">
                        {searchQuery ? 'No matching items found' : 'Library is empty'}
                      </p>
                      <p className="text-xs text-muted-foreground max-w-xs mt-1">
                        Upload photos, videos, or documents to keep all your shared files in one place.
                      </p>
                    </div>
                  </div>
                ) : viewMode === 'list' ? (
                  /* Clean List Format Layout */
                  <div className="space-y-2">
                    {filteredItems.map((item) => {
                      const typeBadge = getTypeLabel(item);
                      const TypeIcon = typeBadge.icon;
                      return (
                        <div
                          key={item.id}
                          className="group relative flex items-center justify-between p-3 rounded-2xl border border-border bg-white dark:bg-card hover:border-primary/50 hover:shadow-sm transition-all gap-3"
                        >
                          {/* File Icon & Main Details */}
                          <div className="flex items-center gap-3 min-w-0 flex-1">
                            <div className={cn("w-10 h-10 rounded-xl flex items-center justify-center shrink-0 font-medium shadow-2xs", typeBadge.bg, typeBadge.text)}>
                              <TypeIcon size={18} />
                            </div>

                            <div className="min-w-0 flex-1 space-y-0.5">
                              <div className="flex items-center gap-2">
                                <h4 className="font-semibold text-xs text-foreground truncate" title={item.name}>
                                  {item.name}
                                </h4>
                                {item.source && (
                                  <span className="text-[10px] px-2 py-0.5 rounded-md bg-muted text-muted-foreground font-medium shrink-0 hidden sm:inline-block">
                                    {item.source}
                                  </span>
                                )}
                              </div>

                              <div className="flex items-center gap-2 text-[11px] text-muted-foreground flex-wrap">
                                {/* Type Label Badge */}
                                <span className={cn("px-1.5 py-0.5 rounded text-[10px] font-bold tracking-wide uppercase", typeBadge.bg, typeBadge.text)}>
                                  {typeBadge.label}
                                </span>
                                <span>•</span>
                                {/* File Size Label */}
                                <span className="font-mono text-[10px] font-semibold text-foreground/80 bg-slate-100 dark:bg-muted/80 px-1.5 py-0.5 rounded">
                                  {item.size || 'Shared File'}
                                </span>
                                <span>•</span>
                                {/* Timestamp */}
                                <span className="text-[10px] font-mono">{getRelativeTime(item.createdAt)}</span>
                              </div>
                            </div>
                          </div>

                          {/* Action Buttons */}
                          <div className="flex items-center gap-1 shrink-0">
                            {(item.type === 'photo' || item.type === 'video' || item.type === 'audio') && (
                              <button
                                onClick={() => setPreviewMedia(item)}
                                className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
                                title={item.type === 'photo' ? 'View Photo' : 'Play Media'}
                              >
                                {item.type === 'photo' ? <Eye size={15} /> : <Play size={15} />}
                              </button>
                            )}

                            <button
                              onClick={(e) => handleDownloadFile(item, e)}
                              className="flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-primary/10 hover:bg-primary hover:text-primary-foreground text-primary font-semibold transition-all text-xs cursor-pointer shadow-2xs"
                              title={`Download ${item.name}`}
                            >
                              <Download size={13} />
                              <span className="hidden sm:inline">Download</span>
                            </button>

                            <button
                              onClick={(e) => handleDeleteLibraryItem(item.id, e, item.name)}
                              className="p-1.5 rounded-lg text-muted-foreground hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors cursor-pointer"
                              title="Delete from Library"
                            >
                              <Trash2 size={14} />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  /* Grid Layout */
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {filteredItems.map((item) => {
                      const typeBadge = getTypeLabel(item);
                      const TypeIcon = typeBadge.icon;
                      return (
                        <div
                          key={item.id}
                          className="group relative rounded-2xl border border-border bg-white dark:bg-card p-3 hover:border-primary/50 hover:shadow-md transition-all flex flex-col justify-between"
                        >
                          {/* Media Preview or Icon Header */}
                          <div>
                            {item.type === 'photo' && item.url ? (
                              <div className="relative aspect-video rounded-xl overflow-hidden mb-2.5 bg-muted">
                                <img 
                                  src={item.url} 
                                  alt={item.name} 
                                  className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                                />
                                <div className="absolute top-2 left-2 flex items-center gap-1 z-10">
                                  <span className={cn("px-1.5 py-0.5 rounded text-[10px] font-bold tracking-wide uppercase shadow-xs backdrop-blur-md", typeBadge.bg, typeBadge.text)}>
                                    {typeBadge.label}
                                  </span>
                                </div>
                                <div className="absolute inset-0 bg-black/20 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
                                  <button
                                    onClick={() => setPreviewMedia(item)}
                                    className="p-2 rounded-full bg-white/90 text-foreground hover:bg-white shadow-md transition-transform transform hover:scale-105 cursor-pointer"
                                    title="View Photo"
                                  >
                                    <Eye size={15} />
                                  </button>
                                  <button
                                    onClick={(e) => handleDownloadFile(item, e)}
                                    className="p-2 rounded-full bg-white/90 text-foreground hover:bg-white shadow-md transition-transform transform hover:scale-105 cursor-pointer"
                                    title="Download Photo"
                                  >
                                    <Download size={15} />
                                  </button>
                                </div>
                              </div>
                            ) : item.type === 'video' ? (
                              <div className="relative aspect-video rounded-xl bg-slate-900 flex items-center justify-center mb-2.5 overflow-hidden group">
                                <Film size={28} className="text-white/60" />
                                <div className="absolute top-2 left-2 flex items-center gap-1 z-10">
                                  <span className={cn("px-1.5 py-0.5 rounded text-[10px] font-bold tracking-wide uppercase shadow-xs backdrop-blur-md", typeBadge.bg, typeBadge.text)}>
                                    {typeBadge.label}
                                  </span>
                                </div>
                                <button
                                  onClick={() => setPreviewMedia(item)}
                                  className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-90 group-hover:bg-black/60 transition-colors cursor-pointer"
                                >
                                  <div className="w-10 h-10 rounded-full bg-primary/90 text-primary-foreground flex items-center justify-center shadow-lg transform group-hover:scale-110 transition-transform">
                                    <Play size={18} className="ml-0.5" />
                                  </div>
                                </button>
                              </div>
                            ) : (
                              <div className="p-3 rounded-xl bg-manus-soft dark:bg-muted/40 mb-2.5 flex items-center gap-3">
                                <div className={cn("w-10 h-10 rounded-xl flex items-center justify-center shrink-0 font-medium shadow-2xs", typeBadge.bg, typeBadge.text)}>
                                  <TypeIcon size={20} />
                                </div>
                                <div className="min-w-0 flex-1 space-y-1">
                                  <div className="flex items-center gap-1.5 flex-wrap">
                                    <span className={cn("px-1.5 py-0.5 rounded text-[10px] font-bold tracking-wide uppercase", typeBadge.bg, typeBadge.text)}>
                                      {typeBadge.label}
                                    </span>
                                    <span className="font-mono text-[10px] font-semibold text-foreground/80 bg-slate-100 dark:bg-muted/80 px-1.5 py-0.5 rounded">
                                      {item.size || 'Shared File'}
                                    </span>
                                  </div>
                                </div>
                              </div>
                            )}

                            {/* File Details */}
                            <div className="space-y-1">
                              <h4 className="font-semibold text-xs text-foreground truncate" title={item.name}>
                                {item.name}
                              </h4>
                              <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground flex-wrap">
                                <span className="font-mono text-[10px] text-foreground/80 font-semibold bg-muted px-1.5 py-0.5 rounded">
                                  {item.size || 'File'}
                                </span>
                                {item.source && (
                                  <>
                                    <span>•</span>
                                    <span className="text-[10px] truncate max-w-[120px]">{item.source}</span>
                                  </>
                                )}
                              </div>
                              {item.description && (
                                <p className="text-[11px] text-muted-foreground line-clamp-1">
                                  {item.description}
                                </p>
                              )}
                            </div>
                          </div>

                          {/* Card Footer Actions */}
                          <div className="flex items-center justify-between pt-2.5 mt-2 border-t border-border/40 text-[10px] text-muted-foreground">
                            <span className="font-mono">{getRelativeTime(item.createdAt)}</span>
                            <div className="flex items-center gap-1.5">
                              <button
                                onClick={(e) => handleDownloadFile(item, e)}
                                className="flex items-center gap-1 px-2.5 py-1 rounded-xl bg-primary/10 hover:bg-primary hover:text-primary-foreground text-primary font-semibold transition-all text-[11px] cursor-pointer shadow-2xs"
                                title={`Download ${item.name}`}
                              >
                                <Download size={13} />
                                <span>Download</span>
                              </button>
                              <button
                                onClick={(e) => handleDeleteLibraryItem(item.id, e, item.name)}
                                className="p-1.5 rounded-lg hover:bg-red-50 dark:hover:bg-red-950/30 text-muted-foreground hover:text-red-500 transition-colors cursor-pointer"
                                title="Delete from Library"
                              >
                                <Trash2 size={14} />
                              </button>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            ) : (
              /* Chat & Task Sessions Tab */
              <TabsContent value="sessions" className="flex-1 overflow-y-auto p-4 space-y-2.5 custom-scrollbar m-0">
                {filteredTasks.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-56 text-center px-4 space-y-3">
                    <div className="w-12 h-12 rounded-2xl bg-muted/60 text-muted-foreground flex items-center justify-center">
                      <MessageSquare size={20} />
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-foreground">No chat sessions found</p>
                      <p className="text-xs text-muted-foreground max-w-xs mt-1">
                        All research and conversation tasks will be archived here.
                      </p>
                    </div>
                  </div>
                ) : (
                  filteredTasks.map((task) => (
                    <div
                      key={task.id}
                      onClick={() => handleOpenTask(task.id)}
                      className="group relative p-3.5 rounded-2xl border border-border bg-white dark:bg-card hover:border-primary/50 hover:shadow-md transition-all cursor-pointer"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex-1 min-w-0 space-y-1.5">
                          <div className="flex items-center gap-2">
                            <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-primary/10 text-primary font-medium">
                              <MessageSquare size={11} /> Chat Session
                            </span>
                            <span className="text-[10px] text-muted-foreground font-mono">
                              {getRelativeTime(task.created_at)}
                            </span>
                          </div>
                          <h4 className="font-semibold text-xs text-foreground line-clamp-1">
                            {formatTitle(task)}
                          </h4>
                          <p className="text-[11px] text-muted-foreground line-clamp-2 leading-relaxed">
                            {task.prompt}
                          </p>
                        </div>
                        <button
                          onClick={(e) => handleDeleteTask(task.id, e, formatTitle(task))}
                          className="p-1.5 rounded-lg text-muted-foreground hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors opacity-0 group-hover:opacity-100 cursor-pointer"
                          title="Delete session"
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </TabsContent>
            )}
          </Tabs>
        </div>

        {/* Media Lightbox Modal */}
        {previewMedia && (
          <div 
            onClick={() => setPreviewMedia(null)}
            className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4 backdrop-blur-xs animate-in fade-in"
          >
            <div 
              onClick={(e) => e.stopPropagation()}
              className="relative max-w-2xl w-full bg-card rounded-2xl overflow-hidden border border-border shadow-2xl p-4 space-y-3"
            >
              <div className="flex items-center justify-between border-b border-border/50 pb-2">
                <h3 className="font-bold text-sm text-foreground truncate">{previewMedia.name}</h3>
                <button
                  onClick={() => setPreviewMedia(null)}
                  className="p-1 rounded-lg hover:bg-muted text-muted-foreground"
                >
                  <X size={18} />
                </button>
              </div>

              {previewMedia.type === 'photo' && previewMedia.url && (
                <img 
                  src={previewMedia.url} 
                  alt={previewMedia.name} 
                  className="w-full max-h-[60vh] object-contain rounded-xl bg-black"
                />
              )}

              {previewMedia.type === 'video' && previewMedia.url && (
                <video 
                  src={previewMedia.url} 
                  controls 
                  autoPlay
                  className="w-full max-h-[60vh] rounded-xl bg-black"
                />
              )}

              <div className="flex items-center justify-between text-xs text-muted-foreground pt-1">
                <span>{previewMedia.description || previewMedia.source}</span>
                <button
                  onClick={() => handleDownloadFile(previewMedia)}
                  className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-primary text-primary-foreground text-xs font-semibold shadow-xs hover:opacity-90 transition-all cursor-pointer"
                >
                  <Download size={14} />
                  <span>Download File</span>
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Delete Confirmation Alert Dialog */}
        <AlertDialog open={!!itemToDelete} onOpenChange={(open) => !open && setItemToDelete(null)}>
          <AlertDialogContent className="max-w-md rounded-2xl p-6 bg-card border border-border">
            <AlertDialogHeader>
              <div className="w-11 h-11 rounded-2xl bg-destructive/10 text-destructive flex items-center justify-center mb-2 mx-auto sm:mx-0">
                <Trash2 size={22} />
              </div>
              <AlertDialogTitle className="text-base sm:text-lg font-bold text-foreground">
                {itemToDelete?.type === 'session' ? 'Delete Chat Session?' : 'Delete File from Library?'}
              </AlertDialogTitle>
              <AlertDialogDescription className="text-xs text-muted-foreground leading-relaxed">
                Are you sure you want to delete <span className="font-semibold text-foreground">"{itemToDelete?.name}"</span>?
                {itemToDelete?.type === 'session' 
                  ? ' This action cannot be undone. All conversation messages, research steps, and generated analysis will be permanently deleted.'
                  : ' This file will be permanently removed from your shared workspace assets.'}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter className="mt-4 gap-2 sm:gap-2">
              <AlertDialogCancel 
                disabled={isDeleting}
                onClick={() => setItemToDelete(null)}
                className="rounded-xl text-xs cursor-pointer border border-border hover:bg-muted"
              >
                Cancel
              </AlertDialogCancel>
              <AlertDialogAction
                disabled={isDeleting}
                onClick={confirmDeleteItem}
                className="rounded-xl text-xs bg-destructive text-destructive-foreground hover:bg-destructive/90 cursor-pointer shadow-xs font-semibold"
              >
                {isDeleting ? 'Deleting...' : (itemToDelete?.type === 'session' ? 'Delete Session' : 'Delete File')}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </SheetContent>
    </Sheet>
  );
}
