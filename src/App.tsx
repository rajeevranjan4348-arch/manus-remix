import React, { useEffect, useCallback, useMemo, Suspense, lazy } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useNavigate, useParams, useLocation } from 'react-router-dom';
import { Sidebar } from './components/layout/Sidebar';
import { Topbar } from './components/layout/Topbar';
import { useAgentTask } from './hooks/useAgentTask';
import { useWebsiteBuilder } from './hooks/useWebsiteBuilder';
import { BlinkProvider, BlinkAuthProvider, useBlinkAuth } from '@blinkdotnew/react';
import { FirebaseProvider } from './context/FirebaseContext';
import { ThemeProvider } from './context/ThemeContext';
import { Toaster } from './components/ui/sonner';
import { configureHighQualityTTS } from './lib/audioPipeline';
import {
  startPerformanceMonitoring,
  getActivePerformanceProfile,
  applyPerformanceProfileToDOM,
} from './lib/performanceEngine';
import { startRecoveryMonitoring } from './lib/recoveryController';
import { getSettings } from './lib/settingsStore';
import { applyViewDensityToDocument } from './lib/viewDensity';

import { ErrorBoundary } from './components/common/ErrorBoundary';
import {
  ActiveWorkspacePanel,
  buildSearchWithPanel,
  isConnectorsPanelActive,
  parsePanelFromSearch,
  resolveConnectorsSection,
} from './lib/panelNavigation';

const Home = lazy(() =>
  import('./pages/Home').then((m) => ({ default: m.Home }))
);
const ChatView = lazy(() =>
  import('./components/agent/ChatView').then((m) => ({ default: m.ChatView }))
);
// Lazy-load Work Mode, E2B sandbox preview, editors, and heavy secondary panels
const WebsiteBuilderView = lazy(() =>
  import('./components/agent/WebsiteBuilderView').then((m) => ({ default: m.WebsiteBuilderView }))
);
const HistoryPanel = lazy(() =>
  import('./components/history/HistoryPanel').then((m) => ({ default: m.HistoryPanel }))
);
const SettingsModal = lazy(() =>
  import('./components/settings/SettingsModal').then((m) => ({ default: m.SettingsModal }))
);
const ConnectorsStorePanel = lazy(() =>
  import('./components/connectors/ConnectorsStorePanel').then((m) => ({ default: m.ConnectorsStorePanel }))
);
const TagAnalyticsModal = lazy(() =>
  import('./components/analytics/TagAnalyticsModal').then((m) => ({ default: m.TagAnalyticsModal }))
);
const AndroidVoiceSettings = lazy(() =>
  import('./components/settings/AndroidVoiceSettings').then((m) => ({ default: m.AndroidVoiceSettings }))
);
const AndroidConnectorsSettings = lazy(() =>
  import('./components/settings/AndroidConnectorsSettings').then((m) => ({ default: m.AndroidConnectorsSettings }))
);
const MyAIChat = lazy(() =>
  import('./components/chat/MyAIChat').then((m) => ({ default: m.MyAIChat }))
);
function RouteLoadingFallback() {
  return (
    <div className="flex h-full min-h-24 w-full items-center justify-center" role="status" aria-label="Loading view">
      <span className="h-1.5 w-12 rounded-full bg-muted" />
    </div>
  );
}

const PROJECT_ID = (import.meta as any).env?.VITE_BLINK_PROJECT_ID || 'manus-agent-clone-tkzhogvs';
const PUBLISHABLE_KEY = (import.meta as any).env?.VITE_BLINK_PUBLISHABLE_KEY || '';

