import React, { useState, useEffect } from 'react';
import { toast } from 'sonner';
import { GitHubRepositoryBrowser } from './GitHubRepositoryBrowser';
import { WorkspaceConnectButton } from '../workspace/WorkspaceConnectButton';
import { getSettings, saveSettings } from '@/lib/settingsStore';
import { getAccessToken } from '@/lib/workspaceAuth';
import { 
  X, 
  Plus, 
  Terminal, 
  Database, 
  FolderLock, 
  ShieldAlert, 
  RefreshCw, 
  Check, 
  ExternalLink,
  Trash2,
  Sliders,
  Sparkles
} from 'lucide-react';

export interface AndroidConnectorsSettingsProps {
  onBack?: () => void;
}

interface MCPServer {
  id: string;
  name: string;
  status: 'active' | 'configured' | 'disabled';
  tag?: string;
  details: string;
  icon: string;
  enabled: boolean;
}

const INITIAL_MCP_SERVERS: MCPServer[] = [
  {
    id: 'brave-search',
    name: 'Brave Search MCP',
    status: 'active',
    details: 'Enabled • 12 query tools active',
    icon: 'travel_explore',
    enabled: true
  },
  {
    id: 'postgres-db',
    name: 'PostgreSQL Local DB',
    status: 'configured',
    tag: 'Read-Only',
    details: 'unix:///var/run/mcp-postgres.sock',
    icon: 'database',
    enabled: true
  },
  {
    id: 'filesystem-sandbox',
    name: 'Filesystem Sandbox',
    status: 'configured',
    tag: 'Configured',
    details: 'Isolated runtime workspace: ~/manus-sandbox',
    icon: 'folder_special',
    enabled: true
  }
];

