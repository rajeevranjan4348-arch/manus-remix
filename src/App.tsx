import React, { useEffect, useCallback, useMemo, Suspense, lazy } from 'react';
import { BrowserRouter, Routes, Route, useNavigate, useParams, useLocation } from 'react-router-dom';
import { Sidebar } from './components/layout/Sidebar';
import { Topbar } from './components/layout/Topbar';
import { Home } from './pages/Home';
import { ChatView } from './components/agent/ChatView';
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

import { ErrorBoundary } from './components/common/ErrorBoundary';

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
const AndroidVoiceSettings = lazy(() =>
  import('./components/settings/AndroidVoiceSettings').then((m) => ({ default: m.AndroidVoiceSettings }))
);
const AndroidConnectorsSettings = lazy(() =>
  import('./components/settings/AndroidConnectorsSettings').then((m) => ({ default: m.AndroidConnectorsSettings }))
);
const MyAIChat = lazy(() =>
  import('./components/chat/MyAIChat').then((m) => ({ default: m.MyAIChat }))
);

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
  const { loadTask, resetTask, stopTask, currentTask, messages, steps, reorderSteps, result, chartData, taskStatus, phase, exportToPDF, sendMessage, isLoading } = useAgentTaskResult;

  useEffect(() => {
    if (taskId) {
      loadTask(taskId);
    }
  }, [taskId, loadTask]);

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
        phase={phase}
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
  const navigate = useNavigate();
  const location = useLocation();
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

  // Initialize Ultra-Lite Performance Engine (2GB RAM Android Target) & adaptive battery/visibility hooks
  React.useEffect(() => {
    const stopMonitoring = startPerformanceMonitoring();
    let batteryManager: any = null;
    let disposed = false;

    const updatePerformanceMode = () => {
      if (disposed) return;
      const activeProfile = getActivePerformanceProfile();
      const batteryLow = Boolean(batteryManager && !batteryManager.charging && batteryManager.level <= 0.2);
      const hidden = document.visibilityState === 'hidden';
      const effectiveMode = activeProfile === 'ultra-lite' ? 'ultra-lite' : batteryLow ? 'saver' : activeProfile;
      applyPerformanceProfileToDOM(effectiveMode);
      document.documentElement.dataset.pageHidden = hidden ? 'true' : 'false';
    };

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
        setIsSettingsOpen(false);
        setIsHistoryOpen(prev => !prev);
      }
      if ((e.ctrlKey || e.metaKey) && (e.key === ',' || e.key.toLowerCase() === 'p')) {
        e.preventDefault();
        setSettingsInitialTab('general');
        setIsHistoryOpen(false);
        setIsSettingsOpen(prev => !prev);
      }
    };
    const handleOpenSettings = (e: any) => {
      const tab = e?.detail?.tab || 'general';
      setSettingsInitialTab(tab);
      setIsHistoryOpen(false);
      setIsSidebarOpen(false);
      setIsSettingsOpen(true);
    };
    const handleOpenHistory = (e?: any) => {
      const tab = e?.detail?.tab || 'sessions';
      setHistoryInitialTab(tab);
      setIsSettingsOpen(false);
      setIsSidebarOpen(false);
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
    resetBuilder();
    resetTask();
    navigate('/');
  }, [resetBuilder, resetTask, navigate]);

  const handleToggleSidebar = useCallback(() => {
    setIsSidebarOpen(prev => !prev);
  }, []);

  const handleOpenHistory = useCallback(() => {
    setHistoryInitialTab('sessions');
    setIsSettingsOpen(false);
    setIsSidebarOpen(false);
    setIsHistoryOpen(true);
  }, []);

  const handleOpenSettings = useCallback(() => {
    setIsHistoryOpen(false);
    setIsSidebarOpen(false);
    setIsSettingsOpen(true);
  }, []);

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
        onNewTask={handleReset}
        onOpenHistory={handleOpenHistory}
        onOpenSettings={handleOpenSettings}
        activeTaskId={location.pathname.startsWith('/task/') ? location.pathname.split('/')[2] : undefined}
      />
      <div className="flex-1 flex flex-col min-w-0">
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
              <Suspense fallback={null}>
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
                <Suspense fallback={null}>
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

      {/* Lazy Slide-out Activity & History Panel — only mounted when opened */}
      {isHistoryOpen && (
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
      )}

      {/* Lazy Global Settings & Preferences Modal — only mounted when opened */}
      {isSettingsOpen && (
        <Suspense fallback={null}>
          <SettingsModal
            isOpen={isSettingsOpen}
            onClose={() => setIsSettingsOpen(false)}
            initialTab={settingsInitialTab}
            activeTaskInfo={activeTaskInfo}
          />
        </Suspense>
      )}

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