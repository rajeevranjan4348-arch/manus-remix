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
  ChartBar as BarChart3, 
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
  LayoutGrid,
  Calendar,
  Filter,
  CheckSquare
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { blink } from '@/lib/blink';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { syncTasksToLibrary, getLibraryItems } from '@/lib/libraryStore';
import { listConversations, deleteConversation, exportAllChatHistory, recoverChatHistory, getAllMessages } from '@/lib/chatDatabase';
import { TaskQuickPreviewCard } from './TaskQuickPreviewCard';
import { SwipeableHistoryItem } from './SwipeableHistoryItem';
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
  mode?: string;
  content?: string;
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
  initialTab?: 'sessions' | 'all' | 'photos' | 'videos' | 'docs';
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
        return { label: 'PDF Document', bg: 'bg-black/10 dark:bg-white/10', text: 'text-black dark:text-white', icon: FileText };
      }
      return { label: 'Document', bg: 'bg-black/10 dark:bg-white/10', text: 'text-black dark:text-white', icon: FileText };
  }
}

/**
 * Extracts a contextual snippet surrounding the search query match in content.
 */
export function getContentSnippet(content?: string, query?: string): string {
  if (!content || !query) return '';
  const idx = content.toLowerCase().indexOf(query.toLowerCase());
  if (idx === -1) return '';
  const start = Math.max(0, idx - 25);
  const end = Math.min(content.length, idx + query.length + 45);
  const prefix = start > 0 ? '...' : '';
  const suffix = end < content.length ? '...' : '';
  return `${prefix}${content.substring(start, end).replace(/\s+/g, ' ').trim()}${suffix}`;
}

/**
 * Filters past tasks by search query (title or content) and date range presets/custom dates.
 */
export function filterTasks(
  tasks: TaskHistoryItem[],
  searchQuery: string,
  dateFilter: 'all' | 'today' | 'yesterday' | 'week' | 'month' | 'custom' = 'all',
  startDate?: string,
  endDate?: string,
  referenceDate: Date = new Date()
): TaskHistoryItem[] {
  return tasks.filter(task => {
    const created = new Date(task.created_at || referenceDate);
    const createdTime = created.getTime();

    // 1. Date Range Filter
    const todayStart = new Date(referenceDate.getFullYear(), referenceDate.getMonth(), referenceDate.getDate()).getTime();
    const yesterdayStart = todayStart - 86400000;
    const weekStart = todayStart - 7 * 86400000;
    const monthStart = todayStart - 30 * 86400000;

    if (dateFilter === 'today') {
      if (createdTime < todayStart) return false;
    } else if (dateFilter === 'yesterday') {
      if (createdTime < yesterdayStart || createdTime >= todayStart) return false;
    } else if (dateFilter === 'week') {
      if (createdTime < weekStart) return false;
    } else if (dateFilter === 'month') {
      if (createdTime < monthStart) return false;
    } else if (dateFilter === 'custom') {
      if (startDate) {
        const sTime = new Date(startDate).getTime();
        if (!isNaN(sTime) && createdTime < sTime) return false;
      }
      if (endDate) {
        const eTime = new Date(endDate).getTime() + 86400000 - 1;
        if (!isNaN(eTime) && createdTime > eTime) return false;
      }
    }

    // 2. Keyword Filter (Search by title or content)
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase().trim();

    const title = (task.title || '').toLowerCase();
    const prompt = (task.prompt || '').toLowerCase();
    const content = (task.content || '').toLowerCase();
    const status = (task.status || '').toLowerCase();
    const mode = ((task as any).mode || '').toLowerCase();

    const dateFormatted = created.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      weekday: 'short'
    }).toLowerCase();
    const fullDate = created.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }).toLowerCase();
    const isoDate = created.toISOString().toLowerCase();

    return (
      title.includes(q) ||
      prompt.includes(q) ||
      content.includes(q) ||
      status.includes(q) ||
      mode.includes(q) ||
      dateFormatted.includes(q) ||
      fullDate.includes(q) ||
      isoDate.includes(q)
    );
  });
}

/**
 * Automatically groups past tasks by date periods:
 * - 'Today': Tasks created today (since 00:00)
 * - 'This Week': Tasks created within the last 7 days (prior to today)
 * - 'Older': Tasks created more than 7 days ago
 */
export function groupTasksByDate(tasks: TaskHistoryItem[]): { label: string; tasks: TaskHistoryItem[] }[] {
  const groups: { [key: string]: TaskHistoryItem[] } = {
    'Today': [],
    'This Week': [],
    'Older': []
  };

  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const sevenDaysAgoStart = todayStart - 7 * 86400000;

  tasks.forEach((task) => {
    const time = new Date(task.created_at || Date.now()).getTime();
    if (isNaN(time) || time >= todayStart) {
      groups['Today'].push(task);
    } else if (time >= sevenDaysAgoStart) {
      groups['This Week'].push(task);
    } else {
      groups['Older'].push(task);
    }
  });

  return Object.entries(groups)
    .filter(([_, list]) => list.length > 0)
    .map(([label, list]) => ({ label, tasks: list }));
}

