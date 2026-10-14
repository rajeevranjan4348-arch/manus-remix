import React, { useEffect } from 'react';
import { BrowserRouter, Routes, Route, useNavigate, useParams, useLocation } from 'react-router-dom';
import { Sidebar } from './components/layout/Sidebar';
import { Topbar } from './components/layout/Topbar';
import { Home } from './pages/Home';
import { ChatView } from './components/agent/ChatView';
import { WebsiteBuilderView } from './components/agent/WebsiteBuilderView';
import { HistoryPanel } from './components/history/HistoryPanel';
import { SettingsModal } from './components/settings/SettingsModal';
import { useAgentTask } from './hooks/useAgentTask';
import { useWebsiteBuilder } from './hooks/useWebsiteBuilder';
import { BlinkProvider, BlinkAuthProvider, useBlinkAuth } from '@blinkdotnew/react';
import { FirebaseProvider } from './context/FirebaseContext';
import { ThemeProvider } from './context/ThemeContext';
import { Toaster } from './components/ui/sonner';
import { blink } from './lib/blink';
import { configureHighQualityTTS } from './lib/audioPipeline';

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
  const { loadTask, resetTask, stopTask, currentTask, messages, steps, result, chartData, taskStatus, exportToPDF, sendMessage, isLoading } = useAgentTaskResult;

  useEffect(() => {
    if (taskId) {
      loadTask(taskId);
    }
  }, [taskId]); // Remove loadTask dependency to avoid infinite loop if it's not stable, but it is useCallback

  if (!currentTask && !taskId) return null;

  return (
    <ChatView
      prompt={currentTask?.prompt || ''}
      messages={messages}
      steps={steps}
      result={result}
      chartData={chartData}
      status={taskStatus === 'idle' ? 'running' : taskStatus as any}
      onReset={onReset}
      onExport={exportToPDF}
      onSubmit={sendMessage}
      onStop={stopTask}
      isLoading={isLoading}
    />
  );
}

function AppContent() {
  const [isSidebarOpen, setIsSidebarOpen] = React.useState(false);
  const [isHistoryOpen, setIsHistoryOpen] = React.useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = React.useState(false);
  const [settingsInitialTab, setSettingsInitialTab] = React.useState<'general' | 'robot' | 'ai' | 'personalization' | 'voice' | 'data' | 'about'>('general');
  const navigate = useNavigate();
  const location = useLocation();
  const { user, isLoading: isAuthLoading } = useBlinkAuth();
  
  // Data analysis hook
  const agentTask = useAgentTask();
  const { startTask, resetTask } = agentTask;

  // Initialize Web Speech API & audio processing clarity pipeline
  React.useEffect(() => {
    configureHighQualityTTS();
  }, []);

  // Adaptive rendering: preserve the current UI while reducing unnecessary work on low battery.
  React.useEffect(() => {
    let batteryManager: any = null;
    let disposed = false;

    const updatePerformanceMode = () => {
      if (disposed) return;
      const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
      const batteryLow = Boolean(batteryManager && !batteryManager.charging && batteryManager.level <= 0.2);
      const hidden = document.visibilityState === 'hidden';
      const mode = reducedMotion || batteryLow ? 'saver' : 'balanced';
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


  // Global keyboard shortcuts (Ctrl+H: History, Ctrl+, : Settings)
  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'h') {
        e.preventDefault();
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
      setIsSettingsOpen(true);
    };
    const handleOpenHistory = () => {
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

  const handleStartTask = async (prompt: string, options: any) => {
    if (options.format === 'website') {
      // Extract website name from prompt or use default
      const websiteName = options.websiteName || prompt.split(' ').slice(0, 3).join(' ') + ' Website';
      // setTaskType('website'); // logic moved to route
      startBuilding(prompt, websiteName);
      // Website builder doesn't have persistence yet in this refactor, keeping it as overlay or separate route
      // For now, let's keep website builder as a state-based view overlaying everything or separate route
      // navigating to /website?
    } else {
      const newTaskId = await startTask(prompt, options);
      if (newTaskId) {
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

  // Wait for Blink to restore the persisted session before rendering app routes.
  if (isAuthLoading) {
    return (
      <div className="flex h-screen items-center justify-center bg-background" role="status" aria-live="polite">
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-muted border-t-foreground" />
          <p className="text-sm text-muted-foreground">Restoring your session…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen w-full max-w-full bg-background overflow-hidden">
      <Sidebar 
        isOpen={isSidebarOpen} 
        onToggle={() => setIsSidebarOpen(!isSidebarOpen)} 
        onNewTask={handleReset}
        onOpenHistory={() => setIsHistoryOpen(true)}
        onOpenSettings={() => setIsSettingsOpen(true)}
        activeTaskId={location.pathname.startsWith('/task/') ? location.pathname.split('/')[2] : undefined}
      />
      <div className="flex-1 flex flex-col min-w-0">
        {!isWebsiteActive && (
          <Topbar 
            onToggleSidebar={() => setIsSidebarOpen(!isSidebarOpen)}
            onOpenHistory={() => setIsHistoryOpen(true)} 
            onNewTask={handleReset}
            onOpenSettings={() => setIsSettingsOpen(true)}
            onExport={agentTask.exportToPDF}
            showNewTask={hasSentMessage}
          />
        )}
        <main className="flex-1 overflow-hidden relative transition-all duration-300 ease-out">
          {isWebsiteActive ? (
            <div className="w-full h-full animate-in fade-in-0 slide-in-from-bottom-2 duration-350 ease-out">
              <WebsiteBuilderView
                websiteName={websiteTask?.websiteName || 'Website'}
                steps={websiteSteps}
                status={websiteStatus === 'idle' ? 'running' : websiteStatus as any}
                onReset={handleReset}
                previewUrl={previewUrl}
                isLoading={isBuilding || isInitializing}
              />
            </div>
          ) : (
            <div key={location.pathname} className="w-full h-full animate-in fade-in-0 slide-in-from-bottom-2 duration-350 ease-out">
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
              </Routes>
            </div>
          )}
        </main>
      </div>

      {/* Slide-out Activity & History Panel */}
      <HistoryPanel 
        isOpen={isHistoryOpen} 
        onClose={() => setIsHistoryOpen(false)}
        onSelectTask={(id) => {
          setIsHistoryOpen(false);
          navigate(`/task/${id}`);
        }}
      />

      {/* Global Settings & Preferences Modal */}
      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        initialTab={settingsInitialTab}
      />

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