// Wrapper for ChatView to handle params
function TaskView({ 
  useAgentTaskResult, 
  onReset 
}: { 
  useAgentTaskResult: ReturnType<typeof useAgentTask>, 
  onReset: () => void 
}) {
  const { taskId } = useParams();
  const { loadTask, resetTask, stopTask, currentTask, messages, steps, reorderSteps, result, chartData, taskStatus, phase, exportToPDF, sendMessage, editMessage, appendVoiceExchange, isLoading, activities } = useAgentTaskResult;

  useEffect(() => {
    if (taskId) {
      loadTask(taskId);
    }
  }, [taskId]);

  if (!currentTask && !taskId) return null;

  return (
    <ErrorBoundary
      title="Error loading task view"
      description="We encountered a problem loading this chat session. You can try reloading the view or creating a new task."
      onReset={resetTask}
    >
      <ChatView
        taskId={taskId || useAgentTaskResult.taskId}
        activities={activities}
        prompt={currentTask?.prompt || ''}
        messages={messages}
        steps={steps}
        onReorderSteps={reorderSteps}
        result={result}
        chartData={chartData}
        status={isLoading && taskStatus === 'idle' ? 'running' : taskStatus as any}
        phase={phase}
        onReset={onReset}
        onExport={exportToPDF}
        onSubmit={sendMessage}
        onEditMessage={editMessage}
        onVoiceExchangeComplete={appendVoiceExchange}
        onStop={stopTask}
        isLoading={isLoading}
      />
    </ErrorBoundary>
  );
}