export function HistoryPanel({ isOpen, onClose, onSelectTask, initialTab }: HistoryPanelProps) {
  const [tasks, setTasks] = useState<TaskHistoryItem[]>([]);
  const [voiceHistory, setVoiceHistory] = useState<VoiceHistoryRecord[]>([]);
  const [libraryItems, setLibraryItems] = useState<LibraryFileItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [dateFilter, setDateFilter] = useState<'all' | 'today' | 'yesterday' | 'week' | 'month' | 'custom'>('all');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [showDateFilter, setShowDateFilter] = useState(false);
  const [activeTab, setActiveTab] = useState<'all' | 'photos' | 'videos' | 'docs' | 'sessions'>('sessions');
  const [viewMode, setViewMode] = useState<'list' | 'grid'>('list');
  const [previewMedia, setPreviewMedia] = useState<LibraryFileItem | null>(null);
  const [itemToDelete, setItemToDelete] = useState<{
    type: 'session' | 'library';
    id: string;
    name: string;
  } | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  // Multi-select state for bulk task deletion
  const [selectedTaskIds, setSelectedTaskIds] = useState<Set<string>>(new Set());
  const [isSelectionMode, setIsSelectionMode] = useState(false);
  const [isBulkDeleting, setIsBulkDeleting] = useState(false);
  const [showBulkDeleteDialog, setShowBulkDeleteDialog] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();

  // Load library & task data whenever panel opens; reset selection when closed
  useEffect(() => {
    if (isOpen) {
      if (initialTab) {
        setActiveTab(initialTab);
      }
      loadLibraryData();
    } else {
      setSelectedTaskIds(new Set());
      setIsSelectionMode(false);
      setShowBulkDeleteDialog(false);
      setSearchQuery('');
    }

    const handleLibraryUpdate = () => {
      loadLibraryData();
    };

    window.addEventListener('manus_library_updated', handleLibraryUpdate);
    return () => {
      window.removeEventListener('manus_library_updated', handleLibraryUpdate);
    };
  }, [isOpen, initialTab]);

  const loadLibraryData = async () => {
    setIsLoading(true);
    try {
      // 1. Pre-load all messages to build a quick content index for full-text task searching
      const messagesMap: Record<string, string> = {};
      try {
        const allMsgs = await getAllMessages();
        for (const msg of allMsgs) {
          if (!msg.conversationId) continue;
          if (!messagesMap[msg.conversationId]) {
            messagesMap[msg.conversationId] = '';
          }
          messagesMap[msg.conversationId] += ' ' + (msg.content || '');
        }
      } catch (err) {
        console.warn('Failed to load message content for task search:', err);
      }

      // 2. Load tasks from DB and IndexedDB
      let blinkTasks: any[] = [];
      try {
        blinkTasks = await (blink.db as any).tasks.list({
          orderBy: { created_at: 'desc' },
          limit: 100
        });
      } catch (err) {
        console.warn('Blink tasks list fallback:', err);
      }

      // Also retrieve persistent conversations from IndexedDB
      let localConversations: any[] = [];
      try {
        const idbList = await listConversations();
        localConversations = idbList.map(c => ({
          id: c.id,
          prompt: c.title,
          title: c.title,
          created_at: c.createdAt,
          status: c.status,
          outputFormat: c.outputFormat,
          mode: c.mode,
          content: messagesMap[c.id] || (c.title || ''),
        }));
      } catch (err) {
        console.warn('IndexedDB list error:', err);
      }

      // Ensure content is attached to blink tasks
      for (const t of blinkTasks) {
        if (!t.content) {
          t.content = messagesMap[t.id] || t.prompt || '';
        }
      }

      // Combine and deduplicate
      const combined = [...(blinkTasks || [])];
      for (const conv of localConversations) {
        const existing = combined.find(t => t.id === conv.id);
        if (existing) {
          if (!existing.content && conv.content) {
            existing.content = conv.content;
          }
        } else {
          combined.push(conv);
        }
      }
      // Sort newest first
      combined.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
      setTasks(combined);

      // Automatically convert task artifacts & shared docs into Library items
      if (combined.length > 0) {
        syncTasksToLibrary(combined);
      }

      // 3. Load voice transcripts
      const savedVoice = localStorage.getItem('manus_voice_history');
      if (savedVoice) {
        try {
          setVoiceHistory(JSON.parse(savedVoice));
        } catch {
          setVoiceHistory([]);
        }
      }

      // 4. Load stored library items
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

  const handleDeleteLibraryItem = (id: string, e?: React.MouseEvent, name?: string) => {
    if (e) e.stopPropagation();
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

  const handleDeleteTask = (taskId: string, e?: React.MouseEvent, title?: string) => {
    if (e) e.stopPropagation();
    const targetTask = tasks.find(t => t.id === taskId);
    setItemToDelete({
      type: 'session',
      id: taskId,
      name: title || (targetTask ? formatTitle(targetTask) : 'Chat Session'),
    });
  };

  const confirmDeleteItem = async () => {
    if (!itemToDelete) return;

    setIsDeleting(true);
    try {
      if (itemToDelete.type === 'session') {
        try {
          await (blink.db as any).tasks.delete(itemToDelete.id);
        } catch {}
        try {
          await deleteConversation(itemToDelete.id);
        } catch {}
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

  // Multi-select handlers for bulk deleting tasks
  const toggleSelectTask = (taskId: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    setSelectedTaskIds(prev => {
      const next = new Set(prev);
      if (next.has(taskId)) {
        next.delete(taskId);
      } else {
        next.add(taskId);
      }
      return next;
    });
    if (!isSelectionMode) {
      setIsSelectionMode(true);
    }
  };

  const handleSelectAllTasks = () => {
    if (selectedTaskIds.size === filteredTasks.length && filteredTasks.length > 0) {
      // Deselect all
      setSelectedTaskIds(new Set());
    } else {
      // Select all currently filtered tasks
      setSelectedTaskIds(new Set(filteredTasks.map(t => t.id)));
      setIsSelectionMode(true);
    }
  };

  const handleSelectGroupTasks = (groupTasks: TaskHistoryItem[], e: React.MouseEvent) => {
    e.stopPropagation();
    const groupIds = groupTasks.map(t => t.id);
    const allSelected = groupIds.length > 0 && groupIds.every(id => selectedTaskIds.has(id));
    setSelectedTaskIds(prev => {
      const next = new Set(prev);
      if (allSelected) {
        groupIds.forEach(id => next.delete(id));
      } else {
        groupIds.forEach(id => next.add(id));
      }
      return next;
    });
    if (!isSelectionMode) {
      setIsSelectionMode(true);
    }
  };

  const handleCancelSelection = () => {
    setSelectedTaskIds(new Set());
    setIsSelectionMode(false);
  };

  const handleConfirmBulkDelete = async () => {
    if (selectedTaskIds.size === 0) return;

    setIsBulkDeleting(true);
    const idsToDelete = Array.from(selectedTaskIds);
    try {
      await Promise.allSettled(
        idsToDelete.map(async (id) => {
          try {
            await (blink.db as any).tasks.delete(id);
          } catch {}
          try {
            await deleteConversation(id);
          } catch {}
        })
      );

      const idSet = new Set(idsToDelete);
      setTasks(prev => prev.filter(t => !idSet.has(t.id)));
      setSelectedTaskIds(new Set());
      setIsSelectionMode(false);
      setShowBulkDeleteDialog(false);
      toast.success(`Deleted ${idsToDelete.length} task(s) from history`);
    } catch (err) {
      console.error('Failed to bulk delete tasks:', err);
      toast.error('Failed to delete some tasks');
    } finally {
      setIsBulkDeleting(false);
    }
  };

  const handleExportHistory = async () => {
    try {
      const dataStr = await exportAllChatHistory();
      const blob = new Blob([dataStr], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `manus-conversation-backup-${Date.now()}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast.success('Conversation history exported successfully');
    } catch (err) {
      toast.error('Failed to export conversations');
    }
  };

  const handleRecoverHistory = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.onchange = async (e: any) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const text = await file.text();
      const res = await recoverChatHistory(text);
      if (res.success) {
        toast.success(`Recovered ${res.restoredCount} conversation(s) into database!`);
        loadLibraryData();
      } else {
        toast.error('Invalid backup file');
      }
    };
    input.click();
  };

  // Filtered files & items
  const filteredItems = useMemo(() => {
    return libraryItems.filter(item => {
      const created = new Date(item.createdAt || Date.now());
      const createdTime = created.getTime();

      // 1. Category tab filter
      if (activeTab === 'photos' && item.type !== 'photo') return false;
      if (activeTab === 'videos' && item.type !== 'video' && item.type !== 'audio') return false;
      if (activeTab === 'docs' && item.type !== 'doc' && item.type !== 'graph') return false;

      // 2. Date Range Filter
      const now = new Date();
      const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
      const yesterdayStart = todayStart - 86400000;
      const weekStart = todayStart - 7 * 86400000;
      const monthStart = todayStart - 30 * 86400000;

      if (dateFilter === 'today') {
        if (createdTime < todayStart) return false;
      } else if (dateFilter === 'yesterday') {
        if (createdTime < yesterdayStart || createdTime >= todayStart) return false;
      } else if (dateFilter === 'week') {
        if (createdTime < weekStart) return false;
      } else if (dateFilter === 'month') {
        if (createdTime < monthStart) return false;
      } else if (dateFilter === 'custom') {
        if (startDate) {
          const sTime = new Date(startDate).getTime();
          if (!isNaN(sTime) && createdTime < sTime) return false;
        }
        if (endDate) {
          const eTime = new Date(endDate).getTime() + 86400000 - 1;
          if (!isNaN(eTime) && createdTime > eTime) return false;
        }
      }

      // 3. Keyword Filter
      if (!searchQuery.trim()) return true;
      const q = searchQuery.toLowerCase().trim();

      const name = item.name.toLowerCase();
      const desc = (item.description || '').toLowerCase();
      const source = (item.source || '').toLowerCase();
      const dateFormatted = created.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric'
      }).toLowerCase();
      const isoDate = created.toISOString().toLowerCase();
      const relTime = getRelativeTime(item.createdAt).toLowerCase();

      return (
        name.includes(q) ||
        desc.includes(q) ||
        source.includes(q) ||
        dateFormatted.includes(q) ||
        isoDate.includes(q) ||
        relTime.includes(q)
      );
    });
  }, [libraryItems, searchQuery, activeTab, dateFilter, startDate, endDate]);

  const filteredTasks = useMemo(() => {
    return filterTasks(tasks, searchQuery, dateFilter, startDate, endDate);
  }, [tasks, searchQuery, dateFilter, startDate, endDate]);

  // Automatically group task sessions by date periods ('Today', 'This Week', 'Older')
  const groupedTasks = useMemo(() => {
    return groupTasksByDate(filteredTasks);
  }, [filteredTasks]);

  return (
    <Sheet open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <SheetContent 
        side="right" 
        className="w-full sm:max-w-xl p-0 flex flex-col h-full bg-background border-l border-border shadow-2xl z-50 overflow-hidden"
      >
        {/* Top Header - History & Library */}
        <div className="p-5 pb-3 border-b border-border bg-manus-soft dark:bg-card/40">
          <SheetHeader className="text-left space-y-1">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-primary/10 text-primary flex items-center justify-center shadow-xs">
                  <Clock size={20} />
                </div>
                <div>
                  <SheetTitle className="text-lg font-bold text-foreground tracking-tight">
                    History & Library
                  </SheetTitle>
                  <SheetDescription className="text-xs text-muted-foreground">
                    Search and filter past tasks, chat sessions & media
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
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-primary text-primary-foreground font-medium text-xs shadow-xs hover:opacity-90 transition-all cursor-pointer"
                >
                  <Plus size={14} />
                  <span>Add File</span>
                </button>
              </div>
            </div>
          </SheetHeader>

          {/* Quick Stats Grid with Interactive Tab Switching */}
          <div className="grid grid-cols-4 gap-2 mt-4">
            <button
              type="button"
              onClick={() => setActiveTab('sessions')}
              className={cn(
                "border rounded-xl p-2 text-center shadow-2xs transition-all cursor-pointer text-left",
                activeTab === 'sessions'
                  ? "bg-primary/10 border-primary/40 font-semibold text-primary"
                  : "bg-white dark:bg-card border-border hover:border-primary/30"
              )}
            >
              <span className="text-xs font-bold text-foreground block">{tasks.length}</span>
              <span className="text-[10px] text-muted-foreground">Past Tasks</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('photos')}
              className={cn(
                "border rounded-xl p-2 text-center shadow-2xs transition-all cursor-pointer text-left",
                activeTab === 'photos'
                  ? "bg-primary/10 border-primary/40 font-semibold text-primary"
                  : "bg-white dark:bg-card border-border hover:border-primary/30"
              )}
            >
              <span className="text-xs font-bold text-foreground block">{libraryItems.filter(i => i.type === 'photo').length}</span>
              <span className="text-[10px] text-muted-foreground">Photos</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('videos')}
              className={cn(
                "border rounded-xl p-2 text-center shadow-2xs transition-all cursor-pointer text-left",
                activeTab === 'videos'
                  ? "bg-primary/10 border-primary/40 font-semibold text-primary"
                  : "bg-white dark:bg-card border-border hover:border-primary/30"
              )}
            >
              <span className="text-xs font-bold text-foreground block">{libraryItems.filter(i => i.type === 'video' || i.type === 'audio').length}</span>
              <span className="text-[10px] text-muted-foreground">Videos</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('docs')}
              className={cn(
                "border rounded-xl p-2 text-center shadow-2xs transition-all cursor-pointer text-left",
                activeTab === 'docs'
                  ? "bg-primary/10 border-primary/40 font-semibold text-primary"
                  : "bg-white dark:bg-card border-border hover:border-primary/30"
              )}
            >
              <span className="text-xs font-bold text-foreground block">{libraryItems.filter(i => i.type === 'doc' || i.type === 'graph').length}</span>
              <span className="text-[10px] text-muted-foreground">Files</span>
            </button>
          </div>

          {/* Search Bar & Date Filter Controls */}
          <div className="space-y-2 mt-3">
            <div className="relative flex items-center gap-2">
              <div className="relative flex-1">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
                <input
                  ref={searchInputRef}
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape' && searchQuery) {
                      e.stopPropagation();
                      setSearchQuery('');
                    }
                  }}
                  placeholder="Search past tasks by title or content..."
                  aria-label="Search past tasks by title or content"
                  className="w-full pl-9 pr-8 py-2 bg-white dark:bg-card border border-border rounded-xl text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary shadow-2xs transition-all"
                />
                {searchQuery && (
                  <button
                    type="button"
                    onClick={() => setSearchQuery('')}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 p-0.5 rounded-full hover:bg-muted text-muted-foreground hover:text-foreground cursor-pointer transition-colors"
                    title="Clear search query"
                    aria-label="Clear search query"
                  >
                    <X size={12} />
                  </button>
                )}
              </div>

              {/* Date Filter Toggle Button */}
              <button
                type="button"
                onClick={() => setShowDateFilter(!showDateFilter)}
                className={cn(
                  "flex items-center gap-1.5 px-3 py-2 rounded-xl border text-xs font-medium transition-all shrink-0 cursor-pointer shadow-2xs",
                  (dateFilter !== 'all' || showDateFilter)
                    ? "bg-primary/10 border-primary/40 text-primary font-semibold"
                    : "bg-white dark:bg-card border-border text-muted-foreground hover:text-foreground"
                )}
                title="Filter tasks by date range"
              >
                <Calendar size={14} />
                <span className="hidden sm:inline">Date</span>
                {dateFilter !== 'all' && (
                  <span className="w-2 h-2 rounded-full bg-primary shrink-0" />
                )}
              </button>
            </div>

            {/* Real-time search counter / indicator */}
            {searchQuery.trim() && (
              <div className="flex items-center justify-between text-[11px] px-1 text-muted-foreground animate-in fade-in duration-150">
                <span className="flex items-center gap-1.5">
                  <Sparkles size={11} className="text-primary" />
                  <span>
                    Found <strong className="text-foreground">{activeTab === 'sessions' ? filteredTasks.length : filteredItems.length}</strong> matching "{searchQuery}"
                  </span>
                </span>
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  className="text-[10px] text-primary hover:underline cursor-pointer"
                >
                  Clear search
                </button>
              </div>
            )}

            {/* Quick Date Filter Pills & Custom Date Range */}
            {(showDateFilter || dateFilter !== 'all') && (
              <div className="p-2.5 rounded-xl bg-white dark:bg-card/90 border border-border/80 space-y-2 animate-in fade-in slide-in-from-top-1 duration-150">
                <div className="flex items-center justify-between text-[11px] text-muted-foreground font-semibold px-0.5">
                  <span className="flex items-center gap-1">
                    <Filter size={11} className="text-primary" /> Filter by Date Period
                  </span>
                  {(dateFilter !== 'all' || searchQuery || startDate || endDate) && (
                    <button
                      type="button"
                      onClick={() => {
                        setDateFilter('all');
                        setStartDate('');
                        setEndDate('');
                        setSearchQuery('');
                      }}
                      className="text-[10px] text-primary hover:underline font-normal cursor-pointer"
                    >
                      Reset All Filters
                    </button>
                  )}
                </div>

                {/* Date Quick Filter Pills */}
                <div className="flex items-center gap-1.5 flex-wrap">
                  {[
                    { id: 'all', label: 'All Dates' },
                    { id: 'today', label: 'Today' },
                    { id: 'yesterday', label: 'Yesterday' },
                    { id: 'week', label: 'Past 7 Days' },
                    { id: 'month', label: 'Past 30 Days' },
                    { id: 'custom', label: 'Custom Range' }
                  ].map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => setDateFilter(p.id as any)}
                      className={cn(
                        "px-2.5 py-1 rounded-lg text-[11px] font-medium transition-all cursor-pointer",
                        dateFilter === p.id
                          ? "bg-primary text-primary-foreground font-semibold shadow-2xs"
                          : "bg-muted/60 text-muted-foreground hover:text-foreground hover:bg-muted"
                      )}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>

                {/* Custom Date Range Picker */}
                {dateFilter === 'custom' && (
                  <div className="flex items-center gap-2 pt-1 border-t border-border/40">
                    <div className="flex-1 space-y-1">
                      <label className="text-[10px] text-muted-foreground font-mono block">Start Date</label>
                      <input
                        type="date"
                        value={startDate}
                        onChange={(e) => setStartDate(e.target.value)}
                        className="w-full px-2 py-1 bg-background border border-border rounded-lg text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                      />
                    </div>
                    <div className="flex-1 space-y-1">
                      <label className="text-[10px] text-muted-foreground font-mono block">End Date</label>
                      <input
                        type="date"
                        value={endDate}
                        onChange={(e) => setEndDate(e.target.value)}
                        className="w-full px-2 py-1 bg-background border border-border rounded-lg text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                      />
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* History & Library Navigation Tabs */}
        <div className="flex-1 flex flex-col min-h-0">
          <Tabs 
            value={activeTab} 
            onValueChange={(val: any) => setActiveTab(val)} 
            className="flex-1 flex flex-col min-h-0"
          >
            <div className="px-5 pt-3 pb-2 flex items-center justify-between border-b border-border/60 gap-2">
              <TabsList className="bg-manus-soft dark:bg-muted/50 p-1 rounded-xl h-9 gap-1 overflow-x-auto">
                <TabsTrigger value="sessions" className="text-xs px-2.5 py-1 rounded-lg font-medium data-[state=active]:bg-white dark:data-[state=active]:bg-card shadow-2xs">
                  Past Tasks ({tasks.length})
                </TabsTrigger>
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
              <div className="flex-1 overflow-y-auto p-4 space-y-2.5 custom-scrollbar smooth-scroll overscroll-contain">
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
                        <SwipeableHistoryItem
                          key={item.id}
                          id={item.id}
                          deleteLabel="Remove"
                          onDelete={() => handleDeleteLibraryItem(item.id, undefined, item.name)}
                        >
                          <div className="group relative flex items-center justify-between p-3 rounded-2xl border border-border bg-white dark:bg-card hover:border-primary/50 hover:shadow-sm transition-all gap-3">
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
                        </SwipeableHistoryItem>
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
                        <SwipeableHistoryItem
                          key={item.id}
                          id={item.id}
                          deleteLabel="Remove"
                          onDelete={() => handleDeleteLibraryItem(item.id, undefined, item.name)}
                        >
                          <div
                            className="group relative rounded-2xl border border-border bg-white dark:bg-card p-3 hover:border-primary/50 hover:shadow-md transition-all flex flex-col justify-between h-full"
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
                      </SwipeableHistoryItem>
                    );
                    })}
                  </div>
                )}
              </div>
            ) : (
              /* Chat & Task Sessions Tab */
              <TabsContent value="sessions" className="flex-1 overflow-y-auto p-4 space-y-2.5 custom-scrollbar smooth-scroll overscroll-contain m-0">
                {/* Conversation Persistence & Multi-Select Toolbar */}
                {isSelectionMode ? (
                  <div className="flex items-center justify-between p-2.5 rounded-xl bg-primary/10 border border-primary/20 mb-2 animate-in fade-in">
                    <div className="flex items-center gap-2">
                      <button
                        onClick={handleSelectAllTasks}
                        className="flex items-center gap-1.5 text-xs font-semibold text-primary hover:underline cursor-pointer"
                      >
                        <div className={cn(
                          "w-4 h-4 rounded border flex items-center justify-center transition-colors",
                          selectedTaskIds.size === filteredTasks.length && filteredTasks.length > 0
                            ? "bg-primary border-primary text-primary-foreground"
                            : selectedTaskIds.size > 0
                              ? "bg-primary/20 border-primary text-primary"
                              : "border-muted-foreground/40 bg-background"
                        )}>
                          {selectedTaskIds.size === filteredTasks.length && filteredTasks.length > 0 && <Check size={11} strokeWidth={3} />}
                          {selectedTaskIds.size > 0 && selectedTaskIds.size < filteredTasks.length && <div className="w-2 h-0.5 bg-primary rounded-full" />}
                        </div>
                        <span>
                          {selectedTaskIds.size === filteredTasks.length && filteredTasks.length > 0
                            ? 'Deselect All'
                            : 'Select All'}
                        </span>
                      </button>
                      <span className="text-xs text-muted-foreground font-mono font-medium">
                        ({selectedTaskIds.size} of {filteredTasks.length} selected)
                      </span>
                    </div>

                    <div className="flex items-center gap-1.5">
                      <button
                        onClick={() => setShowBulkDeleteDialog(true)}
                        disabled={selectedTaskIds.size === 0}
                        className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-red-500 hover:bg-red-600 text-white text-[11px] font-semibold transition-all cursor-pointer shadow-xs disabled:opacity-40 disabled:cursor-not-allowed"
                        title="Delete selected tasks"
                      >
                        <Trash2 size={12} />
                        <span>Delete ({selectedTaskIds.size})</span>
                      </button>
                      <button
                        onClick={handleCancelSelection}
                        className="flex items-center gap-1 px-2 py-1 rounded-lg bg-background hover:bg-muted text-foreground border border-border/60 text-[11px] font-semibold transition-all cursor-pointer shadow-2xs"
                        title="Exit selection mode"
                      >
                        <span>Done</span>
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center justify-between p-2.5 rounded-xl bg-muted/40 border border-border/50 mb-2">
                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground font-medium">
                      <Clock size={13} className="text-primary" />
                      <span>
                        {searchQuery.trim() ? (
                          <>
                            Filtered Tasks (<strong className="text-foreground">{filteredTasks.length}</strong> of {tasks.length})
                          </>
                        ) : (
                          <>Permanent History ({filteredTasks.length})</>
                        )}
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      {filteredTasks.length > 0 && (
                        <button
                          type="button"
                          onClick={() => setIsSelectionMode(true)}
                          className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-background hover:bg-muted text-foreground border border-border/60 text-[11px] font-semibold transition-all cursor-pointer shadow-2xs"
                          title="Select multiple tasks to delete"
                        >
                          <CheckSquare size={12} className="text-primary" />
                          <span>Select</span>
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={handleExportHistory}
                        className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-background hover:bg-muted text-foreground border border-border/60 text-[11px] font-semibold transition-all cursor-pointer shadow-2xs"
                        title="Export conversation history to JSON backup"
                      >
                        <Download size={12} />
                        <span>Backup</span>
                      </button>
                      <button
                        type="button"
                        onClick={handleRecoverHistory}
                        className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-primary/10 hover:bg-primary hover:text-primary-foreground text-primary text-[11px] font-semibold transition-all cursor-pointer"
                        title="Restore conversations from a backup file"
                      >
                        <Upload size={12} />
                        <span>Recover</span>
                      </button>
                    </div>
                  </div>
                )}

                {!isSelectionMode && filteredTasks.length > 0 && (
                  <div className="flex items-center justify-between px-1.5 py-0.5 text-[10px] text-muted-foreground/70 select-none">
                    <span className="flex items-center gap-1.5">
                      <span className="w-1.5 h-1.5 rounded-full bg-rose-500 inline-block shrink-0" />
                      <span>Swipe left on any session to delete</span>
                    </span>
                    <span className="hidden sm:inline font-mono text-[9px] text-muted-foreground/50">
                      Drag / Swipe gesture enabled
                    </span>
                  </div>
                )}

                {groupedTasks.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-56 text-center px-4 space-y-3">
                    <div className="w-12 h-12 rounded-2xl bg-muted/60 text-muted-foreground flex items-center justify-center">
                      {searchQuery ? <Search size={20} className="text-muted-foreground" /> : <MessageSquare size={20} />}
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-foreground">
                        {searchQuery ? `No tasks found matching "${searchQuery}"` : 'No chat sessions found'}
                      </p>
                      <p className="text-xs text-muted-foreground max-w-xs mt-1">
                        {searchQuery ? 'No past tasks match your search by title or content. Try searching with different keywords.' : 'All research and conversation tasks will be archived here.'}
                      </p>
                    </div>
                    {searchQuery && (
                      <button
                        type="button"
                        onClick={() => {
                          setSearchQuery('');
                          setDateFilter('all');
                        }}
                        className="px-3 py-1.5 rounded-xl bg-primary/10 hover:bg-primary hover:text-primary-foreground text-primary text-xs font-semibold transition-all cursor-pointer shadow-2xs"
                      >
                        Clear search
                      </button>
                    )}
                  </div>
                ) : (
                  groupedTasks.map((group) => (
                    <div key={group.label} className="space-y-2 pt-1 mb-3">
                      {/* Date Group Header */}
                      <div className="flex items-center gap-2 px-1 sticky top-0 bg-background/95 backdrop-blur-xs py-1.5 z-10 border-b border-border/40">
                        <Clock size={12} className="text-primary shrink-0" />
                        <span className="text-[11px] font-bold tracking-tight text-foreground/80 uppercase">
                          {group.label}
                        </span>
                        <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-muted font-mono text-muted-foreground font-semibold">
                          {group.tasks.length}
                        </span>
                        <div className="h-px bg-border/40 flex-1 ml-1" />
                        {isSelectionMode && (
                          <button
                            type="button"
                            onClick={(e) => handleSelectGroupTasks(group.tasks, e)}
                            className="text-[10px] font-medium text-muted-foreground hover:text-primary px-1.5 py-0.5 rounded hover:bg-muted transition-colors cursor-pointer"
                          >
                            {group.tasks.every(t => selectedTaskIds.has(t.id)) ? 'Deselect group' : 'Select group'}
                          </button>
                        )}
                      </div>

                      {/* Grouped session cards */}
                      <div className="space-y-2">
                        {group.tasks.map((task) => {
                          const isSelected = selectedTaskIds.has(task.id);
                          const cardContent = (
                            <div
                              onClick={(e) => {
                                if (isSelectionMode) {
                                  toggleSelectTask(task.id, e);
                                } else {
                                  handleOpenTask(task.id);
                                }
                              }}
                              className={cn(
                                "group relative p-3.5 rounded-2xl border transition-all cursor-pointer",
                                isSelected
                                  ? "border-primary bg-primary/5 dark:bg-primary/10 ring-1 ring-primary/30 shadow-sm"
                                  : "border-border bg-white dark:bg-card hover:border-primary/50 hover:shadow-md"
                              )}
                            >
                              <div className="flex items-start gap-3">
                                {/* Selection Checkbox */}
                                <div
                                  onClick={(e) => toggleSelectTask(task.id, e)}
                                  className={cn(
                                    "mt-0.5 shrink-0 w-4 h-4 rounded border flex items-center justify-center transition-all cursor-pointer",
                                    isSelected
                                      ? "bg-primary border-primary text-primary-foreground opacity-100"
                                      : isSelectionMode
                                        ? "border-muted-foreground/40 bg-background hover:border-primary opacity-100"
                                        : "border-muted-foreground/40 bg-background hover:border-primary opacity-0 group-hover:opacity-100"
                                  )}
                                  title={isSelected ? "Deselect task" : "Select task"}
                                >
                                  {isSelected && <Check size={11} strokeWidth={3} />}
                                </div>

                                <div className="flex-1 min-w-0 space-y-1.5">
                                  <div className="flex items-center gap-2">
                                    <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-primary/10 text-primary font-medium">
                                      <MessageSquare size={11} /> {((task as any).mode === 'work' || task.outputFormat === 'website' || Boolean(task.websiteName)) ? 'Work' : 'Chat'}
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
                                  {searchQuery.trim() && task.content && !formatTitle(task).toLowerCase().includes(searchQuery.toLowerCase().trim()) && !task.prompt?.toLowerCase().includes(searchQuery.toLowerCase().trim()) && (
                                    <div className="text-[10px] text-primary bg-primary/5 dark:bg-primary/10 border border-primary/20 rounded-lg px-2 py-0.5 line-clamp-1 font-mono">
                                      <span className="font-semibold">Match in content:</span> "{getContentSnippet(task.content, searchQuery)}"
                                    </div>
                                  )}
                                </div>

                                {/* Delete single session button - only when not in selection mode */}
                                {!isSelectionMode && (
                                  <button
                                    onClick={(e) => handleDeleteTask(task.id, e, formatTitle(task))}
                                    className="p-1.5 rounded-lg text-muted-foreground hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors opacity-0 group-hover:opacity-100 cursor-pointer"
                                    title="Delete session"
                                  >
                                    <Trash2 size={13} />
                                  </button>
                                )}
                              </div>
                            </div>
                          );

                          const wrappedCard = isSelectionMode ? (
                            cardContent
                          ) : (
                            <TaskQuickPreviewCard task={task} side="left" align="start">
                              {cardContent}
                            </TaskQuickPreviewCard>
                          );

                          return (
                            <SwipeableHistoryItem
                              key={task.id}
                              id={task.id}
                              disabled={isSelectionMode}
                              deleteLabel="Delete"
                              onDelete={() => handleDeleteTask(task.id, undefined, formatTitle(task))}
                            >
                              {wrappedCard}
                            </SwipeableHistoryItem>
                          );
                        })}
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
        <AlertDialog 
          open={!!itemToDelete} 
          onOpenChange={(open) => {
            if (!open) {
              setItemToDelete(null);
            }
          }}
        >
          <AlertDialogContent className="max-w-md rounded-2xl p-6 bg-card border border-border">
            <AlertDialogHeader>
              <div className="w-11 h-11 rounded-2xl flex items-center justify-center mb-2 mx-auto sm:mx-0 bg-destructive/10 text-destructive">
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
                onClick={() => {
                  setItemToDelete(null);
                }}
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

        {/* Bulk Delete Confirmation Alert Dialog */}
        <AlertDialog 
          open={showBulkDeleteDialog} 
          onOpenChange={(open) => {
            if (!open && !isBulkDeleting) {
              setShowBulkDeleteDialog(false);
            }
          }}
        >
          <AlertDialogContent className="max-w-md rounded-2xl p-6 bg-card border border-border">
            <AlertDialogHeader>
              <div className="w-11 h-11 rounded-2xl flex items-center justify-center mb-2 mx-auto sm:mx-0 bg-destructive/10 text-destructive">
                <Trash2 size={22} />
              </div>
              <AlertDialogTitle className="text-base sm:text-lg font-bold text-foreground">
                Delete {selectedTaskIds.size} Selected {selectedTaskIds.size === 1 ? 'Task' : 'Tasks'}?
              </AlertDialogTitle>
              <AlertDialogDescription className="text-xs text-muted-foreground leading-relaxed">
                Are you sure you want to delete <span className="font-semibold text-foreground">{selectedTaskIds.size} selected {selectedTaskIds.size === 1 ? 'task' : 'tasks'}</span> in a single action?
                This action cannot be undone. All conversation messages, research steps, and generated analysis will be permanently deleted.
              </AlertDialogDescription>
            </AlertDialogHeader>

            <AlertDialogFooter className="mt-4 gap-2 sm:gap-2">
              <AlertDialogCancel 
                disabled={isBulkDeleting}
                onClick={() => setShowBulkDeleteDialog(false)}
                className="rounded-xl text-xs cursor-pointer border border-border hover:bg-muted"
              >
                Cancel
              </AlertDialogCancel>
              <AlertDialogAction
                disabled={isBulkDeleting}
                onClick={handleConfirmBulkDelete}
                className="rounded-xl text-xs bg-destructive text-destructive-foreground hover:bg-destructive/90 cursor-pointer shadow-xs font-semibold flex items-center gap-1.5"
              >
                {isBulkDeleting ? (
                  <>
                    <Loader2 size={13} className="animate-spin" />
                    <span>Deleting {selectedTaskIds.size}...</span>
                  </>
                ) : (
                  <span>Delete {selectedTaskIds.size} {selectedTaskIds.size === 1 ? 'Task' : 'Tasks'}</span>
                )}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </SheetContent>
    </Sheet>
  );
}
