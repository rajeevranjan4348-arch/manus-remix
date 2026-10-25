import React, { useEffect, lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, useNavigate, useParams, useLocation } from 'react-router-dom';
import { Sidebar } from './components/layout/Sidebar';
import { Topbar } from './components/layout/Topbar';
import { ChatView } from './components/agent/ChatView';

// Performance: split heavy, non-critical views into lazily-loaded chunks so the
// initial bundle only contains what is needed for first paint (Home shell + sidebar).
const Home = lazy(() => import('./pages/Home').then(m => ({ default: m.Home })));
const WebsiteBuilderView = lazy(() => import('./components/agent/WebsiteBuilderView').then(m => ({ default: m.WebsiteBuilderView })));
const HistoryPanel = lazy(() => import('./components/history/HistoryPanel').then(m => ({ default: m.HistoryPanel })));
const SettingsModal = lazy(() => import('./components/settings/SettingsModal').then(m => ({ default: m.SettingsModal })));
const AndroidVoiceSettings = lazy(() => import('./components/settings/AndroidVoiceSettings').then(m => ({ default: m.AndroidVoiceSettings })));
const AndroidConnectorsSettings = lazy(() => import('./components/settings/AndroidConnectorsSettings').then(m => ({ default: m.AndroidConnectorsSettings })));
const MyAIChat = lazy(() => import('./components/chat/MyAIChat').then(m => ({ default: m.MyAIChat })));

function RouteFallback() {
  return (
    <div className="flex h-full w-full items-center justify-center">
      <div className="h-8 w-8 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-primary" />
    </div>
  );
}
import { useAgentTask } from './hooks/useAgentTask';
import { useWebsiteBuilder } from './hooks/useWebsiteBuilder';
import { BlinkProvider, BlinkAuthProvider, useBlinkAuth } from '@blinkdotnew/react';
import { FirebaseProvider } from './context/FirebaseContext';
import { ThemeProvider } from './context/ThemeContext';
import { Toaster } from './components/ui/sonner';
import { blink } from './lib/blink';
import { configureHighQualityTTS } from './lib/audioPipeline';

import { ErrorBoundary } from './components/common/ErrorBoundary';

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
  const { loadTask, resetTask, stopTask, currentTask, messages, steps, reorderSteps, result, chartData, taskStatus, exportToPDF, sendMessage, isLoading } = useAgentTaskResult;

  useEffect(() => {
    if (taskId) {
      loadTask(taskId);
    }
  }, [taskId]); // Remove loadTask dependency to avoid infinite loop if it's not stable, but it is useCallback

  if (!currentTask && !taskId) return null;

  return (
    <ErrorBoundary
      title="Error loading task view"
      description="We encountered a problem loading this chat session. You can try reloading the view or creating a new task."
      onReset={resetTask}
    >
      <ChatView
        prompt={currentTask?.prompt || ''}
        messages={messages}
        steps={steps}
        onReorderSteps={reorderSteps}
        result={result}
        chartData={chartData}
        status={isLoading && taskStatus === 'idle' ? 'running' : taskStatus as any}
        onReset={onReset}
        onExport={exportToPDF}
        onSubmit={sendMessage}
        onStop={stopTask}
        isLoading={isLoading}
      />
    </ErrorBoundary>
  );
}

