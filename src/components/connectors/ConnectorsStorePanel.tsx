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
  Plug, 
  Mail, 
  Calendar, 
  HardDrive, 
  FileText, 
  FileSpreadsheet, 
  CheckSquare, 
  Globe, 
  Terminal, 
  BarChart2, 
  Sparkles, 
  Brain, 
  Check, 
  Lock, 
  Unlock, 
  Plus, 
  ArrowLeft, 
  Github, 
  Activity, 
  Figma, 
  ExternalLink,
  ShieldCheck,
  RefreshCw,
  LogOut,
  Layers
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { googleSignIn, logoutWorkspace, getAccessToken, getCurrentUser } from '@/lib/workspaceAuth';
import { toast } from 'sonner';

export interface ConnectorItem {
  id: string;
  name: string;
  desc: string;
  category: 'workspace' | 'agent' | 'third_party';
  icon: React.ElementType;
  iconBg: string;
  isWorkspaceAuth?: boolean;
  requiresAuth?: boolean;
  defaultEnabled?: boolean;
}

export const CONNECTOR_CATALOG: ConnectorItem[] = [
  {
    id: 'gmail',
    name: 'Gmail',
    desc: 'Read, search, and generate email drafts directly from Gmail',
    category: 'workspace',
    icon: Mail,
    iconBg: 'bg-red-500/10 text-red-500',
    isWorkspaceAuth: true,
  },
  {
    id: 'calendar',
    name: 'Google Calendar',
    desc: 'Fetch schedule, upcoming events, and create calendar meetings',
    category: 'workspace',
    icon: Calendar,
    iconBg: 'bg-blue-500/10 text-blue-500',
    isWorkspaceAuth: true,
  },
  {
    id: 'drive',
    name: 'Google Drive',
    desc: 'Access, search, and attach files from Google Drive',
    category: 'workspace',
    icon: HardDrive,
    iconBg: 'bg-emerald-500/10 text-emerald-500',
    isWorkspaceAuth: true,
  },
  {
    id: 'docs',
    name: 'Google Docs',
    desc: 'Query written documents and generate Google Docs content',
    category: 'workspace',
    icon: FileText,
    iconBg: 'bg-blue-600/10 text-blue-600',
    isWorkspaceAuth: true,
  },
  {
    id: 'sheets',
    name: 'Google Sheets',
    desc: 'Analyze spreadsheets, rows, tables, and data files',
    category: 'workspace',
    icon: FileSpreadsheet,
    iconBg: 'bg-emerald-600/10 text-emerald-600',
    isWorkspaceAuth: true,
  },
  {
    id: 'tasks',
    name: 'Google Tasks',
    desc: 'Manage pending to-dos and sync active task lists',
    category: 'workspace',
    icon: CheckSquare,
    iconBg: 'bg-amber-500/10 text-amber-500',
    isWorkspaceAuth: true,
  },
  {
    id: 'web_search',
    name: 'Web Search',
    desc: 'Real-time live internet search & fact verification',
    category: 'agent',
    icon: Globe,
    iconBg: 'bg-indigo-500/10 text-indigo-500',
    defaultEnabled: true,
  },
  {
    id: 'code_sandbox',
    name: 'Python Sandbox',
    desc: 'Execute code scripts, process datasets, and generate output files',
    category: 'agent',
    icon: Terminal,
    iconBg: 'bg-cyan-500/10 text-cyan-500',
    defaultEnabled: true,
  },
  {
    id: 'charts',
    name: 'Chart Visualizer',
    desc: 'Render interactive graphs, charts, and data visualizers',
    category: 'agent',
    icon: BarChart2,
    iconBg: 'bg-purple-500/10 text-purple-500',
    defaultEnabled: true,
  },
  {
    id: 'deep_research',
    name: 'Deep Research',
    desc: 'Multi-source document synthesis & deep web research',
    category: 'agent',
    icon: Sparkles,
    iconBg: 'bg-amber-500/10 text-amber-500',
    defaultEnabled: false,
  },
  {
    id: 'github',
    name: 'GitHub Integrations',
    desc: 'Triage pull requests, issues, CI logs, and repository code',
    category: 'third_party',
    icon: Github,
    iconBg: 'bg-slate-800/10 dark:bg-white/10 text-slate-900 dark:text-white',
    requiresAuth: true,
  },
  {
    id: 'health',
    name: 'Health & Fitness',
    desc: 'Analyze health data, workout metrics, and activity logs',
    category: 'third_party',
    icon: Activity,
    iconBg: 'bg-rose-500/10 text-rose-500',
    requiresAuth: true,
  },
  {
    id: 'figma',
    name: 'Figma Canvas',
    desc: 'Inspect design files, components, and layout specs',
    category: 'third_party',
    icon: Figma,
    iconBg: 'bg-purple-600/10 text-purple-600',
    requiresAuth: true,
  }
];

