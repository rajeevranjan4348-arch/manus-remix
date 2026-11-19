import React, { useState, useEffect, useCallback } from 'react';
import {
  HardDrive,
  FileSpreadsheet,
  Calendar,
  Mail,
  RefreshCw,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Loader2,
  PlugZap,
  Link2,
  Settings2,
  Unlink,
} from 'lucide-react';
import {
  initWorkspaceAuth,
  getAccessToken,
  getCurrentUser,
} from '@/lib/workspaceAuth';
import {
  WorkspaceServiceId,
  WorkspaceServiceStatusItem,
  WorkspaceConnectionHealth,
  getInitialWorkspaceServiceStatuses,
  fetchActiveGoogleIntegrationsFromBackend,
  verifyWorkspaceServiceConnection,
  verifyAllWorkspaceServices,
  reconnectWorkspaceService,
  setWorkspaceAppLinkedState,
} from '@/lib/workspaceConnectionStatus';
import { toast } from 'sonner';

function getServiceIcon(serviceId: WorkspaceServiceId) {
  switch (serviceId) {
    case 'drive':
      return <HardDrive className="w-4 h-4 text-blue-500 shrink-0" />;
    case 'sheets':
      return <FileSpreadsheet className="w-4 h-4 text-emerald-500 shrink-0" />;
    case 'calendar':
      return <Calendar className="w-4 h-4 text-amber-500 shrink-0" />;
    case 'gmail':
      return <Mail className="w-4 h-4 text-red-500 shrink-0" />;
  }
}

function renderStatusBadge(status: WorkspaceConnectionHealth) {
  if (status === 'verifying') {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/25">
        <Loader2 className="w-2.5 h-2.5 animate-spin" />
        <span>Verifying</span>
      </span>
    );
  }
  if (status === 'connected') {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/25">
        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
        <span>Connected</span>
      </span>
    );
  }
  if (status === 'needs_reconnect') {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/30">
        <AlertTriangle className="w-2.5 h-2.5" />
        <span>Needs Reconnect</span>
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-muted text-muted-foreground border border-border/60">
      <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground/50" />
      <span>Disconnected</span>
    </span>
  );
}

