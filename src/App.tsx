import React, { useEffect } from 'react';
import { BrowserRouter, Routes, Route, useNavigate, useParams, useLocation } from 'react-router-dom';
import { Sidebar } from './components/layout/Sidebar';
import { Topbar } from './components/layout/Topbar';
import { Home } from './pages/Home';
import { ChatView } from './components/agent/ChatView';
import { WebsiteBuilderView } from './components/agent/WebsiteBuilderView';
import { HistoryPanel } from './components/history/HistoryPanel';
import { SettingsModal } from './components/settings/SettingsModal';
import { AndroidVoiceSettings } from './components/settings/AndroidVoiceSettings';
import { AndroidConnectorsSettings } from './components/settings/AndroidConnectorsSettings';
import { MyAIChat } from './components/chat/MyAIChat';
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
        status={taskStatus === 'idle' ? 'running' : taskStatus as any}
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
      const hidden = document.visibilityState === 'hidden';
      const mode = reducedMotion || batteryLow ? 'saver' : 'balanced';
      
      document.documentElement.dataset.perfMode = mode;
      document.documentElement.dataset.pageHidden = hidden ? 'true' : 'false';
      document.documentElement.dataset.batteryLow = batteryLow ? 'true' : 'false';
      document.documentElement.dataset.pausePolling = batteryLow ? 'true' : 'false';
      document.documentElement.dataset.animFps = batteryLow || mode === 'saver' ? 'low' : 'normal';

      window.dispatchEvent(new CustomEvent('manus_battery_saver_change', {
        detail: { batteryLow, pausePolling: batteryLow, perfMode: mode }
      }));
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
      delete document.documentElement.dataset.batteryLow;
      delete document.documentElement.dataset.pausePolling;
      delete document.documentElement.dataset.animFps;
    };
  }, []);


  // Global keyboard shortcuts (Ctrl+H: History, Ctrl+, : Settings)
  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'h') {
        e.preventDefault();
        setHistoryInitialTab('sessions');
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
    const handleOpenHistory = (e?: any) => {
      const tab = e?.detail?.tab || 'sessions';
      setHistoryInitialTab(tab);
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
            onOpenHistory={() => {
              setHistoryInitialTab('sessions');
              setIsHistoryOpen(true);
            }} 
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
              <ErrorBoundary>
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
              </ErrorBoundary>
            </div>
          )}
        </main>
      </div>

      {/* Slide-out Activity & History Panel */}
      <HistoryPanel 
        isOpen={isHistoryOpen} 
        onClose={() => setIsHistoryOpen(false)}
        initialTab={historyInitialTab}
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
        activeTaskInfo={{
          taskId: agentTask.taskId,
          prompt: agentTask.currentTask?.prompt,
          taskStatus: agentTask.taskStatus,
          messages: agentTask.messages,
          steps: agentTask.steps,
          result: agentTask.result,
        }}
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