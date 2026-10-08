import React, { useState, useEffect, useMemo } from 'react';
import { 
  History, 
  Clock, 
  Search, 
  Trash2, 
  ExternalLink, 
  Copy, 
  MessageSquare, 
  Mic, 
  Sparkles, 
  Filter, 
  X, 
  ChevronRight, 
  CheckCircle2, 
  AlertCircle, 
  Loader2, 
  Globe, 
  BarChart3, 
  FileText, 
  Layout, 
  Table as TableIcon,
  RotateCcw
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { blink } from '@/lib/blink';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription
} from '@/components/ui/sheet';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';

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

export function HistoryPanel({ isOpen, onClose, onSelectTask }: HistoryPanelProps) {
  const [tasks, setTasks] = useState<TaskHistoryItem[]>([]);
  const [voiceHistory, setVoiceHistory] = useState<VoiceHistoryRecord[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeTab, setActiveTab] = useState<'tasks' | 'voice'>('tasks');
  const [selectedFormatFilter, setSelectedFormatFilter] = useState<string>('all');
  const navigate = useNavigate();

  // Load history data whenever panel opens
  useEffect(() => {
    if (isOpen) {
      loadHistory();
    }
  }, [isOpen]);

  const loadHistory = async () => {
    setIsLoading(true);
    try {
      // 1. Fetch task sessions from blink.db
      const result = await (blink.db as any).tasks.list({
        orderBy: { created_at: 'desc' },
        limit: 100
      });
      setTasks(result || []);

      // 2. Fetch voice call records from localStorage
      const savedVoice = localStorage.getItem('manus_voice_history');
      if (savedVoice) {
        try {
          setVoiceHistory(JSON.parse(savedVoice));
        } catch {
          setVoiceHistory([]);
        }
      } else {
        setVoiceHistory([]);
      }
    } catch (error) {
      console.error('Failed to load history', error);
      toast.error('Failed to load past sessions');
    } finally {
      setIsLoading(false);
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

  const handleDeleteTask = async (taskId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await (blink.db as any).tasks.delete(taskId);
      setTasks(prev => prev.filter(t => t.id !== taskId));
      toast.success('Session removed from history');
    } catch (error) {
      toast.error('Failed to delete session');
    }
  };

  const handleClearAllTasks = async () => {
    if (!window.confirm('Are you sure you want to delete all task history? This action cannot be undone.')) {
      return;
    }

    const toastId = toast.loading('Clearing task history...');
    try {
      for (const t of tasks) {
        try {
          await (blink.db as any).tasks.delete(t.id);
        } catch {}
      }
      setTasks([]);
      toast.dismiss(toastId);
      toast.success('All task history cleared');
    } catch (e) {
      toast.dismiss(toastId);
      toast.error('Error clearing tasks');
    }
  };

  const handleClearVoiceHistory = () => {
    if (!window.confirm('Clear all voice call transcripts?')) return;
    localStorage.removeItem('manus_voice_history');
    setVoiceHistory([]);
    toast.success('Voice transcripts cleared');
  };

  const handleCopyPrompt = (text: string, e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(text);
    toast.success('Prompt copied to clipboard');
  };

  const handleCopyTaskId = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(id);
    toast.success('Task ID copied');
  };

  // Filtered task results
  const filteredTasks = useMemo(() => {
    return tasks.filter(task => {
      const q = searchQuery.toLowerCase().trim();
      const title = formatTitle(task).toLowerCase();
      const prompt = (task.prompt || '').toLowerCase();
      const id = (task.id || '').toLowerCase();
      const matchesSearch = !q || title.includes(q) || prompt.includes(q) || id.includes(q);

      if (!matchesSearch) return false;

      if (selectedFormatFilter === 'all') return true;
      if (selectedFormatFilter === 'website') return task.outputFormat === 'website';
      if (selectedFormatFilter === 'graph') return task.outputFormat === 'graph';
      if (selectedFormatFilter === 'report') return task.outputFormat === 'report';
      if (selectedFormatFilter === 'slides') return task.outputFormat === 'slides';
      return true;
    });
  }, [tasks, searchQuery, selectedFormatFilter]);

  // Filtered voice results
  const filteredVoice = useMemo(() => {
    if (!searchQuery.trim()) return voiceHistory;
    const q = searchQuery.toLowerCase().trim();
    return voiceHistory.filter(v => v.text.toLowerCase().includes(q));
  }, [voiceHistory, searchQuery]);

  const getFormatBadge = (task: TaskHistoryItem) => {
    const fmt = task.outputFormat || 'general';
    switch (fmt) {
      case 'website':
        return (
          <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 font-medium">
            <Globe size={11} /> Website
          </span>
        );
      case 'graph':
        return (
          <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-600 dark:text-blue-400 font-medium">
            <BarChart3 size={11} /> Chart / Data
          </span>
        );
      case 'report':
        return (
          <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-purple-500/10 text-purple-600 dark:text-purple-400 font-medium">
            <FileText size={11} /> Report
          </span>
        );
      case 'slides':
        return (
          <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-600 dark:text-amber-400 font-medium">
            <Layout size={11} /> Slides
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-slate-500/10 text-muted-foreground font-medium">
            <MessageSquare size={11} /> Chat
          </span>
        );
    }
  };

  return (
    <Sheet open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <SheetContent 
        side="right" 
        className="w-full sm:max-w-lg p-0 flex flex-col h-full bg-background border-l border-border shadow-2xl z-50 overflow-hidden"
      >
        {/* Header */}
        <div className="p-5 pb-3 border-b border-border bg-manus-soft dark:bg-card/40">
          <SheetHeader className="text-left space-y-1">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-xl bg-primary/10 text-primary flex items-center justify-center">
                  <History size={18} />
                </div>
                <div>
                  <SheetTitle className="text-base font-bold text-foreground">
                    Activity & History
                  </SheetTitle>
                  <SheetDescription className="text-xs text-muted-foreground">
                    Review past AI sessions, tasks, and voice calls
                  </SheetDescription>
                </div>
              </div>
            </div>
          </SheetHeader>

          {/* Quick Statistics Overview */}
          <div className="grid grid-cols-2 gap-2 mt-4">
            <div className="bg-white dark:bg-card border border-border rounded-xl p-2.5 flex items-center gap-3 shadow-xs">
              <div className="w-7 h-7 rounded-lg bg-blue-500/10 text-blue-600 dark:text-blue-400 flex items-center justify-center shrink-0">
                <MessageSquare size={14} />
              </div>
              <div className="min-w-0">
                <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-wider">Total Tasks</p>
                <p className="text-sm font-bold text-foreground">{tasks.length}</p>
              </div>
            </div>

            <div className="bg-white dark:bg-card border border-border rounded-xl p-2.5 flex items-center gap-3 shadow-xs">
              <div className="w-7 h-7 rounded-lg bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 flex items-center justify-center shrink-0">
                <Mic size={14} />
              </div>
              <div className="min-w-0">
                <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-wider">Voice Notes</p>
                <p className="text-sm font-bold text-foreground">{voiceHistory.length}</p>
              </div>
            </div>
          </div>

          {/* Search Box */}
          <div className="relative mt-3">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search history by keyword, title, or ID..."
              className="w-full pl-9 pr-8 py-2 bg-white dark:bg-card border border-border rounded-xl text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary shadow-xs"
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

        {/* Tabs & Filters */}
        <div className="flex-1 flex flex-col min-h-0">
          <Tabs 
            value={activeTab} 
            onValueChange={(val: any) => setActiveTab(val)} 
            className="flex-1 flex flex-col min-h-0"
          >
            <div className="px-5 pt-3 pb-2 flex items-center justify-between border-b border-border/60">
              <TabsList className="bg-manus-soft dark:bg-muted/50 p-0.5 rounded-lg h-8">
                <TabsTrigger value="tasks" className="text-xs px-3 py-1 font-medium data-[state=active]:bg-white dark:data-[state=active]:bg-card shadow-xs">
                  Tasks ({tasks.length})
                </TabsTrigger>
                <TabsTrigger value="voice" className="text-xs px-3 py-1 font-medium data-[state=active]:bg-white dark:data-[state=active]:bg-card shadow-xs">
                  Voice Transcripts ({voiceHistory.length})
                </TabsTrigger>
              </TabsList>

              {activeTab === 'tasks' && tasks.length > 0 && (
                <button
                  onClick={handleClearAllTasks}
                  className="text-[11px] text-muted-foreground hover:text-red-500 flex items-center gap-1 transition-colors px-2 py-1 rounded hover:bg-red-50 dark:hover:bg-red-950/30 cursor-pointer"
                  title="Clear all tasks"
                >
                  <Trash2 size={12} />
                  <span>Clear All</span>
                </button>
              )}

              {activeTab === 'voice' && voiceHistory.length > 0 && (
                <button
                  onClick={handleClearVoiceHistory}
                  className="text-[11px] text-muted-foreground hover:text-red-500 flex items-center gap-1 transition-colors px-2 py-1 rounded hover:bg-red-50 dark:hover:bg-red-950/30 cursor-pointer"
                  title="Clear voice transcripts"
                >
                  <Trash2 size={12} />
                  <span>Clear Voice</span>
                </button>
              )}
            </div>

            {/* Filter pills for tasks tab */}
            {activeTab === 'tasks' && (
              <div className="flex items-center gap-1.5 px-5 py-2 overflow-x-auto custom-scrollbar border-b border-border/40 shrink-0">
                {[
                  { id: 'all', label: 'All Formats' },
                  { id: 'website', label: 'Websites' },
                  { id: 'graph', label: 'Charts' },
                  { id: 'report', label: 'Reports' },
                  { id: 'slides', label: 'Slides' }
                ].map(pill => (
                  <button
                    key={pill.id}
                    onClick={() => setSelectedFormatFilter(pill.id)}
                    className={cn(
                      "px-2.5 py-1 rounded-lg text-[11px] font-medium transition-all whitespace-nowrap cursor-pointer",
                      selectedFormatFilter === pill.id
                        ? "bg-primary text-primary-foreground shadow-xs"
                        : "bg-manus-soft dark:bg-muted/40 text-muted-foreground hover:text-foreground hover:bg-manus-cream dark:hover:bg-muted"
                    )}
                  >
                    {pill.label}
                  </button>
                ))}
              </div>
            )}

            {/* Tab 1: Task Sessions */}
            <TabsContent value="tasks" className="flex-1 overflow-y-auto p-4 space-y-2.5 custom-scrollbar m-0">
              {isLoading ? (
                <div className="flex flex-col items-center justify-center h-48 text-muted-foreground space-y-2">
                  <Loader2 size={24} className="animate-spin text-primary" />
                  <p className="text-xs">Loading task sessions...</p>
                </div>
              ) : filteredTasks.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-56 text-center px-4 space-y-3">
                  <div className="w-12 h-12 rounded-2xl bg-muted/60 text-muted-foreground flex items-center justify-center">
                    <Clock size={20} />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-foreground">
                      {searchQuery ? 'No matching sessions found' : 'No task history yet'}
                    </p>
                    <p className="text-xs text-muted-foreground max-w-xs mt-1">
                      {searchQuery 
                        ? `Try adjusting your search query "${searchQuery}"`
                        : 'Your research queries, chart analyses, and website builds will be preserved here.'}
                    </p>
                  </div>
                </div>
              ) : (
                filteredTasks.map((task) => {
                  const title = formatTitle(task);
                  const relTime = getRelativeTime(task.created_at);

                  return (
                    <div
                      key={task.id}
                      onClick={() => handleOpenTask(task.id)}
                      className="group relative p-3.5 rounded-2xl border border-border bg-white dark:bg-card hover:border-primary/50 hover:shadow-md transition-all cursor-pointer"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex-1 min-w-0 space-y-1.5">
                          <div className="flex items-center gap-2 flex-wrap">
                            {getFormatBadge(task)}
                            <span className="text-[11px] text-muted-foreground flex items-center gap-1 font-mono">
                              <Clock size={11} /> {relTime}
                            </span>
                          </div>

                          <h4 className="font-semibold text-sm text-foreground group-hover:text-primary transition-colors line-clamp-1">
                            {title}
                          </h4>

                          <p className="text-xs text-muted-foreground line-clamp-2 leading-relaxed">
                            {task.prompt}
                          </p>

                          <div className="flex items-center gap-2 pt-1 text-[10px] text-muted-foreground font-mono">
                            <span>ID: {task.id.slice(0, 10)}...</span>
                          </div>
                        </div>

                        {/* Quick Action Icons */}
                        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                          <button
                            onClick={(e) => handleCopyPrompt(task.prompt, e)}
                            className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-manus-soft dark:hover:bg-accent transition-colors"
                            title="Copy Prompt"
                          >
                            <Copy size={13} />
                          </button>

                          <button
                            onClick={(e) => handleCopyTaskId(task.id, e)}
                            className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-manus-soft dark:hover:bg-accent transition-colors"
                            title="Copy Task ID"
                          >
                            <ExternalLink size={13} />
                          </button>

                          <button
                            onClick={(e) => handleDeleteTask(task.id, e)}
                            className="p-1.5 rounded-lg text-muted-foreground hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors"
                            title="Delete Session"
                          >
                            <Trash2 size={13} />
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </TabsContent>

            {/* Tab 2: Voice Transcripts */}
            <TabsContent value="voice" className="flex-1 overflow-y-auto p-4 space-y-2.5 custom-scrollbar m-0">
              {filteredVoice.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-56 text-center px-4 space-y-3">
                  <div className="w-12 h-12 rounded-2xl bg-muted/60 text-muted-foreground flex items-center justify-center">
                    <Mic size={20} />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-foreground">
                      {searchQuery ? 'No voice notes found' : 'No voice notes recorded yet'}
                    </p>
                    <p className="text-xs text-muted-foreground max-w-xs mt-1">
                      Start a voice call using the plus menu to record and save spoken conversations.
                    </p>
                  </div>
                </div>
              ) : (
                filteredVoice.map((item) => (
                  <div
                    key={item.id}
                    className="p-3.5 rounded-2xl border border-border bg-white dark:bg-card hover:border-indigo-500/50 hover:shadow-xs transition-all space-y-1.5"
                  >
                    <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                      <div className="flex items-center gap-1.5 font-medium text-indigo-600 dark:text-indigo-400">
                        <Mic size={12} />
                        <span>Spoken Transcript</span>
                      </div>
                      <span className="font-mono">{item.time} • {item.date}</span>
                    </div>

                    <p className="text-xs text-foreground font-medium leading-relaxed">
                      "{item.text}"
                    </p>

                    <div className="flex items-center justify-end gap-2 pt-1">
                      <button
                        onClick={() => {
                          navigator.clipboard.writeText(item.text);
                          toast.success('Transcript copied');
                        }}
                        className="text-[11px] text-muted-foreground hover:text-foreground flex items-center gap-1 transition-colors px-2 py-0.5 rounded hover:bg-muted"
                      >
                        <Copy size={11} /> Copy
                      </button>
                    </div>
                  </div>
                ))
              )}
            </TabsContent>
          </Tabs>
        </div>
      </SheetContent>
    </Sheet>
  );
}