function AppContent() {
  const [isSidebarOpen, setIsSidebarOpen] = React.useState(false);
  const [isHistoryOpen, setIsHistoryOpen] = React.useState(false);
  const [historyInitialTab, setHistoryInitialTab] = React.useState<'sessions' | 'all' | 'photos' | 'videos' | 'docs'>('sessions');
  const [isSettingsOpen, setIsSettingsOpen] = React.useState(false);
  const [settingsInitialTab, setSettingsInitialTab] = React.useState<'general' | 'robot' | 'ai' | 'personalization' | 'voice' | 'data' | 'about'>('general');
  // Once a lazy panel/modal has been opened we keep its chunk mounted (it renders
  // closed via isOpen=false) so re-opening is instant; chunks are also prefetched
  // during idle time (see effect below).
  const [historyPreloaded, setHistoryPreloaded] = React.useState(false);
  const [settingsPreloaded, setSettingsPreloaded] = React.useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const { user, isLoading: isAuthLoading } = useBlinkAuth();
  
  // Data analysis hook
  const agentTask = useAgentTask();
  const { startTask, resetTask } = agentTask;

  // Non-blocking initialization of Web Speech API & audio pipeline
  React.useEffect(() => {
    if (typeof window !== 'undefined' && 'requestIdleCallback' in window) {
      (window as any).requestIdleCallback(() => configureHighQualityTTS());
    } else {
      setTimeout(() => configureHighQualityTTS(), 150);
    }
  }, []);

  // Adaptive rendering: preserve the current UI while reducing unnecessary work on low battery.
  React.useEffect(() => {
    let batteryManager: any = null;
    let disposed = false;

    const updatePerformanceMode = () => {
      if (disposed) return;
      const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
      const batteryLow = Boolean(batteryManager && !batteryManager.charging && batteryManager.level <= 0.2);
      const nav = navigator as any;
      const lowEndHardware =
        (typeof nav.deviceMemory === 'number' && nav.deviceMemory > 0 && nav.deviceMemory <= 4) ||
        (typeof nav.hardwareConcurrency === 'number' && nav.hardwareConcurrency > 0 && nav.hardwareConcurrency <= 4) ||
        Boolean(nav.connection?.saveData);
      const hidden = document.visibilityState === 'hidden';
      const mode = reducedMotion || batteryLow || lowEndHardware ? 'saver' : 'balanced';
      document.documentElement.dataset.perfMode = mode;
      document.documentElement.dataset.pageHidden = hidden ? 'true' : 'false';
    };

    const onVisibilityChange = () => updatePerformanceMode();
    const onMotionPreferenceChange = () => updatePerformanceMode();
    const motionPreference = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    document.addEventListener('visibilitychange', onVisibilityChange);
    motionPreference?.addEventListener?.('change', onMotionPreferenceChange);

    // The Battery Status API is optional and unsupported in many browsers; gracefully ignore it.
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
      document.removeEventListener('visibilitychange', onVisibilityChange);
      motionPreference?.removeEventListener?.('change', onMotionPreferenceChange);
      batteryManager?.removeEventListener?.('levelchange', updatePerformanceMode);
      batteryManager?.removeEventListener?.('chargingchange', updatePerformanceMode);
      delete document.documentElement.dataset.perfMode;
      delete document.documentElement.dataset.pageHidden;
    };
  }, []);


  // Warm the lazy chunks for History/Settings during idle time so opening them
  // later feels instantaneous, without competing with the initial page load.
  React.useEffect(() => {
    const prefetch = () => {
      import('./components/history/HistoryPanel').catch(() => {});
      import('./components/settings/SettingsModal').catch(() => {});
    };
    if ('requestIdleCallback' in window) {
      const id = (window as any).requestIdleCallback(prefetch, { timeout: 5000 });
      return () => (window as any).cancelIdleCallback(id);
    }
    const t = setTimeout(prefetch, 2500);
    return () => clearTimeout(t);
  }, []);

  // Global keyboard shortcuts (Ctrl+H: History, Ctrl+, : Settings)
  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'h') {
        e.preventDefault();
        setHistoryInitialTab('sessions');
        setHistoryPreloaded(true);
        setIsHistoryOpen(prev => !prev);
      }
      if ((e.ctrlKey || e.metaKey) && (e.key === ',' || e.key.toLowerCase() === 'p')) {
        e.preventDefault();
        setSettingsInitialTab('general');
        setIsSettingsOpen(prev => !prev);
      }
    };
    const handleOpenSettings = (e: any) => {
      const tab = e?.detail?.tab || 'general';
      setSettingsInitialTab(tab);
      setSettingsPreloaded(true);
      setIsSettingsOpen(true);
    };
    const handleOpenHistory = (e?: any) => {
      const tab = e?.detail?.tab || 'sessions';
      setHistoryInitialTab(tab);
      setHistoryPreloaded(true);
      setIsHistoryOpen(true);
    };
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('manus_open_settings', handleOpenSettings);
    window.addEventListener('manus_open_history', handleOpenHistory);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('manus_open_settings', handleOpenSettings);
      window.removeEventListener('manus_open_history', handleOpenHistory);
    };
  }, []);

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
      // Extract website name from prompt or use default
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

  const handleReset = () => {
    resetBuilder();
    resetTask();
    navigate('/');
  };

  const isWebsiteActive = websiteTask !== null;
  const isHomePage = location.pathname === '/';
  const hasSentMessage = !isHomePage || isWebsiteActive || Boolean(agentTask.currentTask) || agentTask.messages.length > 0 || agentTask.isLoading;



  return (
    <div className="flex h-screen w-full max-w-full bg-background overflow-hidden">
      <Sidebar 
        isOpen={isSidebarOpen} 
        onToggle={() => setIsSidebarOpen(!isSidebarOpen)} 
        onNewTask={handleReset}
        onOpenHistory={() => {
          setHistoryPreloaded(true);
          setIsHistoryOpen(true);
        }}
        onOpenSettings={() => {
          setSettingsPreloaded(true);
          setIsSettingsOpen(true);
        }}
        activeTaskId={location.pathname.startsWith('/task/') ? location.pathname.split('/')[2] : undefined}
      />
      <div className="flex-1 flex flex-col min-w-0">
        {!isWebsiteActive && (
          <Topbar 
            onToggleSidebar={() => setIsSidebarOpen(!isSidebarOpen)}
            onOpenHistory={() => {
              setHistoryInitialTab('sessions');
              setHistoryPreloaded(true);
              setIsHistoryOpen(true);
            }} 
            onNewTask={handleReset}
            onOpenSettings={() => {
              setSettingsPreloaded(true);
              setIsSettingsOpen(true);
            }}
            onExport={agentTask.exportToPDF}
            showNewTask={hasSentMessage}
          />
        )}
        <main className="flex-1 overflow-hidden relative transition-all duration-300 ease-out">
          {isWebsiteActive ? (
            <div className="w-full h-full animate-in fade-in-0 slide-in-from-bottom-2 duration-350 ease-out">
              <Suspense fallback={<RouteFallback />}>
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
            <div key={location.pathname} className="w-full h-full animate-in fade-in-0 slide-in-from-bottom-2 duration-300 ease-out gpu-accelerated">
              <ErrorBoundary>
                <Suspense fallback={<RouteFallback />}>
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
                </Routes>
                </Suspense>
              </ErrorBoundary>
            </div>
          )}
        </main>
      </div>

      {/* Slide-out Activity & History Panel (lazy chunk: only fetched when first opened) */}
      {isHistoryOpen || historyPreloaded ? (
        <Suspense fallback={null}>
          <HistoryPanel
            isOpen={isHistoryOpen}
            onClose={() => setIsHistoryOpen(false)}
            initialTab={historyInitialTab}
            onSelectTask={(id) => {
              setIsHistoryOpen(false);
              navigate(`/task/${id}`);
            }}
          />
        </Suspense>
      ) : null}

      {/* Global Settings & Preferences Modal (lazy chunk: only fetched when first opened) */}
      {isSettingsOpen || settingsPreloaded ? (
        <Suspense fallback={null}>
          <SettingsModal
            isOpen={isSettingsOpen}
            onClose={() => setIsSettingsOpen(false)}
            initialTab={settingsInitialTab}
            activeTaskInfo={{
              taskId: agentTask.taskId,
              prompt: agentTask.currentTask?.prompt,
              taskStatus: agentTask.taskStatus,
              messages: agentTask.messages,
              steps: agentTask.steps,
              result: agentTask.result,
            }}
          />
        </Suspense>
      ) : null}

      <Toaster />
    </div>
  );
}

export default function App() {
  return (
    <ThemeProvider>
      <FirebaseProvider>
        <BlinkProvider 
          projectId={PROJECT_ID} 
          publishableKey={PUBLISHABLE_KEY}
        >
          <BlinkAuthProvider>
            <BrowserRouter>
              <AppContent />
            </BrowserRouter>
          </BlinkAuthProvider>
        </BlinkProvider>
      </FirebaseProvider>
    </ThemeProvider>
  );
}