interface ConnectorsStorePanelProps {
  isOpen: boolean;
  onClose: () => void;
  activeConnectors?: string[];
  onToggleConnector?: (id: string) => void;
}

export function ConnectorsStorePanel({
  isOpen,
  onClose,
  activeConnectors: propActiveConnectors,
  onToggleConnector: propOnToggle
}: ConnectorsStorePanelProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [isConnectingGoogle, setIsConnectingGoogle] = useState(false);
  const [workspaceConnected, setWorkspaceConnected] = useState(!!getAccessToken());
  const [userEmail, setUserEmail] = useState<string | null>(getCurrentUser()?.email || null);
  
  // Local state for enabled connectors
  const [enabledConnectors, setEnabledConnectors] = useState<string[]>(() => {
    const saved = localStorage.getItem('manus_enabled_connectors');
    if (saved) {
      try { return JSON.parse(saved); } catch {}
    }
    return propActiveConnectors || ['web_search', 'code_sandbox', 'charts', 'gmail', 'calendar', 'drive'];
  });

  useEffect(() => {
    const token = getAccessToken();
    const user = getCurrentUser();
    setWorkspaceConnected(!!token);
    setUserEmail(user?.email || null);
  }, [isOpen]);

  const toggleConnector = (id: string) => {
    let next: string[];
    if (enabledConnectors.includes(id)) {
      next = enabledConnectors.filter(c => c !== id);
      toast.info(`Disabled connector`);
    } else {
      next = [...enabledConnectors, id];
      toast.success(`Enabled connector`);
    }
    setEnabledConnectors(next);
    localStorage.setItem('manus_enabled_connectors', JSON.stringify(next));
    if (propOnToggle) propOnToggle(id);
    window.dispatchEvent(new CustomEvent('manus_connectors_updated', { detail: next }));
  };

  const handleConnectGoogleWorkspace = async () => {
    setIsConnectingGoogle(true);
    try {
      const res = await googleSignIn();
      if (res) {
        setWorkspaceConnected(true);
        setUserEmail(res.user.email);
        toast.success(`Google Workspace connected as ${res.user.email}`);
        
        // Auto enable Google connectors
        const workspaceIds = ['gmail', 'calendar', 'drive', 'docs', 'sheets', 'tasks'];
        const next = Array.from(new Set([...enabledConnectors, ...workspaceIds]));
        setEnabledConnectors(next);
        localStorage.setItem('manus_enabled_connectors', JSON.stringify(next));
        window.dispatchEvent(new CustomEvent('manus_connectors_updated', { detail: next }));
      }
    } catch (err: any) {
      toast.error('Failed to authenticate Google Workspace');
    } finally {
      setIsConnectingGoogle(false);
    }
  };

  const handleDisconnectGoogleWorkspace = async () => {
    await logoutWorkspace();
    setWorkspaceConnected(false);
    setUserEmail(null);
    toast.info('Disconnected from Google Workspace');
  };

  const filteredCatalog = CONNECTOR_CATALOG.filter(c => 
    c.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    c.desc.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl bg-card border-border/80 text-foreground p-0 overflow-hidden shadow-2xl rounded-3xl h-[85vh] flex flex-col">
        {/* Header */}
        <div className="p-5 border-b border-border/60 bg-muted/20 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <button 
              onClick={onClose}
              className="p-2 rounded-xl text-muted-foreground hover:text-foreground hover:bg-muted/80 transition-colors"
              title="Back"
            >
              <ArrowLeft size={18} />
            </button>
            <div>
              <DialogTitle className="text-lg font-bold flex items-center gap-2">
                <Plug className="text-primary" size={20} />
                <span>Connectors & Plugins</span>
              </DialogTitle>
              <DialogDescription className="text-xs text-muted-foreground">
                Connect Google Workspace, agent capabilities, and third-party tools
              </DialogDescription>
            </div>
          </div>

          {/* Google Connection Status Banner */}
          {workspaceConnected ? (
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-600 dark:text-emerald-400 text-xs font-medium">
              <ShieldCheck size={14} />
              <span className="truncate max-w-[130px] sm:max-w-[180px]">{userEmail || 'Google Connected'}</span>
              <button onClick={handleDisconnectGoogleWorkspace} className="p-1 hover:bg-emerald-500/20 rounded-md" title="Disconnect Google">
                <LogOut size={12} />
              </button>
            </div>
          ) : (
            <button
              onClick={handleConnectGoogleWorkspace}
              disabled={isConnectingGoogle}
              className="gsi-material-button inline-flex items-center gap-2 px-3.5 py-1.5 rounded-xl bg-foreground text-background font-semibold text-xs hover:opacity-90 transition-opacity cursor-pointer shadow-xs"
            >
              {isConnectingGoogle ? (
                <RefreshCw size={13} className="animate-spin" />
              ) : (
                <svg version="1.1" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" className="w-3.5 h-3.5">
                  <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"></path>
                  <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"></path>
                  <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"></path>
                  <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"></path>
                </svg>
              )}
              <span>Connect Google Workspace</span>
            </button>
          )}
        </div>

        {/* Scrollable Content */}
        <div className="flex-1 overflow-y-auto p-5 space-y-6 custom-scrollbar">
          {/* INSTALLED / ENABLED CONNECTORS ROW (Matches Reference Image 2) */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                <Layers size={13} className="text-primary" />
                <span>Active & Installed Connectors ({enabledConnectors.length})</span>
              </h3>
            </div>

            <div className="flex items-center gap-2.5 overflow-x-auto pb-2 pt-1 no-scrollbar">
              {enabledConnectors.map((id) => {
                const item = CONNECTOR_CATALOG.find(c => c.id === id);
                if (!item) return null;
                const Icon = item.icon;
                return (
                  <div
                    key={id}
                    onClick={() => toggleConnector(id)}
                    className="flex flex-col items-center gap-1.5 p-2 rounded-2xl border border-border/70 bg-muted/30 hover:bg-muted/70 transition-all cursor-pointer group shrink-0 w-20 text-center"
                    title={`Click to disable ${item.name}`}
                  >
                    <div className={cn("w-10 h-10 rounded-2xl flex items-center justify-center font-bold shadow-2xs group-hover:scale-105 transition-transform", item.iconBg)}>
                      <Icon size={18} />
                    </div>
                    <span className="text-[10px] font-semibold text-foreground truncate w-full">{item.name}</span>
                  </div>
                );
              })}
              <div className="flex flex-col items-center justify-center gap-1.5 p-2 rounded-2xl border border-dashed border-border bg-muted/10 w-20 h-20 shrink-0 text-muted-foreground text-center">
                <span className="text-xs font-bold font-mono">+{CONNECTOR_CATALOG.length - enabledConnectors.length}</span>
                <span className="text-[9px]">available</span>
              </div>
            </div>
          </div>

          {/* POPULAR CONNECTORS SECTION */}
          <div className="space-y-3">
            <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
              Popular Connectors & Integrations
            </h3>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {filteredCatalog.map((item) => {
                const isEnabled = enabledConnectors.includes(item.id);
                const Icon = item.icon;

                return (
                  <div
                    key={item.id}
                    className={cn(
                      "flex items-start justify-between p-3.5 rounded-2xl border transition-all",
                      isEnabled 
                        ? "border-primary/30 bg-primary/5 dark:bg-primary/10 shadow-xs" 
                        : "border-border/60 bg-muted/20 hover:bg-muted/50"
                    )}
                  >
                    <div className="flex items-start gap-3 min-w-0 pr-2">
                      <div className={cn("w-10 h-10 rounded-2xl flex items-center justify-center shrink-0 shadow-2xs mt-0.5", item.iconBg)}>
                        <Icon size={20} />
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          <h4 className="font-semibold text-sm text-foreground truncate">{item.name}</h4>
                          {item.isWorkspaceAuth && workspaceConnected && (
                            <span className="px-1.5 py-0.2 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 text-[9px] font-semibold border border-emerald-500/20">
                              Synced
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground leading-snug mt-0.5 line-clamp-2">{item.desc}</p>
                      </div>
                    </div>

                    <div className="shrink-0 pt-0.5">
                      {item.isWorkspaceAuth && !workspaceConnected ? (
                        <button
                          onClick={handleConnectGoogleWorkspace}
                          className="p-2 rounded-xl bg-muted border border-border text-muted-foreground hover:text-foreground hover:bg-muted/80 transition-colors cursor-pointer"
                          title="Connect Google Workspace to enable"
                        >
                          <Lock size={15} />
                        </button>
                      ) : (
                        <button
                          onClick={() => toggleConnector(item.id)}
                          className={cn(
                            "px-3 py-1.5 rounded-xl font-semibold text-xs flex items-center gap-1.5 transition-all cursor-pointer shadow-2xs",
                            isEnabled 
                              ? "bg-primary text-primary-foreground hover:opacity-90" 
                              : "bg-muted border border-border/80 text-foreground hover:bg-muted/80"
                          )}
                        >
                          {isEnabled ? (
                            <>
                              <Check size={13} strokeWidth={2.5} />
                              <span>Enabled</span>
                            </>
                          ) : (
                            <>
                              <Plus size={13} />
                              <span>Enable</span>
                            </>
                          )}
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Search Bar at Bottom (Matches Reference Image 2) */}
        <div className="p-4 border-t border-border/60 bg-muted/20 shrink-0">
          <div className="relative max-w-2xl mx-auto">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground" size={16} />
            <input
              type="text"
              placeholder="Search connectors, plugins, or workspace tools..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full text-xs pl-10 pr-4 py-3 bg-card border border-border/80 rounded-2xl text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/40 shadow-inner"
            />
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
