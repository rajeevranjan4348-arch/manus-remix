import React, { useState, useEffect, useMemo } from 'react';
import { 
  Github, 
  Search, 
  RefreshCw, 
  ExternalLink, 
  Lock, 
  Globe, 
  Star, 
  GitFork, 
  AlertCircle, 
  CheckCircle2, 
  Copy, 
  Check, 
  Filter, 
  Layers, 
  ArrowUpDown,
  Code2,
  PlugZap,
  Unplug
} from 'lucide-react';
import { 
  getConnectorState, 
  startOAuthFlow, 
  disconnectConnector, 
  listRepositories, 
  GitHubRepository,
  ConnectorState 
} from '@/lib/connectors';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

interface GitHubRepositoryBrowserProps {
  className?: string;
  onSelectRepo?: (repo: GitHubRepository) => void;
}

const LANGUAGE_COLORS: Record<string, string> = {
  typescript: 'bg-blue-500',
  javascript: 'bg-yellow-400',
  python: 'bg-emerald-500',
  rust: 'bg-orange-600',
  go: 'bg-cyan-500',
  java: 'bg-red-500',
  'c++': 'bg-pink-500',
  c: 'bg-slate-400',
  html: 'bg-orange-500',
  css: 'bg-indigo-500',
  ruby: 'bg-rose-600',
  php: 'bg-violet-500',
  swift: 'bg-amber-500',
};