export function ConnectedAppsDashboard() {
  const [services, setServices] = useState<WorkspaceServiceStatusItem[]>(() =>
    getInitialWorkspaceServiceStatuses()
  );
  const [accountEmail, setAccountEmail] = useState<string | null>(
    () => getCurrentUser()?.email || null
  );
  const [isSyncingBackend, setIsSyncingBackend] = useState<boolean>(false);
  const [isVerifyingAll, setIsVerifyingAll] = useState<boolean>(false);
  const [reconnectingId, setReconnectingId] = useState<WorkspaceServiceId | 'all' | null>(null);
  const [managingAppId, setManagingAppId] = useState<WorkspaceServiceId | null>(null);

  const syncWithBackend = useCallback(
    async (tokenOverride?: string | null, emailOverride?: string | null) => {
      setIsSyncingBackend(true);
      try {
        const res = await fetchActiveGoogleIntegrationsFromBackend(
          tokenOverride,
          emailOverride
        );
        if (res.accountEmail) {
          setAccountEmail(res.accountEmail);
        }
        setServices(res.statuses);
      } finally {
        setIsSyncingBackend(false);
      }
    },
    []
  );

  const handleVerifyAll = useCallback(async (tokenOverride?: string | null) => {
    const token = tokenOverride !== undefined ? tokenOverride : getAccessToken();
    if (!token) {
      await syncWithBackend(null, null);
      return;
    }
    setIsVerifyingAll(true);
    setServices((prev) =>
      prev.map((item) => ({
        ...item,
        status: 'verifying',
      }))
    );
    try {
      const results = await verifyAllWorkspaceServices(token);
      setServices(results);
    } finally {
      setIsVerifyingAll(false);
    }
  }, [syncWithBackend]);

  useEffect(() => {
    syncWithBackend();
    const unsubscribe = initWorkspaceAuth(
      (user, token) => {
        setAccountEmail(user?.email || null);
        syncWithBackend(token, user?.email || null);
      },
      () => {
        setAccountEmail(null);
        syncWithBackend(null, null);
      }
    );
    return () => unsubscribe();
  }, [syncWithBackend]);

  const handleVerifySingleService = async (serviceId: WorkspaceServiceId) => {
    setServices((prev) =>
      prev.map((item) =>
        item.id === serviceId ? { ...item, status: 'verifying', errorMessage: null } : item
      )
    );
    const updated = await verifyWorkspaceServiceConnection(serviceId);
    setServices((prev) => prev.map((item) => (item.id === serviceId ? updated : item)));
    if (updated.status === 'connected') {
      toast.success(`${updated.name} connection verified (${updated.latencyMs ?? 1}ms)`);
    } else if (updated.status === 'needs_reconnect') {
      toast.warning(`${updated.name} requires reconnection`);
    } else {
      toast.info(`${updated.name} is disconnected. Click Link Account to connect.`);
    }
  };

  const handleQuickReconnectOrLink = async (serviceId?: WorkspaceServiceId) => {
    const targetKey = serviceId || 'all';
    setReconnectingId(targetKey);
    try {
      const result = await reconnectWorkspaceService(serviceId);
      if (result.reconnected) {
        setAccountEmail(result.userEmail);
        setServices(result.statuses);
        const label = serviceId
          ? result.statuses.find((s) => s.id === serviceId)?.name || 'Google Workspace'
          : 'All Google Workspace services';
        toast.success(`Linked ${label}${result.userEmail ? ` (${result.userEmail})` : ''}`);
      } else {
        toast.error('Google account linking was cancelled or failed.');
      }
    } catch (err: any) {
      toast.error(err?.message || 'Failed to link Google Workspace service.');
    } finally {
      setReconnectingId(null);
    }
  };

  const handleUnlinkSingleApp = async (serviceId: WorkspaceServiceId) => {
    setWorkspaceAppLinkedState(serviceId, false);
    setManagingAppId(null);
    await syncWithBackend();
    const targetName =
      services.find((s) => s.id === serviceId)?.name || 'Google integration';
    toast.info(`Unlinked ${targetName}. Click "Link Account" anytime to reconnect.`);
  };

  const connectedCount = services.filter((s) => s.status === 'connected').length;

  return (
    <div
      data-testid="connected-apps-dashboard"
      className="mt-2 rounded-xl border border-border/60 bg-muted/20 p-3 space-y-3"
    >
      <div
        data-testid="workspace-connections-dashboard"
        className="space-y-3"
      >
        {/* Connected Apps Summary Header */}
        <div className="flex flex-wrap items-center justify-between gap-2 pb-2.5 border-b border-border/40">
          <div className="space-y-0.5 min-w-0">
            <div className="flex items-center gap-2">
              <p className="text-xs font-semibold text-foreground">
                Connected Apps
              </p>
              <span
                data-testid="workspace-active-count-badge"
                className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                  connectedCount === services.length
                    ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/25'
                    : connectedCount > 0
                      ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/25'
                      : 'bg-muted text-muted-foreground border border-border/60'
                }`}
              >
                {connectedCount === services.length ? (
                  <CheckCircle2 className="w-2.5 h-2.5" />
                ) : connectedCount === 0 ? (
                  <XCircle className="w-2.5 h-2.5" />
                ) : (
                  <AlertTriangle className="w-2.5 h-2.5" />
                )}
                <span>
                  {connectedCount}/{services.length} Active
                </span>
              </span>
            </div>
            <p className="text-[11px] text-muted-foreground truncate">
              {accountEmail
                ? `Linked Google account: ${accountEmail}`
                : 'Link or manage your active Google Drive, Sheets, Calendar, and Gmail integrations'}
            </p>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              data-testid="workspace-verify-all-btn"
              onClick={() => handleVerifyAll()}
              disabled={isVerifyingAll || isSyncingBackend || reconnectingId !== null}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border border-border/70 bg-background/80 hover:bg-muted text-[11px] font-medium text-foreground transition-colors cursor-pointer disabled:opacity-50"
              title="Query backend & check live API connectivity for all Google apps"
            >
              <RefreshCw
                className={`w-3 h-3 ${isVerifyingAll || isSyncingBackend ? 'animate-spin' : ''}`}
              />
              <span>Verify Status</span>
            </button>

            <button
              type="button"
              data-testid="workspace-reconnect-all-btn"
              onClick={() => handleQuickReconnectOrLink()}
              disabled={reconnectingId !== null}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-foreground text-background hover:opacity-90 text-[11px] font-semibold transition-opacity cursor-pointer disabled:opacity-50"
              title="Quick-reconnect all Google Workspace apps"
            >
              {reconnectingId === 'all' ? (
                <Loader2 className="w-3 h-3 animate-spin" />
              ) : (
                <PlugZap className="w-3 h-3" />
              )}
              <span>Reconnect All</span>
            </button>
          </div>
        </div>

        {/* Status Cards Grid: Google Drive, Google Sheets, Google Calendar, Gmail */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
          {services.map((service) => {
            const isReconnectingThis =
              reconnectingId === service.id || reconnectingId === 'all';
            const isVerifyingThis = service.status === 'verifying';
            const isLinked =
              service.isLinked && service.status !== 'disconnected';
            const isManagingThis = managingAppId === service.id;

            return (
              <div
                key={service.id}
                data-testid={`workspace-service-card-${service.id}`}
                className="rounded-xl border border-border/60 bg-background/70 p-2.5 flex flex-col justify-between gap-2 transition-colors hover:border-border"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-start gap-2 min-w-0">
                    <div className="mt-0.5 p-1.5 rounded-lg bg-muted/60 border border-border/50 shrink-0">
                      {getServiceIcon(service.id)}
                    </div>
                    <div className="min-w-0">
                      <p className="text-xs font-semibold text-foreground truncate">
                        {service.name}
                      </p>
                      <p className="text-[10px] text-muted-foreground line-clamp-1">
                        {service.description}
                      </p>
                    </div>
                  </div>

                  <div
                    data-testid={`workspace-status-${service.id}`}
                    className="shrink-0"
                  >
                    {renderStatusBadge(service.status)}
                  </div>
                </div>

                {service.errorMessage && (
                  <p className="text-[10px] text-amber-600 dark:text-amber-400 truncate">
                    {service.errorMessage}
                  </p>
                )}

                {/* Primary Card Footer with 'Link Account' or 'Manage Connection' */}
                <div className="flex items-center justify-between gap-2 pt-1.5 border-t border-border/40">
                  <span className="text-[10px] text-muted-foreground truncate">
                    {service.latencyMs !== null
                      ? `Verified (${service.latencyMs}ms)`
                      : isLinked
                        ? service.accountEmail || 'Account linked'
                        : 'Not linked'}
                  </span>

                  <div className="flex items-center gap-1 shrink-0">
                    {!isLinked ? (
                      <button
                        type="button"
                        data-testid={`connected-app-link-${service.id}`}
                        onClick={() => handleQuickReconnectOrLink(service.id)}
                        disabled={isReconnectingThis}
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-foreground text-background hover:opacity-90 text-[10px] font-semibold transition-opacity cursor-pointer disabled:opacity-50"
                        title={`Link ${service.name} account`}
                      >
                        {isReconnectingThis ? (
                          <Loader2 className="w-2.5 h-2.5 animate-spin" />
                        ) : (
                          <Link2 className="w-2.5 h-2.5" />
                        )}
                        <span>Link Account</span>
                      </button>
                    ) : (
                      <>
                        <button
                          type="button"
                          data-testid={`connected-app-manage-${service.id}`}
                          onClick={() =>
                            setManagingAppId((prev) =>
                              prev === service.id ? null : service.id
                            )
                          }
                          className="inline-flex items-center gap-1 px-2 py-1 rounded-md border border-border/70 bg-muted/50 hover:bg-muted text-[10px] font-semibold text-foreground transition-colors cursor-pointer"
                          title={`Manage ${service.name} connection`}
                        >
                          <Settings2 className="w-2.5 h-2.5" />
                          <span>Manage Connection</span>
                        </button>

                        <button
                          type="button"
                          data-testid={`workspace-reconnect-${service.id}`}
                          onClick={() => handleQuickReconnectOrLink(service.id)}
                          disabled={isReconnectingThis}
                          className="inline-flex items-center gap-1 px-2 py-1 rounded-md border border-border/60 hover:bg-muted text-[10px] font-medium text-muted-foreground hover:text-foreground transition-colors cursor-pointer disabled:opacity-50"
                          title={`Quick-reconnect ${service.name}`}
                        >
                          {isReconnectingThis ? (
                            <Loader2 className="w-2.5 h-2.5 animate-spin" />
                          ) : (
                            <PlugZap className="w-2.5 h-2.5" />
                          )}
                          <span>Quick Reconnect</span>
                        </button>
                      </>
                    )}
                  </div>
                </div>

                {/* Expandable 'Manage Connection' Drawer for Active Linked Apps */}
                {isLinked && isManagingThis && (
                  <div
                    data-testid={`connected-app-management-panel-${service.id}`}
                    className="mt-1 pt-2 border-t border-border/50 rounded-lg bg-muted/30 p-2 space-y-2 text-[10px]"
                  >
                    <div className="flex items-center justify-between gap-2 text-muted-foreground">
                      <span className="font-medium text-foreground">
                        Connection Details
                      </span>
                      <span className="truncate">
                        {service.accountEmail || accountEmail || 'Active OAuth Session'}
                      </span>
                    </div>
                    <div className="flex flex-wrap items-center justify-between gap-1.5">
                      <button
                        type="button"
                        data-testid={`workspace-verify-${service.id}`}
                        onClick={() => handleVerifySingleService(service.id)}
                        disabled={isVerifyingThis || isReconnectingThis}
                        className="inline-flex items-center gap-1 px-2 py-1 rounded-md border border-border/60 bg-background hover:bg-muted text-[10px] font-medium text-foreground transition-colors cursor-pointer disabled:opacity-50"
                      >
                        <RefreshCw
                          className={`w-2.5 h-2.5 ${isVerifyingThis ? 'animate-spin' : ''}`}
                        />
                        <span>Check Health</span>
                      </button>

                      <button
                        type="button"
                        data-testid={`connected-app-unlink-${service.id}`}
                        onClick={() => handleUnlinkSingleApp(service.id)}
                        className="inline-flex items-center gap-1 px-2 py-1 rounded-md border border-border/60 bg-background hover:bg-destructive/10 text-[10px] font-medium text-muted-foreground hover:text-destructive transition-colors cursor-pointer"
                      >
                        <Unlink className="w-2.5 h-2.5" />
                        <span>Unlink App</span>
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export default ConnectedAppsDashboard;
