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
  CheckSquare,
  Tag,
  ChevronDown,
  ChevronUp
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { blink } from '@/lib/blink';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { syncTasksToLibrary, getLibraryItems } from '@/lib/libraryStore';
import { listConversations, deleteConversation, exportAllChatHistory, recoverChatHistory, getAllMessages, getMessages } from '@/lib/chatDatabase';
import { classifyTaskTags, getTagStyle, getAvailableTags, TaskTag } from '@/lib/taskTaggingService';
import { getTagColorHex, TagSummaryMetric } from '@/lib/tagAnalyticsService';
import { generateSessionSummary, getStoredSessionSummaries, removeSessionSummary } from '@/lib/sessionSummaryService';
import { TaskQuickPreviewCard } from './TaskQuickPreviewCard';
import { SwipeableHistoryItem } from './SwipeableHistoryItem';
import { useUltraLiteImage } from '@/hooks/useUltraLiteImage';

const TagAnalyticsModal = React.lazy(() =>
  import('@/components/analytics/TagAnalyticsModal').then((m) => ({ default: m.TagAnalyticsModal }))
);

const UltraLiteLibraryPhoto = React.memo(function UltraLiteLibraryPhoto({
  url,
  name,
}: {
  url: string;
  name: string;
}) {
  const { src, isPlaceholder, loadFullResolution } = useUltraLiteImage(url, {
    label: name || 'Library Photo',
    maxDimension: 220,
  });
  return (
    <div className="relative w-full h-full">
      <img
        src={src}
        alt={name}
        loading="lazy"
        decoding="async"
        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
      />
      {isPlaceholder && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            loadFullResolution();
          }}
          className="absolute bottom-1.5 right-1.5 z-10 px-2 py-0.5 rounded bg-[#000000]/80 text-[#FFFFFF] text-[9px] font-bold cursor-pointer"
        >
          Load HD
        </button>
      )}
    </div>
  );
});
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
  tags?: string[];
  summary?: string;
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
    description: 'Abstract futuristic monochrome sphere UI rendering'
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
  const monoBg = 'bg-[#F2F2F2] dark:bg-[#1A1A1A] border border-[#E0E0E0] dark:border-[#262626]';
  const monoText = 'text-[#000000] dark:text-[#FFFFFF]';
  switch (item.type) {
    case 'photo':
      return { label: 'Image', bg: monoBg, text: monoText, icon: ImageIcon };
    case 'video':
      return { label: 'Video', bg: monoBg, text: monoText, icon: Film };
    case 'audio':
      return { label: 'Audio', bg: monoBg, text: monoText, icon: Mic };
    case 'website':
      return { label: 'Web Project', bg: monoBg, text: monoText, icon: Globe };
    case 'graph':
      return { label: 'Dataset', bg: monoBg, text: monoText, icon: BarChart3 };
    case 'doc':
    default:
      if (item.name.endsWith('.pdf')) {
        return { label: 'PDF Document', bg: monoBg, text: monoText, icon: FileText };
      }
      return { label: 'Document', bg: monoBg, text: monoText, icon: FileText };
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
  referenceDate: Date = new Date(),
  selectedTag: string = 'all'
): TaskHistoryItem[] {
  return tasks.filter(task => {
    // Tag Filter
    if (selectedTag && selectedTag !== 'all') {
      const taskTags = Array.isArray(task.tags) && task.tags.length > 0
        ? task.tags
        : typeof task.tags === 'string'
          ? JSON.parse(task.tags)
          : classifyTaskTags(task.prompt || task.title || '', (task as any).result);
      if (!taskTags.includes(selectedTag)) {
        return false;
      }
    }

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

    // 2. Keyword Filter (Search by title, content, or tag)
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase().trim();

    const title = (task.title || '').toLowerCase();
    const prompt = (task.prompt || '').toLowerCase();
    const content = (task.content || '').toLowerCase();
    const summary = (task.summary || '').toLowerCase();
    const status = (task.status || '').toLowerCase();
    const mode = ((task as any).mode || '').toLowerCase();
    const tagsStr = (Array.isArray(task.tags) ? task.tags.join(' ') : '').toLowerCase();

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
      summary.includes(q) ||
      status.includes(q) ||
      mode.includes(q) ||
      tagsStr.includes(q) ||
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
  const [selectedTagFilter, setSelectedTagFilter] = useState<string>('all');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [showDateFilter, setShowDateFilter] = useState(false);
  // Collapsible Tag Distribution defaults to compact view (false)
  const [showTagBars, setShowTagBars] = useState(false);
  const [visibleChartTags, setVisibleChartTags] = useState<TaskTag[]>([]);
  const [isTagAnalyticsOpen, setIsTagAnalyticsOpen] = useState(false);
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
  const [sessionSummaries, setSessionSummaries] = useState<Record<string, string>>(() => getStoredSessionSummaries());
  const [summarizingIds, setSummarizingIds] = useState<Record<string, boolean>>({});
  const [copiedSummaryId, setCopiedSummaryId] = useState<string | null>(null);
  const [collapsedSummaryIds, setCollapsedSummaryIds] = useState<Record<string, boolean>>({});
  const [isBatchSummarizing, setIsBatchSummarizing] = useState(false);
  const [batchSummaryProgress, setBatchSummaryProgress] = useState<{ completed: number; total: number } | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();

  useEffect(() => {
    const handleSummariesUpdated = () => {
      setSessionSummaries(getStoredSessionSummaries());
    };
    window.addEventListener('manus_session_summaries_updated', handleSummariesUpdated);
    return () => {
      window.removeEventListener('manus_session_summaries_updated', handleSummariesUpdated);
    };
  }, []);

  // Load library & task data whenever panel opens; reset selection when closed
  useEffect(() => {
    if (isOpen) {
      if (initialTab) {
        setActiveTab(initialTab);
      }
      setSessionSummaries(getStoredSessionSummaries());
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

  const handleGenerateSessionSummary = async (task: TaskHistoryItem, e?: React.MouseEvent) => {
    if (e) {
      e.stopPropagation();
      e.preventDefault();
    }
    if (summarizingIds[task.id]) return;

    setSummarizingIds((prev) => ({ ...prev, [task.id]: true }));
    try {
      let messages: Array<{ role: string; content: string }> = [];
      try {
        const storedMsgs = await getMessages(task.id);
        if (Array.isArray(storedMsgs) && storedMsgs.length > 0) {
          messages = storedMsgs.map((m) => ({
            role: m.role,
            content: m.content,
          }));
        }
      } catch {}

      const summary = await generateSessionSummary({
        id: task.id,
        title: formatTitle(task),
        prompt: task.prompt,
        content: task.content,
        messages,
      });

      setSessionSummaries((prev) => ({ ...prev, [task.id]: summary }));
      setCollapsedSummaryIds((prev) => ({ ...prev, [task.id]: false }));
      setTasks((prev) =>
        prev.map((t) => (t.id === task.id ? { ...t, summary } : t))
      );
      try {
        await (blink.db as any).tasks.update(task.id, { summary });
      } catch {}
      toast.success('Generated session summary');
    } catch (err) {
      console.error('Failed to generate session summary:', err);
      toast.error('Failed to generate summary');
    } finally {
      setSummarizingIds((prev) => ({ ...prev, [task.id]: false }));
    }
  };

  const handleCopySessionSummary = (taskId: string, summaryText: string, e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    navigator.clipboard.writeText(summaryText);
    setCopiedSummaryId(taskId);
    toast.success('Summary copied to clipboard');
    setTimeout(() => {
      setCopiedSummaryId((prev) => (prev === taskId ? null : prev));
    }, 1800);
  };

  const handleClearSessionSummary = (taskId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    const updated = removeSessionSummary(taskId);
    setSessionSummaries(updated);
    setTasks((prev) =>
      prev.map((t) => (t.id === taskId ? { ...t, summary: undefined } : t))
    );
    toast.info('Session summary cleared');
  };

  const handleToggleCollapseSummary = (taskId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    setCollapsedSummaryIds((prev) => ({
      ...prev,
      [taskId]: !prev[taskId],
    }));
  };

  const handleBatchSummarizeTasks = async (targetTasks: TaskHistoryItem[]) => {
    if (isBatchSummarizing || targetTasks.length === 0) return;
    const unsummarized = targetTasks.filter((t) => !(sessionSummaries[t.id] || t.summary));
    const queue = unsummarized.length > 0 ? unsummarized : targetTasks;

    setIsBatchSummarizing(true);
    setBatchSummaryProgress({ completed: 0, total: queue.length });

    let completedCount = 0;
    try {
      for (const task of queue) {
        setSummarizingIds((prev) => ({ ...prev, [task.id]: true }));
        try {
          let messages: Array<{ role: string; content: string }> = [];
          try {
            const storedMsgs = await getMessages(task.id);
            if (Array.isArray(storedMsgs) && storedMsgs.length > 0) {
              messages = storedMsgs.map((m) => ({ role: m.role, content: m.content }));
            }
          } catch {}

          const summary = await generateSessionSummary({
            id: task.id,
            title: formatTitle(task),
            prompt: task.prompt,
            content: task.content,
            messages,
          });
          setSessionSummaries((prev) => ({ ...prev, [task.id]: summary }));
          setCollapsedSummaryIds((prev) => ({ ...prev, [task.id]: false }));
          setTasks((prev) =>
            prev.map((t) => (t.id === task.id ? { ...t, summary } : t))
          );
          try {
            await (blink.db as any).tasks.update(task.id, { summary });
          } catch {}
        } finally {
          setSummarizingIds((prev) => ({ ...prev, [task.id]: false }));
          completedCount += 1;
          setBatchSummaryProgress({ completed: completedCount, total: queue.length });
        }
      }
      toast.success(`Generated summaries for ${completedCount} session(s)`);
    } catch (err) {
      toast.error('Failed to summarize some sessions');
    } finally {
      setIsBatchSummarizing(false);
      setBatchSummaryProgress(null);
    }
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

  const tasksWithSummaries = useMemo(() => {
    return tasks.map((t) => ({
      ...t,
      summary: sessionSummaries[t.id] || t.summary,
    }));
  }, [tasks, sessionSummaries]);

  const filteredTasks = useMemo(() => {
    return filterTasks(tasksWithSummaries, searchQuery, dateFilter, startDate, endDate, new Date(), selectedTagFilter);
  }, [tasksWithSummaries, searchQuery, dateFilter, startDate, endDate, selectedTagFilter]);

  // Compute tag summaries for Tag Distribution based on active date range & search filter
  const inlineTagSummaries: TagSummaryMetric[] = useMemo(() => {
    const dateFilteredTasks = filterTasks(tasks, searchQuery, dateFilter, startDate, endDate, new Date(), 'all');
    const available = getAvailableTags();
    const counts: Record<TaskTag, number> = available.reduce((acc, t) => {
      acc[t] = 0;
      return acc;
    }, {} as Record<TaskTag, number>);

    dateFilteredTasks.forEach((t) => {
      const tTags: string[] =
        Array.isArray(t.tags) && t.tags.length > 0
          ? t.tags
          : typeof t.tags === 'string'
            ? (() => {
                try {
                  return JSON.parse(t.tags);
                } catch {
                  return classifyTaskTags(t.prompt || t.title || '');
                }
              })()
            : classifyTaskTags(t.prompt || t.title || '');
      tTags.forEach((tag) => {
        if (available.includes(tag as TaskTag)) {
          counts[tag as TaskTag] = (counts[tag as TaskTag] || 0) + 1;
        }
      });
    });

    const activeList = visibleChartTags.length > 0 ? visibleChartTags : available;
    const totalVisible = activeList.reduce((acc, tag) => acc + (counts[tag] || 0), 0);

    return available
      .map((tag) => ({
        tag,
        count: counts[tag] || 0,
        percentage: totalVisible > 0 ? Math.round(((counts[tag] || 0) / totalVisible) * 100) : 0,
        trendPercent: 0,
        avgPerDay: 0,
        color: getTagColorHex(tag),
      }))
      .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
  }, [tasks, searchQuery, dateFilter, startDate, endDate, visibleChartTags]);

  // Automatically group task sessions by date periods ('Today', 'This Week', 'Older')
  const groupedTasks = useMemo(() => {
    return groupTasksByDate(filteredTasks);
  }, [filteredTasks]);

  const topTagMetric = inlineTagSummaries[0];
  const photosCount = libraryItems.filter(i => i.type === 'photo').length;
  const videosCount = libraryItems.filter(i => i.type === 'video' || i.type === 'audio').length;
  const filesCount = libraryItems.filter(i => i.type === 'doc' || i.type === 'graph').length;

  return (
    <Sheet open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <SheetContent 
        side="right" 
        hideCloseButton
        className="w-full max-w-[100vw] sm:max-w-xl p-0 flex flex-col h-full h-[100dvh] max-h-[100dvh] bg-[#FFFFFF] dark:bg-[#000000] text-[#000000] dark:text-[#FFFFFF] border-l border-[#E0E0E0] dark:border-[#262626] shadow-2xl z-50 overflow-hidden"
      >
        {/* Minimal Fixed Header */}
        <div className="px-4 py-3 border-b border-[#E0E0E0] dark:border-[#262626] bg-[#FFFFFF] dark:bg-[#000000] shrink-0">
          <SheetHeader className="text-left space-y-0">
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0 flex-1">
                <SheetTitle className="text-base sm:text-lg font-bold text-[#000000] dark:text-[#FFFFFF] tracking-tight truncate">
                  History & Library
                </SheetTitle>
                <SheetDescription className="text-xs text-[#777777] dark:text-[#888888] truncate">
                  Your past tasks, chats and files
                </SheetDescription>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <input 
                  type="file" 
                  ref={fileInputRef}
                  onChange={handleFileUpload}
                  multiple 
                  className="hidden" 
                />
                <button
                  type="button"
                  data-size="icon"
                  onClick={() => fileInputRef.current?.click()}
                  className="inline-flex items-center gap-1.5 h-8 px-3 rounded-full bg-[#000000] dark:bg-[#FFFFFF] text-[#FFFFFF] dark:text-[#000000] font-semibold text-xs hover:opacity-90 transition-opacity cursor-pointer shrink-0"
                >
                  <Plus size={14} />
                  <span>Add File</span>
                </button>

                <button
                  type="button"
                  data-size="icon"
                  onClick={onClose}
                  aria-label="Close History & Library"
                  className="w-8 h-8 rounded-full border border-[#E0E0E0] dark:border-[#262626] bg-[#F2F2F2] dark:bg-[#111111] text-[#000000] dark:text-[#FFFFFF] flex items-center justify-center hover:opacity-80 transition-opacity cursor-pointer shrink-0"
                >
                  <X size={15} />
                </button>
              </div>
            </div>
          </SheetHeader>
        </div>

        {/* Single Primary Vertical Scroll Container */}
        <div
          data-testid="history-panel-scroll-container"
          className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden overscroll-y-contain touch-pan-y custom-scrollbar px-3.5 sm:px-5 py-3.5 pb-24 sm:pb-12 space-y-3.5"
        >
          {/* Compact 4 Statistic Cards */}
          <div className="grid grid-cols-4 gap-2">
            {[
              { id: 'sessions', label: 'Past Tasks', count: tasks.length },
              { id: 'photos', label: 'Photos', count: photosCount },
              { id: 'videos', label: 'Videos', count: videosCount },
              { id: 'docs', label: 'Files', count: filesCount },
            ].map((stat) => {
              const isSelected = activeTab === stat.id;
              return (
                <button
                  key={stat.id}
                  type="button"
                  data-size="icon"
                  onClick={() => setActiveTab(stat.id as any)}
                  className={cn(
                    "rounded-xl px-2.5 py-2 text-left border transition-all cursor-pointer",
                    isSelected
                      ? "bg-[#000000] dark:bg-[#FFFFFF] text-[#FFFFFF] dark:text-[#000000] border-[#000000] dark:border-[#FFFFFF]"
                      : "bg-[#FAFAFA] dark:bg-[#111111] text-[#000000] dark:text-[#FFFFFF] border-[#E0E0E0] dark:border-[#262626] hover:border-[#777777]"
                  )}
                >
                  <span className="text-sm font-bold leading-tight block">{stat.count}</span>
                  <span className={cn(
                    "text-[11px] leading-tight block mt-0.5 truncate",
                    isSelected ? "text-[#E0E0E0] dark:text-[#333333] font-medium" : "text-[#777777] dark:text-[#888888]"
                  )}>
                    {stat.label}
                  </span>
                </button>
              );
            })}
          </div>

          {/* Prominent Search Bar + Compact Date Filter Icon Button */}
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <div className="relative flex-1 min-w-0">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#777777] pointer-events-none" />
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
                  className="w-full h-9 pl-9 pr-8 bg-[#FAFAFA] dark:bg-[#111111] border border-[#E0E0E0] dark:border-[#262626] rounded-xl text-xs text-[#000000] dark:text-[#FFFFFF] placeholder:text-[#777777] focus:outline-none focus:border-[#000000] dark:focus:border-[#FFFFFF] transition-colors"
                />
                {searchQuery && (
                  <button
                    type="button"
                    data-size="icon"
                    onClick={() => setSearchQuery('')}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 p-0.5 rounded-full text-[#777777] hover:text-[#000000] dark:hover:text-[#FFFFFF] cursor-pointer"
                    title="Clear search query"
                    aria-label="Clear search query"
                  >
                    <X size={13} />
                  </button>
                )}
              </div>

              <button
                type="button"
                data-size="icon"
                onClick={() => setShowDateFilter(!showDateFilter)}
                className={cn(
                  "relative w-9 h-9 rounded-xl border flex items-center justify-center transition-all shrink-0 cursor-pointer",
                  (dateFilter !== 'all' || showDateFilter)
                    ? "bg-[#000000] dark:bg-[#FFFFFF] text-[#FFFFFF] dark:text-[#000000] border-[#000000] dark:border-[#FFFFFF]"
                    : "bg-[#FAFAFA] dark:bg-[#111111] border-[#E0E0E0] dark:border-[#262626] text-[#777777] hover:text-[#000000] dark:hover:text-[#FFFFFF]"
                )}
                title="Filter by date range"
                aria-label="Filter by date range"
              >
                <Calendar size={15} />
                {dateFilter !== 'all' && (
                  <span className="absolute top-1.5 right-1.5 w-1.5 h-1.5 rounded-full bg-current" />
                )}
              </button>
            </div>

            {/* Expandable Date Filter Panel */}
            {(showDateFilter || dateFilter !== 'all') && (
              <div className="p-2.5 rounded-xl bg-[#FAFAFA] dark:bg-[#111111] border border-[#E0E0E0] dark:border-[#262626] space-y-2">
                <div className="flex items-center justify-between text-[11px] text-[#777777] font-medium px-0.5">
                  <span className="flex items-center gap-1">
                    <Filter size={11} /> Date Filter
                  </span>
                  {(dateFilter !== 'all' || searchQuery || startDate || endDate) && (
                    <button
                      type="button"
                      data-size="icon"
                      onClick={() => {
                        setDateFilter('all');
                        setStartDate('');
                        setEndDate('');
                        setSearchQuery('');
                      }}
                      className="text-[11px] text-[#000000] dark:text-[#FFFFFF] underline cursor-pointer"
                    >
                      Reset
                    </button>
                  )}
                </div>

                <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar touch-pan-x pb-0.5">
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
                      data-size="icon"
                      onClick={() => setDateFilter(p.id as any)}
                      className={cn(
                        "h-7 px-2.5 rounded-lg text-[11px] font-medium transition-all shrink-0 cursor-pointer border",
                        dateFilter === p.id
                          ? "bg-[#000000] dark:bg-[#FFFFFF] text-[#FFFFFF] dark:text-[#000000] border-[#000000] dark:border-[#FFFFFF] font-semibold"
                          : "bg-[#FFFFFF] dark:bg-[#1A1A1A] text-[#777777] border-[#E0E0E0] dark:border-[#262626] hover:text-[#000000] dark:hover:text-[#FFFFFF]"
                      )}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>

                {dateFilter === 'custom' && (
                  <div className="flex items-center gap-2 pt-1.5 border-t border-[#E0E0E0] dark:border-[#262626]">
                    <div className="flex-1 space-y-1">
                      <label className="text-[10px] text-[#777777] font-mono block">Start Date</label>
                      <input
                        type="date"
                        value={startDate}
                        onChange={(e) => setStartDate(e.target.value)}
                        className="w-full px-2 py-1 bg-[#FFFFFF] dark:bg-[#000000] border border-[#E0E0E0] dark:border-[#262626] rounded-lg text-xs text-[#000000] dark:text-[#FFFFFF]"
                      />
                    </div>
                    <div className="flex-1 space-y-1">
                      <label className="text-[10px] text-[#777777] font-mono block">End Date</label>
                      <input
                        type="date"
                        value={endDate}
                        onChange={(e) => setEndDate(e.target.value)}
                        className="w-full px-2 py-1 bg-[#FFFFFF] dark:bg-[#000000] border border-[#E0E0E0] dark:border-[#262626] rounded-lg text-xs text-[#000000] dark:text-[#FFFFFF]"
                      />
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Horizontal Scrollable Tag Filter Row */}
            {activeTab === 'sessions' && (
              <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar touch-pan-x py-0.5">
                {['all', ...getAvailableTags()].map((tag) => {
                  const isActive = selectedTagFilter === tag;
                  return (
                    <button
                      key={tag}
                      type="button"
                      data-size="icon"
                      onClick={() => {
                        setSelectedTagFilter(tag);
                        if (tag === 'all') {
                          setVisibleChartTags([]);
                        }
                      }}
                      className={cn(
                        "h-7 px-3 rounded-full text-[11px] transition-all shrink-0 cursor-pointer border",
                        isActive
                          ? "bg-[#000000] dark:bg-[#FFFFFF] text-[#FFFFFF] dark:text-[#000000] border-[#000000] dark:border-[#FFFFFF] font-semibold"
                          : "bg-[#FAFAFA] dark:bg-[#111111] border-[#E0E0E0] dark:border-[#262626] text-[#777777] dark:text-[#888888] hover:text-[#000000] dark:hover:text-[#FFFFFF]"
                      )}
                    >
                      {tag === 'all' ? 'All Tags' : tag}
                    </button>
                  );
                })}
              </div>
            )}

            {/* Collapsible Tag Distribution Dashboard (Compact by Default) */}
            {activeTab === 'sessions' && (
              <div
                data-testid="tag-distribution-card"
                className="rounded-xl bg-[#FAFAFA] dark:bg-[#111111] border border-[#E0E0E0] dark:border-[#262626] overflow-hidden"
              >
                <div className="flex items-center justify-between gap-2 px-3 py-2">
                  <button
                    type="button"
                    data-size="icon"
                    data-testid="toggle-tag-distribution-btn"
                    onClick={() => setShowTagBars((prev) => !prev)}
                    className="flex items-center gap-2 min-w-0 flex-1 text-left cursor-pointer"
                  >
                    <BarChart3 size={13} className="text-[#000000] dark:text-[#FFFFFF] shrink-0" />
                    <span className="text-xs font-semibold text-[#000000] dark:text-[#FFFFFF] shrink-0">
                      Tag Distribution
                    </span>
                    {topTagMetric && (
                      <span className="text-[11px] text-[#777777] dark:text-[#888888] truncate">
                        • Top: {topTagMetric.tag} ({topTagMetric.count} / {topTagMetric.percentage}%)
                      </span>
                    )}
                  </button>

                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      type="button"
                      data-size="icon"
                      onClick={() => setIsTagAnalyticsOpen(true)}
                      className="h-6 px-2 rounded-md border border-[#E0E0E0] dark:border-[#262626] bg-[#FFFFFF] dark:bg-[#1A1A1A] text-[#000000] dark:text-[#FFFFFF] text-[10px] font-medium hover:opacity-80 transition-opacity cursor-pointer"
                      title="Open Full Tag Analytics"
                    >
                      Analytics
                    </button>
                    <button
                      type="button"
                      data-size="icon"
                      onClick={() => setShowTagBars((prev) => !prev)}
                      aria-expanded={showTagBars}
                      aria-label={showTagBars ? "Collapse tag distribution" : "Expand tag distribution"}
                      className="w-6 h-6 rounded-md flex items-center justify-center text-[#777777] hover:text-[#000000] dark:hover:text-[#FFFFFF] cursor-pointer"
                    >
                      {showTagBars ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                    </button>
                  </div>
                </div>

                {showTagBars && (
                  <div className="px-3 pb-3 pt-1.5 border-t border-[#E0E0E0] dark:border-[#262626] space-y-2.5">
                    {/* Compact Time Range Switcher */}
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[10px] text-[#777777] dark:text-[#888888]">
                        Click a tag bar to filter tasks
                      </span>
                      <div className="flex items-center gap-1">
                        {[
                          { id: 'today', label: 'Today' },
                          { id: 'week', label: '7D' },
                          { id: 'month', label: '30D' },
                          { id: 'all', label: 'All' },
                        ].map((range) => (
                          <button
                            key={range.id}
                            type="button"
                            data-size="icon"
                            onClick={() => setDateFilter(range.id as any)}
                            className={cn(
                              "h-6 px-2 rounded-md text-[10px] font-medium transition-all cursor-pointer",
                              dateFilter === range.id
                                ? "bg-[#000000] dark:bg-[#FFFFFF] text-[#FFFFFF] dark:text-[#000000] font-semibold"
                                : "bg-[#F2F2F2] dark:bg-[#1A1A1A] text-[#777777] hover:text-[#000000] dark:hover:text-[#FFFFFF]"
                            )}
                          >
                            {range.label}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Simple Horizontal Progress Bars */}
                    <div className="space-y-1.5">
                      {inlineTagSummaries.map((item) => {
                        const isSelectedTag = selectedTagFilter === item.tag;
                        return (
                          <button
                            key={item.tag}
                            type="button"
                            data-size="icon"
                            onClick={() =>
                              setSelectedTagFilter(isSelectedTag ? 'all' : item.tag)
                            }
                            className={cn(
                              "w-full flex items-center gap-2.5 py-1 px-1.5 rounded-lg text-left transition-colors cursor-pointer",
                              isSelectedTag
                                ? "bg-[#F2F2F2] dark:bg-[#1A1A1A]"
                                : "hover:bg-[#F2F2F2]/60 dark:hover:bg-[#1A1A1A]/60"
                            )}
                          >
                            <span className={cn(
                              "w-20 text-[11px] truncate shrink-0",
                              isSelectedTag
                                ? "font-bold text-[#000000] dark:text-[#FFFFFF]"
                                : "font-medium text-[#333333] dark:text-[#CCCCCC]"
                            )}>
                              {item.tag}
                            </span>
                            <div className="flex-1 h-2 rounded-full bg-[#E0E0E0] dark:bg-[#262626] overflow-hidden">
                              <div
                                className="h-full rounded-full bg-[#000000] dark:bg-[#FFFFFF] transition-all duration-300"
                                style={{ width: `${Math.max(item.count > 0 ? 4 : 0, item.percentage)}%` }}
                              />
                            </div>
                            <span className="w-16 text-right font-mono text-[10px] text-[#777777] dark:text-[#888888] shrink-0">
                              {item.count} ({item.percentage}%)
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Real-time search match indicator */}
            {searchQuery.trim() && (
              <div className="flex items-center justify-between text-[11px] px-1 text-[#777777]">
                <span>
                  Found <strong className="text-[#000000] dark:text-[#FFFFFF]">{activeTab === 'sessions' ? filteredTasks.length : filteredItems.length}</strong> matching "{searchQuery}"
                </span>
                <button
                  type="button"
                  data-size="icon"
                  onClick={() => setSearchQuery('')}
                  className="text-[11px] text-[#000000] dark:text-[#FFFFFF] underline cursor-pointer"
                >
                  Clear search
                </button>
              </div>
            )}
          </div>

          {/* Navigation Tabs & Content */}
          <Tabs 
            value={activeTab} 
            onValueChange={(val: any) => setActiveTab(val)} 
            className="w-full space-y-3"
          >
            <div className="flex items-center justify-between gap-2 min-w-0 border-b border-[#E0E0E0] dark:border-[#262626] pb-2">
              <TabsList className="bg-[#F2F2F2] dark:bg-[#111111] p-1 rounded-xl h-9 gap-1 overflow-x-auto no-scrollbar touch-pan-x max-w-full justify-start border border-[#E0E0E0] dark:border-[#262626]">
                <TabsTrigger
                  value="sessions"
                  data-size="icon"
                  className="text-xs px-2.5 py-1 rounded-lg font-medium shrink-0 text-[#777777] data-[state=active]:bg-[#000000] dark:data-[state=active]:bg-[#FFFFFF] data-[state=active]:text-[#FFFFFF] dark:data-[state=active]:text-[#000000]"
                >
                  Past Tasks ({tasks.length})
                </TabsTrigger>
                <TabsTrigger
                  value="all"
                  data-size="icon"
                  className="text-xs px-2.5 py-1 rounded-lg font-medium shrink-0 text-[#777777] data-[state=active]:bg-[#000000] dark:data-[state=active]:bg-[#FFFFFF] data-[state=active]:text-[#FFFFFF] dark:data-[state=active]:text-[#000000]"
                >
                  All Items
                </TabsTrigger>
                <TabsTrigger
                  value="photos"
                  data-size="icon"
                  className="text-xs px-2.5 py-1 rounded-lg font-medium shrink-0 text-[#777777] data-[state=active]:bg-[#000000] dark:data-[state=active]:bg-[#FFFFFF] data-[state=active]:text-[#FFFFFF] dark:data-[state=active]:text-[#000000]"
                >
                  Photos
                </TabsTrigger>
                <TabsTrigger
                  value="videos"
                  data-size="icon"
                  className="text-xs px-2.5 py-1 rounded-lg font-medium shrink-0 text-[#777777] data-[state=active]:bg-[#000000] dark:data-[state=active]:bg-[#FFFFFF] data-[state=active]:text-[#FFFFFF] dark:data-[state=active]:text-[#000000]"
                >
                  Videos
                </TabsTrigger>
                <TabsTrigger
                  value="docs"
                  data-size="icon"
                  className="text-xs px-2.5 py-1 rounded-lg font-medium shrink-0 text-[#777777] data-[state=active]:bg-[#000000] dark:data-[state=active]:bg-[#FFFFFF] data-[state=active]:text-[#FFFFFF] dark:data-[state=active]:text-[#000000]"
                >
                  Docs & Files
                </TabsTrigger>
              </TabsList>

              {/* View Mode Switcher (List vs Grid) */}
              {activeTab !== 'sessions' && (
                <div className="flex items-center gap-0.5 bg-[#F2F2F2] dark:bg-[#111111] p-0.5 rounded-lg border border-[#E0E0E0] dark:border-[#262626] shrink-0">
                  <button
                    type="button"
                    data-size="icon"
                    onClick={() => setViewMode('list')}
                    className={cn(
                      "p-1.5 rounded-md transition-all cursor-pointer",
                      viewMode === 'list' 
                        ? "bg-[#000000] dark:bg-[#FFFFFF] text-[#FFFFFF] dark:text-[#000000]" 
                        : "text-[#777777] hover:text-[#000000] dark:hover:text-[#FFFFFF]"
                    )}
                    title="Clean List Format"
                  >
                    <LayoutList size={14} />
                  </button>
                  <button
                    type="button"
                    data-size="icon"
                    onClick={() => setViewMode('grid')}
                    className={cn(
                      "p-1.5 rounded-md transition-all cursor-pointer",
                      viewMode === 'grid' 
                        ? "bg-[#000000] dark:bg-[#FFFFFF] text-[#FFFFFF] dark:text-[#000000]" 
                        : "text-[#777777] hover:text-[#000000] dark:hover:text-[#FFFFFF]"
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
              <div className="space-y-2.5">
                {filteredItems.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-14 text-center px-4 space-y-3">
                    <div className="w-11 h-11 rounded-2xl bg-[#F2F2F2] dark:bg-[#111111] border border-[#E0E0E0] dark:border-[#262626] text-[#777777] flex items-center justify-center">
                      <Library size={20} />
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-[#000000] dark:text-[#FFFFFF]">
                        {searchQuery ? 'No matching items found' : 'Library is empty'}
                      </p>
                      <p className="text-xs text-[#777777] max-w-xs mt-1">
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
                          <div className="group relative flex items-center justify-between p-3 rounded-xl border border-[#E0E0E0] dark:border-[#262626] bg-[#FFFFFF] dark:bg-[#111111] hover:border-[#000000] dark:hover:border-[#FFFFFF] transition-all gap-3">
                            {/* File Icon & Main Details */}
                            <div className="flex items-center gap-3 min-w-0 flex-1">
                              <div className={cn("w-9 h-9 rounded-xl flex items-center justify-center shrink-0 font-medium", typeBadge.bg, typeBadge.text)}>
                                <TypeIcon size={17} />
                              </div>

                              <div className="min-w-0 flex-1 space-y-0.5">
                                <div className="flex items-center gap-2">
                                  <h4 className="font-semibold text-xs text-[#000000] dark:text-[#FFFFFF] truncate" title={item.name}>
                                    {item.name}
                                  </h4>
                                  {item.source && (
                                    <span className="text-[10px] px-2 py-0.5 rounded-md bg-[#F2F2F2] dark:bg-[#1A1A1A] text-[#777777] font-medium shrink-0 hidden sm:inline-block">
                                      {item.source}
                                    </span>
                                  )}
                                </div>

                                <div className="flex items-center gap-2 text-[11px] text-[#777777] flex-wrap">
                                  <span className={cn("px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase", typeBadge.bg, typeBadge.text)}>
                                    {typeBadge.label}
                                  </span>
                                  <span>•</span>
                                  <span className="font-mono text-[10px] font-medium text-[#333333] dark:text-[#CCCCCC]">
                                    {item.size || 'Shared File'}
                                  </span>
                                  <span>•</span>
                                  <span className="text-[10px] font-mono">{getRelativeTime(item.createdAt)}</span>
                                </div>
                              </div>
                            </div>

                            {/* Action Buttons */}
                            <div className="flex items-center gap-1 shrink-0">
                              {(item.type === 'photo' || item.type === 'video' || item.type === 'audio') && (
                                <button
                                  type="button"
                                  data-size="icon"
                                  onClick={() => setPreviewMedia(item)}
                                  className="p-1.5 rounded-lg hover:bg-[#F2F2F2] dark:hover:bg-[#1A1A1A] text-[#777777] hover:text-[#000000] dark:hover:text-[#FFFFFF] transition-colors cursor-pointer"
                                  title={item.type === 'photo' ? 'View Photo' : 'Play Media'}
                                >
                                  {item.type === 'photo' ? <Eye size={15} /> : <Play size={15} />}
                                </button>
                              )}

                              <button
                                type="button"
                                data-size="icon"
                                onClick={(e) => handleDownloadFile(item, e)}
                                className="flex items-center gap-1 h-7 px-2.5 rounded-lg bg-[#000000] dark:bg-[#FFFFFF] text-[#FFFFFF] dark:text-[#000000] font-semibold transition-opacity hover:opacity-90 text-[11px] cursor-pointer"
                                title={`Download ${item.name}`}
                              >
                                <Download size={12} />
                                <span className="hidden sm:inline">Download</span>
                              </button>

                              <button
                                type="button"
                                data-size="icon"
                                onClick={(e) => handleDeleteLibraryItem(item.id, e, item.name)}
                                className="p-1.5 rounded-lg text-[#777777] hover:text-[#000000] dark:hover:text-[#FFFFFF] hover:bg-[#F2F2F2] dark:hover:bg-[#1A1A1A] transition-colors cursor-pointer"
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
                          <div className="group relative rounded-xl border border-[#E0E0E0] dark:border-[#262626] bg-[#FFFFFF] dark:bg-[#111111] p-3 hover:border-[#000000] dark:hover:border-[#FFFFFF] transition-all flex flex-col justify-between h-full">
                            <div>
                              {item.type === 'photo' && item.url ? (
                                <div className="relative aspect-video rounded-lg overflow-hidden mb-2.5 bg-[#F2F2F2] dark:bg-[#1A1A1A]">
                                  <UltraLiteLibraryPhoto url={item.url} name={item.name} />
                                  <div className="absolute top-2 left-2 flex items-center gap-1 z-10">
                                    <span className={cn("px-1.5 py-0.5 rounded text-[10px] font-bold uppercase", typeBadge.bg, typeBadge.text)}>
                                      {typeBadge.label}
                                    </span>
                                  </div>
                                  <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
                                    <button
                                      type="button"
                                      data-size="icon"
                                      onClick={() => setPreviewMedia(item)}
                                      className="p-2 rounded-full bg-[#FFFFFF] text-[#000000] shadow-md cursor-pointer"
                                      title="View Photo"
                                    >
                                      <Eye size={15} />
                                    </button>
                                    <button
                                      type="button"
                                      data-size="icon"
                                      onClick={(e) => handleDownloadFile(item, e)}
                                      className="p-2 rounded-full bg-[#FFFFFF] text-[#000000] shadow-md cursor-pointer"
                                      title="Download Photo"
                                    >
                                      <Download size={15} />
                                    </button>
                                  </div>
                                </div>
                              ) : item.type === 'video' ? (
                                <div className="relative aspect-video rounded-lg bg-[#111111] flex items-center justify-center mb-2.5 overflow-hidden group border border-[#262626]">
                                  <Film size={26} className="text-[#777777]" />
                                  <div className="absolute top-2 left-2 flex items-center gap-1 z-10">
                                    <span className={cn("px-1.5 py-0.5 rounded text-[10px] font-bold uppercase", typeBadge.bg, typeBadge.text)}>
                                      {typeBadge.label}
                                    </span>
                                  </div>
                                  <button
                                    type="button"
                                    data-size="icon"
                                    onClick={() => setPreviewMedia(item)}
                                    className="absolute inset-0 flex items-center justify-center bg-black/40 group-hover:bg-black/60 transition-colors cursor-pointer"
                                  >
                                    <div className="w-10 h-10 rounded-full bg-[#FFFFFF] text-[#000000] flex items-center justify-center shadow-lg">
                                      <Play size={17} className="ml-0.5" />
                                    </div>
                                  </button>
                                </div>
                              ) : (
                                <div className="p-3 rounded-lg bg-[#FAFAFA] dark:bg-[#1A1A1A] mb-2.5 flex items-center gap-3">
                                  <div className={cn("w-9 h-9 rounded-lg flex items-center justify-center shrink-0 font-medium", typeBadge.bg, typeBadge.text)}>
                                    <TypeIcon size={18} />
                                  </div>
                                  <div className="min-w-0 flex-1 space-y-1">
                                    <div className="flex items-center gap-1.5 flex-wrap">
                                      <span className={cn("px-1.5 py-0.5 rounded text-[10px] font-bold uppercase", typeBadge.bg, typeBadge.text)}>
                                        {typeBadge.label}
                                      </span>
                                      <span className="font-mono text-[10px] font-medium text-[#777777]">
                                        {item.size || 'Shared File'}
                                      </span>
                                    </div>
                                  </div>
                                </div>
                              )}

                              <div className="space-y-1">
                                <h4 className="font-semibold text-xs text-[#000000] dark:text-[#FFFFFF] truncate" title={item.name}>
                                  {item.name}
                                </h4>
                                {item.description && (
                                  <p className="text-[11px] text-[#777777] line-clamp-1">
                                    {item.description}
                                  </p>
                                )}
                              </div>
                            </div>

                            <div className="flex items-center justify-between pt-2.5 mt-2 border-t border-[#E0E0E0] dark:border-[#262626] text-[10px] text-[#777777]">
                              <span className="font-mono">{getRelativeTime(item.createdAt)}</span>
                              <div className="flex items-center gap-1.5">
                                <button
                                  type="button"
                                  data-size="icon"
                                  onClick={(e) => handleDownloadFile(item, e)}
                                  className="flex items-center gap-1 h-7 px-2.5 rounded-lg bg-[#000000] dark:bg-[#FFFFFF] text-[#FFFFFF] dark:text-[#000000] font-semibold text-[11px] cursor-pointer"
                                  title={`Download ${item.name}`}
                                >
                                  <Download size={12} />
                                  <span>Download</span>
                                </button>
                                <button
                                  type="button"
                                  data-size="icon"
                                  onClick={(e) => handleDeleteLibraryItem(item.id, e, item.name)}
                                  className="p-1.5 rounded-lg hover:bg-[#F2F2F2] dark:hover:bg-[#1A1A1A] text-[#777777] hover:text-[#000000] dark:hover:text-[#FFFFFF] transition-colors cursor-pointer"
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
              /* Chat & Task Sessions Tab - Rendered directly in the single vertical scroll container */
              <TabsContent value="sessions" className="space-y-2.5 m-0">
                {/* Compact Permanent History & Multi-Select Bar */}
                {isSelectionMode ? (
                  <div className="flex items-center justify-between gap-2 p-2.5 rounded-xl bg-[#FAFAFA] dark:bg-[#111111] border border-[#000000] dark:border-[#FFFFFF]">
                    <div className="flex items-center gap-2 min-w-0">
                      <button
                        type="button"
                        data-size="icon"
                        onClick={handleSelectAllTasks}
                        className="flex items-center gap-1.5 text-xs font-semibold text-[#000000] dark:text-[#FFFFFF] hover:underline cursor-pointer shrink-0"
                      >
                        <div className={cn(
                          "w-4 h-4 rounded border flex items-center justify-center transition-colors",
                          selectedTaskIds.size === filteredTasks.length && filteredTasks.length > 0
                            ? "bg-[#000000] dark:bg-[#FFFFFF] border-[#000000] dark:border-[#FFFFFF] text-[#FFFFFF] dark:text-[#000000]"
                            : "border-[#777777] bg-transparent"
                        )}>
                          {selectedTaskIds.size === filteredTasks.length && filteredTasks.length > 0 && <Check size={11} strokeWidth={3} />}
                        </div>
                        <span>
                          {selectedTaskIds.size === filteredTasks.length && filteredTasks.length > 0
                            ? 'Deselect All'
                            : 'Select All'}
                        </span>
                      </button>
                      <span className="text-[11px] text-[#777777] font-mono truncate">
                        ({selectedTaskIds.size}/{filteredTasks.length})
                      </span>
                    </div>

                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        type="button"
                        data-size="icon"
                        data-testid="summarize-selected-sessions-btn"
                        onClick={() =>
                          handleBatchSummarizeTasks(
                            filteredTasks.filter((t) => selectedTaskIds.has(t.id))
                          )
                        }
                        disabled={selectedTaskIds.size === 0 || isBatchSummarizing}
                        className="flex items-center gap-1 h-7 px-2.5 rounded-lg bg-[#000000] dark:bg-[#FFFFFF] text-[#FFFFFF] dark:text-[#000000] text-[11px] font-semibold transition-opacity hover:opacity-90 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                        title="Generate AI summaries for selected sessions"
                      >
                        {isBatchSummarizing ? (
                          <>
                            <Loader2 size={11} className="animate-spin" />
                            <span>
                              {batchSummaryProgress
                                ? `${batchSummaryProgress.completed}/${batchSummaryProgress.total}`
                                : 'Summarizing...'}
                            </span>
                          </>
                        ) : (
                          <>
                            <Sparkles size={11} />
                            <span>Summarize ({selectedTaskIds.size})</span>
                          </>
                        )}
                      </button>
                      <button
                        type="button"
                        data-size="icon"
                        onClick={() => setShowBulkDeleteDialog(true)}
                        disabled={selectedTaskIds.size === 0}
                        className="flex items-center gap-1 h-7 px-2.5 rounded-lg border border-[#000000] dark:border-[#FFFFFF] bg-[#FFFFFF] dark:bg-[#1A1A1A] text-[#000000] dark:text-[#FFFFFF] text-[11px] font-semibold cursor-pointer disabled:opacity-40"
                        title="Delete selected tasks"
                      >
                        <Trash2 size={11} />
                        <span>Delete ({selectedTaskIds.size})</span>
                      </button>
                      <button
                        type="button"
                        data-size="icon"
                        onClick={handleCancelSelection}
                        className="flex items-center h-7 px-2 rounded-lg bg-[#F2F2F2] dark:bg-[#1A1A1A] text-[#000000] dark:text-[#FFFFFF] border border-[#E0E0E0] dark:border-[#262626] text-[11px] font-medium cursor-pointer"
                        title="Exit selection mode"
                      >
                        <span>Done</span>
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 px-3 py-2 rounded-xl bg-[#FAFAFA] dark:bg-[#111111] border border-[#E0E0E0] dark:border-[#262626]">
                    <div className="flex items-center gap-1.5 text-xs text-[#777777] dark:text-[#888888] font-medium shrink-0">
                      <Clock size={13} className="text-[#000000] dark:text-[#FFFFFF] shrink-0" />
                      <span>
                        {searchQuery.trim() ? (
                          <>
                            Filtered Tasks (<strong className="text-[#000000] dark:text-[#FFFFFF]">{filteredTasks.length}</strong> of {tasks.length})
                          </>
                        ) : (
                          <>Permanent History ({filteredTasks.length})</>
                        )}
                      </span>
                    </div>

                    <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar touch-pan-x">
                      {filteredTasks.length > 0 && (
                        <button
                          type="button"
                          data-size="icon"
                          data-testid="summarize-all-sessions-btn"
                          onClick={() => handleBatchSummarizeTasks(filteredTasks)}
                          disabled={isBatchSummarizing}
                          className="flex items-center gap-1 h-7 px-2.5 rounded-lg bg-[#000000] dark:bg-[#FFFFFF] text-[#FFFFFF] dark:text-[#000000] text-[11px] font-semibold transition-opacity hover:opacity-90 cursor-pointer shrink-0 disabled:opacity-50"
                          title="Generate one-sentence summaries for visible sessions"
                        >
                          {isBatchSummarizing ? (
                            <>
                              <Loader2 size={11} className="animate-spin" />
                              <span>
                                {batchSummaryProgress
                                  ? `Summarizing ${batchSummaryProgress.completed}/${batchSummaryProgress.total}`
                                  : 'Summarizing...'}
                              </span>
                            </>
                          ) : (
                            <>
                              <Sparkles size={11} />
                              <span>Summarize All</span>
                            </>
                          )}
                        </button>
                      )}
                      {filteredTasks.length > 0 && (
                        <button
                          type="button"
                          data-size="icon"
                          onClick={() => setIsSelectionMode(true)}
                          className="flex items-center gap-1 h-7 px-2.5 rounded-lg bg-[#FFFFFF] dark:bg-[#1A1A1A] text-[#000000] dark:text-[#FFFFFF] border border-[#E0E0E0] dark:border-[#262626] text-[11px] font-medium hover:border-[#000000] dark:hover:border-[#FFFFFF] transition-colors cursor-pointer shrink-0"
                          title="Select multiple tasks to summarize or delete"
                        >
                          <CheckSquare size={11} />
                          <span>Select</span>
                        </button>
                      )}
                      <button
                        type="button"
                        data-size="icon"
                        onClick={handleExportHistory}
                        className="flex items-center gap-1 h-7 px-2.5 rounded-lg bg-[#FFFFFF] dark:bg-[#1A1A1A] text-[#000000] dark:text-[#FFFFFF] border border-[#E0E0E0] dark:border-[#262626] text-[11px] font-medium hover:border-[#000000] dark:hover:border-[#FFFFFF] transition-colors cursor-pointer shrink-0"
                        title="Export conversation history to JSON backup"
                      >
                        <Download size={11} />
                        <span>Backup</span>
                      </button>
                      <button
                        type="button"
                        data-size="icon"
                        onClick={handleRecoverHistory}
                        className="flex items-center gap-1 h-7 px-2.5 rounded-lg bg-[#FFFFFF] dark:bg-[#1A1A1A] text-[#000000] dark:text-[#FFFFFF] border border-[#E0E0E0] dark:border-[#262626] text-[11px] font-medium hover:border-[#000000] dark:hover:border-[#FFFFFF] transition-colors cursor-pointer shrink-0"
                        title="Restore conversations from a backup file"
                      >
                        <Upload size={11} />
                        <span>Recover</span>
                      </button>
                    </div>
                  </div>
                )}

                {groupedTasks.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-14 text-center px-4 space-y-3">
                    <div className="w-11 h-11 rounded-2xl bg-[#F2F2F2] dark:bg-[#111111] border border-[#E0E0E0] dark:border-[#262626] text-[#777777] flex items-center justify-center">
                      {searchQuery ? <Search size={18} /> : <MessageSquare size={18} />}
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-[#000000] dark:text-[#FFFFFF]">
                        {searchQuery ? `No tasks found matching "${searchQuery}"` : 'No chat sessions found'}
                      </p>
                      <p className="text-xs text-[#777777] max-w-xs mt-1">
                        {searchQuery ? 'No past tasks match your search by title or content. Try searching with different keywords.' : 'All research and conversation tasks will be archived here.'}
                      </p>
                    </div>
                    {searchQuery && (
                      <button
                        type="button"
                        data-size="icon"
                        onClick={() => {
                          setSearchQuery('');
                          setDateFilter('all');
                        }}
                        className="h-8 px-3 rounded-xl bg-[#000000] dark:bg-[#FFFFFF] text-[#FFFFFF] dark:text-[#000000] text-xs font-semibold cursor-pointer"
                      >
                        Clear search
                      </button>
                    )}
                  </div>
                ) : (
                  groupedTasks.map((group) => (
                    <div key={group.label} className="space-y-2 pt-1">
                      {/* Date Group Header */}
                      <div className="flex items-center gap-2 px-1 py-1">
                        <span className="text-[11px] font-bold tracking-wider text-[#777777] dark:text-[#888888] uppercase">
                          {group.label}
                        </span>
                        <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-[#F2F2F2] dark:bg-[#1A1A1A] font-mono text-[#777777] font-semibold">
                          {group.tasks.length}
                        </span>
                        <div className="h-px bg-[#E0E0E0] dark:bg-[#262626] flex-1 ml-1" />
                        {isSelectionMode && (
                          <button
                            type="button"
                            data-size="icon"
                            onClick={(e) => handleSelectGroupTasks(group.tasks, e)}
                            className="text-[10px] font-medium text-[#777777] hover:text-[#000000] dark:hover:text-[#FFFFFF] px-1.5 py-0.5 rounded cursor-pointer"
                          >
                            {group.tasks.every(t => selectedTaskIds.has(t.id)) ? 'Deselect group' : 'Select group'}
                          </button>
                        )}
                      </div>

                      {/* Grouped session cards */}
                      <div className="space-y-2">
                        {group.tasks.map((task) => {
                          const isSelected = selectedTaskIds.has(task.id);
                          const isSummarizing = Boolean(summarizingIds[task.id]);
                          const activeSummary = sessionSummaries[task.id] || task.summary;
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
                                "group relative p-3 rounded-xl border transition-all cursor-pointer",
                                isSelected
                                  ? "border-[#000000] dark:border-[#FFFFFF] bg-[#FAFAFA] dark:bg-[#1A1A1A]"
                                  : "border-[#E0E0E0] dark:border-[#262626] bg-[#FFFFFF] dark:bg-[#111111] hover:border-[#777777]"
                              )}
                            >
                              <div className="flex items-start gap-2.5">
                                {/* Selection Checkbox */}
                                <div
                                  onClick={(e) => toggleSelectTask(task.id, e)}
                                  className={cn(
                                    "mt-0.5 shrink-0 w-4 h-4 rounded border flex items-center justify-center transition-all cursor-pointer",
                                    isSelected
                                      ? "bg-[#000000] dark:bg-[#FFFFFF] border-[#000000] dark:border-[#FFFFFF] text-[#FFFFFF] dark:text-[#000000] opacity-100"
                                      : isSelectionMode
                                        ? "border-[#777777] bg-transparent opacity-100"
                                        : "border-[#777777] bg-transparent opacity-0 group-hover:opacity-100"
                                  )}
                                  title={isSelected ? "Deselect task" : "Select task"}
                                >
                                  {isSelected && <Check size={11} strokeWidth={3} />}
                                </div>

                                <div className="flex-1 min-w-0 space-y-1">
                                  <div className="flex items-center gap-1.5 flex-wrap">
                                    <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-[#F2F2F2] dark:bg-[#1A1A1A] text-[#000000] dark:text-[#FFFFFF] font-medium">
                                      <MessageSquare size={10} /> {((task as any).mode === 'work' || task.outputFormat === 'website' || Boolean(task.websiteName)) ? 'Work' : 'Chat'}
                                    </span>
                                    {((Array.isArray(task.tags) && task.tags.length > 0)
                                      ? task.tags
                                      : typeof task.tags === 'string'
                                        ? JSON.parse(task.tags)
                                        : classifyTaskTags(task.prompt || task.title || '', (task as any).result)
                                    ).map((tag: string) => {
                                      const style = getTagStyle(tag);
                                      return (
                                        <span key={tag} className={cn("text-[9px] font-bold px-2 py-0.5 rounded-full border tracking-wide", style.badgeClass)}>
                                          {tag}
                                        </span>
                                      );
                                    })}
                                    <span className="text-[10px] text-[#777777] font-mono">
                                      {getRelativeTime(task.created_at)}
                                    </span>
                                  </div>
                                  <h4 className="font-semibold text-xs text-[#000000] dark:text-[#FFFFFF] line-clamp-1">
                                    {formatTitle(task)}
                                  </h4>
                                  <p className="text-[11px] text-[#777777] dark:text-[#888888] line-clamp-2 leading-relaxed">
                                    {task.prompt}
                                  </p>

                                  {activeSummary && (
                                    <div
                                      data-testid={`session-summary-${task.id}`}
                                      data-no-swipe
                                      onClick={(e) => e.stopPropagation()}
                                      className="mt-1.5 p-2 rounded-lg bg-[#FAFAFA] dark:bg-[#1A1A1A] border border-[#E0E0E0] dark:border-[#262626] text-[11px] text-[#000000] dark:text-[#FFFFFF] leading-relaxed"
                                    >
                                      <div className="flex items-center justify-between gap-2 mb-1">
                                        <button
                                          type="button"
                                          data-size="icon"
                                          onClick={(e) => handleToggleCollapseSummary(task.id, e)}
                                          className="inline-flex items-center gap-1 text-[10px] font-semibold text-[#000000] dark:text-[#FFFFFF] hover:underline cursor-pointer"
                                          title={collapsedSummaryIds[task.id] ? 'Show summary' : 'Hide summary'}
                                        >
                                          <Sparkles size={11} className="shrink-0" />
                                          <span>AI Summary</span>
                                          <span className="text-[9px] text-[#777777] font-normal">
                                            ({collapsedSummaryIds[task.id] ? 'Expand' : 'Hide'})
                                          </span>
                                        </button>
                                        <div className="flex items-center gap-1">
                                          <button
                                            type="button"
                                            data-size="icon"
                                            data-testid={`copy-summary-btn-${task.id}`}
                                            onClick={(e) => handleCopySessionSummary(task.id, activeSummary, e)}
                                            className="p-1 rounded-md text-[#777777] hover:text-[#000000] dark:hover:text-[#FFFFFF] transition-colors cursor-pointer"
                                            title="Copy summary"
                                            aria-label="Copy summary"
                                          >
                                            {copiedSummaryId === task.id ? (
                                              <Check size={11} />
                                            ) : (
                                              <Copy size={11} />
                                            )}
                                          </button>
                                          <button
                                            type="button"
                                            data-size="icon"
                                            data-testid={`clear-summary-btn-${task.id}`}
                                            onClick={(e) => handleClearSessionSummary(task.id, e)}
                                            className="p-1 rounded-md text-[#777777] hover:text-[#000000] dark:hover:text-[#FFFFFF] transition-colors cursor-pointer"
                                            title="Clear summary"
                                            aria-label="Clear summary"
                                          >
                                            <X size={11} />
                                          </button>
                                        </div>
                                      </div>
                                      {!collapsedSummaryIds[task.id] && (
                                        <p className="text-[11px] text-[#333333] dark:text-[#CCCCCC] leading-relaxed">
                                          {activeSummary}
                                        </p>
                                      )}
                                    </div>
                                  )}

                                  {searchQuery.trim() && task.content && !formatTitle(task).toLowerCase().includes(searchQuery.toLowerCase().trim()) && !task.prompt?.toLowerCase().includes(searchQuery.toLowerCase().trim()) && (
                                    <div className="text-[10px] text-[#000000] dark:text-[#FFFFFF] bg-[#F2F2F2] dark:bg-[#1A1A1A] border border-[#E0E0E0] dark:border-[#262626] rounded-lg px-2 py-0.5 line-clamp-1 font-mono">
                                      <span className="font-semibold">Match in content:</span> "{getContentSnippet(task.content, searchQuery)}"
                                    </div>
                                  )}
                                </div>

                                {/* Session Actions: Generate Summary & Delete */}
                                {!isSelectionMode && (
                                  <div className="flex items-center gap-1 shrink-0" data-no-swipe>
                                    <button
                                      type="button"
                                      data-size="icon"
                                      data-testid={`generate-summary-btn-${task.id}`}
                                      data-action="generate-summary"
                                      disabled={isSummarizing}
                                      onClick={(e) => handleGenerateSessionSummary(task, e)}
                                      className={cn(
                                        "inline-flex items-center gap-1 h-7 px-2 rounded-lg border text-[10px] font-semibold transition-all cursor-pointer disabled:opacity-60 disabled:cursor-wait",
                                        activeSummary
                                          ? "bg-[#F2F2F2] dark:bg-[#1A1A1A] border-[#000000] dark:border-[#FFFFFF] text-[#000000] dark:text-[#FFFFFF]"
                                          : "bg-[#FFFFFF] dark:bg-[#1A1A1A] border-[#E0E0E0] dark:border-[#262626] text-[#000000] dark:text-[#FFFFFF] hover:border-[#000000] dark:hover:border-[#FFFFFF]"
                                      )}
                                      title="Generate a one-sentence AI summary of this session"
                                      aria-label="Generate Summary"
                                    >
                                      {isSummarizing ? (
                                        <>
                                          <Loader2 size={11} className="animate-spin shrink-0" />
                                          <span className="hidden sm:inline">Summarizing...</span>
                                        </>
                                      ) : (
                                        <>
                                          <Sparkles size={11} className="shrink-0" />
                                          <span className="hidden sm:inline">Generate Summary</span>
                                        </>
                                      )}
                                    </button>

                                    <button
                                      type="button"
                                      data-size="icon"
                                      onClick={(e) => handleDeleteTask(task.id, e, formatTitle(task))}
                                      className="p-1.5 rounded-lg text-[#777777] hover:text-[#000000] dark:hover:text-[#FFFFFF] hover:bg-[#F2F2F2] dark:hover:bg-[#1A1A1A] transition-colors cursor-pointer"
                                      title="Delete session"
                                    >
                                      <Trash2 size={13} />
                                    </button>
                                  </div>
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
              className="relative max-w-2xl w-full bg-[#FFFFFF] dark:bg-[#111111] rounded-2xl overflow-hidden border border-[#E0E0E0] dark:border-[#262626] shadow-2xl p-4 space-y-3"
            >
              <div className="flex items-center justify-between border-b border-[#E0E0E0] dark:border-[#262626] pb-2">
                <h3 className="font-bold text-sm text-[#000000] dark:text-[#FFFFFF] truncate">{previewMedia.name}</h3>
                <button
                  type="button"
                  data-size="icon"
                  onClick={() => setPreviewMedia(null)}
                  className="p-1 rounded-lg hover:bg-[#F2F2F2] dark:hover:bg-[#1A1A1A] text-[#777777]"
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

              <div className="flex items-center justify-between text-xs text-[#777777] pt-1">
                <span>{previewMedia.description || previewMedia.source}</span>
                <button
                  type="button"
                  data-size="icon"
                  onClick={() => handleDownloadFile(previewMedia)}
                  className="flex items-center gap-1.5 h-8 px-3.5 rounded-xl bg-[#000000] dark:bg-[#FFFFFF] text-[#FFFFFF] dark:text-[#000000] text-xs font-semibold hover:opacity-90 transition-opacity cursor-pointer"
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
              <div className="w-11 h-11 rounded-2xl flex items-center justify-center mb-2 mx-auto sm:mx-0 bg-[#F2F2F2] dark:bg-[#1A1A1A] text-[#000000] dark:text-[#FFFFFF]">
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
                className="rounded-xl text-xs bg-[#000000] dark:bg-[#FFFFFF] text-[#FFFFFF] dark:text-[#000000] hover:opacity-90 cursor-pointer font-semibold"
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
              <div className="w-11 h-11 rounded-2xl flex items-center justify-center mb-2 mx-auto sm:mx-0 bg-[#F2F2F2] dark:bg-[#1A1A1A] text-[#000000] dark:text-[#FFFFFF]">
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
                className="rounded-xl text-xs bg-[#000000] dark:bg-[#FFFFFF] text-[#FFFFFF] dark:text-[#000000] hover:opacity-90 cursor-pointer font-semibold flex items-center gap-1.5"
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

        {/* Full D3 Tag Analytics Modal */}
        {isTagAnalyticsOpen && (
          <React.Suspense fallback={null}>
            <TagAnalyticsModal
              isOpen={isTagAnalyticsOpen}
              onClose={() => setIsTagAnalyticsOpen(false)}
            />
          </React.Suspense>
        )}
      </SheetContent>
    </Sheet>
  );
}