export function AndroidConnectorsSettings({ onBack }: AndroidConnectorsSettingsProps) {
  const isGoogleConnected = Boolean(getAccessToken());
  const [settings, setSettings] = useState(() => getSettings());
  
  // Cloud Integrations States
  const [googleSyncEnabled, setGoogleSyncEnabled] = useState(true);
  const [slackConnected, setSlackConnected] = useState(false);
  const [notionConnected, setNotionConnected] = useState(true);
  const [showGithubBrowser, setShowGithubBrowser] = useState(false);

  // MCP Servers
  const [mcpServers, setMcpServers] = useState<MCPServer[]>(() => {
    try {
      const saved = localStorage.getItem('manus_mcp_servers');
      return saved ? JSON.parse(saved) : INITIAL_MCP_SERVERS;
    } catch {
      return INITIAL_MCP_SERVERS;
    }
  });

  // Security policies
  const [confirmDestructive, setConfirmDestructive] = useState(() => {
    return localStorage.getItem('manus_confirm_destructive_actions') !== 'false';
  });
  const [oauthAutoRefresh, setOauthAutoRefresh] = useState(() => {
    return localStorage.getItem('manus_oauth_auto_refresh') !== 'false';
  });

  // Modals
  const [isAddMcpModalOpen, setIsAddMcpModalOpen] = useState(false);
  const [showRevokeConfirm, setShowRevokeConfirm] = useState(false);
  const [newMcpName, setNewMcpName] = useState('');
  const [newMcpUrl, setNewMcpUrl] = useState('');
  const [newMcpTransport, setNewMcpTransport] = useState<'stdio' | 'sse'>('stdio');

  // Save MCP servers on update
  useEffect(() => {
    try {
      localStorage.setItem('manus_mcp_servers', JSON.stringify(mcpServers));
    } catch {}
  }, [mcpServers]);

  const handleBack = () => {
    if (onBack) {
      onBack();
    } else {
      window.history.back();
    }
  };

  const handleToggleMcp = (id: string) => {
    setMcpServers(prev => prev.map(s => {
      if (s.id === id) {
        const nextState = !s.enabled;
        toast.success(`${s.name} ${nextState ? 'enabled' : 'disabled'}`);
        return {
          ...s,
          enabled: nextState,
          status: nextState ? 'active' : 'disabled'
        };
      }
      return s;
    }));
  };

  const handleAddMcpServer = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newMcpName.trim()) {
      toast.error('Please enter a server name');
      return;
    }
    const newServer: MCPServer = {
      id: `custom-mcp-${Date.now()}`,
      name: newMcpName.trim(),
      status: 'active',
      tag: newMcpTransport.toUpperCase(),
      details: newMcpUrl.trim() || 'stdio://local-process',
      icon: 'terminal',
      enabled: true
    };
    setMcpServers(prev => [...prev, newServer]);
    toast.success(`MCP Server "${newMcpName}" connected`);
    setNewMcpName('');
    setNewMcpUrl('');
    setIsAddMcpModalOpen(false);
  };

  const handleToggleDestructive = () => {
    const nextVal = !confirmDestructive;
    setConfirmDestructive(nextVal);
    localStorage.setItem('manus_confirm_destructive_actions', String(nextVal));
    toast.success(nextVal ? 'Destructive action prompts enabled' : 'Destructive action prompts relaxed');
  };

  const handleToggleOauthRefresh = () => {
    const nextVal = !oauthAutoRefresh;
    setOauthAutoRefresh(nextVal);
    localStorage.setItem('manus_oauth_auto_refresh', String(nextVal));
    toast.success(nextVal ? 'OAuth token background auto-refresh enabled' : 'Background auto-refresh disabled');
  };

  const handleRevokeAllAccess = () => {
    setMcpServers(prev => prev.map(s => ({ ...s, enabled: false, status: 'disabled' })));
    setSlackConnected(false);
    setNotionConnected(false);
    setShowRevokeConfirm(false);
    toast.success('All active integrations and tokens have been revoked');
  };

  const activeCount = 
    (googleSyncEnabled ? 1 : 0) +
    1 + // GitHub
    (notionConnected ? 1 : 0) +
    (slackConnected ? 1 : 0) +
    mcpServers.filter(s => s.enabled).length;

  return (
    <div className="fixed inset-0 z-50 bg-[#000000] text-[#FFFFFF] antialiased flex flex-col min-h-screen selection:bg-[#343538] selection:text-white font-sans overflow-hidden">
      
      {/* Top Android App Bar - Header extends to very top edge with pt-safe */}
      <header className="fixed top-0 inset-x-0 z-40 bg-[#000000]/85 backdrop-blur-xl pt-safe border-b border-[#333537]/40 shadow-[0_1px_12px_rgba(0,0,0,0.85)]">
        <div className="h-14 px-4 flex items-center justify-between">
          <div className="flex items-center gap-2 min-w-0 flex-1">
            <button 
              aria-label="Go back" 
              className="w-10 h-10 -ml-1 rounded-full flex items-center justify-center text-white active:bg-[#202225] transition-colors shrink-0 cursor-pointer" 
              onClick={handleBack} 
              type="button"
            >
              <span className="material-symbols-outlined text-[24px]">arrow_back</span>
            </button>
            <h1 className="text-lg font-semibold text-white tracking-tight truncate">
              Connectors &amp; Integrations
            </h1>
          </div>
          <div className="flex items-center space-x-1 shrink-0">
            <button 
              aria-label="More options" 
              onClick={() => toast.info('MCP Ecosystem v1.0 • 6 Protocols Active')}
              className="w-10 h-10 rounded-full flex items-center justify-center text-neutral-400 hover:text-white active:bg-[#202225] transition-colors cursor-pointer" 
              type="button"
            >
              <span className="material-symbols-outlined text-[22px]">more_vert</span>
            </button>
          </div>
        </div>
      </header>

      {/* Main Content Area - Extends right to app bar edge with safe area */}
      <main className="flex flex-col relative w-full px-4 pt-[calc(3.5rem+env(safe-area-inset-top,0px))] pb-12 bg-[#000000] flex-1 overflow-y-auto overscroll-contain custom-scrollbar">
        <div className="flex flex-col w-full pb-8 max-w-md mx-auto space-y-6 pt-2">
          
          {/* Introductory Banner */}
          <div className="relative overflow-hidden rounded-2xl bg-[#1E2020] border border-[#333535] p-4 shadow-lg">
            <div className="flex items-start gap-4">
              <div className="w-10 h-10 rounded-full bg-[#292A2A] border border-[#343535] flex items-center justify-center shrink-0 text-white">
                <span className="material-symbols-outlined text-[22px]">hub</span>
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-base font-semibold text-white">Tool Ecosystem</span>
                  <span className="px-2 py-0.5 rounded-full bg-[#343535] text-neutral-300 text-[11px] font-semibold tracking-wide">
                    {activeCount} ACTIVE
                  </span>
                </div>
                <p className="text-xs text-[#C4C7C8] leading-relaxed">
                  Connect external tools, databases, and Model Context Protocol (MCP) servers to expand Manus's real-time reasoning and execution scope.
                </p>
              </div>
            </div>
          </div>

          {/* SECTION 1: Active Cloud Integrations */}
          <div className="flex flex-col">
            <div className="flex items-center justify-between px-1 mb-2">
              <span className="text-[11px] uppercase tracking-widest font-semibold text-neutral-400">
                Active Cloud Integrations
              </span>
              <span className="text-[11px] text-neutral-500">4 Available</span>
            </div>

            <div className="bg-[#1E2020] border border-[#343535] rounded-2xl overflow-hidden flex flex-col shadow-md">
              {/* Row 1: GitHub */}
              <button 
                onClick={() => setShowGithubBrowser(true)}
                className="w-full flex items-center p-4 text-left hover:bg-[#252727] active:bg-[#292A2A] transition-colors cursor-pointer" 
                type="button"
              >
                <div className="w-10 h-10 rounded-full bg-[#292A2A] border border-[#343535] flex items-center justify-center shrink-0 text-white mr-3.5">
                  <span className="material-symbols-outlined text-[22px]">terminal</span>
                </div>
                <div className="flex-1 min-w-0 pr-2">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-white truncate">GitHub</span>
                    <span className="flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-black/60 border border-white/10">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
                      <span className="text-[11px] font-semibold text-white">Active</span>
                    </span>
                  </div>
                  <p className="text-xs text-neutral-400 truncate mt-0.5">
                    Connected to @manus-core • Read/Write repos, PRs
                  </p>
                </div>
                <span className="material-symbols-outlined text-neutral-400 text-[20px] shrink-0">chevron_right</span>
              </button>

              <div className="h-[1px] bg-[#292A2A] ml-[56px] mr-4"></div>

              {/* Row 2: Google Workspace */}
              <div className="flex items-center justify-between p-4">
                <div className="flex items-center min-w-0 mr-2">
                  <div className="w-10 h-10 rounded-full bg-[#292A2A] border border-[#343535] flex items-center justify-center shrink-0 text-white mr-3.5">
                    <span className="material-symbols-outlined text-[22px]">drafts</span>
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-white block truncate">Google Workspace</span>
                      {isGoogleConnected && (
                        <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-blue-500/10 text-blue-400 border border-blue-500/20 font-semibold">
                          Linked
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-neutral-400 truncate mt-0.5">Gmail, Drive &amp; Calendar sync</p>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <WorkspaceConnectButton />
                  <button 
                    aria-checked={googleSyncEnabled} 
                    className={`w-12 h-7 rounded-full p-0.5 transition-colors duration-200 flex items-center shrink-0 cursor-pointer ${
                      googleSyncEnabled ? 'bg-white justify-end' : 'bg-[#343535] justify-start'
                    }`} 
                    onClick={() => {
                      const next = !googleSyncEnabled;
                      setGoogleSyncEnabled(next);
                      toast.success(next ? 'Google Workspace context sync active' : 'Google Workspace context sync paused');
                    }} 
                    role="switch" 
                    type="button"
                  >
                    <div className={`w-6 h-6 rounded-full transition-transform duration-200 ${
                      googleSyncEnabled ? 'bg-black' : 'bg-neutral-400'
                    }`} />
                  </button>
                </div>
              </div>

              <div className="h-[1px] bg-[#292A2A] ml-[56px] mr-4"></div>

              {/* Row 3: Notion */}
              <button 
                onClick={() => {
                  toast.info('Notion integration synced (3 databases indexed)');
                }}
                className="w-full flex items-center p-4 text-left hover:bg-[#252727] active:bg-[#292A2A] transition-colors cursor-pointer" 
                type="button"
              >
                <div className="w-10 h-10 rounded-full bg-[#292A2A] border border-[#343535] flex items-center justify-center shrink-0 text-white mr-3.5">
                  <span className="material-symbols-outlined text-[22px]">description</span>
                </div>
                <div className="flex-1 min-w-0 pr-2">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-white truncate">Notion</span>
                    <span className="text-[11px] text-neutral-300 bg-[#343535] px-2 py-0.5 rounded-full shrink-0">
                      3 databases
                    </span>
                  </div>
                  <p className="text-xs text-neutral-400 truncate mt-0.5">Workspaces &amp; Knowledge Base indexing</p>
                </div>
                <span className="material-symbols-outlined text-neutral-400 text-[20px] shrink-0 ml-2">chevron_right</span>
              </button>

              <div className="h-[1px] bg-[#292A2A] ml-[56px] mr-4"></div>

              {/* Row 4: Slack */}
              <div className="flex items-center justify-between p-4">
                <div className="flex items-center min-w-0 mr-2">
                  <div className="w-10 h-10 rounded-full bg-[#292A2A] border border-[#343535] flex items-center justify-center shrink-0 text-neutral-300 mr-3.5">
                    <span className="material-symbols-outlined text-[22px]">forum</span>
                  </div>
                  <div className="min-w-0">
                    <span className="text-sm font-medium text-white block truncate">Slack</span>
                    <p className="text-xs text-neutral-400 truncate mt-0.5">
                      {slackConnected ? 'Connected to workspace #agent-broadcast' : 'Workspace Bot & updates'}
                    </p>
                  </div>
                </div>
                <button 
                  onClick={() => {
                    const next = !slackConnected;
                    setSlackConnected(next);
                    toast.success(next ? 'Slack workspace bot connected' : 'Slack disconnected');
                  }}
                  className={`px-3.5 py-1.5 rounded-full text-xs font-semibold active:scale-95 transition-all shrink-0 cursor-pointer ${
                    slackConnected 
                      ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30' 
                      : 'bg-[#292A2A] hover:bg-[#343535] text-white border border-[#343535]'
                  }`} 
                  type="button"
                >
                  {slackConnected ? 'Connected' : 'Connect'}
                </button>
              </div>
            </div>
          </div>

          {/* SECTION 2: Model Context Protocol (MCP) Servers */}
          <div className="flex flex-col">
            <div className="flex items-center justify-between px-1 mb-2">
              <div className="flex items-center gap-2">
                <span className="text-[11px] uppercase tracking-widest font-semibold text-neutral-400">
                  MCP Servers
                </span>
                <span className="px-1.5 py-0.5 rounded bg-[#292A2A] text-[10px] text-white tracking-tight font-mono border border-white/10">
                  v1.0
                </span>
              </div>
              <button 
                onClick={() => toast.info('MCP (Model Context Protocol) allows seamless interop between LLMs and local/remote tools.')}
                className="flex items-center text-neutral-400 hover:text-white transition-colors text-[11px] cursor-pointer" 
                type="button"
              >
                <span className="material-symbols-outlined text-[15px] mr-1">help_outline</span> Docs
              </button>
            </div>

            {/* MCP Card Group */}
            <div className="bg-[#1E2020] border border-[#343535] rounded-2xl overflow-hidden flex flex-col shadow-md">
              {mcpServers.map((server, idx) => (
                <React.Fragment key={server.id}>
                  {idx > 0 && <div className="h-[1px] bg-[#292A2A] ml-[56px] mr-4" />}
                  <div className="flex items-center justify-between p-4">
                    <div className="flex items-center min-w-0 mr-2">
                      <div className="w-10 h-10 rounded-full bg-[#292A2A] border border-[#343535] flex items-center justify-center shrink-0 text-white mr-3.5">
                        <span className="material-symbols-outlined text-[22px]">{server.icon}</span>
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium text-white truncate">{server.name}</span>
                          {server.tag && (
                            <span className="text-[10px] text-neutral-300 bg-[#343535] px-2 py-0.5 rounded-full shrink-0">
                              {server.tag}
                            </span>
                          )}
                          {server.enabled && !server.tag && (
                            <span className="w-2 h-2 rounded-full bg-emerald-400 shrink-0"></span>
                          )}
                        </div>
                        <p className="text-xs text-neutral-400 truncate mt-0.5">{server.details}</p>
                      </div>
                    </div>
                    <button 
                      aria-checked={server.enabled} 
                      className={`w-12 h-7 rounded-full p-0.5 transition-colors duration-200 flex items-center shrink-0 cursor-pointer ${
                        server.enabled ? 'bg-white justify-end' : 'bg-[#343535] justify-start'
                      }`} 
                      onClick={() => handleToggleMcp(server.id)} 
                      role="switch" 
                      type="button"
                    >
                      <div className={`w-6 h-6 rounded-full transition-transform duration-200 ${
                        server.enabled ? 'bg-black' : 'bg-neutral-400'
                      }`} />
                    </button>
                  </div>
                </React.Fragment>
              ))}
            </div>

            {/* Add Custom MCP Server Trigger */}
            <button 
              onClick={() => setIsAddMcpModalOpen(true)}
              className="mt-3 w-full py-3 px-4 rounded-xl bg-[#292A2A] hover:bg-[#343535] border border-[#343535] flex items-center justify-center gap-2 text-white text-sm font-semibold active:scale-[0.99] transition-all cursor-pointer shadow-sm" 
              type="button"
            >
              <span className="material-symbols-outlined text-[20px]">add_circle</span>
              <span>Add Custom MCP Server</span>
            </button>
          </div>

          {/* SECTION 3: Security & Execution Policies */}
          <div className="flex flex-col">
            <div className="px-1 mb-2">
              <span className="text-[11px] uppercase tracking-widest font-semibold text-neutral-400">
                Security &amp; Permissions
              </span>
            </div>

            <div className="bg-[#1E2020] border border-[#343535] rounded-2xl overflow-hidden flex flex-col shadow-md">
              {/* Confirm Destructive Actions */}
              <div className="flex items-start justify-between p-4 gap-3">
                <div className="flex items-start min-w-0">
                  <div className="w-10 h-10 rounded-full bg-[#292A2A] border border-[#343535] flex items-center justify-center shrink-0 text-white mr-3.5 mt-0.5">
                    <span className="material-symbols-outlined text-[22px]">shield</span>
                  </div>
                  <div className="min-w-0">
                    <span className="text-sm font-medium text-white block">Confirm Destructive Actions</span>
                    <p className="text-xs text-neutral-400 mt-0.5 leading-relaxed">
                      Prompt before git push, database writes, or outbound messaging.
                    </p>
                  </div>
                </div>
                <button 
                  aria-checked={confirmDestructive} 
                  className={`w-12 h-7 rounded-full p-0.5 transition-colors duration-200 flex items-center shrink-0 mt-1 cursor-pointer ${
                    confirmDestructive ? 'bg-white justify-end' : 'bg-[#343535] justify-start'
                  }`} 
                  onClick={handleToggleDestructive} 
                  role="switch" 
                  type="button"
                >
                  <div className={`w-6 h-6 rounded-full transition-transform duration-200 ${
                    confirmDestructive ? 'bg-black' : 'bg-neutral-400'
                  }`} />
                </button>
              </div>

              <div className="h-[1px] bg-[#292A2A] ml-[56px] mr-4"></div>

              {/* OAuth Token Auto Refresh */}
              <div className="flex items-start justify-between p-4 gap-3">
                <div className="flex items-start min-w-0">
                  <div className="w-10 h-10 rounded-full bg-[#292A2A] border border-[#343535] flex items-center justify-center shrink-0 text-white mr-3.5 mt-0.5">
                    <span className="material-symbols-outlined text-[22px]">sync</span>
                  </div>
                  <div className="min-w-0">
                    <span className="text-sm font-medium text-white block">OAuth Auto-Refresh</span>
                    <p className="text-xs text-neutral-400 mt-0.5 leading-relaxed">
                      Maintain background credentials for ongoing scheduled tasks.
                    </p>
                  </div>
                </div>
                <button 
                  aria-checked={oauthAutoRefresh} 
                  className={`w-12 h-7 rounded-full p-0.5 transition-colors duration-200 flex items-center shrink-0 mt-1 cursor-pointer ${
                    oauthAutoRefresh ? 'bg-white justify-end' : 'bg-[#343535] justify-start'
                  }`} 
                  onClick={handleToggleOauthRefresh} 
                  role="switch" 
                  type="button"
                >
                  <div className={`w-6 h-6 rounded-full transition-transform duration-200 ${
                    oauthAutoRefresh ? 'bg-black' : 'bg-neutral-400'
                  }`} />
                </button>
              </div>

              <div className="h-[1px] bg-[#292A2A] ml-[56px] mr-4"></div>

              {/* Revoke All Access (Destructive Item) */}
              <button 
                onClick={() => setShowRevokeConfirm(true)}
                className="w-full flex items-center p-4 text-left hover:bg-rose-500/10 active:bg-rose-500/20 transition-colors cursor-pointer group" 
                type="button"
              >
                <div className="w-10 h-10 rounded-full bg-rose-500/10 border border-rose-500/20 flex items-center justify-center shrink-0 text-rose-400 mr-3.5">
                  <Trash2 size={18} />
                </div>
                <div className="flex-1 min-w-0">
                  <span className="text-sm font-medium text-rose-400 block group-hover:underline">
                    Revoke All Connector Access
                  </span>
                  <p className="text-xs text-neutral-400 mt-0.5">
                    Clear stored credentials, active tokens, and disable MCP endpoints.
                  </p>
                </div>
              </button>
            </div>
          </div>
        </div>
      </main>

      {/* GitHub Repository Browser Modal */}
      {showGithubBrowser && (
        <div className="fixed inset-0 z-50 bg-black/85 backdrop-blur-md flex items-center justify-center p-4 animate-in fade-in duration-200">
          <div className="bg-[#1E1F20] border border-[#333537] rounded-3xl w-full max-w-lg max-h-[85vh] flex flex-col overflow-hidden shadow-2xl">
            <div className="p-4 border-b border-[#333537] flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-[20px] text-white">terminal</span>
                <h3 className="font-semibold text-white">GitHub Integration Explorer</h3>
              </div>
              <button 
                onClick={() => setShowGithubBrowser(false)}
                className="w-8 h-8 rounded-full flex items-center justify-center text-neutral-400 hover:text-white hover:bg-white/10 transition-colors"
                type="button"
              >
                <X size={18} />
              </button>
            </div>
            <div className="p-4 overflow-y-auto flex-1 custom-scrollbar">
              <GitHubRepositoryBrowser />
            </div>
          </div>
        </div>
      )}

      {/* Add Custom MCP Server Modal */}
      {isAddMcpModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/85 backdrop-blur-md flex items-center justify-center p-4 animate-in fade-in duration-200">
          <div className="bg-[#1E1F20] border border-[#333537] rounded-3xl w-full max-w-md flex flex-col overflow-hidden shadow-2xl">
            <div className="p-5 border-b border-[#333537] flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-[22px] text-white">hub</span>
                <h3 className="font-semibold text-white">Add Custom MCP Server</h3>
              </div>
              <button 
                onClick={() => setIsAddMcpModalOpen(false)}
                className="w-8 h-8 rounded-full flex items-center justify-center text-neutral-400 hover:text-white hover:bg-white/10 transition-colors"
                type="button"
              >
                <X size={18} />
              </button>
            </div>
            <form onSubmit={handleAddMcpServer} className="p-5 space-y-4">
              <div>
                <label className="text-xs font-semibold text-neutral-300 block mb-1.5">
                  Server Name
                </label>
                <input 
                  type="text" 
                  value={newMcpName} 
                  onChange={(e) => setNewMcpName(e.target.value)} 
                  placeholder="e.g. SQLite MCP, Puppeteer Web, Docker MCP"
                  className="w-full px-3.5 py-2.5 rounded-xl bg-black border border-[#333537] text-white text-sm focus:border-white outline-none"
                  autoFocus
                />
              </div>

              <div>
                <label className="text-xs font-semibold text-neutral-300 block mb-1.5">
                  Transport Protocol
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setNewMcpTransport('stdio')}
                    className={`py-2 px-3 rounded-xl border text-xs font-semibold transition-all cursor-pointer ${
                      newMcpTransport === 'stdio' 
                        ? 'bg-white text-black border-white' 
                        : 'bg-[#292A2A] text-neutral-300 border-[#343535]'
                    }`}
                  >
                    stdio (Local CLI)
                  </button>
                  <button
                    type="button"
                    onClick={() => setNewMcpTransport('sse')}
                    className={`py-2 px-3 rounded-xl border text-xs font-semibold transition-all cursor-pointer ${
                      newMcpTransport === 'sse' 
                        ? 'bg-white text-black border-white' 
                        : 'bg-[#292A2A] text-neutral-300 border-[#343535]'
                    }`}
                  >
                    SSE / HTTP Remote
                  </button>
                </div>
              </div>

              <div>
                <label className="text-xs font-semibold text-neutral-300 block mb-1.5">
                  {newMcpTransport === 'stdio' ? 'Command or Path' : 'Endpoint URL'}
                </label>
                <input 
                  type="text" 
                  value={newMcpUrl} 
                  onChange={(e) => setNewMcpUrl(e.target.value)} 
                  placeholder={newMcpTransport === 'stdio' ? 'npx -y @modelcontextprotocol/server-sqlite' : 'https://mcp.internal.net/sse'}
                  className="w-full px-3.5 py-2.5 rounded-xl bg-black border border-[#333537] text-white text-sm focus:border-white outline-none font-mono text-xs"
                />
              </div>

              <div className="pt-2 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setIsAddMcpModalOpen(false)}
                  className="px-4 py-2 rounded-xl text-neutral-400 hover:text-white text-xs font-semibold cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 rounded-xl bg-white text-black hover:bg-neutral-200 text-xs font-bold cursor-pointer transition-colors"
                >
                  Connect Server
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Revoke All Confirmation Modal */}
      {showRevokeConfirm && (
        <div className="fixed inset-0 z-50 bg-black/85 backdrop-blur-md flex items-center justify-center p-4 animate-in fade-in duration-200">
          <div className="bg-[#1E1F20] border border-[#333537] rounded-3xl w-full max-w-sm p-6 text-center space-y-4 shadow-2xl">
            <div className="w-12 h-12 rounded-full bg-rose-500/10 border border-rose-500/20 text-rose-400 flex items-center justify-center mx-auto">
              <ShieldAlert size={24} />
            </div>
            <div>
              <h3 className="text-lg font-bold text-white">Revoke All Access?</h3>
              <p className="text-xs text-neutral-400 mt-1 leading-relaxed">
                This will disconnect Google Workspace, GitHub tokens, Slack integrations, and disable all MCP servers.
              </p>
            </div>
            <div className="grid grid-cols-2 gap-3 pt-2">
              <button
                type="button"
                onClick={() => setShowRevokeConfirm(false)}
                className="py-2.5 rounded-xl bg-[#292A2A] hover:bg-[#343535] text-neutral-300 text-xs font-semibold cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleRevokeAllAccess}
                className="py-2.5 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold cursor-pointer transition-colors"
              >
                Yes, Revoke All
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
