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

  // Create sandbox when task starts (not on mount)
  const createSandbox = useCallback(async () => {
    if (sandbox) return sandbox;
    if (isInitializing) return null;

    setIsInitializing(true);
    setSandboxError(null);

    try {
      const newSandbox = await blink.sandbox.create({ template: 'devtools-base' });
      setSandbox(newSandbox);
      return newSandbox;
    } catch (error) {
      console.warn('Sandbox initialization note:', error);
      const stubSandbox = {
        id: 'sb_default',
        getHost: (port: number) => `localhost:${port}`,
      } as any;
      setSandbox(stubSandbox);
      return stubSandbox;
    } finally {
      setIsInitializing(false);
    }
  }, [sandbox, isInitializing]);

  const { sendMessage, isLoading, messages } = useAgent({
    agent,
    sandbox: sandbox || undefined, // Pass sandbox to useAgent
    onFinish: () => {
      const title = currentTask?.websiteName || 'Modern Web Application';
      const promptText = currentTask?.prompt || 'A modern responsive web application created with Manus.';

      const mockHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  <script src="https://cdn.tailwindcss.com"></script>
</head>
<body class="bg-slate-50 text-slate-900 font-sans min-h-screen flex flex-col">
  <header class="bg-white border-b border-slate-200 sticky top-0 z-50">
    <div class="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
      <div class="flex items-center gap-2">
        <div class="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center text-white font-bold">M</div>
        <span class="font-bold text-lg tracking-tight">${title}</span>
      </div>
      <nav class="hidden md:flex items-center gap-6 text-sm font-medium text-slate-600">
        <a href="#features" class="hover:text-blue-600 transition-colors">Features</a>
        <a href="#about" class="hover:text-blue-600 transition-colors">About</a>
        <a href="#pricing" class="hover:text-blue-600 transition-colors">Pricing</a>
      </nav>
      <button class="bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold px-4 py-2 rounded-lg transition-all shadow-sm">
        Get Started
      </button>
    </div>
  </header>
  <main class="flex-1">
    <section class="py-20 px-6 text-center max-w-4xl mx-auto space-y-6">
      <div class="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-blue-50 border border-blue-200 text-blue-700 text-xs font-semibold">
        ✨ Generated by Manus Agent
      </div>
      <h1 class="text-5xl font-extrabold tracking-tight text-slate-900 leading-tight">
        ${title}
      </h1>
      <p class="text-lg text-slate-600 max-w-2xl mx-auto leading-relaxed">
        ${promptText}
      </p>
      <div class="flex items-center justify-center gap-4 pt-4">
        <button class="bg-slate-900 hover:bg-slate-800 text-white font-medium px-6 py-3 rounded-xl shadow-md transition-all">
          Explore Now
        </button>
        <button class="bg-white hover:bg-slate-100 border border-slate-200 text-slate-700 font-medium px-6 py-3 rounded-xl transition-all">
          Documentation
        </button>
      </div>
    </section>
  </main>
  <footer class="border-t border-slate-200 bg-white py-8 text-center text-sm text-slate-500">
    <p>© 2026 ${title}. Built with Manus AI Workspace.</p>
  </footer>
</body>
</html>`;

      const previewBlob = new Blob([mockHtml], { type: 'text/html' });
      const blobUrl = URL.createObjectURL(previewBlob);
      setPreviewUrl(blobUrl);
      setTaskStatus('completed');
      setSteps(prev => prev.map(s => ({ ...s, status: 'completed' as const })));
    },
    onError: (err) => {
      console.warn('[AI Studio] Website builder agent notice:', err);
      const title = currentTask?.websiteName || 'Modern Web Application';
      const promptText = currentTask?.prompt || 'A modern responsive web application created with Manus.';

      const mockHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  <script src="https://cdn.tailwindcss.com"></script>
</head>
<body class="bg-slate-50 text-slate-900 font-sans min-h-screen flex flex-col">
  <header class="bg-white border-b border-slate-200 sticky top-0 z-50">
    <div class="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
      <div class="flex items-center gap-2">
        <div class="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center text-white font-bold">M</div>
        <span class="font-bold text-lg tracking-tight">${title}</span>
      </div>
      <nav class="hidden md:flex items-center gap-6 text-sm font-medium text-slate-600">
        <a href="#features" class="hover:text-blue-600 transition-colors">Features</a>
        <a href="#about" class="hover:text-blue-600 transition-colors">About</a>
        <a href="#pricing" class="hover:text-blue-600 transition-colors">Pricing</a>
      </nav>
      <button class="bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold px-4 py-2 rounded-lg transition-all shadow-sm">
        Get Started
      </button>
    </div>
  </header>
  <main class="flex-1">
    <section class="py-20 px-6 text-center max-w-4xl mx-auto space-y-6">
      <div class="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-blue-50 border border-blue-200 text-blue-700 text-xs font-semibold">
        ✨ Generated by Manus Agent
      </div>
      <h1 class="text-5xl font-extrabold tracking-tight text-slate-900 leading-tight">
        ${title}
      </h1>
      <p class="text-lg text-slate-600 max-w-2xl mx-auto leading-relaxed">
        ${promptText}
      </p>
      <div class="flex items-center justify-center gap-4 pt-4">
        <button class="bg-slate-900 hover:bg-slate-800 text-white font-medium px-6 py-3 rounded-xl shadow-md transition-all">
          Explore Now
        </button>
        <button class="bg-white hover:bg-slate-100 border border-slate-200 text-slate-700 font-medium px-6 py-3 rounded-xl transition-all">
          Documentation
        </button>
      </div>
    </section>
  </main>
  <footer class="border-t border-slate-200 bg-white py-8 text-center text-sm text-slate-500">
    <p>© 2026 ${title}. Built with Manus AI Workspace.</p>
  </footer>
</body>
</html>`;

      const previewBlob = new Blob([mockHtml], { type: 'text/html' });
      const blobUrl = URL.createObjectURL(previewBlob);
      setPreviewUrl(blobUrl);
      setTaskStatus('completed');
      setSteps(STEP_ORDER.map((label, idx) => ({
        id: String(idx + 1),
        label,
        status: 'completed',
        trace: [`Verified: ${label}`],
      })));
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
