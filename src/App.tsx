import React, { useEffect } from 'react';
import { BrowserRouter, Routes, Route, useNavigate, useParams, useLocation, Navigate } from 'react-router-dom';
import { Sidebar } from './components/layout/Sidebar';
import { Topbar } from './components/layout/Topbar';
import { Home } from './pages/Home';
import { ChatView } from './components/agent/ChatView';
import { WebsiteBuilderView } from './components/agent/WebsiteBuilderView';
import { HistoryPanel } from './components/history/HistoryPanel';
import { SettingsModal } from './components/settings/SettingsModal';
import { AndroidMainSettings } from './components/settings/AndroidMainSettings';
import { AndroidGeneralSettings } from './components/settings/AndroidGeneralSettings';
import { AndroidRobotSettings } from './components/settings/AndroidRobotSettings';
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

const PROJECT_ID = (import.meta as any).env?.VITE_BLINK_PROJECT_ID || 'manus-agent-clone-tkzhogvs';
const PUBLISHABLE_KEY = (import.meta as any).env?.VITE_BLINK_PUBLISHABLE_KEY || '';

/**
 * Route loading fallback UI rendered during route transitions or module loading
 */
function RouteLoadingFallback() {
  return (
    <div className="flex h-full w-full items-center justify-center p-8 bg-background text-foreground">
      <div className="flex flex-col items-center gap-3 text-muted-foreground animate-in fade-in duration-200">
        <span className="material-symbols-outlined animate-spin text-2xl text-primary">progress_activity</span>
        <span className="text-xs font-medium">Loading view...</span>
      </div>
    </div>
  );
}

/**
 * Error boundary component to safely catch and isolate route rendering exceptions
 */
interface ErrorBoundaryProps {
  children: React.ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error?: Error;
}

class RouteErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('[RouteErrorBoundary] Caught route transition error:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex flex-col items-center justify-center h-full w-full p-6 text-center bg-background text-foreground animate-in fade-in duration-200">
          <div className="max-w-md space-y-4 p-6 rounded-2xl border border-destructive/20 bg-destructive/5 shadow-sm">
            <div className="w-12 h-12 rounded-full bg-destructive/10 text-destructive flex items-center justify-center mx-auto">
              <span className="material-symbols-outlined text-2xl">warning</span>
            </div>
            <h3 className="text-base font-semibold">Route Navigation Exception</h3>
            <p className="text-xs text-muted-foreground leading-relaxed">
              A temporary issue occurred while transitioning routes. You can return home or retry.
            </p>
            <div className="flex justify-center gap-3 pt-2">
              <button
                type="button"
                onClick={() => {
                  this.setState({ hasError: false });
                  window.location.href = '/';
                }}
                className="px-4 py-2 rounded-xl bg-primary text-primary-foreground text-xs font-semibold hover:opacity-90 transition-opacity cursor-pointer"
              >
                Return to Home
              </button>
              <button
                type="button"
                onClick={() => this.setState({ hasError: false })}
                className="px-4 py-2 rounded-xl bg-muted text-foreground text-xs font-semibold hover:bg-muted/80 transition-colors cursor-pointer"
              >
                Retry
              </button>
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

// Wrapper for ChatView to handle params safely without returning null
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
  }, [taskId]);

  if (!taskId) {
    return (
      <div className="flex h-full w-full items-center justify-center p-8 bg-background text-foreground">
        <div className="flex flex-col items-center gap-3 text-muted-foreground animate-in fade-in duration-200">
          <p className="text-sm font-medium">No task session specified.</p>
          <button 
            type="button"
            onClick={onReset} 
            className="px-4 py-2 rounded-xl bg-primary text-primary-foreground text-xs font-semibold hover:opacity-90 transition-opacity cursor-pointer"
          >
            Return to Home
          </button>
        </div>
      </div>
    );
  }

  // Display a smooth loader while initial task content is fetching instead of returning null
  if (!currentTask && isLoading) {
    return (
      <div className="flex h-full w-full items-center justify-center p-8 bg-background text-foreground">
        <div className="flex flex-col items-center gap-3 text-muted-foreground animate-in fade-in duration-200">
          <span className="material-symbols-outlined animate-spin text-2xl text-primary">progress_activity</span>
          <p className="text-xs font-medium">Loading session context...</p>
        </div>
      </div>
    );
  }

  return (
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
      const websiteName = options.websiteName || prompt.split(' ').slice(0, 3).join(' ') + ' Website';
      startBuilding(prompt, websiteName);
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

  const handleSettingsBack = () => {
    if (window.history.length > 2) {
      navigate(-1);
    } else {
      navigate('/');
    }
  };

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
              <RouteErrorBoundary>
                <React.Suspense fallback={<RouteLoadingFallback />}>
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
                    
                    {/* Settings Navigation Routes */}
                    <Route 
                      path="/settings" 
                      element={
                        <AndroidMainSettings onBack={handleSettingsBack} />
                      } 
                    />
                    <Route 
                      path="/settings/general" 
                      element={
                        <AndroidGeneralSettings onBack={() => navigate('/settings')} />
                      } 
                    />
                    <Route 
                      path="/settings/robot" 
                      element={
                        <AndroidRobotSettings onBack={() => navigate('/settings')} />
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
                      path="/settings/*" 
                      element={
                        <AndroidMainSettings onBack={handleSettingsBack} />
                      } 
                    />

                    {/* Chat Routes */}
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

                    {/* Catch-all Fallback Route to prevent null component blank screens */}
                    <Route path="*" element={<Navigate to="/" replace />} />
                  </Routes>
                </React.Suspense>
              </RouteErrorBoundary>
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