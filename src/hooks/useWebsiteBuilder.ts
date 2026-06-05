import { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { useAgent, Agent, sandboxTools, webSearch, useBlinkAuth } from '@blinkdotnew/react';
import type { Sandbox } from '@blinkdotnew/react';
import { blink } from '@/lib/blink';

export interface WebsiteStep {
  id: string;
  label: string;
  status: 'pending' | 'running' | 'completed' | 'error';
  trace?: string[];
}

// Standard step order for website building
const STEP_ORDER = [
  'Analyzing Requirements',
  'Initializing Project',
  'Installing Dependencies',
  'Creating Components',
  'Starting Dev Server',
  'Verifying Website'
];

export function useWebsiteBuilder() {
  const { isAuthenticated } = useBlinkAuth();
  const [sandbox, setSandbox] = useState<Sandbox | null>(null);
  const [previewUrl, setPreviewUrl] = useState('');
  const [isInitializing, setIsInitializing] = useState(false);
  const [currentTask, setCurrentTask] = useState<{ prompt: string; websiteName: string } | null>(null);
  const [steps, setSteps] = useState<WebsiteStep[]>([]);
  const [taskStatus, setTaskStatus] = useState<'idle' | 'running' | 'completed' | 'error'>('idle');
  const [sandboxError, setSandboxError] = useState<string | null>(null);
  const completedStepsRef = useRef<Set<string>>(new Set());
  const hasVerifiedRef = useRef(false);

  // Define the website builder agent
  const agent = useMemo(() => new Agent({
    model: 'google/gemini-3-flash',
    system: `You are Manus Website Builder, an expert at creating beautiful websites quickly.

Your mission: Build a complete, production-ready website based on user requirements.

CRITICAL WORKFLOW:
1. Create project structure using vite-react template
2. Install dependencies (use bun for speed)
3. Configure vite.config.js with allowedHosts: true (MANDATORY)
4. Build the website components and pages
5. Start dev server on port 3000 with host 0.0.0.0
6. Verify the site is accessible

REQUIREMENTS:
- Use modern React + TypeScript + Tailwind CSS
- Create responsive, beautiful UI with proper design system
- Follow best practices (components, hooks, proper file structure)
- Ensure accessibility and SEO basics
- Start dev server in background with: npm run dev -- --port 3000 --host 0.0.0.0

STEPS TO EXECUTE:
1. npm create vite@latest website -- --template react-ts
2. cd website && bun install
3. Write vite.config.js with server.allowedHosts: true
4. Create components based on requirements
5. npm run dev (background: true)
6. curl http://localhost:3000 to verify

Be efficient, create clean code, and ensure the preview works perfectly.`,
    tools: [...sandboxTools, webSearch],
    maxSteps: 25,
  }), []);

  // Create sandbox when authenticated and task starts (not on mount)
  const createSandbox = useCallback(async () => {
    if (!isAuthenticated) {
      blink.auth.login(window.location.href);
      return null;
    }

    if (sandbox) return sandbox;
    if (isInitializing) return null;

    setIsInitializing(true);
    setSandboxError(null);

    try {
      const newSandbox = await blink.sandbox.create({ template: 'devtools-base' });
      setSandbox(newSandbox);
      return newSandbox;
    } catch (error) {
      console.error('Failed to create sandbox:', error);
      const errorMsg = error instanceof Error ? error.message : 'Failed to create sandbox';
      setSandboxError(errorMsg);
      setTaskStatus('error');
      return null;
    } finally {
      setIsInitializing(false);
    }
  }, [isAuthenticated, sandbox, isInitializing]);

  const { sendMessage, isLoading, messages } = useAgent({
    agent,
    sandbox, // Pass sandbox to useAgent
    onFinish: () => {
      // Only mark complete if we've verified the website
      if (hasVerifiedRef.current && sandbox) {
        const url = `https://${sandbox.getHost(3000)}`;
        setPreviewUrl(url);
        setTaskStatus('completed');
        // Mark all remaining steps as completed
        setSteps(prev => prev.map(s => 
          s.status === 'running' || s.status === 'pending' 
            ? { ...s, status: 'completed' } 
            : s
        ));
      } else if (sandbox) {
        // Agent finished but didn't verify - mark as running still
        // The preview URL will be set when the last step completes
        const url = `https://${sandbox.getHost(3000)}`;
        setPreviewUrl(url);
        // Check if most steps are done
        setSteps(prev => {
          const completedCount = prev.filter(s => s.status === 'completed').length;
          if (completedCount >= prev.length - 1) {
            setTaskStatus('completed');
            return prev.map(s => ({ ...s, status: 'completed' }));
          }
          return prev;
        });
      }
    },
    onError: (err) => {
      setTaskStatus('error');
      setSteps(prev => prev.map(s => 
        s.status === 'running' ? { ...s, status: 'error', trace: [...(s.trace || []), `Error: ${err.message}`] } : s
      ));
    }
  });

  // Helper to mark a step complete and advance to next
  const completeStep = useCallback((stepLabel: string) => {
    if (completedStepsRef.current.has(stepLabel)) return;
    completedStepsRef.current.add(stepLabel);
    
    setSteps(prev => {
      const stepIndex = prev.findIndex(s => s.label === stepLabel);
      if (stepIndex === -1) return prev;
      
      return prev.map((s, i) => {
        if (i < stepIndex) return { ...s, status: 'completed' as const };
        if (i === stepIndex) return { ...s, status: 'completed' as const };
        if (i === stepIndex + 1) return { ...s, status: 'running' as const };
        return s;
      });
    });
  }, []);

  // Track tool calls and update steps dynamically
  useEffect(() => {
    if (messages.length === 0 || taskStatus !== 'running') return;
    
    // Process all messages to find tool calls
    messages.forEach((msg) => {
      if (msg.role === 'assistant' && msg.parts) {
        msg.parts.forEach((part: any) => {
          if (part.type === 'tool-invocation') {
            const toolName = part.toolName;
            const cmd = part.input?.command || '';
            
            // Determine which step this tool call represents
            if (toolName === 'run_terminal_cmd') {
              if (cmd.includes('create vite') || cmd.includes('npm init') || cmd.includes('mkdir')) {
                completeStep('Analyzing Requirements');
                setSteps(prev => prev.map(s => s.label === 'Initializing Project' ? { ...s, status: 'running', trace: ['Creating Vite + React project...'] } : s));
              } else if (cmd.includes('install') || cmd.includes('bun add') || cmd.includes('npm i')) {
                completeStep('Initializing Project');
                setSteps(prev => prev.map(s => s.label === 'Installing Dependencies' ? { ...s, status: 'running', trace: ['Installing packages...'] } : s));
              } else if (cmd.includes('npm run dev') || cmd.includes('vite') || cmd.includes('--port')) {
                completeStep('Installing Dependencies');
                completeStep('Creating Components');
                setSteps(prev => prev.map(s => s.label === 'Starting Dev Server' ? { ...s, status: 'running', trace: ['Launching on port 3000...'] } : s));
              } else if (cmd.includes('curl')) {
                completeStep('Starting Dev Server');
                setSteps(prev => prev.map(s => s.label === 'Verifying Website' ? { ...s, status: 'running', trace: ['Checking server response...'] } : s));
                hasVerifiedRef.current = true;
              }
            } else if (toolName === 'write_file') {
              // Writing files means we're creating components
              const filePath = part.input?.path || '';
              if (filePath.includes('.tsx') || filePath.includes('.jsx') || filePath.includes('.css') || filePath.includes('index.html')) {
                setSteps(prev => {
                  const creatingIdx = prev.findIndex(s => s.label === 'Creating Components');
                  if (creatingIdx !== -1 && prev[creatingIdx].status === 'pending') {
                    completeStep('Installing Dependencies');
                  }
                  return prev.map(s => s.label === 'Creating Components' ? { 
                    ...s, 
                    status: 'running', 
                    trace: [...(s.trace || []).slice(-2), `Writing: ${filePath.split('/').pop()}`] 
                  } : s);
                });
              }
            }
          }
          
          // Check for tool results that indicate completion
          if (part.type === 'tool-result') {
            const result = part.result;
            if (typeof result === 'string' && (result.includes('<!DOCTYPE') || result.includes('<html') || result.includes('200'))) {
              completeStep('Verifying Website');
              hasVerifiedRef.current = true;
            }
          }
        });
      }
    });
  }, [messages, taskStatus, completeStep]);

  const startBuilding = useCallback(async (prompt: string, websiteName: string) => {
    if (!isAuthenticated) {
      blink.auth.login(window.location.href);
      return;
    }

    // Reset refs
    completedStepsRef.current = new Set();
    hasVerifiedRef.current = false;

    setCurrentTask({ prompt, websiteName });
    setTaskStatus('running');
    setPreviewUrl(''); // Reset preview URL
    setSandboxError(null);
    
    // Initial steps
    const initialSteps: WebsiteStep[] = [
      { id: '1', label: 'Analyzing Requirements', status: 'running', trace: ['Understanding website needs...', `Building: ${websiteName}`] },
      { id: '2', label: 'Initializing Project', status: 'pending', trace: [] },
      { id: '3', label: 'Installing Dependencies', status: 'pending', trace: [] },
      { id: '4', label: 'Creating Components', status: 'pending', trace: [] },
      { id: '5', label: 'Starting Dev Server', status: 'pending', trace: [] },
      { id: '6', label: 'Verifying Website', status: 'pending', trace: [] },
    ];
    
    setSteps(initialSteps);

    // Create sandbox if needed
    let activeSandbox = sandbox;
    if (!activeSandbox) {
      activeSandbox = await createSandbox();
      if (!activeSandbox) {
        // Sandbox creation failed - error already set in createSandbox
        setSteps(prev => prev.map((s, i) => i === 0 ? { ...s, status: 'error', trace: ['Failed to create sandbox'] } : s));
        return;
      }
    }

    // Build enhanced prompt
    const enhancedPrompt = `Build a website called "${websiteName}".

Requirements:
${prompt}

CRITICAL STEPS (execute in order):
1. Create project: npm create vite@latest website -- --template react-ts
2. Navigate: cd website
3. Install deps: bun install
4. MANDATORY: Write vite.config.js:
   import { defineConfig } from 'vite'
   import react from '@vitejs/plugin-react'
   export default defineConfig({
     plugins: [react()],
     server: { host: '0.0.0.0', port: 3000, allowedHosts: true }
   })
5. Build the website components based on requirements
6. Start server: npm run dev (run in background)
7. Verify: curl http://localhost:3000

The website should be production-ready, responsive, and beautiful. Use Tailwind CSS for styling.`;

    // Start agent execution
    sendMessage(enhancedPrompt);

  }, [isAuthenticated, sandbox, sendMessage, createSandbox]);

  const resetBuilder = useCallback(() => {
    setCurrentTask(null);
    setTaskStatus('idle');
    setSteps([]);
    setPreviewUrl('');
    completedStepsRef.current = new Set();
    hasVerifiedRef.current = false;
  }, []);

  return {
    startBuilding,
    resetBuilder,
    currentTask,
    steps,
    taskStatus,
    previewUrl,
    isLoading,
    isInitializing,
    sandbox,
    sandboxError,
    // isReady now only checks auth - sandbox is created on demand
    isReady: isAuthenticated && !isInitializing
  };
}
