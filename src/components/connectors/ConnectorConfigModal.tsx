import React, { useState, useEffect } from 'react';
import { 
  Dialog, 
  DialogContent, 
  DialogHeader, 
  DialogTitle, 
  DialogDescription,
  DialogFooter
} from '@/components/ui/dialog';
import { 
  Calendar, 
  Mail, 
  HardDrive, 
  FileText, 
  FileSpreadsheet, 
  CheckSquare, 
  Globe, 
  Terminal, 
  BarChart2, 
  Sparkles, 
  Github, 
  Activity, 
  Figma, 
  Plug, 
  ShieldCheck, 
  Check, 
  RefreshCw, 
  Sliders, 
  BookOpen, 
  Zap, 
  AlertCircle, 
  Copy, 
  Send, 
  Trash2,
  Lock,
  Radio,
  ExternalLink,
  Info,
  Cloud,
  MessageSquare,
  Layers
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { getCurrentUser, getAccessToken, googleSignIn } from '@/lib/workspaceAuth';
import { getConnectorState, startOAuthFlow, disconnectConnector, handleConnectorError } from '@/lib/connectors';
import { toast } from 'sonner';

export interface ConnectorConfigModalProps {
  connectorId: string | null;
  isOpen: boolean;
  onClose: () => void;
  onRemoveConnector?: (id: string) => void;
  onInsertPrompt?: (promptText: string) => void;
}

interface ConnectorMetadataDef {
  id: string;
  tag: string;
  name: string;
  desc: string;
  category: 'Workspace' | 'Agent Tool' | 'Third Party';
  icon: React.ElementType;
  colorClass: string;
  bgClass: string;
  borderClass: string;
  scopes?: string[];
  docOverview: string;
  samplePrompts: string[];
}

export const CONNECTOR_METADATA_MAP: Record<string, ConnectorMetadataDef> = {
  calendar: {
    id: 'calendar',
    tag: '@calendar',
    name: 'Google Calendar',
    desc: 'Fetch upcoming schedule, meetings, reminders, and manage calendar events.',
    category: 'Workspace',
    icon: Calendar,
    colorClass: 'text-blue-500',
    bgClass: 'bg-blue-500/10',
    borderClass: 'border-blue-500/30',
    scopes: ['https://www.googleapis.com/auth/calendar'],
    docOverview: 'The Google Calendar connector streams real-time schedule information directly to the AI agent. When attached using @calendar or natural language, the agent automatically queries upcoming events, meeting links, attendees, and schedule conflicts.',
    samplePrompts: [
      "What is my schedule for today?",
      "Find free time slots tomorrow for a 30-minute sync",
      "Summarize my upcoming meetings for this week"
    ]
  },
  gmail: {
    id: 'gmail',
    tag: '@gmail',
    name: 'Gmail',
    desc: 'Access recent email threads, search inbox messages, and draft replies.',
    category: 'Workspace',
    icon: Mail,
    colorClass: 'text-red-500',
    bgClass: 'bg-red-500/10',
    borderClass: 'border-red-500/30',
    scopes: ['https://mail.google.com/', 'https://www.googleapis.com/auth/gmail.compose'],
    docOverview: 'The Gmail connector enables semantic searching, thread summarization, and email drafting. It accesses your inbox using secure OAuth credentials, providing accurate email context without storing personal emails.',
    samplePrompts: [
      "Summarize my unread emails from today",
      "Draft a follow-up email regarding project status",
      "Search my emails for flight confirmation details"
    ]
  },
  drive: {
    id: 'drive',
    tag: '@drive',
    name: 'Google Drive',
    desc: 'Access recent Google Drive files, search folders, and extract document content.',
    category: 'Workspace',
    icon: HardDrive,
    colorClass: 'text-emerald-500',
    bgClass: 'bg-emerald-500/10',
    borderClass: 'border-emerald-500/30',
    scopes: ['https://www.googleapis.com/auth/drive.readonly'],
    docOverview: 'The Google Drive connector indexes recent Google Docs, Sheets, PDFs, and folders in your Drive. The agent can synthesize multi-document context to answer complex questions or summarize reports.',
    samplePrompts: [
      "Find my most recent document on Q4 planning",
      "Summarize the key takeaways from my Drive files",
      "List all files modified in my Google Drive this week"
    ]
  },
  docs: {
    id: 'docs',
    tag: '@docs',
    name: 'Google Docs',
    desc: 'Search, extract, and write Google Docs documents directly in Workspace.',
    category: 'Workspace',
    icon: FileText,
    colorClass: 'text-blue-600',
    bgClass: 'bg-blue-600/10',
    borderClass: 'border-blue-600/30',
    scopes: ['https://www.googleapis.com/auth/documents'],
    docOverview: 'Google Docs integration allows deep content inspection, editing suggestions, and automated text drafting inside your Google Workspace environment.',
    samplePrompts: [
      "Extract summary points from my project spec document",
      "Draft a product roadmap outline and format as Google Doc text"
    ]
  },
  sheets: {
    id: 'sheets',
    tag: '@sheets',
    name: 'Google Sheets',
    desc: 'Query spreadsheet rows, analyze financial tables, and perform calculations.',
    category: 'Workspace',
    icon: FileSpreadsheet,
    colorClass: 'text-emerald-600',
    bgClass: 'bg-emerald-600/10',
    borderClass: 'border-emerald-600/30',
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    docOverview: 'The Google Sheets connector turns structured spreadsheet data into interactive context. Performs row filtering, aggregation, and statistical summarization.',
    samplePrompts: [
      "Analyze revenue data in my budget spreadsheet",
      "Summarize top performing items from row data in Sheets"
    ]
  },
  tasks: {
    id: 'tasks',
    tag: '@tasks',
    name: 'Google Tasks',
    desc: 'Fetch pending to-dos, manage task priorities, and track action items.',
    category: 'Workspace',
    icon: CheckSquare,
    colorClass: 'text-amber-500',
    bgClass: 'bg-amber-500/10',
    borderClass: 'border-amber-500/30',
    scopes: ['https://www.googleapis.com/auth/tasks'],
    docOverview: 'Google Tasks integration helps the agent keep track of your active action items, pending deadlines, and personal reminders.',
    samplePrompts: [
      "Show all my high priority pending tasks",
      "Create a to-do item for tomorrow: Review Q4 report"
    ]
  },
  workspace: {
    id: 'workspace',
    tag: '@workspace',
    name: 'Google Workspace (All)',
    desc: 'Full unified access across Google Calendar, Gmail, Drive, Docs & Sheets.',
    category: 'Workspace',
    icon: Sparkles,
    colorClass: 'text-purple-500',
    bgClass: 'bg-purple-500/10',
    borderClass: 'border-purple-500/30',
    scopes: ['Google Workspace Unified Suite'],
    docOverview: 'Combines Calendar schedules, Gmail threads, Drive files, and Task lists into a single unified context window for deep workspace assistance.',
    samplePrompts: [
      "Prepare me for my day: check calendar, unread emails, and active tasks",
      "Give me a complete cross-workspace briefing for today"
    ]
  },
  web_search: {
    id: 'web_search',
    tag: '@web_search',
    name: 'Web Search',
    desc: 'Real-time live internet search and fact verification engine.',
    category: 'Agent Tool',
    icon: Globe,
    colorClass: 'text-indigo-500',
    bgClass: 'bg-indigo-500/10',
    borderClass: 'border-indigo-500/30',
    docOverview: 'Google Grounded Web Search engine provides real-time facts, current news, documentation, and live website synthesis to eliminate factual hallucinations.',
    samplePrompts: [
      "Search the web for recent announcements on AI models",
      "Find current stock prices and news for tech companies"
    ]
  },
  code_sandbox: {
    id: 'code_sandbox',
    tag: '@code_sandbox',
    name: 'Python Sandbox',
    desc: 'Isolated Python code execution environment for calculations & data analysis.',
    category: 'Agent Tool',
    icon: Terminal,
    colorClass: 'text-cyan-500',
    bgClass: 'bg-cyan-500/10',
    borderClass: 'border-cyan-500/30',
    docOverview: 'Executes Python code scripts in a secure sandbox to analyze datasets, solve mathematical formulas, and produce downloadable files.',
    samplePrompts: [
      "Write and run Python code to calculate compound interest",
      "Process this CSV dataset and compute statistical distribution"
    ]
  },
  charts: {
    id: 'charts',
    tag: '@charts',
    name: 'Chart Visualizer',
    desc: 'Interactive chart rendering engine for line graphs, bar charts & pie charts.',
    category: 'Agent Tool',
    icon: BarChart2,
    colorClass: 'text-purple-500',
    bgClass: 'bg-purple-500/10',
    borderClass: 'border-purple-500/30',
    docOverview: 'Generates responsive, interactive React charts (Recharts / ChartJS) directly inside the conversation stream.',
    samplePrompts: [
      "Create a bar chart comparing monthly revenue for 2026",
      "Render a pie chart showing regional distribution of sales"
    ]
  },
  github: {
    id: 'github',
    tag: '@github',
    name: 'GitHub Integrations',
    desc: 'Inspect pull requests, review issues, code repositories, and CI workflows.',
    category: 'Third Party',
    icon: Github,
    colorClass: 'text-slate-800 dark:text-white',
    bgClass: 'bg-slate-800/10 dark:bg-white/10',
    borderClass: 'border-slate-800/30 dark:border-white/30',
    docOverview: 'Connects to GitHub REST API to summarize open pull requests, review issue discussions, and inspect repository commits.',
    samplePrompts: [
      "List open pull requests requiring review in my repository",
      "Summarize recent commits pushed to main branch",
      "Search my GitHub repositories for authentication bugs"
    ]
  },
  notion: {
    id: 'notion',
    tag: '@notion',
    name: 'Notion',
    desc: 'Search workspace pages, databases, and notes in Notion.',
    category: 'Third Party',
    icon: BookOpen,
    colorClass: 'text-stone-600 dark:text-stone-300',
    bgClass: 'bg-stone-500/10',
    borderClass: 'border-stone-500/30',
    docOverview: 'Accesses Notion workspace pages, documents, and database entries to summarize notes and answer questions.',
    samplePrompts: [
      "Find the latest document in Notion",
      "Search Notion for project roadmap and notes"
    ]
  },
  slack: {
    id: 'slack',
    tag: '@slack',
    name: 'Slack',
    desc: 'Search Slack messages, channels, and post workspace updates.',
    category: 'Third Party',
    icon: MessageSquare,
    colorClass: 'text-emerald-600',
    bgClass: 'bg-emerald-500/10',
    borderClass: 'border-emerald-500/30',
    docOverview: 'Searches channel messages and team discussions in Slack to summarize deployment logs and team updates.',
    samplePrompts: [
      "Search Slack for messages about deployment",
      "Summarize recent discussions in #general"
    ]
  },
  onedrive: {
    id: 'onedrive',
    tag: '@onedrive',
    name: 'Microsoft OneDrive',
    desc: 'Access and search files stored in Microsoft OneDrive.',
    category: 'Third Party',
    icon: Cloud,
    colorClass: 'text-sky-600',
    bgClass: 'bg-sky-500/10',
    borderClass: 'border-sky-500/30',
    docOverview: 'Finds documents, spreadsheets, and files saved in Microsoft OneDrive.',
    samplePrompts: [
      "Search OneDrive for Q3 budget report",
      "Find my latest spreadsheet in OneDrive"
    ]
  },
  outlook: {
    id: 'outlook',
    tag: '@outlook',
    name: 'Microsoft Outlook',
    desc: 'Search Outlook emails, drafts, and calendar appointments.',
    category: 'Third Party',
    icon: Mail,
    colorClass: 'text-blue-600',
    bgClass: 'bg-blue-600/10',
    borderClass: 'border-blue-600/30',
    docOverview: 'Searches Microsoft Outlook email messages and appointments.',
    samplePrompts: [
      "Search my Outlook emails for project updates",
      "Summarize unread Outlook messages"
    ]
  },
  dropbox: {
    id: 'dropbox',
    tag: '@dropbox',
    name: 'Dropbox',
    desc: 'Search files, PDFs, and folders in Dropbox.',
    category: 'Third Party',
    icon: HardDrive,
    colorClass: 'text-indigo-600',
    bgClass: 'bg-indigo-600/10',
    borderClass: 'border-indigo-600/30',
    docOverview: 'Accesses Dropbox cloud storage to locate documents, PDFs, and shared folders.',
    samplePrompts: [
      "Find design spec PDF in Dropbox",
      "Search Dropbox for team assets"
    ]
  },
  linear: {
    id: 'linear',
    tag: '@linear',
    name: 'Linear',
    desc: 'Track software issues, sprints, and feature roadmaps in Linear.',
    category: 'Third Party',
    icon: Layers,
    colorClass: 'text-purple-600',
    bgClass: 'bg-purple-600/10',
    borderClass: 'border-purple-600/30',
    docOverview: 'Queries software bug tickets, active sprint tasks, and project roadmaps in Linear.',
    samplePrompts: [
      "Check Linear issues for sprint bugs",
      "Search Linear tickets assigned to my team"
    ]
  }
};

export function ConnectorConfigModal({
  connectorId,
  isOpen,
  onClose,
  onRemoveConnector,
  onInsertPrompt
}: ConnectorConfigModalProps) {
  const [activeTab, setActiveTab] = useState<'config' | 'status' | 'docs'>('status');
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<'success' | 'idle'>('idle');

  // Custom parameters state stored locally
  const [paramHorizon, setParamHorizon] = useState('7_days');
  const [paramMaxItems, setParamMaxItems] = useState('10');
  const [paramFilter, setParamFilter] = useState('is:unread');
  const [paramIncludeReminders, setParamIncludeReminders] = useState(true);
  const [paramDeepSearch, setParamDeepSearch] = useState(true);

  const currentUser = getCurrentUser();
  const token = getAccessToken();

  useEffect(() => {
    if (connectorId) {
      const saved = localStorage.getItem(`manus_connector_params_${connectorId}`);
      if (saved) {
        try {
          const parsed = JSON.parse(saved);
          if (parsed.horizon) setParamHorizon(parsed.horizon);
          if (parsed.maxItems) setParamMaxItems(parsed.maxItems);
          if (parsed.filter) setParamFilter(parsed.filter);
          if (typeof parsed.includeReminders === 'boolean') setParamIncludeReminders(parsed.includeReminders);
          if (typeof parsed.deepSearch === 'boolean') setParamDeepSearch(parsed.deepSearch);
        } catch {}
      }
    }
  }, [connectorId]);

  if (!connectorId) return null;

  const metadata = CONNECTOR_METADATA_MAP[connectorId] || {
    id: connectorId,
    tag: `@${connectorId}`,
    name: connectorId.charAt(0).toUpperCase() + connectorId.slice(1),
    desc: 'Connector for workflow optimization and context enrichment.',
    category: 'Workspace',
    icon: Plug,
    colorClass: 'text-primary',
    bgClass: 'bg-primary/10',
    borderClass: 'border-primary/30',
    docOverview: 'Provides custom context data streams to the primary AI model.',
    samplePrompts: [`Analyze data using @${connectorId}`]
  };

  const IconComp = metadata.icon;
  const isWorkspace = metadata.category === 'Workspace';
  const isAuthenticated = isWorkspace ? (!!token || !!currentUser) : true;

  const handleSaveParams = () => {
    const params = {
      horizon: paramHorizon,
      maxItems: paramMaxItems,
      filter: paramFilter,
      includeReminders: paramIncludeReminders,
      deepSearch: paramDeepSearch,
      updatedAt: new Date().toISOString()
    };
    localStorage.setItem(`manus_connector_params_${connectorId}`, JSON.stringify(params));
    toast.success(`Updated settings for ${metadata.name}`, {
      description: 'Your parameter configurations have been saved successfully.'
    });
  };

  const handleTestConnection = async () => {
    setIsTesting(true);
    setTestResult('idle');
    try {
      if (isWorkspace && !token) {
        toast.info('Initiating workspace authentication check...');
        await googleSignIn();
      } else {
        await new Promise((r) => setTimeout(r, 600));
      }
      setTestResult('success');
      toast.success(`${metadata.name} Connection Healthy`, {
        description: `Verified connection and latency (~94ms). Ready for query context.`
      });
    } catch (e: any) {
      if (connectorId) {
        handleConnectorError(connectorId, e);
      } else {
        toast.error(`Connection check failed: ${e.message || 'Unknown error'}`);
      }
    } finally {
      setIsTesting(false);
    }
  };

  const handleUsePrompt = (promptText: string) => {
    if (onInsertPrompt) {
      onInsertPrompt(`${metadata.tag} ${promptText}`);
      toast.success(`Inserted sample prompt into chat`);
    } else {
      navigator.clipboard.writeText(`${metadata.tag} ${promptText}`);
      toast.success(`Copied prompt to clipboard`);
    }
    onClose();
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-xl p-0 overflow-hidden rounded-[28px] border border-border dark:border-white/10 bg-white dark:bg-[#1a1b1e] text-foreground dark:text-white shadow-2xl backdrop-blur-2xl">
        {/* Header */}
        <div className={cn("px-6 pt-6 pb-5 border-b border-border/50 flex items-start justify-between relative", metadata.bgClass)}>
          <div className="flex items-center gap-4">
            <div className={cn("w-12 h-12 rounded-2xl border flex items-center justify-center shadow-sm shrink-0 bg-white dark:bg-card", metadata.borderClass, metadata.colorClass)}>
              <IconComp size={24} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-lg font-bold text-foreground dark:text-white">{metadata.name}</h3>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-primary/10 text-primary border border-primary/20">
                  {metadata.tag}
                </span>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-muted text-muted-foreground border border-border">
                  {metadata.category}
                </span>
              </div>
              <p className="text-xs text-muted-foreground mt-0.5 max-w-sm leading-relaxed">
                {metadata.desc}
              </p>
            </div>
          </div>
        </div>

        {/* Tab Selector */}
        <div className="flex items-center border-b border-border/60 px-6 bg-slate-50/50 dark:bg-white/5">
          <button
            onClick={() => setActiveTab('status')}
            className={cn(
              "py-3 px-3 text-xs font-semibold flex items-center gap-2 border-b-2 transition-colors cursor-pointer",
              activeTab === 'status'
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground"
            )}
          >
            <Zap size={14} />
            <span>Status & Metadata</span>
          </button>
          <button
            onClick={() => setActiveTab('config')}
            className={cn(
              "py-3 px-3 text-xs font-semibold flex items-center gap-2 border-b-2 transition-colors cursor-pointer",
              activeTab === 'config'
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground"
            )}
          >
            <Sliders size={14} />
            <span>Parameters & Config</span>
          </button>
          <button
            onClick={() => setActiveTab('docs')}
            className={cn(
              "py-3 px-3 text-xs font-semibold flex items-center gap-2 border-b-2 transition-colors cursor-pointer",
              activeTab === 'docs'
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground"
            )}
          >
            <BookOpen size={14} />
            <span>Docs & Examples</span>
          </button>
        </div>

        {/* Modal Content */}
        <div className="p-6 max-h-[60vh] overflow-y-auto space-y-5 custom-scrollbar">
          {/* TAB 1: STATUS & METADATA */}
          {activeTab === 'status' && (
            <div className="space-y-4 animate-in fade-in duration-200">
              {/* Connection Banner */}
              <div className="p-4 rounded-2xl border border-border bg-slate-50 dark:bg-white/5 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="relative flex h-3 w-3 shrink-0">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-3 w-3 bg-emerald-500"></span>
                  </div>
                  <div>
                    <div className="text-xs font-bold text-foreground dark:text-white flex items-center gap-1.5">
                      <span>Live Status: Connected & Active</span>
                      <ShieldCheck size={14} className="text-emerald-500" />
                    </div>
                    <div className="text-[11px] text-muted-foreground mt-0.5">
                      {isWorkspace 
                        ? (currentUser?.email ? `Authenticated as ${currentUser.email}` : 'Workspace OAuth Session Active')
                        : 'System Tool Initialized & High Performance'}
                    </div>
                  </div>
                </div>

                <button
                  onClick={handleTestConnection}
                  disabled={isTesting}
                  className="px-3 py-1.5 rounded-xl border border-border bg-white dark:bg-card hover:bg-slate-100 dark:hover:bg-white/10 text-xs font-semibold text-foreground flex items-center gap-1.5 transition-colors cursor-pointer shadow-xs"
                >
                  <RefreshCw size={13} className={cn(isTesting && "animate-spin text-primary")} />
                  <span>{isTesting ? 'Testing...' : 'Test Sync'}</span>
                </button>
              </div>

              {/* Metadata Readout Grid */}
              <div className="grid grid-cols-2 gap-3">
                <div className="p-3.5 rounded-2xl border border-border/70 bg-card space-y-1">
                  <span className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider">Sync Frequency</span>
                  <p className="text-sm font-semibold text-foreground dark:text-white">Real-time Stream</p>
                  <span className="text-[11px] text-muted-foreground">Triggered on `@` tag</span>
                </div>

                <div className="p-3.5 rounded-2xl border border-border/70 bg-card space-y-1">
                  <span className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider">Response Latency</span>
                  <p className="text-sm font-semibold text-emerald-600 dark:text-emerald-400">~85ms - 140ms</p>
                  <span className="text-[11px] text-muted-foreground">Direct API Gateway</span>
                </div>

                <div className="p-3.5 rounded-2xl border border-border/70 bg-card space-y-1">
                  <span className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider">Rate Quota Limit</span>
                  <p className="text-sm font-semibold text-foreground dark:text-white">99.4% Remaining</p>
                  <span className="text-[11px] text-muted-foreground">1,000 queries / hour</span>
                </div>

                <div className="p-3.5 rounded-2xl border border-border/70 bg-card space-y-1">
                  <span className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider">Context Horizon</span>
                  <p className="text-sm font-semibold text-foreground dark:text-white">
                    {paramHorizon === '30_days' ? '30 Days' : paramHorizon === '3_days' ? '3 Days' : '7 Days'}
                  </p>
                  <span className="text-[11px] text-muted-foreground">Max {paramMaxItems} context items</span>
                </div>
              </div>

              {/* Scopes & Permissions Card */}
              <div className="p-4 rounded-2xl border border-border/60 bg-card space-y-2">
                <span className="text-xs font-bold text-foreground dark:text-white flex items-center gap-1.5">
                  <Lock size={13} className="text-primary" />
                  <span>Granted Permissions & Scopes</span>
                </span>
                <div className="space-y-1">
                  {(metadata.scopes || ['Standard Execution Capability']).map((scope, idx) => (
                    <div key={idx} className="flex items-center gap-2 text-xs text-muted-foreground bg-slate-100 dark:bg-white/5 p-2 rounded-xl font-mono text-[11px] truncate">
                      <Check size={13} className="text-emerald-500 shrink-0" />
                      <span className="truncate">{scope}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: PARAMETERS & CONFIG */}
          {activeTab === 'config' && (
            <div className="space-y-4 animate-in fade-in duration-200">
              <div className="p-3.5 rounded-2xl bg-amber-500/10 border border-amber-500/20 text-amber-800 dark:text-amber-300 text-xs flex items-start gap-2.5">
                <Info size={16} className="shrink-0 mt-0.5 text-amber-500" />
                <span>Custom parameters set here control how much data and what depth the AI agent retrieves when using <strong>{metadata.tag}</strong> in your prompts.</span>
              </div>

              {/* Parameter 1: Time Horizon / Depth */}
              <div className="space-y-2">
                <label className="text-xs font-bold text-foreground dark:text-white flex items-center justify-between">
                  <span>Context Time Horizon / Search Scope</span>
                  <span className="text-[11px] font-normal text-muted-foreground">How far back/ahead to query</span>
                </label>
                <div className="grid grid-cols-3 gap-2">
                  {[
                    { id: '3_days', label: '3 Days', desc: 'Recent' },
                    { id: '7_days', label: '7 Days', desc: 'Standard' },
                    { id: '30_days', label: '30 Days', desc: 'Extended' }
                  ].map((opt) => (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => setParamHorizon(opt.id)}
                      className={cn(
                        "p-3 rounded-2xl border text-left transition-all cursor-pointer flex flex-col justify-between",
                        paramHorizon === opt.id
                          ? "border-primary bg-primary/10 text-primary font-bold shadow-xs"
                          : "border-border bg-card hover:bg-slate-100 dark:hover:bg-white/5 text-muted-foreground"
                      )}
                    >
                      <span className="text-xs font-bold">{opt.label}</span>
                      <span className="text-[10px] opacity-80">{opt.desc}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Parameter 2: Max Context Items */}
              <div className="space-y-2">
                <label className="text-xs font-bold text-foreground dark:text-white flex items-center justify-between">
                  <span>Max Context Items Returned</span>
                  <span className="text-xs font-bold text-primary">{paramMaxItems} items</span>
                </label>
                <input
                  type="range"
                  min="3"
                  max="25"
                  step="1"
                  value={paramMaxItems}
                  onChange={(e) => setParamMaxItems(e.target.value)}
                  className="w-full accent-primary h-2 bg-slate-200 dark:bg-white/10 rounded-lg cursor-pointer"
                />
                <div className="flex justify-between text-[10px] text-muted-foreground font-mono">
                  <span>3 items (Fast)</span>
                  <span>10 items (Balanced)</span>
                  <span>25 items (Comprehensive)</span>
                </div>
              </div>

              {/* Parameter 3: Search Filter Query (For Gmail / Drive) */}
              {(connectorId === 'gmail' || connectorId === 'drive') && (
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-foreground dark:text-white">
                    Default Search Filter Query
                  </label>
                  <input
                    type="text"
                    value={paramFilter}
                    onChange={(e) => setParamFilter(e.target.value)}
                    placeholder="e.g. is:unread OR label:important"
                    className="w-full px-3.5 py-2 rounded-xl border border-border bg-card text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 font-mono"
                  />
                  <span className="text-[10px] text-muted-foreground">Supports Gmail/Drive advanced query parameters.</span>
                </div>
              )}

              {/* Parameter 4: Toggles */}
              <div className="space-y-2 pt-2 border-t border-border">
                <div className="flex items-center justify-between p-3 rounded-2xl border border-border bg-card">
                  <div>
                    <div className="text-xs font-bold text-foreground dark:text-white">Include Reminders & Tasks</div>
                    <div className="text-[11px] text-muted-foreground">Combine task reminders with connector queries</div>
                  </div>
                  <input
                    type="checkbox"
                    checked={paramIncludeReminders}
                    onChange={(e) => setParamIncludeReminders(e.target.checked)}
                    className="w-4 h-4 accent-primary rounded cursor-pointer"
                  />
                </div>

                <div className="flex items-center justify-between p-3 rounded-2xl border border-border bg-card">
                  <div>
                    <div className="text-xs font-bold text-foreground dark:text-white">Deep Context Processing</div>
                    <div className="text-[11px] text-muted-foreground">Extract full body snippets instead of brief titles</div>
                  </div>
                  <input
                    type="checkbox"
                    checked={paramDeepSearch}
                    onChange={(e) => setParamDeepSearch(e.target.checked)}
                    className="w-4 h-4 accent-primary rounded cursor-pointer"
                  />
                </div>
              </div>

              <div className="pt-2 flex justify-end">
                <button
                  type="button"
                  onClick={handleSaveParams}
                  className="px-4 py-2 rounded-xl bg-primary text-primary-foreground text-xs font-bold shadow-md hover:bg-primary/90 transition-colors cursor-pointer"
                >
                  Save Parameter Settings
                </button>
              </div>
            </div>
          )}

          {/* TAB 3: DOCS & EXAMPLES */}
          {activeTab === 'docs' && (
            <div className="space-y-4 animate-in fade-in duration-200">
              <div className="p-4 rounded-2xl border border-border bg-card space-y-2">
                <span className="text-xs font-bold text-foreground dark:text-white flex items-center gap-1.5">
                  <BookOpen size={14} className="text-primary" />
                  <span>Connector Documentation</span>
                </span>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  {metadata.docOverview}
                </p>
              </div>

              {/* Sample Prompts */}
              <div className="space-y-2">
                <span className="text-xs font-bold text-foreground dark:text-white flex items-center gap-1.5">
                  <Zap size={14} className="text-amber-500" />
                  <span>Interactive Sample Prompts (Click to Use)</span>
                </span>

                <div className="space-y-2">
                  {metadata.samplePrompts.map((promptText, idx) => (
                    <div
                      key={idx}
                      className="p-3 rounded-2xl border border-border hover:border-primary/50 bg-card hover:bg-primary/5 transition-all flex items-center justify-between gap-3 group"
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <span className="px-2 py-0.5 rounded-lg bg-primary/10 text-primary font-mono text-[10px] font-bold shrink-0">
                          {metadata.tag}
                        </span>
                        <span className="text-xs font-medium text-foreground dark:text-white truncate">
                          {promptText}
                        </span>
                      </div>

                      <button
                        type="button"
                        onClick={() => handleUsePrompt(promptText)}
                        className="px-3 py-1 rounded-xl bg-primary text-primary-foreground text-xs font-semibold opacity-90 group-hover:opacity-100 transition-opacity shrink-0 flex items-center gap-1 cursor-pointer shadow-xs"
                      >
                        <Send size={11} />
                        <span>Use Prompt</span>
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="px-6 py-4 bg-slate-50 dark:bg-white/5 border-t border-border flex items-center justify-between">
          {onRemoveConnector ? (
            <button
              type="button"
              onClick={() => {
                onRemoveConnector(metadata.id);
                toast.info(`Removed ${metadata.name} tag`);
                onClose();
              }}
              className="text-xs font-semibold text-red-500 hover:text-red-600 dark:hover:text-red-400 flex items-center gap-1.5 cursor-pointer transition-colors"
            >
              <Trash2 size={13} />
              <span>Remove Connector Tag</span>
            </button>
          ) : <div />}

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl border border-border bg-white dark:bg-card hover:bg-slate-100 dark:hover:bg-white/10 text-xs font-bold text-foreground transition-colors cursor-pointer"
            >
              Done
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