function AppContent() {
  const navigate = useNavigate();
  const location = useLocation();
  const [isSidebarOpen, setIsSidebarOpen] = React.useState(false);
  const [activePanel, setActivePanel] = React.useState<ActiveWorkspacePanel>(() =>
    parsePanelFromSearch(location.search)
  );
  const [historyInitialTab, setHistoryInitialTab] = React.useState<'sessions' | 'all' | 'photos' | 'videos' | 'docs'>('sessions');
  const [settingsInitialTab, setSettingsInitialTab] = React.useState<'general' | 'robot' | 'ai' | 'personalization' | 'voice' | 'data' | 'about'>('general');
  const [gmpQuotaExceeded, setGmpQuotaExceeded] = React.useState(false);

  const isHistoryOpen = activePanel === 'history';
  const isSettingsOpen = activePanel === 'settings';
  const isConnectorsOpen = isConnectorsPanelActive(activePanel);
  const isTagAnalyticsOpen = activePanel === 'analytics';

  // Latch lazy workspace panels after first open so spring close/exit transitions can complete cleanly
  const [loadedPanels, setLoadedPanels] = React.useState(() => ({
    history: activePanel === 'history',
    settings: activePanel === 'settings',
    connectors: isConnectorsPanelActive(activePanel),
    analytics: activePanel === 'analytics',
  }));

  React.useEffect(() => {
    if (!activePanel) return;
    setLoadedPanels((prev) => {
      const nextHistory = prev.history || activePanel === 'history';
      const nextSettings = prev.settings || activePanel === 'settings';
      const nextConnectors = prev.connectors || isConnectorsPanelActive(activePanel);
      const nextAnalytics = prev.analytics || activePanel === 'analytics';
      if (
        nextHistory === prev.history &&
        nextSettings === prev.settings &&
        nextConnectors === prev.connectors &&
        nextAnalytics === prev.analytics
      ) {
        return prev;
      }
      return {
        history: nextHistory,
        settings: nextSettings,
        connectors: nextConnectors,
        analytics: nextAnalytics,
      };
    });
  }, [activePanel]);

  // Keep activePanel synchronized with URL query param on browser navigation/refresh
  React.useEffect(() => {
    const panelFromUrl = parsePanelFromSearch(location.search);
    setActivePanel((prev) => (prev === panelFromUrl ? prev : panelFromUrl));
  }, [location.search]);

  const syncPanelToUrl = useCallback(
    (nextPanel: ActiveWorkspacePanel) => {
      const nextSearch = buildSearchWithPanel(location.search, nextPanel);
      if (nextSearch !== location.search) {
        navigate(
          { pathname: location.pathname, search: nextSearch },
          { replace: true },
        );
      }
    },
    [location.pathname, location.search, navigate],
  );

  const openWorkspacePanel = useCallback(
    (
      nextPanel: Exclude<ActiveWorkspacePanel, null>,
      options?: { closeSidebar?: boolean },
    ) => {
      // Synchronously update panel state and preserve current pathname BEFORE dismissing sidebar
      setActivePanel(nextPanel);
      syncPanelToUrl(nextPanel);
      if (options?.closeSidebar !== false) {
        setIsSidebarOpen(false);
      }
    },
    [syncPanelToUrl],
  );

  const closeWorkspacePanel = useCallback(() => {
    setActivePanel(null);
    syncPanelToUrl(null);
  }, [syncPanelToUrl]);

  React.useEffect(() => {
    const handleGmpQuotaExceeded = () => setGmpQuotaExceeded(true);
    window.addEventListener('gmp-quota-exceeded', handleGmpQuotaExceeded);
    return () => window.removeEventListener('gmp-quota-exceeded', handleGmpQuotaExceeded);
  }, []);
  useBlinkAuth();
  
  // Data analysis hook
  const agentTask = useAgentTask();
  const { startTask, resetTask } = agentTask;

  // Non-blocking initialization of Web Speech API & audio pipeline
  React.useEffect(() => {
    if (typeof window !== 'undefined' && 'requestIdleCallback' in window) {
      (window as any).requestIdleCallback(() => configureHighQualityTTS());
    } else {
      setTimeout(() => configureHighQualityTTS(), 250);
    }
  }, []);

  // Apply persisted View Density CSS variables on startup and settings updates
  React.useEffect(() => {
    applyViewDensityToDocument(getSettings().viewDensity);
    const handleSettingsUpdated = (event: Event) => {
      const detail = (event as CustomEvent).detail;
      if (detail && detail.viewDensity !== undefined) {
        applyViewDensityToDocument(detail.viewDensity);
      } else {
        applyViewDensityToDocument(getSettings().viewDensity);
      }
    };
    window.addEventListener('manus_settings_updated', handleSettingsUpdated);
    return () => window.removeEventListener('manus_settings_updated', handleSettingsUpdated);
  }, []);

  // Initialize Ultra-Lite Performance Engine (2GB RAM Android Target) & adaptive battery/visibility hooks
  React.useEffect(() => {
    const stopMonitoring = startPerformanceMonitoring();
    let batteryManager: any = null;
    let disposed = false;
    let adaptivePerformanceDegraded = false;

    const updatePerformanceMode = () => {
      if (disposed) return;
      const activeProfile = getActivePerformanceProfile();
      const batteryLow = Boolean(batteryManager && !batteryManager.charging && batteryManager.level <= 0.2);
      const hidden = document.visibilityState === 'hidden';
      const effectiveMode = adaptivePerformanceDegraded
        ? 'ultra-lite'
        : activeProfile === 'ultra-lite' ? 'ultra-lite' : batteryLow ? 'saver' : activeProfile;
      applyPerformanceProfileToDOM(effectiveMode);
      document.documentElement.dataset.pageHidden = hidden ? 'true' : 'false';
    };

    const stopRecoveryMonitoring = startRecoveryMonitoring({
      onPerformanceDegraded: (degraded) => {
        adaptivePerformanceDegraded = degraded;
        updatePerformanceMode();
      },
    });

    const onVisibilityChange = () => updatePerformanceMode();
    const onMotionPreferenceChange = () => updatePerformanceMode();
    const onPerfProfileChange = () => updatePerformanceMode();
    const motionPreference = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    document.addEventListener('visibilitychange', onVisibilityChange, { passive: true });
    motionPreference?.addEventListener?.('change', onMotionPreferenceChange);
    window.addEventListener('manus_performance_profile_changed', onPerfProfileChange);

    const batteryApi = (navigator as any).getBattery;
    if (typeof batteryApi === 'function') {
      batteryApi.call(navigator).then((battery: any) => {
        if (disposed) return;
        batteryManager = battery;
        battery.addEventListener?.('levelchange', updatePerformanceMode);
        battery.addEventListener?.('chargingchange', updatePerformanceMode);
        updatePerformanceMode();
      }).catch(() => updatePerformanceMode());
    } else {
      updatePerformanceMode();
    }

    return () => {
      disposed = true;
      stopMonitoring();
      stopRecoveryMonitoring();
      document.removeEventListener('visibilitychange', onVisibilityChange);
      motionPreference?.removeEventListener?.('change', onMotionPreferenceChange);
      window.removeEventListener('manus_performance_profile_changed', onPerfProfileChange);
      batteryManager?.removeEventListener?.('levelchange', updatePerformanceMode);
      batteryManager?.removeEventListener?.('chargingchange', updatePerformanceMode);
    };
  }, []);

  // Global keyboard shortcuts (Ctrl+H: History, Ctrl+, : Settings) with mutual exclusion of heavy panels
  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'h') {
        e.preventDefault();
        setHistoryInitialTab('sessions');
        if (activePanel === 'history') {
          closeWorkspacePanel();
        } else {
          openWorkspacePanel('history');
        }
      }
      if ((e.ctrlKey || e.metaKey) && (e.key === ',' || e.key.toLowerCase() === 'p')) {
        e.preventDefault();
        setSettingsInitialTab('general');
        if (activePanel === 'settings') {
          closeWorkspacePanel();
        } else {
          openWorkspacePanel('settings');
        }
      }
    };
    const handleOpenSettings = (e: any) => {
      const tab = e?.detail?.tab || 'general';
      setSettingsInitialTab(tab);
      openWorkspacePanel('settings');
    };
    const handleOpenHistory = (e?: any) => {
      const tab = e?.detail?.tab || 'sessions';
      setHistoryInitialTab(tab);
      openWorkspacePanel('history');
    };
    const handleOpenConnectorsEvent = () => {
      openWorkspacePanel('connectors');
    };
    const handleOpenPluginsEvent = () => {
      openWorkspacePanel('plugins');
    };
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('manus_open_settings', handleOpenSettings);
    window.addEventListener('manus_open_history', handleOpenHistory);
    window.addEventListener('manus_open_connectors', handleOpenConnectorsEvent);
    window.addEventListener('manus_open_plugins', handleOpenPluginsEvent);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('manus_open_settings', handleOpenSettings);
      window.removeEventListener('manus_open_history', handleOpenHistory);
      window.removeEventListener('manus_open_connectors', handleOpenConnectorsEvent);
      window.removeEventListener('manus_open_plugins', handleOpenPluginsEvent);
    };
  }, [activePanel, closeWorkspacePanel, openWorkspacePanel]);

  // Website builder hook
  const {
    startBuilding,
    resetBuilder,
    currentTask: websiteTask,
    steps: websiteSteps,
    taskStatus: websiteStatus,
    previewUrl,
    isLoading: isBuilding,
    isInitializing
  } = useWebsiteBuilder();

  const handleStartTask = async (prompt: string, options: any = {}) => {
    if (options?.format === 'website') {
      const websiteName = options.websiteName || prompt.split(' ').slice(0, 3).join(' ') + ' Website';
      startBuilding(prompt, websiteName);
    } else {
      let navigated = false;
      const newTaskId = await startTask(prompt, {
        ...options,
        onTaskCreated: (id: string) => {
          if (id && !navigated) {
            navigated = true;
            navigate(`/task/${id}`);
          }
        },
      });
      if (newTaskId && !navigated) {
        navigate(`/task/${newTaskId}`);
      }
    }
  };

  const handleReset = useCallback(() => {
    setActivePanel(null);
    resetBuilder();
    resetTask();
    navigate('/');
  }, [resetBuilder, resetTask, navigate]);

  const handleToggleSidebar = useCallback(() => {
    setIsSidebarOpen(prev => !prev);
  }, []);

  const handleCloseSidebar = useCallback(() => {
    setIsSidebarOpen(false);
  }, []);

  const handleOpenHistory = useCallback(() => {
    setHistoryInitialTab('sessions');
    openWorkspacePanel('history');
  }, [openWorkspacePanel]);

  const handleOpenSettings = useCallback(() => {
    openWorkspacePanel('settings');
  }, [openWorkspacePanel]);

  const handleOpenConnectors = useCallback(() => {
    openWorkspacePanel('connectors');
  }, [openWorkspacePanel]);

  const handleOpenPlugins = useCallback(() => {
    openWorkspacePanel('plugins');
  }, [openWorkspacePanel]);

  const handleOpenTagAnalytics = useCallback(() => {
    openWorkspacePanel('analytics');
  }, [openWorkspacePanel]);

  const activeTaskInfo = useMemo(() => ({
    taskId: agentTask.taskId,
    prompt: agentTask.currentTask?.prompt,
    taskStatus: agentTask.taskStatus,
    messages: agentTask.messages,
    steps: agentTask.steps,
    result: agentTask.result,
  }), [
    agentTask.taskId,
    agentTask.currentTask?.prompt,
    agentTask.taskStatus,
    agentTask.messages,
    agentTask.steps,
    agentTask.result,
  ]);

  const isWebsiteActive = websiteTask !== null;
  const isHomePage = location.pathname === '/';
  const hasSentMessage = !isHomePage || isWebsiteActive || Boolean(agentTask.currentTask) || agentTask.messages.length > 0 || agentTask.isLoading;

  return (
    <div className="flex h-[100dvh] w-full max-w-full bg-background overflow-hidden">
      <Sidebar 
        isOpen={isSidebarOpen} 
        onToggle={handleToggleSidebar} 
        onCloseSidebar={handleCloseSidebar}
        onNewTask={handleReset}
        onOpenHistory={handleOpenHistory}
        onOpenSettings={handleOpenSettings}
        onOpenConnectors={handleOpenConnectors}
        onOpenPlugins={handleOpenPlugins}
        onOpenTagAnalytics={handleOpenTagAnalytics}
        activePanel={activePanel}
        isSettingsActive={isSettingsOpen || location.pathname.startsWith('/settings')}
        activeTaskId={location.pathname.startsWith('/task/') ? location.pathname.split('/')[2] : undefined}
      />
      <div className="flex-1 flex flex-col min-w-0">
        {gmpQuotaExceeded && (
          <div className="bg-amber-50 border-b border-amber-200 text-amber-900 px-4 py-2.5 text-xs md:text-sm text-center sticky top-0 z-50 shadow-sm">
            <span>
              Google Maps Platform quota reached. If you are the app owner, visit{' '}
              <a
                href="https://developers.google.com/maps/ai/ai-studio?utm_campaign=gmp_mcp_codeassist_v1_aistudio#quota_exceeded_errors"
                target="_blank"
                rel="noopener noreferrer"
                className="underline font-semibold text-amber-950 hover:text-amber-800"
              >
                maps developer site
              </a>{' '}
              for instructions to update your account.
            </span>
          </div>
        )}
        {!isWebsiteActive && (
          <Topbar 
            onToggleSidebar={handleToggleSidebar}
            onOpenHistory={handleOpenHistory} 
            onNewTask={handleReset}
            onOpenSettings={handleOpenSettings}
            onExport={agentTask.exportToPDF}
            showNewTask={hasSentMessage}
          />
        )}
        <main className="flex-1 overflow-hidden relative transition-all duration-300 ease-out">
          {isWebsiteActive ? (
            <div className="w-full h-full manus-transition-enter gpu-accelerated">
              <Suspense fallback={<RouteLoadingFallback />}>
                <WebsiteBuilderView
                  websiteName={websiteTask?.websiteName || 'Website'}
                  steps={websiteSteps}
                  status={websiteStatus === 'idle' ? 'running' : websiteStatus as any}
                  onReset={handleReset}
                  previewUrl={previewUrl}
                  isLoading={isBuilding || isInitializing}
                />
              </Suspense>
            </div>
          ) : (
            <div key={location.pathname} className="w-full h-full manus-transition-enter gpu-accelerated">
              <ErrorBoundary>
                <Suspense fallback={<RouteLoadingFallback />}>
                  <Routes>
                    <Route path="/" element={<Home onStartTask={handleStartTask} />} />
                    <Route 
                      path="/task/:taskId" 
                      element={
                        <TaskView 
                          useAgentTaskResult={agentTask} 
                          onReset={handleReset} 
                        />
                      } 
                    />
                    <Route 
                      path="/settings" 
                      element={
                        <SettingsModal isOpen={true} onClose={() => navigate('/')} onBack={() => navigate('/')} />
                      } 
                    />
                    <Route 
                      path="/settings/voice" 
                      element={
                        <AndroidVoiceSettings onBack={() => navigate('/settings')} />
                      } 
                    />
                    <Route 
                      path="/settings/connectors" 
                      element={
                        <AndroidConnectorsSettings onBack={() => navigate('/settings')} />
                      } 
                    />
                    <Route 
                      path="/chat" 
                      element={
                        <MyAIChat onBack={() => navigate('/')} />
                      } 
                    />
                    <Route 
                      path="/my-ai" 
                      element={
                        <MyAIChat onBack={() => navigate('/')} />
                      } 
                    />
                    <Route path="*" element={<Navigate to="/" replace />} />
                  </Routes>
                </Suspense>
              </ErrorBoundary>
            </div>
          )}
        </main>
      </div>

      {/* Lazy Slide-out Activity & History Panel — stays mounted after first open for spring exit transition */}
      {loadedPanels.history && (
        <Suspense fallback={null}>
          <HistoryPanel 
            isOpen={isHistoryOpen} 
            onClose={closeWorkspacePanel}
            initialTab={historyInitialTab}
            onSelectTask={(id) => {
              setActivePanel(null);
              navigate(`/task/${id}`);
            }}
          />
        </Suspense>
      )}

      {/* Lazy Global Settings & Preferences Modal — stays mounted after first open for spring exit transition */}
      {loadedPanels.settings && (
        <Suspense fallback={null}>
          <SettingsModal
            isOpen={isSettingsOpen}
            onClose={closeWorkspacePanel}
            initialTab={settingsInitialTab}
            activeTaskInfo={activeTaskInfo}
          />
        </Suspense>
      )}

      {/* Lazy Connectors & Plugins Store Panel — mounted at top level so closing Sidebar never unmounts it */}
      {loadedPanels.connectors && (
        <Suspense fallback={null}>
          <ConnectorsStorePanel
            isOpen={isConnectorsOpen}
            initialSection={resolveConnectorsSection(activePanel)}
            onClose={closeWorkspacePanel}
          />
        </Suspense>
      )}

      {/* Lazy Tag Analytics Modal — mounted at top level so closing Sidebar never unmounts it */}
      {loadedPanels.analytics && (
        <Suspense fallback={null}>
          <TagAnalyticsModal
            isOpen={isTagAnalyticsOpen}
            onClose={closeWorkspacePanel}
          />
        </Suspense>
      )}
    </div>
  );
}

export default function App() {
  return (
    <ErrorBoundary
      title="Application Error"
      description="The app could not render this view. Your account and saved conversations have not been reset. Reload to try again."
    >
      <ThemeProvider>
        <FirebaseProvider>
          <BlinkProvider
            projectId={PROJECT_ID}
            publishableKey={PUBLISHABLE_KEY}
          >
            <BlinkAuthProvider>
              <BrowserRouter>
                <AppContent />
                <Toaster />
              </BrowserRouter>
            </BlinkAuthProvider>
          </BlinkProvider>
        </FirebaseProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}
