import React, { useEffect } from 'react';
import { BrowserRouter, Routes, Route, useNavigate, useParams, useLocation } from 'react-router-dom';
import { Sidebar } from './components/layout/Sidebar';
import { Topbar } from './components/layout/Topbar';
import { Home } from './pages/Home';
import { ChatView } from './components/agent/ChatView';
import { WebsiteBuilderView } from './components/agent/WebsiteBuilderView';
import { useAgentTask } from './hooks/useAgentTask';
import { useWebsiteBuilder } from './hooks/useWebsiteBuilder';
import { BlinkProvider, BlinkAuthProvider, useBlinkAuth } from '@blinkdotnew/react';
import { Toaster } from './components/ui/sonner';
import { blink } from './lib/blink';

const PROJECT_ID = import.meta.env.VITE_BLINK_PROJECT_ID;
const PUBLISHABLE_KEY = import.meta.env.VITE_BLINK_PUBLISHABLE_KEY;

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
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useBlinkAuth();
  
  // Data analysis hook
  const agentTask = useAgentTask();
  const { startTask, resetTask } = agentTask;

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

  return (
    <div className="flex h-screen bg-background overflow-hidden">
      <Sidebar 
        isOpen={isSidebarOpen} 
        onToggle={() => setIsSidebarOpen(!isSidebarOpen)} 
        onNewTask={handleReset}
        activeTaskId={location.pathname.startsWith('/task/') ? location.pathname.split('/')[2] : undefined}
      />
      <div className="flex-1 flex flex-col min-w-0">
        {!isWebsiteActive && <Topbar />}
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
      <Toaster />
    </div>
  );
}

export default function App() {
  if (!PROJECT_ID || !PUBLISHABLE_KEY) {
    return (
      <div className="h-screen flex items-center justify-center p-6 bg-manus-cream text-center">
        <div className="max-w-md space-y-4">
          <h1 className="text-2xl font-serif font-bold">Configuration Missing</h1>
          <p className="text-muted-foreground">Please ensure VITE_BLINK_PROJECT_ID and VITE_BLINK_PUBLISHABLE_KEY are set in your environment.</p>
        </div>
      </div>
    );
  }

  return (
    <BlinkProvider 
      projectId={PROJECT_ID} 
      publishableKey={PUBLISHABLE_KEY}
      auth={{ mode: 'managed' }}
    >
      <BlinkAuthProvider>
        <BrowserRouter>
          <AppContent />
        </BrowserRouter>
      </BlinkAuthProvider>
    </BlinkProvider>
  );
}