export function GitHubRepositoryBrowser({ className, onSelectRepo }: GitHubRepositoryBrowserProps) {
  const [connectorState, setConnectorState] = useState<ConnectorState>(() => getConnectorState('github'));
  const [repositories, setRepositories] = useState<GitHubRepository[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [visibilityFilter, setVisibilityFilter] = useState<'all' | 'public' | 'private'>('all');
  const [sortBy, setSortBy] = useState<'updated' | 'stars' | 'name'>('updated');
  const [copiedRepoId, setCopiedRepoId] = useState<number | string | null>(null);

  // Sync state on connector events
  useEffect(() => {
    const handleStateChange = () => {
      setConnectorState(getConnectorState('github'));
    };
    window.addEventListener('manus_connectors_state_changed', handleStateChange);
    return () => window.removeEventListener('manus_connectors_state_changed', handleStateChange);
  }, []);

  const isConnected = connectorState.status === 'connected';

  // Fetch repositories
  const fetchRepos = async () => {
    setIsLoading(true);
    try {
      const res = await listRepositories({
        visibility: visibilityFilter === 'all' ? undefined : visibilityFilter,
        sort: sortBy === 'name' ? 'full_name' : sortBy,
        perPage: 30
      });

      if (res.success && res.data) {
        setRepositories(res.data);
      } else {
        toast.error(res.message || 'Failed to fetch GitHub repositories');
      }
    } catch (e: any) {
      toast.error(`Error loading repositories: ${e.message || 'Network error'}`);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    // Automatically load repositories if connected or previewing
    fetchRepos();
  }, [visibilityFilter, sortBy]);

  // Connect GitHub
  const handleConnect = async () => {
    setIsConnecting(true);
    try {
      const ok = await startOAuthFlow('github');
      if (ok) {
        toast.success('Connected to GitHub!');
        setConnectorState(getConnectorState('github'));
        await fetchRepos();
      }
    } catch (err: any) {
      toast.error('GitHub connection failed: ' + err.message);
    } finally {
      setIsConnecting(false);
    }
  };

  // Disconnect GitHub
  const handleDisconnect = async () => {
    await disconnectConnector('github');
    setConnectorState(getConnectorState('github'));
    toast.info('Disconnected from GitHub');
  };

  // Copy Repo link
  const handleCopyUrl = (repo: GitHubRepository) => {
    navigator.clipboard.writeText(repo.url);
    setCopiedRepoId(repo.id);
    toast.success(`Copied ${repo.name} URL to clipboard`);
    setTimeout(() => setCopiedRepoId(null), 2000);
  };

  // Filtered and sorted repositories
  const filteredRepos = useMemo(() => {
    return repositories.filter(repo => {
      const query = searchQuery.trim().toLowerCase();
      const matchesQuery = 
        !query ||
        repo.name.toLowerCase().includes(query) ||
        repo.fullName.toLowerCase().includes(query) ||
        (repo.description && repo.description.toLowerCase().includes(query)) ||
        (repo.language && repo.language.toLowerCase().includes(query));

      const matchesVisibility =
        visibilityFilter === 'all' ||
        (visibilityFilter === 'public' && !repo.isPrivate) ||
        (visibilityFilter === 'private' && repo.isPrivate);

      return matchesQuery && matchesVisibility;
    }).sort((a, b) => {
      if (sortBy === 'stars') return (b.stars || 0) - (a.stars || 0);
      if (sortBy === 'name') return a.name.localeCompare(b.name);
      // default: updated
      return new Date(b.updatedAt || 0).getTime() - new Date(a.updatedAt || 0).getTime();
    });
  }, [repositories, searchQuery, visibilityFilter, sortBy]);

  const publicCount = repositories.filter(r => !r.isPrivate).length;
  const privateCount = repositories.filter(r => r.isPrivate).length;

  return (
    <div className={cn("space-y-4", className)}>
      {/* Connection Header Card */}
      <div className="p-4 rounded-xl border border-border/70 bg-card/60 backdrop-blur-xs flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-slate-900 dark:bg-white/10 flex items-center justify-center text-white shrink-0 shadow-xs">
            <Github size={22} />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-semibold text-foreground">GitHub Connector</h3>
              {isConnected ? (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
                  <CheckCircle2 size={10} /> Connected
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-muted text-muted-foreground border border-border">
                  Not Connected
                </span>
              )}
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">
              {isConnected 
                ? `Authorized as ${connectorState.account?.name || 'GitHub User'} (${connectorState.account?.email || 'developer@manus.ai'})`
                : 'Connect your account to query repositories, issues, and pull requests.'}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 self-start sm:self-auto shrink-0">
          {isConnected ? (
            <>
              <button
                type="button"
                onClick={fetchRepos}
                disabled={isLoading}
                className="p-2 rounded-lg border border-border bg-background hover:bg-muted text-foreground transition-colors cursor-pointer"
                title="Refresh Repositories"
              >
                <RefreshCw size={14} className={cn(isLoading && "animate-spin text-primary")} />
              </button>
              <button
                type="button"
                onClick={handleDisconnect}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border bg-background hover:bg-destructive/10 hover:text-destructive text-muted-foreground text-xs font-medium transition-colors cursor-pointer"
              >
                <Unplug size={13} />
                <span>Disconnect</span>
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={handleConnect}
              disabled={isConnecting}
              className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-foreground text-background hover:opacity-90 text-xs font-semibold shadow-xs transition-opacity cursor-pointer"
            >
              <PlugZap size={13} />
              <span>{isConnecting ? 'Connecting...' : 'Connect GitHub'}</span>
            </button>
          )}
        </div>
      </div>

      {/* Repositories Search & Filters Bar */}
      <div className="space-y-3">
        <div className="flex flex-col sm:flex-row gap-2">
          {/* Search Input */}
          <div className="relative flex-1">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search repositories by name, language, or topic..."
              className="w-full text-xs bg-muted/30 border border-border/70 rounded-lg pl-8 pr-3 py-2 text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/40 transition-all"
            />
          </div>

          {/* Visibility Filters */}
          <div className="flex items-center gap-1 p-0.5 bg-muted/40 border border-border/60 rounded-lg shrink-0">
            {(['all', 'public', 'private'] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => setVisibilityFilter(mode)}
                className={cn(
                  "px-2.5 py-1 text-xs font-medium rounded-md transition-colors capitalize cursor-pointer",
                  visibilityFilter === mode
                    ? "bg-background text-foreground shadow-2xs font-semibold"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                {mode === 'all' ? `All (${repositories.length})` : mode === 'public' ? `Public (${publicCount})` : `Private (${privateCount})`}
              </button>
            ))}
          </div>

          {/* Sort Selector */}
          <div className="flex items-center gap-1 shrink-0">
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as any)}
              className="text-xs bg-muted/30 border border-border/70 rounded-lg px-2.5 py-2 font-medium text-foreground cursor-pointer focus:outline-none focus:ring-1 focus:ring-primary/40"
              aria-label="Sort repositories"
            >
              <option value="updated">Recently Updated</option>
              <option value="stars">Most Stars</option>
              <option value="name">Alphabetical</option>
            </select>
          </div>
        </div>

        {/* Repositories List Grid */}
        {isLoading && repositories.length === 0 ? (
          <div className="p-8 text-center rounded-xl border border-border/60 bg-card/30 flex flex-col items-center justify-center space-y-2">
            <RefreshCw size={24} className="animate-spin text-primary" />
            <p className="text-xs text-muted-foreground">Fetching user-accessible repositories from GitHub...</p>
          </div>
        ) : filteredRepos.length === 0 ? (
          <div className="p-8 text-center rounded-xl border border-dashed border-border/80 bg-card/20 space-y-2">
            <Layers size={28} className="mx-auto text-muted-foreground/60" />
            <p className="text-xs font-medium text-foreground">No repositories found</p>
            <p className="text-[11px] text-muted-foreground">
              {searchQuery ? `No results matching "${searchQuery}".` : 'Connect your GitHub account or grant organization access to view repos.'}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-2.5 max-h-[300px] overflow-y-auto pr-1 custom-scrollbar">
            {filteredRepos.map((repo) => {
              const langLower = (repo.language || '').toLowerCase();
              const langColor = LANGUAGE_COLORS[langLower] || 'bg-slate-400';

              return (
                <div
                  key={repo.id}
                  className="p-3 rounded-xl border border-border/60 bg-card/40 hover:bg-card hover:border-border transition-all duration-150 flex flex-col justify-between gap-2 group shadow-2xs"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <a
                          href={repo.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs font-semibold text-foreground hover:text-primary transition-colors flex items-center gap-1 group-hover:underline truncate"
                        >
                          <span className="truncate">{repo.fullName || repo.name}</span>
                          <ExternalLink size={11} className="shrink-0 opacity-60 group-hover:opacity-100" />
                        </a>

                        {repo.isPrivate ? (
                          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20 shrink-0">
                            <Lock size={9} /> Private
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-slate-500/10 text-slate-600 dark:text-slate-400 border border-slate-500/20 shrink-0">
                            <Globe size={9} /> Public
                          </span>
                        )}
                      </div>

                      {repo.description && (
                        <p className="text-[11px] text-muted-foreground line-clamp-2 mt-1">
                          {repo.description}
                        </p>
                      )}
                    </div>

                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        type="button"
                        onClick={() => handleCopyUrl(repo)}
                        className="p-1.5 rounded-lg border border-border/50 bg-background/80 hover:bg-muted text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
                        title="Copy repository URL"
                      >
                        {copiedRepoId === repo.id ? <Check size={12} className="text-emerald-500" /> : <Copy size={12} />}
                      </button>

                      {onSelectRepo && (
                        <button
                          type="button"
                          onClick={() => onSelectRepo(repo)}
                          className="px-2 py-1 rounded-lg bg-foreground text-background text-[11px] font-medium hover:opacity-90 transition-opacity cursor-pointer shrink-0"
                        >
                          Select
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Metadata Tags */}
                  <div className="flex items-center gap-3 pt-1 border-t border-border/30 text-[11px] text-muted-foreground flex-wrap">
                    {repo.language && (
                      <div className="flex items-center gap-1.5 shrink-0">
                        <span className={cn("w-2 h-2 rounded-full shrink-0", langColor)} />
                        <span>{repo.language}</span>
                      </div>
                    )}

                    <div className="flex items-center gap-1 shrink-0">
                      <Star size={11} className="text-amber-500" />
                      <span>{repo.stars || 0}</span>
                    </div>

                    {(repo.forks !== undefined && repo.forks > 0) && (
                      <div className="flex items-center gap-1 shrink-0">
                        <GitFork size={11} />
                        <span>{repo.forks}</span>
                      </div>
                    )}

                    {repo.openIssuesCount !== undefined && (
                      <div className="flex items-center gap-1 shrink-0">
                        <AlertCircle size={11} />
                        <span>{repo.openIssuesCount} issues</span>
                      </div>
                    )}

                    {repo.defaultBranch && (
                      <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-muted/60 text-muted-foreground shrink-0">
                        {repo.defaultBranch}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
