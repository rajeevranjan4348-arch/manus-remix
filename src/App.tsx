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
import { ThemeProvider } from './context/ThemeContext';
import { Toaster } from './components/ui/sonner';
import { blink } from './lib/blink';

const PROJECT_ID = (import.meta as any).env?.VITE_BLINK_PROJECT_ID || 'manus-agent-clone-tkzhogvs';
const PUBLISHABLE_KEY = (import.meta as any).env?.VITE_BLINK_PUBLISHABLE_KEY || 'blnk_pk_dummy';

// Wrapper for ChatView to handle params
function TaskView({ 
  useAgentTaskResult, 
  onReset 
}: { 
  useAgentTaskResult: ReturnType<typeof useAgentTask>, 
  onReset: () => void 
}) {
  const { taskId } = useParams();
  const { loadTask, resetTask, currentTask, messages, steps, result, chartData, taskStatus, exportToPDF, sendMessage, isLoading } = useAgentTaskResult;

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
      isLoading={isLoading}
    />
  );
}

function AppContent() {
  const [isSidebarOpen, setIsSidebarOpen] = React.useState(false);
  const [isHistoryOpen, setIsHistoryOpen] = React.useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = React.useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useBlinkAuth();
  
  // Data analysis hook
  const agentTask = useAgentTask();
  const { startTask, resetTask } = agentTask;

  // Global keyboard shortcuts (Ctrl+H: History, Ctrl+, : Settings)
  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'h') {
        e.preventDefault();
        setIsHistoryOpen(prev => !prev);
      }
      if ((e.ctrlKey || e.metaKey) && (e.key === ',' || e.key.toLowerCase() === 'p')) {
        e.preventDefault();
        setIsSettingsOpen(prev => !prev);
      }
    };
    const handleOpenSettings = () => {
      setIsSettingsOpen(true);
    };
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('manus_open_settings', handleOpenSettings);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('manus_open_settings', handleOpenSettings);
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
    <div className="flex h-screen bg-background overflow-hidden">
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
            showNewTask={hasSentMessage}
          />
        )}
        <main className="flex-1 overflow-hidden relative">
          {isWebsiteActive ? (
            <WebsiteBuilderView
              websiteName={websiteTask?.websiteName || 'Website'}
              steps={websiteSteps}
              status={websiteStatus === 'idle' ? 'running' : websiteStatus as any}
              onReset={handleReset}
              previewUrl={previewUrl}
              isLoading={isBuilding || isInitializing}
            />
          ) : (
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
      />

      <Toaster />
    </div>
  );
}

export default function App() {
  return (
    <ThemeProvider>
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
    </ThemeProvider>
  );
}