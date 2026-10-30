import { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { useAgent, Agent, webSearch, sandboxTools, fetchUrl, useBlinkAuth } from '@blinkdotnew/react';
import { blink, abortActiveAutonomousStreams, setActiveStreamContext } from '@/lib/blink';
import type { Sandbox } from '@blinkdotnew/sdk';
import { getSettings, playNotificationSound } from '@/lib/settingsStore';
import { speakCleanHumanVoice } from '@/lib/speechSynthesis';
import { sendBackgroundNotification } from '@/lib/permissionsManager';
import { emitRobotEvent } from '@/hooks/useRobotStateController';
import { matchVoiceCommand, executeOpenUrl, executeDeviceCommand } from '@/lib/voiceCommands';
import { detectToolIntent, executeConnectorTool, getConnectorState, handleConnectorError } from '@/lib/connectors';
import { fetchWorkspaceContextSummary } from '@/lib/workspaceContextService';
import { toast } from 'sonner';
import { longTermMemory } from '@/lib/longTermMemory';
import { knowledgeBase } from '@/lib/knowledgeBase';
import { captureExplicitMemory } from '@/lib/agentMemory';
import { taskCheckpoint } from '@/lib/taskCheckpoint';
import { notificationDispatcher } from '@/lib/notificationDispatcher';
import { securityCenter } from '@/lib/securityCenter';
import { modelRouter } from '@/lib/modelRouter';
import { skillsRegistry } from '@/lib/skillsSystem';
import {
  saveMessage,
  getMessages,
  createConversation,
  updateConversation,
  cleanChatTitle,
  StoredMessage,
} from '@/lib/chatDatabase';
import { tagTaskAfterCompletion } from '@/lib/taskTaggingService';
import { taskTagger } from '@/services/taskTagger';
import { exportChatSession, ChatExportFormat } from '@/lib/chatExport';
// Removed import chatAutoSave

export type AgentTaskPhase = 'idle' | 'tool-calling' | 'text-generation' | 'completed' | 'error';

type ConnectorRegistryEntry = { id?: string; name?: string; slug?: string; key?: string; keywords?: string[]; status?: string; connected?: boolean; authenticated?: boolean; isAuthenticated?: boolean; isConnected?: boolean; authStatus?: string; connectionStatus?: string; };
function getConnectorTerms(connector: ConnectorRegistryEntry): string[] {
  return [...new Set([connector.name, connector.slug, connector.key, connector.id, ...(connector.keywords || [])].filter((v): v is string => typeof v === 'string' && v.trim().length > 0).map(v => v.trim().toLowerCase()))];
}
function isConnectorAuthenticated(c: ConnectorRegistryEntry): boolean {
  const status = [c.status, c.authStatus, c.connectionStatus].filter(Boolean).join(' ').toLowerCase();
  return c.authenticated === true || c.isAuthenticated === true || c.connected === true || c.isConnected === true || /(^|\s)(connected|authenticated|authorized)(\s|$)/.test(status);
}
function findPromptConnector(prompt: string, connectors: ConnectorRegistryEntry[]): ConnectorRegistryEntry | undefined {
  const p = prompt.toLowerCase();
  const matches = connectors.filter(isConnectorAuthenticated).map(connector => ({ connector, term: getConnectorTerms(connector).filter(t => t.length > 1).sort((a,b) => b.length-a.length).find(t => p.includes(t)) })).filter(x => x.term);
  matches.sort((a,b) => (b.term?.length || 0) - (a.term?.length || 0));
  return matches[0]?.connector;
}
export function isSimpleConversationalPrompt(prompt: string): boolean {
  const clean = prompt
    .replace(/^\[MODE:[^\]]*\]\s*/i, '')
    .replace(/^\[Think Harder[^\]]*\]\s*/i, '')
    .trim();
  if (!clean) return true;
  if (/^(hi|hello|hey|hiya|howdy|yo|namaste|greetings|good\s+(morning|afternoon|evening|night)|how are you|what's up|whats up|thanks|thank you|ok|okay|bye|goodbye)[!?.\s]*$/i.test(clean)) {
    return true;
  }
  if (
    clean.length < 200 &&
    !/@(github|calendar|gmail|drive|docs|sheets|tasks|workspace|schedule|mail)\b/i.test(clean) &&
    !/https?:\/\//i.test(clean) &&
    !/\b(create a chart|generate a pdf|export|spreadsheet|build a website|scrape|connect to|analyze file|parse csv)\b/i.test(clean)
  ) {
    if (
      /^(who|what|when|where|why|how|can you|could you|tell me|explain|define|do you know)\b/i.test(clean) ||
      clean.split(/\s+/).length <= 12
    ) {
      return true;
    }
  }
  return false;
}

async function executeMatchingConnector(prompt: string): Promise<{ matched: boolean; connectorName?: string; result?: unknown }> {
  if (isSimpleConversationalPrompt(prompt)) {
    return { matched: false };
  }
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 1000);
    let registryResponse: Response;
    try {
      registryResponse = await fetch('/api/connectors', {
        method: 'GET',
        credentials: 'include',
        headers: { Accept: 'application/json' },
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
    if (!registryResponse.ok) {
      return { matched: false };
    }
    const contentType = registryResponse.headers.get('content-type') || '';
    if (!contentType.toLowerCase().includes('application/json')) {
      return { matched: false };
    }
    const payload = await registryResponse.json().catch(() => null);
    if (!payload) return { matched: false };
    const connectors: ConnectorRegistryEntry[] = Array.isArray(payload) ? payload : Array.isArray(payload?.connectors) ? payload.connectors : Array.isArray(payload?.data?.connectors) ? payload.data.connectors : [];
    const connector = findPromptConnector(prompt, connectors);
    if (!connector) return { matched: false };
    const connectorId = connector.id || connector.slug || connector.key;
    if (!connectorId) return { matched: false };
    const execController = new AbortController();
    const execTimer = setTimeout(() => execController.abort(), 2500);
    let response: Response;
    try {
      response = await fetch('/api/connectors/execute', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ connectorId, prompt, input: { prompt }, action: 'auto' }),
        signal: execController.signal,
      });
    } finally {
      clearTimeout(execTimer);
    }
    const execContentType = response.headers.get('content-type') || '';
    if (!execContentType.toLowerCase().includes('application/json')) {
      return { matched: false };
    }
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(typeof result?.error === 'string' ? result.error : 'Connector execution failed (HTTP ' + response.status + ').');
    return { matched: true, connectorName: connector.name || connector.slug || connectorId, result };
  } catch (err) {
    console.warn('[useAgentTask] Connector lookup skipped:', err);
    return { matched: false };
  }
}

export interface Step {
  id: string;
  label: string;
  status: 'pending' | 'running' | 'completed' | 'error';
  trace?: string[];
}

export interface ChartData {
  labels: string[];
  datasets: {
    label: string;
    data: number[];
    backgroundColor?: string[];
    borderColor?: string;
  }[];
}

export function useAgentTask() {
  const { isAuthenticated, user } = useBlinkAuth();
  const [taskId, setTaskId] = useState<string | null>(null);
  const [currentTask, setCurrentTask] = useState<{ prompt: string; options: any; fileData?: string; url?: string } | null>(null);
  const [steps, setSteps] = useState<Step[]>([]);
  const [taskStatus, setTaskStatus] = useState<'idle' | 'running' | 'completed' | 'error'>('idle');
  const [phase, setPhase] = useState<AgentTaskPhase>('idle');
  const [result, setResult] = useState<any>(null);
  const [chartData, setChartData] = useState<ChartData | null>(null);
  const [sandbox, setSandbox] = useState<Sandbox | null>(null);
  const [persistentMessages, setPersistentMessages] = useState<any[]>([]);
  const [liveStreamText, setLiveStreamText] = useState<string>('');
  const liveStreamTextRef = useRef<string>('');
  const messagesRef = useRef<any[]>([]);
  const persistentMessagesRef = useRef<any[]>([]);
  persistentMessagesRef.current = persistentMessages;
  const currentTaskIdRef = useRef<string | null>(null);
  currentTaskIdRef.current = taskId;
  const currentTaskRef = useRef<{ prompt: string; options: any; fileData?: string; url?: string } | null>(null);
  currentTaskRef.current = currentTask;
  const stepsRef = useRef<Step[]>([]);
  stepsRef.current = steps;
  const taskStatusRef = useRef<'idle' | 'running' | 'completed' | 'error'>('idle');
  taskStatusRef.current = taskStatus;
  const activeRequestIdRef = useRef<number>(0);
  const activeStreamRequestIdRef = useRef<string>('');
  const activeUserMsgIdRef = useRef<string>('');
  const activeAssistantMsgIdRef = useRef<string>('');
  const finalizedRequestIdsRef = useRef<Set<number>>(new Set());
  const completedSdkMsgIdsRef = useRef<Set<string>>(new Set());
  const stepTimersRef = useRef<Array<ReturnType<typeof setTimeout>>>([]);
  const streamRafRef = useRef<number | null>(null);
  const lastStreamFinishReasonRef = useRef<'stop' | 'error' | null>(null);
  const lastStreamErrorRef = useRef<string | null>(null);

  const clearStepTimers = useCallback(() => {
    for (const timer of stepTimersRef.current) {
      clearTimeout(timer);
    }
    stepTimersRef.current = [];
    if (streamRafRef.current !== null && typeof window !== 'undefined' && typeof window.cancelAnimationFrame === 'function') {
      window.cancelAnimationFrame(streamRafRef.current);
      streamRafRef.current = null;
    }
  }, []);

  const markExistingSdkMessagesCompleted = useCallback(() => {
    for (const m of messagesRef.current) {
      if (m?.id) {
        completedSdkMsgIdsRef.current.add(String(m.id));
      }
    }
  }, []);

  // Listen to real-time SSE stream deltas from blink.ts and coalesce React state updates
  // to display refresh frames (60-120 FPS) so rapid token bursts never block the main thread.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const handleDelta = (e: Event) => {
      const detail = (e as CustomEvent)?.detail;
      if (detail?.requestId && activeStreamRequestIdRef.current && detail.requestId !== activeStreamRequestIdRef.current) {
        return;
      }
      if (finalizedRequestIdsRef.current.has(activeRequestIdRef.current)) {
        return;
      }
      if (typeof detail?.text === 'string') {
        liveStreamTextRef.current = detail.text;
        // Once real response tokens begin arriving, stop synthetic step timers and complete active step banners
        if (stepTimersRef.current.length > 0) {
          for (const timer of stepTimersRef.current) {
            clearTimeout(timer);
          }
          stepTimersRef.current = [];
        }
        setSteps(prev => prev.some(s => s.status === 'running')
          ? prev.map(s => s.status === 'running' ? { ...s, status: 'completed' as const } : s)
          : prev
        );
        if (typeof window.requestAnimationFrame === 'function') {
          if (streamRafRef.current === null) {
            streamRafRef.current = window.requestAnimationFrame(() => {
              streamRafRef.current = null;
              if (!finalizedRequestIdsRef.current.has(activeRequestIdRef.current)) {
                setLiveStreamText(liveStreamTextRef.current);
              }
            });
          }
        } else {
          setLiveStreamText(detail.text);
        }
      }
    };
    const handleStreamDone = (e: Event) => {
      const detail = (e as CustomEvent)?.detail;
      if (detail?.requestId && activeStreamRequestIdRef.current && detail.requestId !== activeStreamRequestIdRef.current) {
        return;
      }
      clearStepTimers();
      if (detail?.finishReason === 'error' || detail?.finishReason === 'stop') {
        lastStreamFinishReasonRef.current = detail.finishReason;
      }
      if (typeof detail?.error === 'string' && detail.error.trim()) {
        lastStreamErrorRef.current = detail.error.trim();
      }
      if (!finalizedRequestIdsRef.current.has(activeRequestIdRef.current)) {
        if (typeof detail?.text === 'string' && detail.text) {
          liveStreamTextRef.current = detail.text;
          setLiveStreamText(detail.text);
        } else if (liveStreamTextRef.current) {
          setLiveStreamText(liveStreamTextRef.current);
        }
      }
    };
    window.addEventListener('manus_stream_delta', handleDelta);
    window.addEventListener('manus_stream_done', handleStreamDone);
    return () => {
      window.removeEventListener('manus_stream_delta', handleDelta);
      window.removeEventListener('manus_stream_done', handleStreamDone);
      if (streamRafRef.current !== null && typeof window.cancelAnimationFrame === 'function') {
        window.cancelAnimationFrame(streamRafRef.current);
        streamRafRef.current = null;
      }
    };
  }, [clearStepTimers]);

  // Clean up in-flight streams and loading indicators on component unmount
  useEffect(() => {
    return () => {
      abortActiveAutonomousStreams();
      setActiveStreamContext(null);
      clearStepTimers();
      isSubmittingRef.current = false;
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('manus_agent_generating', {
          detail: { isGenerating: false, mode: 'work' }
        }));
      }
    };
  }, [clearStepTimers]);

  // Initialize sandbox
  useEffect(() => {
    let mounted = true;
    if (isAuthenticated && !sandbox) {
      blink.sandbox.create({ template: 'devtools-base' }).then(sb => {
        if (mounted) setSandbox(sb);
      }).catch(err => console.error('Failed to create sandbox:', err));
    }
    return () => { mounted = false; };
  }, [isAuthenticated, sandbox]);

  const isSubmittingRef = useRef<boolean>(false);

  // Synchronize typing indicator in topbar and watchdog timer
  useEffect(() => {
    let watchdogTimer: any = null;
    if (taskStatus === 'running') {
      window.dispatchEvent(new CustomEvent('manus_agent_generating', {
        detail: { isGenerating: true, mode: 'work', text: 'Manus is typing...' }
      }));
      // 40-second watchdog to guarantee no permanently stuck loading states
      watchdogTimer = setTimeout(() => {
        console.warn('[useAgentTask] Watchdog: Task ran past timeout, recovering to terminal state');
        abortActiveAutonomousStreams();
        isSubmittingRef.current = false;
        clearStepTimers();
        setTaskStatus('error');
        setPhase('error');
        setResult({
          type: currentTask?.options?.format || 'chat',
          content: 'This request timed out before the AI service finished. Please retry, or check the selected model and server configuration.',
          error: true,
          retryable: true,
        });
        setSteps(prev => prev.map(s => s.status === 'running' ? { ...s, status: 'error' as const } : s));
        window.dispatchEvent(new CustomEvent('manus_agent_generating', {
          detail: { isGenerating: false, mode: 'work' }
        }));
      }, 40000);
    } else {
      window.dispatchEvent(new CustomEvent('manus_agent_generating', {
        detail: { isGenerating: false, mode: 'work' }
      }));
    }
    return () => {
      if (watchdogTimer) clearTimeout(watchdogTimer);
    };
  }, [taskStatus, clearStepTimers, currentTask]);

  // Clear stale loading indicator when switching between Chat and Work modes while idle
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const handleModeChanged = () => {
      if (!isSubmittingRef.current && taskStatus !== 'running') {
        window.dispatchEvent(new CustomEvent('manus_agent_generating', {
          detail: { isGenerating: false, mode: 'work' }
        }));
      }
    };
    window.addEventListener('manus_mode_changed', handleModeChanged);
    return () => window.removeEventListener('manus_mode_changed', handleModeChanged);
  }, [taskStatus]);

  // Define the agent
  const agent = useMemo(() => {
    let selectedModelId = 'gemini-3.8-flash';
    try {
      if (typeof localStorage !== 'undefined') {
        selectedModelId = localStorage.getItem('selected_manus_model') || 'gemini-3.8-flash';
      }
    } catch {}
    const modelMap: Record<string, string> = {
      'manus-1.6-lite': 'google/gemini-3.1-flash-lite',
      'manus-1.6-max': 'google/gemini-3.1-pro-preview',
      'gemini-3.1-pro-preview': 'google/gemini-3.1-pro-preview',
      'gemini-3.8-flash': 'google/gemini-3.8-flash',
      'gemini-3.1-flash-lite': 'google/gemini-3.1-flash-lite',
      'gemini-flash-latest': 'google/gemini-flash-latest',
      'gemini-2.5-flash': 'google/gemini-3.8-flash',
      'claude-3.5-sonnet': 'anthropic/claude-3.5-sonnet',
    };
    const activeModel = modelMap[selectedModelId] || 'google/gemini-3.8-flash';

    return new Agent({
      model: activeModel,
      system: `You are Manus, a premium AI workspace agent. Your goal is to turn prompts, file uploads (CSV, Excel, PDF), or URLs into actionable data analyses, charts, and reports.
    
    Guidelines:
    1. When given file content or CSV data, ALWAYS parse it, analyze the context, compute statistics if numeric, and identify insights.
    2. When given a URL, use web_search or fetch_url to research it thoroughly, extract key information, and if needed, structure findings as CSV data.
    3. For data analysis tasks, generate chart-ready data in JSON format with labels and datasets.
    4. Use multi-step reasoning - break analysis into: data profiling → cleaning → aggregation → insight generation.
    5. When creating charts, provide specific data points with proper labels.
    6. Never invent sample, placeholder, or illustrative data and present it as real. If the user has not provided data and a reliable source/tool has not returned data, clearly state that a chart needs data or label any example as illustrative.
    7. Validate chart JSON before using it: labels must be an array, datasets must be an array, each dataset must have a label and numeric data values, and data length should match labels length. If the structure is invalid, explain the issue instead of fabricating replacement values.
    8. For reports, include: executive summary, key findings (bullet points), detailed analysis, and recommendations.
    
    CHAT MODE BEHAVIOR:
    - When the request is ordinary conversation (for example "hello", "hi", casual questions, explanations, or follow-up discussion), respond naturally and directly like a normal chat assistant.
    - Do NOT call web_search, fetch_url, sandbox, or other tools for simple conversation.
    - Do NOT create analysis steps, reports, charts, files, or research workflows unless the user explicitly asks for them.
    - For a greeting such as "hello", answer briefly and warmly, e.g. "Hello! How can I help you?".
    - Only use web/tools when the user explicitly asks for current/live information, web research, a URL, file/data analysis, code execution, or another task that genuinely requires a tool.
    - In Chat mode, prioritize a fast conversational answer over autonomous task execution.
    - Format user-facing answers for easy scanning: use Markdown headings, short paragraphs, bullets, numbered steps, and code blocks when they improve clarity.
    - Use a small number of relevant emojis or icons where they add meaning (for example, ✅ for completed steps, ⚠️ for warnings, 💡 for tips, and 🔧 for developer guidance). Do not decorate every line or force emojis into serious, formal, or code-only answers.
    - Match answer length to the question: concise for simple questions and structured/detail-rich for complex requests.
    - Use tables only when comparing multiple items; preserve accurate facts and never use emojis as a substitute for explanation.
    - Do not invent stickers or claim to render animated media unless a supported image/sticker renderer and asset are actually available.

    RESPONSE GENERATION & ANSWER QUALITY LOGIC:
    1. First identify the user's actual intent, requested output, constraints, language, and whether the message is a follow-up. Answer the latest request—not an earlier or merely related question.
    2. Give the useful answer first. For simple questions, be direct and concise; for complex tasks, use clear sections, steps, examples, or a table only when it improves understanding.
    3. Use the active conversation's relevant context to resolve references and follow-ups. Do not mix in unrelated conversations, repeat the same point unnecessarily, or ask the user to restate information already available.
    4. Ground factual claims in reliable knowledge, supplied context, or tool results. For live, changing, or obscure facts, use an appropriate available tool when necessary. Never invent sources, citations, statistics, quotes, test results, file contents, or actions.
    5. Be transparent about uncertainty and limitations. If information is missing, say what is unknown; ask one focused clarifying question only when the missing detail materially prevents a useful answer. Otherwise state reasonable assumptions clearly and proceed.
    6. If tools or integrations are needed, use only tools that are actually available and authorized. Base conclusions on their returned results. Never claim a search, connector action, code execution, file creation, deployment, or change succeeded unless its result confirms success.
    7. For code and technical tasks, explain the solution and important edge cases, prefer working code over pseudocode when requested, preserve existing constraints, and distinguish verified behavior from untested suggestions.
    8. For data, charts, and analysis, validate inputs and calculations. Do not present illustrative or estimated values as real; label examples and estimates explicitly.
    9. Match the user's language and requested level of detail. Follow explicit format constraints. Do not force reports, tool calls, charts, emojis, or long explanations into a simple conversational answer.
    10. Before sending, silently check: Did I answer the latest question? Are claims supported? Did I follow constraints? Is the response complete, non-duplicative, and safe? Fix any obvious issue before finalizing.
    11. Do not reveal private chain-of-thought or internal deliberation, including <think> blocks. For complex questions, provide a concise explanation, key assumptions, calculations, evidence, and conclusions instead.
    12. When the request is ambiguous but still answerable, choose the most likely interpretation and briefly state it. When interpretations would lead to materially different actions, ask a concise clarifying question.

    Output Format Guide:
    - graph: Generate structured JSON with chart data (labels, datasets with values) AND include a "type" field (bar, line, pie, scatter, area, bubble) if 'auto' was requested.
    - document: If the user asks to create a document, PDF, or export, return JSON with:
      {
        "content": "Your message to the user...",
        "files": [
          { "name": "filename.pdf", "type": "pdf", "size": "282.40 KB" },
          { "name": "filename.md", "type": "markdown", "size": "6.42 KB" }
        ]
      }
    - report: Detailed markdown with sections, bullet points, and actionable insights
    - slides: Key takeaways in bullet format with supporting data
    - spreadsheet: Structured tabular data with headers
    
    Output Instructions:
    ALWAYS wrap your JSON output in \`\`\`json\`\`\` code blocks.
    If producing a document, ALWAYS simulate the file creation by returning the "files" array in your JSON.
    
    When analyzing data:
    1. Parse and validate the structure/content
    2. Identify data types (numeric, categorical, date) or key themes for unstructured data
    3. Compute summary statistics for numeric columns or summarize key sections for documents
    4. Identify trends, outliers, and correlations
    5. Generate visualization-ready data if requested or appropriate
    
    When researching URLs:
    1. Use web_search to find relevant information
    2. Extract key facts, data points, and trends
    3. Structure findings clearly
    4. If creating CSV, ensure proper headers and data rows
    `,
    tools: [webSearch, fetchUrl, ...sandboxTools],
    maxSteps: 20,
  });
}, []);

  const getCurrentTurnSdkAssistantText = useCallback((): string => {
    const msgs = messagesRef.current;
    if (!Array.isArray(msgs) || msgs.length === 0) return '';
    // Walk backwards only up to the latest user message in SDK state
    for (let i = msgs.length - 1; i >= 0; i--) {
      const m = msgs[i];
      if (!m) continue;
      if (m.role === 'user') break;
      if (
        m.role === 'assistant' &&
        (!m.id || !completedSdkMsgIdsRef.current.has(String(m.id))) &&
        typeof m.content === 'string' &&
        m.content.trim().length > 0
      ) {
        return m.content.trim();
      }
    }
    return '';
  }, []);

  const finalizeRequestTurn = useCallback((
    reqId: number,
    explicitActiveId?: string | null,
    explicitText?: string,
    rawResponse?: any
  ): boolean => {
    if (reqId !== activeRequestIdRef.current) {
      return false;
    }
    if (finalizedRequestIdsRef.current.has(reqId)) {
      return true;
    }
    if (lastStreamFinishReasonRef.current === 'error') {
      return false;
    }

    const rawText = (explicitText && explicitText.trim())
      ? explicitText.trim()
      : (liveStreamTextRef.current.trim() || getCurrentTurnSdkAssistantText());
    if (!rawText) {
      return false;
    }

    finalizedRequestIdsRef.current.add(reqId);
    markExistingSdkMessagesCompleted();
    setActiveStreamContext(null);

    const activeTask = currentTaskRef.current;
    const activeId = explicitActiveId || currentTaskIdRef.current || taskId;

    let parsedChartData = null;
    let extractedChartData = null;
    let parsedFiles = null;
    let detectedType = null;

    const jsonMatch = rawText.match(/```json\n?([\s\S]*?)\n?```/) || rawText.match(/```\n?([\s\S]*?)\n?```/);
    let parsedJson: any = null;

    if (jsonMatch) {
      try {
        parsedJson = JSON.parse(jsonMatch[1]);
      } catch (e) {
        console.log('Failed to parse json block:', e);
      }
    } else if (rawText.trim().startsWith('{') && rawText.trim().endsWith('}')) {
      try {
        parsedJson = JSON.parse(rawText.trim());
      } catch {}
    }

    if (parsedJson) {
      const chartDataCandidate = parsedJson.graph || parsedJson.data || parsedJson;
      const hasValidChartShape =
        Array.isArray(chartDataCandidate?.labels) &&
        chartDataCandidate.labels.length > 0 &&
        chartDataCandidate.labels.every((label: unknown) => typeof label === 'string' || typeof label === 'number') &&
        Array.isArray(chartDataCandidate?.datasets) &&
        chartDataCandidate.datasets.length > 0 &&
        chartDataCandidate.datasets.every((dataset: any) =>
          dataset &&
          typeof dataset.label === 'string' &&
          Array.isArray(dataset.data) &&
          dataset.data.length === chartDataCandidate.labels.length &&
          dataset.data.every((value: unknown) => typeof value === 'number' && Number.isFinite(value))
        );
      if (hasValidChartShape) {
        parsedChartData = parsedJson;
        extractedChartData = chartDataCandidate;
        detectedType = parsedJson.graph?.type || parsedJson.type || 'bar';
        setChartData(chartDataCandidate);
      }
      if (parsedJson.files) {
        parsedFiles = parsedJson.files;
      }
    }

    const isGraphRequested =
      activeTask?.options?.format === 'graph' ||
      persistentMessagesRef.current.some(m => m.role === 'user' && /\b(graph|chart|plot|diagram|histogram|pie\s+chart|bar\s+chart|line\s+chart|scatter\s+plot)\b/i.test(m.content));

    if (isGraphRequested && !extractedChartData) {
      setChartData(null);
    }

    const cleanedText = parsedChartData?.content || rawText.replace(/```json\n?[\s\S]*?\n?```/g, '').trim() || rawText;
    const assistantMsgId = activeAssistantMsgIdRef.current || ('msg_' + Date.now() + '_' + Math.random().toString(36).substring(2, 8));
    const assistantMsg = {
      id: assistantMsgId,
      role: 'assistant' as const,
      content: cleanedText,
      timestamp: new Date().toISOString(),
      status: 'success' as const,
    };

    const nextMessages = (() => {
      const prev = persistentMessagesRef.current;
      const existingIdx = prev.findIndex(m => m?.id === assistantMsgId);
      if (existingIdx !== -1) {
        const copy = [...prev];
        copy[existingIdx] = assistantMsg;
        return copy;
      }
      const last = prev[prev.length - 1];
      if (last && last.role === 'assistant' && last.content?.trim() === cleanedText.trim()) {
        return prev;
      }
      return [...prev, assistantMsg];
    })();

    persistentMessagesRef.current = nextMessages;
    setPersistentMessages(nextMessages);

    const finalResult = {
      type: isGraphRequested || extractedChartData ? 'graph' : (activeTask?.options?.format || 'report'),
      content: cleanedText,
      chartData: extractedChartData || parsedChartData,
      files: parsedFiles,
      detectedChartType: detectedType || parsedChartData?.graph?.type || (activeTask?.options?.chartType !== 'auto' ? activeTask?.options?.chartType : undefined) || 'bar',
      rawResponse: rawResponse ?? null,
      messages: nextMessages,
    };

    liveStreamTextRef.current = '';
    setLiveStreamText('');
    setResult(finalResult);
    isSubmittingRef.current = false;
    setTaskStatus('completed');
    setPhase('completed');
    const completedSteps = stepsRef.current.map(s => ({ ...s, status: 'completed' as const }));
    setSteps(completedSteps);
    emitRobotEvent('TASK_SUCCEEDED');
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('manus_agent_generating', {
        detail: { isGenerating: false, mode: 'work' }
      }));
    }

    if (activeId) {
      saveMessage({
        id: assistantMsgId,
        conversationId: activeId,
        userId: user?.id || 'usr_manus_default',
        role: 'assistant',
        content: cleanedText,
        status: 'success',
      }).catch(err => console.warn('Failed to save assistant response to DB:', err));

      Promise.resolve((blink.db as any).tasks.update(activeId, {
        status: 'completed',
        result: JSON.stringify(finalResult),
        steps: JSON.stringify(completedSteps),
      })).catch(e => console.error('Failed to update task in DB:', e));

      updateConversation(activeId, {
        status: 'completed',
        result: finalResult,
        steps: completedSteps,
      }).catch(() => {});

      taskTagger.processTaskTags(activeId, activeTask?.prompt || cleanedText, cleanedText).catch(() => {});
      taskCheckpoint.clearCheckpoint(activeId);
    }

    const curSettings = getSettings();
    if (curSettings.autoPlayAudio || activeTask?.options?.voicePlayback) {
      speakCleanHumanVoice(cleanedText, {
        voicePersona: curSettings.voicePersona,
        rate: curSettings.speechSpeed,
        pitch: curSettings.voicePitch,
      });
    }

    if (typeof document !== 'undefined' && document.hidden && curSettings.enableBackgroundNotifications) {
      sendBackgroundNotification(
        'Manus AI Agent',
        `Task completed: ${cleanChatTitle(cleanedText)}`
      );
    }

    notificationDispatcher.dispatch({
      channel: 'task_completed',
      title: 'Manus AI Agent',
      body: `Task completed: ${cleanChatTitle(cleanedText)}`,
      taskId: activeId || undefined,
      sound: curSettings.soundEffects,
    });

    return true;
  }, [getCurrentTurnSdkAssistantText, markExistingSdkMessagesCompleted, taskId, user]);

  const useAgentResult = useAgent({
    agent,
    sandbox: sandbox || undefined,
    onFinish: async (response) => {
      const reqId = activeRequestIdRef.current;
      console.log('[Manus Agent] onFinish triggered for reqId:', reqId, response);
      clearStepTimers();
      markExistingSdkMessagesCompleted();

      if (finalizedRequestIdsRef.current.has(reqId)) {
        return;
      }

      const text = (typeof response?.text === 'string' && response.text.trim())
        ? response.text.trim()
        : liveStreamTextRef.current.trim();
      const isErrorFinish = response?.finishReason === 'error' || lastStreamFinishReasonRef.current === 'error';

      if (!text || isErrorFinish) {
        const errorContent = lastStreamErrorRef.current || (isErrorFinish && text ? text : "I didn't receive an answer from the AI service. Please try again.");
        console.error('[Manus AI] Provider finished with error or empty text:', errorContent);
        finalizedRequestIdsRef.current.add(reqId);
        setActiveStreamContext(null);
        isSubmittingRef.current = false;
        liveStreamTextRef.current = '';
        setLiveStreamText('');
        setTaskStatus('error');
        setPhase('error');
        setResult({
          type: currentTaskRef.current?.options?.format || 'chat',
          content: errorContent,
          error: true,
          retryable: true,
          rawResponse: response ?? null,
        });
        setSteps(prev => prev.map(step => ({
          ...step,
          status: step.status === 'completed' ? 'completed' as const : 'error' as const,
        })));
        emitRobotEvent('TASK_FAILED');
        window.dispatchEvent(new CustomEvent('manus_agent_generating', {
          detail: { isGenerating: false, mode: 'work' }
        }));
        playNotificationSound('pop');
        return;
      }

      finalizeRequestTurn(reqId, currentTaskIdRef.current || taskId, text, response);
    },
    onError: async (err) => {
      const reqId = activeRequestIdRef.current;
      console.error('[Manus Agent] onError triggered:', err);
      clearStepTimers();
      markExistingSdkMessagesCompleted();
      finalizedRequestIdsRef.current.add(reqId);
      setActiveStreamContext(null);
      isSubmittingRef.current = false;
      liveStreamTextRef.current = '';
      setLiveStreamText('');
      const message = err instanceof Error && err.message
        ? err.message
        : 'The selected AI provider could not complete this request.';
      const failureText = `AI response failed: ${message}. Please retry or check the selected model and server configuration.`;
      setResult({
        type: currentTaskRef.current?.options?.format || 'chat',
        content: failureText,
        error: true,
        retryable: true,
      });
      setTaskStatus('error');
      setPhase('error');
      setSteps(prev => prev.map(step => step.status === 'running'
        ? { ...step, status: 'error' as const }
        : step));
      emitRobotEvent('TASK_FAILED');
      window.dispatchEvent(new CustomEvent('manus_agent_generating', {
        detail: { isGenerating: false, mode: 'work' }
      }));
      toast.error('AI response failed. You can retry the request.');

      const activeId = currentTaskIdRef.current || taskId;
      if (activeId) {
        const errorMsgId = 'msg_error_' + Date.now();
        setPersistentMessages(prev => prev.some(m => m.role === 'assistant' && m.error && m.content === failureText)
          ? prev
          : [...prev, {
              id: errorMsgId,
              role: 'assistant' as const,
              content: failureText,
              timestamp: new Date().toISOString(),
              status: 'error' as const,
              error: true,
              retryable: true,
            }]);
        saveMessage({
          id: errorMsgId,
          conversationId: activeId,
          userId: user?.id || 'usr_manus_default',
          role: 'assistant',
          content: failureText,
          status: 'failed',
        }).catch(() => {});
        (blink.db as any).tasks.update(activeId, {
          status: 'error',
          result: JSON.stringify({ type: currentTaskRef.current?.options?.format || 'chat', content: failureText, error: true, retryable: true }),
        }).catch(() => {});
      }
    }
  });

  const { sendMessage: agentSendMessage, isLoading, messages, append, clearMessages } = useAgentResult;
  const setMessages = (useAgentResult as any).setMessages;

  // Keep messagesRef synchronized on every render so turn boundaries are always accurate
  messagesRef.current = messages;

  const finalizeAssistantTurnIfMissing = useCallback((activeId: string | null, reqIdOverride?: number) => {
    const reqId = reqIdOverride ?? activeRequestIdRef.current;
    return finalizeRequestTurn(reqId, activeId);
  }, [finalizeRequestTurn]);

  const stopTask = useCallback(() => {
    const interruptedReqId = activeRequestIdRef.current;
    const partialText = liveStreamTextRef.current.trim();
    if (partialText) {
      finalizeRequestTurn(interruptedReqId, currentTaskIdRef.current || taskId, partialText);
    }
    finalizedRequestIdsRef.current.add(interruptedReqId);
    activeRequestIdRef.current += 1;
    activeStreamRequestIdRef.current = '';
    setActiveStreamContext(null);
    abortActiveAutonomousStreams();
    clearStepTimers();
    markExistingSdkMessagesCompleted();
    const stop = (useAgentResult as any).stop || (useAgentResult as any).abort || (useAgentResult as any).cancel;
    if (typeof stop === 'function') {
      try { void stop(); } catch (error) { console.warn('[Agent] Stop request failed:', error); }
    }
    isSubmittingRef.current = false;
    liveStreamTextRef.current = '';
    setLiveStreamText('');
    setTaskStatus('completed');
    setPhase('completed');
    setSteps(prev => prev.map(step => step.status === 'running' ? { ...step, status: 'completed' as const } : step));
    emitRobotEvent('AI_GENERATION_ENDED');
    window.dispatchEvent(new CustomEvent('manus_agent_generating', {
      detail: { isGenerating: false, mode: 'work' }
    }));
    window.dispatchEvent(new CustomEvent('manus_robot_state_change', { detail: 'idle' }));
    toast.info('Generation stopped');
  }, [useAgentResult, clearStepTimers, finalizeRequestTurn, markExistingSdkMessagesCompleted, taskId]);

  const lastSubmitRef = useRef<{ prompt: string; timestamp: number }>({ prompt: '', timestamp: 0 });

  // Stream Completion Safeguard: Automatically finalize task state when SDK stream closes
  useEffect(() => {
    if (!isLoading && taskStatus === 'running' && !isSubmittingRef.current) {
      clearStepTimers();
      const reqId = activeRequestIdRef.current;
      const activeId = currentTaskIdRef.current || taskId;
      const finalized = finalizeRequestTurn(reqId, activeId);

      if (finalized) {
        return;
      }

      const lastMsg = persistentMessagesRef.current[persistentMessagesRef.current.length - 1];
      if (lastMsg?.role === 'assistant') {
        setTaskStatus('completed');
        setPhase('completed');
        setSteps(prev => prev.map(step => step.status === 'running' ? { ...step, status: 'completed' as const } : step));
      } else {
        const failureText = lastStreamErrorRef.current || 'The AI connection ended before a response was received. Please retry.';
        setResult({
          type: 'chat',
          content: failureText,
          error: true,
          retryable: true,
        });
        setTaskStatus('error');
        setPhase('error');
        setSteps(prev => prev.map(step => step.status === 'running'
          ? { ...step, status: 'error' as const }
          : step));
      }
      window.dispatchEvent(new CustomEvent('manus_agent_generating', {
        detail: { isGenerating: false, mode: 'work' }
      }));
    }
  }, [isLoading, taskStatus, taskId, clearStepTimers, finalizeRequestTurn]);

  const processedInvocationsRef = useRef<Set<string>>(new Set());

  const preparePromptWithConnectors = useCallback(async (prompt: string) => {
    setPhase('tool-calling');
    const activeUserId = user?.id || 'usr_manus_default';
    const simplePrompt = isSimpleConversationalPrompt(prompt);

    const buildEnrichedPrompt = async (): Promise<string> => {
      let enriched = prompt;
      // 1. Inject Long-Term Memory (local & bounded Firestore)
      try {
        const memoryContext = await longTermMemory.getRelevantContext(activeUserId, prompt);
        if (memoryContext) {
          enriched += `\n\n[USER SAVED PREFERENCES & FACTUAL MEMORY]:\n${memoryContext}`;
        }
      } catch {}

      // 2. Inject Workspace Knowledge Base RAG (local & synchronous-fast)
      try {
        const ragPassages = knowledgeBase.retrieve(prompt, activeUserId, 3);
        if (ragPassages.length > 0) {
          const textPassages = ragPassages
            .map(r => `Document "${r.citation.title}":\n${r.chunk.content}`)
            .join('\n\n');
          enriched += `\n\n[WORKSPACE KNOWLEDGE BASE PASSAGES]:\n${textPassages}\n[INSTRUCTION: Ground your answer in the provided workspace documents and cite sources.]`;
        }
      } catch {}

      // 3. Inject Live Google Workspace Context ONLY when explicit @mentions are present
      const detectedMentions = prompt.match(/@[\w_]+/g) || [];
      if (detectedMentions.length > 0) {
        try {
          const workspaceContext = await fetchWorkspaceContextSummary(detectedMentions);
          if (workspaceContext) {
            enriched += workspaceContext;
          }
        } catch (wsErr) {
          console.warn('[Workspace Context] Notice:', wsErr);
        }
      }

      // 4. Client-side Autonomous Workspace Tool Intent Execution (skip for simple conversational prompts)
      if (!simplePrompt) {
        try {
          const toolIntent = detectToolIntent(prompt);
          if (toolIntent && toolIntent.matched && !toolIntent.requiresConfirmation) {
            const state = getConnectorState(toolIntent.connectorId);
            if (state.status === 'connected') {
              const toolResult = await executeConnectorTool(toolIntent.toolName, toolIntent.args);
              if (toolResult.success) {
                enriched += `\n\n[Google Workspace Action Executed via ${toolIntent.connectorName} - ${toolIntent.suggestedAction}]\nResult: ${JSON.stringify(toolResult.data || toolResult.message)}\nUse this live data to complete the user's request.`;
              }
            }
          }
        } catch (toolErr) {
          console.warn('[Workspace Tool Execution] Notice:', toolErr);
        }
      }

      // 5. Autonomous Built-in Computational Skills Execution
      try {
        const skillRes = await skillsRegistry.detectAndExecute(prompt);
        if (skillRes && skillRes.success) {
          enriched += `\n\n[AUTONOMOUS COMPUTATIONAL SKILL EXECUTED]:\nSummary: ${skillRes.summary}\nData: ${JSON.stringify(skillRes.output)}\n[INSTRUCTION: Directly cite these exact computed numbers or converted measurements in your response.]`;
        }
      } catch (skillErr) {
        console.warn('[Autonomous Skill Execution] Notice:', skillErr);
      }

      // 6. External connector dispatch (skipped automatically for simple conversational prompts)
      if (!simplePrompt) {
        try {
          const dispatch = await executeMatchingConnector(prompt);
          if (dispatch.matched) {
            return enriched + '\n\n[Connected app result from ' + dispatch.connectorName + ']\n' +
              JSON.stringify(dispatch.result) + '\n\nUse this returned data as the source for your answer.';
          }
        } catch (error) {
          console.warn('[Connectors] Dispatch failed; continuing with text generation:', error);
        }
      }
      return enriched;
    };

    try {
      return await Promise.race([
        buildEnrichedPrompt(),
        new Promise<string>((resolve) => setTimeout(() => resolve(prompt), 1200)),
      ]);
    } finally {
      setPhase('text-generation');
    }
  }, [user]);


  // Track tool calls and update steps dynamically without duplicate traces
  useEffect(() => {
    if (messages.length > 0) {
      messagesRef.current = messages;
      
      const lastMessage = messages[messages.length - 1];
      const toolInvocations = (lastMessage as any).toolInvocations || 
        (lastMessage as any).parts
          ?.filter((p: any) => p.type === 'tool-invocation')
          .map((p: any) => ({
            toolName: p.toolName,
            args: p.input,
          }));
      if (lastMessage.role === 'assistant' && toolInvocations && toolInvocations.length > 0) {
        toolInvocations.forEach((invocation: any) => {
          const toolName = invocation.toolName;
          const invocationKey = `${lastMessage.id || 'last'}_${toolName}_${JSON.stringify(invocation.args || {})}`;
          if (processedInvocationsRef.current.has(invocationKey)) {
            return;
          }
          processedInvocationsRef.current.add(invocationKey);

          let stepLabel = '';
          let trace: string[] = [];
          
          if (toolName === 'web_search') {
            stepLabel = 'Searching Web';
            trace = [`Searching for: ${invocation.args?.query || 'information'}`];
          } else if (toolName === 'fetch_url') {
            stepLabel = 'Fetching URL Content';
            trace = [`Fetching: ${invocation.args?.url || 'URL'}`];
          } else if (toolName.includes('sandbox') || toolName === 'run_terminal_cmd') {
            stepLabel = 'Executing Code Analysis';
            trace = ['Running data processing script...'];
          } else if (toolName === 'read_file') {
            stepLabel = 'Reading Data File';
            trace = [`Reading: ${invocation.args?.path || 'file'}`];
          }
          
          if (stepLabel) {
            emitRobotEvent(toolName === 'web_search' ? 'SEARCH_STARTED' : 'TOOL_STARTED');
            setSteps(prev => {
              const nextSteps: Step[] = prev.map(s => {
                if (s.label === stepLabel) {
                  const existingTraces = s.trace || [];
                  const newItems = trace.filter(t => !existingTraces.includes(t));
                  return { ...s, status: 'running' as const, trace: [...existingTraces, ...newItems] };
                }
                return s;
              });
              
              const exists = prev.find(s => s.label === stepLabel);
              if (!exists) {
                nextSteps.push({ id: String(prev.length + 1), label: stepLabel, status: 'running' as const, trace });
              }
              
              if (taskId && nextSteps.length !== prev.length) {
                (blink.db as any).tasks.update(taskId, {
                  steps: JSON.stringify(nextSteps)
                }).catch(() => {});
              }
              
              return nextSteps;
            });
          }
        });
      }
    }
  }, [messages, taskId, isAuthenticated]);

  const sendMessage = useCallback((content: string) => {
    if (!content || !content.trim()) return;
    if (isSubmittingRef.current) {
      console.warn('[Manus Agent] Ignored submission while a request is still active.');
      return;
    }
    const now = Date.now();
    if (taskStatus !== 'error' && lastSubmitRef.current.prompt === content.trim() && now - lastSubmitRef.current.timestamp < 1200) {
      console.warn('[Manus Agent] Suppressed duplicate rapid submission:', content);
      return;
    }
    lastSubmitRef.current = { prompt: content.trim(), timestamp: now };
    isSubmittingRef.current = true;
    abortActiveAutonomousStreams();
    markExistingSdkMessagesCompleted();

    const reqId = ++activeRequestIdRef.current;
    const streamReqId = `req_${now}_${reqId}`;
    activeStreamRequestIdRef.current = streamReqId;
    clearStepTimers();
    liveStreamTextRef.current = '';
    setLiveStreamText('');
    lastStreamFinishReasonRef.current = null;
    lastStreamErrorRef.current = null;

    setTaskStatus('running');
    setPhase('tool-calling');
    emitRobotEvent('USER_SUBMITTED');
    setResult(null);
    setSteps([
      { id: 'think_1', label: 'Understanding intent & context', status: 'running', trace: ['Analyzing prompt & conversation history...'] },
      { id: 'think_2', label: 'Synthesizing response', status: 'pending', trace: [] },
    ]);

    const activeId = currentTaskIdRef.current || taskId;
    const userMsgId = 'msg_' + now + '_' + Math.random().toString(36).substring(2, 8);
    const assistantMsgId = 'msg_assistant_' + now + '_' + Math.random().toString(36).substring(2, 8);
    activeUserMsgIdRef.current = userMsgId;
    activeAssistantMsgIdRef.current = assistantMsgId;

    const userMsg = {
      id: userMsgId,
      role: 'user' as const,
      content,
      timestamp: new Date().toISOString(),
      status: 'success' as const
    };

    const cleanedHistory = persistentMessagesRef.current.filter(
      m => m && !(m.role === 'assistant' && (m.error || m.status === 'error'))
    );
    const lastExisting = cleanedHistory[cleanedHistory.length - 1];
    const nextHistory =
      lastExisting && lastExisting.role === 'user' && lastExisting.content.trim() === content.trim()
        ? cleanedHistory
        : [...cleanedHistory, userMsg];

    persistentMessagesRef.current = nextHistory;
    setPersistentMessages(nextHistory);

    setActiveStreamContext({
      requestId: streamReqId,
      taskId: activeId,
      messages: nextHistory
        .filter(m => (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim())
        .map(m => ({ role: m.role, content: m.content.trim() })),
    });

    if (activeId) {
      saveMessage({
        id: userMsgId,
        conversationId: activeId,
        userId: user?.id || 'usr_manus_default',
        role: 'user',
        content,
        status: 'success'
      }).catch(err => console.warn('Failed to save user message to DB:', err));
    }

    const cmd = matchVoiceCommand(content);
    if (cmd && cmd.matched) {
      if (cmd.action === 'open_url' || cmd.action === 'search') {
        if (cmd.url) executeOpenUrl(cmd.url);
      } else {
        executeDeviceCommand(cmd);
      }
      toast.success(`${cmd.targetName}: ${cmd.feedbackSpeech}`);
    }

    const runSendLifecycle = async () => {
      try {
        // Strip embedded base64 image data before running connector regexes / RAG enrichment
        // so multi-kilobyte base64 strings never stall main-thread text processing.
        const textWithoutImagePayload = content.replace(/\[IMAGE_DATA_URL:[^\]]+\]\n?/gi, '').trim();
        const toolIntent = !isSimpleConversationalPrompt(textWithoutImagePayload) ? detectToolIntent(textWithoutImagePayload) : null;
        if (toolIntent) {
          if (toolIntent.status !== 'connected') {
            handleConnectorError(toolIntent.connectorId, null, {
              issueType: toolIntent.status === 'expired' ? 'expired' : toolIntent.status === 'permission_required' ? 'permission_required' : 'disconnected',
              customMessage: `The ${toolIntent.connectorName} connector is required for "${toolIntent.toolName}" but is not currently authorized.`
            });
            const noticePrompt = `${textWithoutImagePayload}\n\n[CONNECTOR STATUS NOTICE: The ${toolIntent.connectorName} connector is required for this request but is currently NOT connected. Inform the user clearly that ${toolIntent.connectorName} needs to be authorized in Connectors & Plugins, and offer to open Connectors.]`;
            await agentSendMessage(noticePrompt);
            return;
          }

          setSteps(prev => [
            ...prev,
            { id: String(prev.length + 1), label: toolIntent.suggestedAction, status: 'running', trace: [`Executing ${toolIntent.toolName}...`] }
          ]);

          const res = await executeConnectorTool(toolIntent.toolName, toolIntent.args);
          setSteps(prev => prev.map(s => s.label === toolIntent.suggestedAction ? { ...s, status: 'completed' } : s));
          if (res.success) {
            const augmentedPrompt = `${textWithoutImagePayload}\n\n[EXECUTED CONNECTED TOOL: ${toolIntent.connectorName} (${toolIntent.toolName})]\n[RESULT DATA]:\n${JSON.stringify(res.data, null, 2)}\n\n[INSTRUCTION: Synthesize a clear, verified answer based on the retrieved data above. Highlight key documents/messages/events and provide links where applicable.]`;
            await agentSendMessage(augmentedPrompt);
          } else {
            const errorPrompt = `${textWithoutImagePayload}\n\n[CONNECTOR TOOL ERROR: ${res.error || 'Execution failed'}]\n${res.message}\nProvide a helpful explanation of the failure.`;
            await agentSendMessage(errorPrompt);
          }
          return;
        }

        const isExplicitChartPrompt = /\b(graph|chart|plot|diagram|histogram|pie\s+chart|bar\s+chart|line\s+chart|scatter\s+plot|visualize\s+data)\b/i.test(textWithoutImagePayload);
        const targetPrompt = isExplicitChartPrompt
          ? `${textWithoutImagePayload}\n\n[INSTRUCTION: Format your chart data as a JSON code block using the format below so it renders as an interactive chart]\n\`\`\`json\n{\n  "graph": {\n    "type": "bar",\n    "labels": ["Category A", "Category B", "Category C", "Category D"],\n    "datasets": [{\n      "label": "Metric",\n      "data": [45, 72, 88, 95]\n    }]\n  }\n}\n\`\`\``
          : textWithoutImagePayload;

        const preparedPrompt = await preparePromptWithConnectors(targetPrompt);
        if (activeRequestIdRef.current !== reqId) return;
        await agentSendMessage(preparedPrompt);
      } catch (error) {
        if (activeRequestIdRef.current !== reqId) return;
        console.error('[Manus AI] Failed to send chat message:', error);
        finalizedRequestIdsRef.current.add(reqId);
        setActiveStreamContext(null);
        setTaskStatus('error');
        setPhase('error');
        setResult({
          type: 'chat',
          content: "I couldn't reach the AI service. Check your connection and try again.",
          error: true,
          retryable: true,
        });
        setSteps(prev => prev.map(step => ({ ...step, status: 'error' as const })));
        emitRobotEvent('TASK_FAILED');
        toast.error("Couldn't reach the AI service. Please try again.");
      } finally {
        if (activeRequestIdRef.current === reqId) {
          clearStepTimers();
          isSubmittingRef.current = false;
          setActiveStreamContext(null);
          const hadErrorFinish = lastStreamFinishReasonRef.current === 'error';
          const finalized = !hadErrorFinish && finalizeRequestTurn(reqId, activeId);
          liveStreamTextRef.current = '';
          setLiveStreamText('');
          if (hadErrorFinish) {
            const errText = lastStreamErrorRef.current || "The AI service encountered an error. Please retry.";
            setTaskStatus('error');
            setPhase('error');
            setResult((prev: any) => prev?.error ? prev : {
              type: 'chat',
              content: errText,
              error: true,
              retryable: true,
            });
            setSteps(prev => prev.map(step => step.status === 'running' ? { ...step, status: 'error' as const } : step));
          } else {
            const lastMsg = persistentMessagesRef.current[persistentMessagesRef.current.length - 1];
            const hasAssistantReply = finalized || lastMsg?.role === 'assistant';
            setTaskStatus(prev => (prev === 'running' || prev === 'idle') ? (hasAssistantReply ? 'completed' : 'error') : prev);
            setPhase(prev => (prev === 'tool-calling' || prev === 'text-generation' || prev === 'idle') ? 'completed' : prev);
            setSteps(prev => prev.map(step => step.status === 'running' ? { ...step, status: 'completed' as const } : step));
          }
          window.dispatchEvent(new CustomEvent('manus_agent_generating', {
            detail: { isGenerating: false, mode: 'work' }
          }));
        }
      }
    };

    void runSendLifecycle();
  }, [agentSendMessage, preparePromptWithConnectors, taskId, taskStatus, user, clearStepTimers, finalizeRequestTurn, markExistingSdkMessagesCompleted]);

  const startTask = useCallback(async (prompt: string, options: any = {}) => {
    if (!prompt || !prompt.trim()) return null;
    if (isSubmittingRef.current) {
      console.warn('[Manus Agent] Ignored startTask while a request is still active.');
      return currentTaskIdRef.current;
    }
    const now = Date.now();
    if (taskStatus !== 'error' && lastSubmitRef.current.prompt === prompt.trim() && now - lastSubmitRef.current.timestamp < 1200) {
      console.warn('[Manus Agent] Suppressed duplicate rapid startTask:', prompt);
      return currentTaskIdRef.current;
    }
    lastSubmitRef.current = { prompt: prompt.trim(), timestamp: now };
    isSubmittingRef.current = true;
    abortActiveAutonomousStreams();
    markExistingSdkMessagesCompleted();

    const reqId = ++activeRequestIdRef.current;
    const streamReqId = `req_${now}_${reqId}`;
    activeStreamRequestIdRef.current = streamReqId;
    clearStepTimers();
    liveStreamTextRef.current = '';
    setLiveStreamText('');
    lastStreamFinishReasonRef.current = null;
    lastStreamErrorRef.current = null;

    if (clearMessages) {
      clearMessages();
    } else if (setMessages) {
      setMessages([]);
    }

    let newTaskId: string | null = null;
    const userMsgId = 'msg_' + now + '_' + Math.random().toString(36).substring(2, 8);
    const assistantMsgId = 'msg_assistant_' + now + '_' + Math.random().toString(36).substring(2, 8);
    activeUserMsgIdRef.current = userMsgId;
    activeAssistantMsgIdRef.current = assistantMsgId;

    const isImageFile = typeof options.fileData === 'string' && options.fileData.startsWith('data:image/');
    const userMessageContent = isImageFile && !prompt.includes('[IMAGE_DATA_URL:')
      ? `[Attached Image: ${options.fileName || 'image.jpg'}]\n[IMAGE_DATA_URL:${options.fileData}]\n${prompt.trim()}`
      : prompt;

    const userMsg = {
      id: userMsgId,
      role: 'user' as const,
      content: userMessageContent,
      timestamp: new Date().toISOString(),
      status: 'success' as const
    };

    setPersistentMessages([userMsg]);
    persistentMessagesRef.current = [userMsg];

    const generatedId = 'task_' + now + '_' + Math.random().toString(36).substring(2, 8);
    newTaskId = generatedId;
    setTaskId(newTaskId);
    currentTaskIdRef.current = newTaskId;

    setActiveStreamContext({
      requestId: streamReqId,
      taskId: newTaskId,
      messages: [{ role: 'user', content: userMessageContent.trim() }],
    });

    processedInvocationsRef.current.clear();
    const nextTaskObj = { prompt, options, fileData: options.fileData, url: options.url };
    currentTaskRef.current = nextTaskObj;
    setCurrentTask(nextTaskObj);
    setTaskStatus('running');
    setPhase('tool-calling');
    setResult(null);
    setChartData(null);
    emitRobotEvent('USER_SUBMITTED');
    playNotificationSound('send');

    // Immediately notify caller (e.g. App.tsx router) so the UI navigates to /task/:taskId
    // right away instead of staying stuck on the Home screen while DB/stream calls run.
    if (typeof options?.onTaskCreated === 'function') {
      try {
        options.onTaskCreated(newTaskId);
      } catch (navErr) {
        console.warn('[startTask] onTaskCreated callback error:', navErr);
      }
    }
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('manus_task_started', { detail: { taskId: newTaskId } }));
    }

    const persistInitialTask = async () => {
      try {
        let activeUser = user;
        if (!activeUser) {
          try {
            activeUser = await blink.auth.me();
          } catch {
            activeUser = null;
          }
        }
        const userId = activeUser?.id || 'usr_manus_default';
        captureExplicitMemory(userId, prompt);

        try {
          await (blink.db as any).tasks.create({
            id: newTaskId,
            userId,
            prompt: prompt,
            outputFormat: options.format,
            mode: options.mode || (options.format === 'website' ? 'work' : 'chat'),
            chartType: options.chartType,
            projectId: options.projectId || null,
            status: 'running',
            result: null,
            steps: JSON.stringify([]),
            skipInitialMessage: true,
          });
        } catch (err) {
          console.warn('Blink task create fallback to local DB:', err);
        }

        await createConversation({
          id: newTaskId,
          userId,
          title: cleanChatTitle(prompt),
          mode: options.mode || (options.format === 'website' ? 'work' : 'chat'),
          outputFormat: options.format,
          chartType: options.chartType,
          projectId: options.projectId || null,
        });

        await saveMessage({
          id: userMsgId,
          conversationId: newTaskId,
          userId,
          role: 'user',
          content: userMessageContent,
          status: 'success'
        });

        if (options.projectId) {
          try {
            const { addTaskToProject } = await import('@/lib/projectStore');
            addTaskToProject(options.projectId, newTaskId);
          } catch {}
        }
      } catch (e) {
        console.error('Failed to create task in DB:', e);
      }
    };

    // Persist initial task in background so IndexedDB or auth latency never delays AI streaming start
    void persistInitialTask();

    const isChatMode = options.mode === 'chat';
    const isSimple = isChatMode || isSimpleConversationalPrompt(prompt) || (!options.fileData && !options.url && options.format === 'report' && !options.intent);

    let enhancedPrompt = prompt;
    let initialSteps: Step[] = [];

    if (isSimple) {
      initialSteps = [
        {
          id: 'think_1',
          label: isImageFile ? 'Inspecting attached image' : 'Understanding intent & context',
          status: 'running',
          trace: [isImageFile ? 'Scanning visual features & question context...' : 'Analyzing prompt semantics...'],
        },
        {
          id: 'think_2',
          label: 'Synthesizing final response',
          status: 'pending',
          trace: [],
        },
      ];
    } else {
      initialSteps.push({ id: '1', label: 'Analyzing Request', status: 'running', trace: ['Parsing intent...', `Output: ${options.format}`, `Chart: ${options.chartType || 'auto'}`] });

      if (options.fileData) {
        if (isImageFile) {
          initialSteps.push(
            { id: '2', label: 'Inspecting Image Content', status: 'pending', trace: [] },
            { id: '3', label: 'Extracting Visual Details', status: 'pending', trace: [] },
            { id: '4', label: 'Generating Analysis', status: 'pending', trace: [] },
          );
          enhancedPrompt = `${prompt}\n\n[Attached Image: ${options.fileName || 'image.jpg'}]`;
        } else {
          const isCSV = options.fileName?.toLowerCase().endsWith('.csv');
          initialSteps.push(
            { id: '2', label: isCSV ? 'Parsing CSV Data' : 'Parsing File Content', status: 'pending', trace: [] },
            { id: '3', label: 'Profiling Data', status: 'pending', trace: [] },
            { id: '4', label: 'Computing Statistics', status: 'pending', trace: [] },
            { id: '5', label: 'Generating Insights', status: 'pending', trace: [] },
            { id: '6', label: 'Creating Visualizations', status: 'pending', trace: [] },
          );

          enhancedPrompt = `${prompt}\n\nFile Content to analyze (${options.fileName}):\n\`\`\`${isCSV ? 'csv' : 'text'}\n${options.fileData}\n\`\`\`\n\nPlease:\n1. Parse and validate this ${isCSV ? 'CSV data' : 'content'}\n2. Identify ${isCSV ? 'column types and compute summary statistics' : 'key themes and data points'}\n3. Generate insights about trends, patterns, and anomalies\n4. If applicable, create chart data in JSON format for ${options.chartType} chart\n5. Provide ${options.format} output with key findings`;
        }
      } else if (options.url) {
        initialSteps.push(
          { id: '2', label: 'Researching URL', status: 'pending', trace: [] },
          { id: '3', label: 'Extracting Information', status: 'pending', trace: [] },
          { id: '4', label: 'Structuring Data', status: 'pending', trace: [] },
          { id: '5', label: 'Generating Analysis', status: 'pending', trace: [] },
        );
        enhancedPrompt = `${prompt}\n\nURL to research: ${options.url}\n\nPlease:\n1. Search and fetch information from this URL\n2. Extract key facts, data points, and trends\n3. Structure the findings clearly\n4. If relevant, create CSV data from the information\n5. Provide ${options.format} output with analysis`;
      } else {
        initialSteps.push(
          { id: '2', label: 'Gathering Context', status: 'pending', trace: [] },
          { id: '3', label: 'Executing Analysis', status: 'pending', trace: [] },
          { id: '4', label: 'Generating Output', status: 'pending', trace: [] },
        );
      }

      if (options.thinkHarder) {
        initialSteps.splice(1, 0,
          {
            id: 'think_harder_1',
            label: '🧠 Deconstructing Core Problem & Assumptions',
            status: 'pending',
            trace: ['Analyzing constraints and goal metrics...', 'Mapping contextual dependencies']
          },
          {
            id: 'think_harder_2',
            label: '🔍 Extended Multi-Angle Chain-of-Thought',
            status: 'pending',
            trace: ['Synthesizing alternative approaches...', 'Testing edge cases and stress-testing logic']
          }
        );
      }
    }

    const toolIntent = !isSimple ? detectToolIntent(prompt) : null;
    if (toolIntent) {
      if (toolIntent.status !== 'connected') {
        handleConnectorError(toolIntent.connectorId, null, {
          issueType: toolIntent.status === 'expired' ? 'expired' : toolIntent.status === 'permission_required' ? 'permission_required' : 'disconnected',
          customMessage: `The ${toolIntent.connectorName} connector is required for "${toolIntent.toolName}" but needs authorization.`
        });
        enhancedPrompt = `${prompt}\n\n[CONNECTOR STATUS NOTICE: The ${toolIntent.connectorName} connector is required for this request but is currently NOT connected. Inform the user clearly that ${toolIntent.connectorName} needs to be authorized in Connectors & Plugins.]`;
      } else {
        try {
          initialSteps.push({
            id: String(initialSteps.length + 1),
            label: toolIntent.suggestedAction,
            status: 'running',
            trace: [`Executing ${toolIntent.toolName}...`]
          });
          const res = await executeConnectorTool(toolIntent.toolName, toolIntent.args);
          initialSteps = initialSteps.map(s => s.label === toolIntent.suggestedAction ? { ...s, status: 'completed' } : s);
          if (res.success) {
            enhancedPrompt = `${prompt}\n\n[EXECUTED CONNECTED TOOL: ${toolIntent.connectorName} (${toolIntent.toolName})]\n[RESULT DATA]:\n${JSON.stringify(res.data, null, 2)}\n\n[INSTRUCTION: Synthesize a clear, verified answer based on the retrieved data above. Highlight key documents/messages/events and provide direct links where applicable.]`;
          } else {
            enhancedPrompt = `${prompt}\n\n[CONNECTOR TOOL ERROR: ${res.error || 'Execution failed'}]\n${res.message}\nProvide a helpful explanation of the failure.`;
          }
        } catch (e: any) {
          console.warn('[startTask Connector Tool Error]', e);
        }
      }
    }

    setSteps(initialSteps);

    const cmd = matchVoiceCommand(prompt);
    if (cmd && cmd.matched) {
      if (cmd.action === 'open_url' || cmd.action === 'search') {
        if (cmd.url) executeOpenUrl(cmd.url);
      } else {
        executeDeviceCommand(cmd);
      }
      toast.success(`${cmd.targetName}: ${cmd.feedbackSpeech}`);
    }

    if (newTaskId && initialSteps.length > 0) {
      (blink.db as any).tasks.update(newTaskId, {
        steps: JSON.stringify(initialSteps)
      }).catch(console.error);
    }

    if (!isSimple) {
      stepTimersRef.current.push(
        setTimeout(() => {
          if (activeRequestIdRef.current !== reqId || !isSubmittingRef.current || liveStreamTextRef.current) return;
          setSteps(prev => prev.length > 0 ? prev.map((s, i) => i === 0 ? { ...s, status: 'completed' } : i === 1 ? { ...s, status: 'running' } : s) : prev);
        }, 1500),
        setTimeout(() => {
          if (activeRequestIdRef.current !== reqId || !isSubmittingRef.current || liveStreamTextRef.current) return;
          setSteps(prev => prev.length > 1 ? prev.map((s, i) => i === 1 ? { ...s, status: 'completed' } : i === 2 ? { ...s, status: 'running' } : s) : prev);
        }, 3500),
        setTimeout(() => {
          if (activeRequestIdRef.current !== reqId || !isSubmittingRef.current || liveStreamTextRef.current) return;
          setSteps(prev => prev.length > 2 ? prev.map((s, i) => i === 2 ? { ...s, status: 'completed' } : i === 3 ? { ...s, status: 'running' } : s) : prev);
        }, 6000)
      );
    }

    try {
      const preparedPrompt = await preparePromptWithConnectors(enhancedPrompt);
      if (activeRequestIdRef.current === reqId) {
        await agentSendMessage(preparedPrompt);
      }
    } catch (error) {
      if (activeRequestIdRef.current === reqId) {
        console.error('[Manus AI] Failed to start generation:', error);
        finalizedRequestIdsRef.current.add(reqId);
        setActiveStreamContext(null);
        setTaskStatus('error');
        setPhase('error');
        setResult({
          type: options.format || 'chat',
          content: "I couldn't reach the AI service. Check your connection and try again.",
          error: true,
          retryable: true,
        });
        setSteps(prev => prev.map(step => ({ ...step, status: 'error' as const })));
        emitRobotEvent('TASK_FAILED');
        toast.error("Couldn't reach the AI service. Please try again.");
      }
    } finally {
      if (activeRequestIdRef.current === reqId) {
        clearStepTimers();
        isSubmittingRef.current = false;
        setActiveStreamContext(null);
        const hadErrorFinish = lastStreamFinishReasonRef.current === 'error';
        const finalized = !hadErrorFinish && finalizeRequestTurn(reqId, newTaskId);
        liveStreamTextRef.current = '';
        setLiveStreamText('');
        if (hadErrorFinish) {
          const errText = lastStreamErrorRef.current || "The AI service encountered an error. Please retry.";
          setTaskStatus('error');
          setPhase('error');
          setResult((prev: any) => prev?.error ? prev : {
            type: options.format || 'chat',
            content: errText,
            error: true,
            retryable: true,
          });
          setSteps(prev => prev.map(step => step.status === 'running' ? { ...step, status: 'error' as const } : step));
        } else {
          const lastMsg = persistentMessagesRef.current[persistentMessagesRef.current.length - 1];
          const hasAssistantReply = finalized || lastMsg?.role === 'assistant';
          setTaskStatus(prev => (prev === 'running' || prev === 'idle') ? (hasAssistantReply ? 'completed' : 'error') : prev);
          setPhase(prev => (prev === 'tool-calling' || prev === 'text-generation' || prev === 'idle') ? 'completed' : prev);
          setSteps(prev => prev.map(step => step.status === 'running' ? { ...step, status: 'completed' as const } : step));
        }
        window.dispatchEvent(new CustomEvent('manus_agent_generating', {
          detail: { isGenerating: false, mode: 'work' }
        }));
      }
    }

    return newTaskId;
  }, [isAuthenticated, user, taskStatus, agentSendMessage, preparePromptWithConnectors, clearMessages, setMessages, clearStepTimers, finalizeRequestTurn, markExistingSdkMessagesCompleted]);

  const loadTask = useCallback(async (id: string) => {
    try {
      // Guard: if this task is already the active in-memory task and either currently
      // streaming or already populated with messages in memory, do not clobber
      // live state with potentially incomplete database records during route transitions.
      if (
        id === currentTaskIdRef.current &&
        (isSubmittingRef.current || persistentMessagesRef.current.length > 0)
      ) {
        return;
      }

      setTaskId(id);
      currentTaskIdRef.current = id;

      const storedMsgs = await getMessages(id);
      let initialMsgs: any[] = [];
      if (storedMsgs && storedMsgs.length > 0) {
        initialMsgs = storedMsgs.map(m => ({
          id: m.id,
          role: m.role,
          content: m.content,
          timestamp: m.timestamp,
          status: m.status
        }));
      }

      setPersistentMessages(initialMsgs);

      const task = await (blink.db as any).tasks.get(id);
      if (task) {
        setCurrentTask({ 
          prompt: task.prompt || task.title || '', 
          options: { 
            format: task.outputFormat || undefined, 
            chartType: task.chartType || undefined
          } 
        });

        // A historical task loaded from storage when no request is submitting is never actively streaming.
        const rawStatus = task.status || 'completed';
        const safeLoadedStatus = (!isSubmittingRef.current && (rawStatus === 'running' || rawStatus === 'idle'))
          ? 'completed'
          : rawStatus;
        setTaskStatus(safeLoadedStatus as any);
        
        if (task.steps) {
          try {
            const parsedSteps = JSON.parse(task.steps);
            setSteps(Array.isArray(parsedSteps)
              ? parsedSteps.map((s: Step) => (!isSubmittingRef.current && s.status === 'running') ? { ...s, status: 'completed' as const } : s)
              : []);
          } catch { 
            setSteps([]); 
          }
        }
        
        if (task.result) {
          try {
            const parsedResult = JSON.parse(task.result);
            setResult(parsedResult);
            setChartData(parsedResult.chartData || null);
            if (initialMsgs.length === 0 && parsedResult.messages && parsedResult.messages.length > 0) {
              setPersistentMessages(parsedResult.messages);
            }
          } catch { 
            setResult(null); 
          }
        }
      }
    } catch (e) {
      console.error('Failed to load task:', e);
    }
  }, [isAuthenticated]);

  const resetTask = useCallback(() => {
    activeRequestIdRef.current += 1;
    activeStreamRequestIdRef.current = '';
    setActiveStreamContext(null);
    abortActiveAutonomousStreams();
    clearStepTimers();
    markExistingSdkMessagesCompleted();
    isSubmittingRef.current = false;
    liveStreamTextRef.current = '';
    setLiveStreamText('');
    setTaskId(null);
    currentTaskIdRef.current = null;
    currentTaskRef.current = null;
    setCurrentTask(null);
    setTaskStatus('idle');
    setPhase('idle');
    setSteps([]);
    setResult(null);
    setChartData(null);
    setPersistentMessages([]);
    persistentMessagesRef.current = [];
    if (clearMessages) {
      clearMessages();
    } else if (setMessages) {
      setMessages([]);
    }
    window.dispatchEvent(new CustomEvent('manus_agent_generating', {
      detail: { isGenerating: false, mode: 'work' }
    }));
  }, [clearMessages, setMessages, clearStepTimers, markExistingSdkMessagesCompleted]);

  const exportToPDF = useCallback(async (format: ChatExportFormat = 'pdf') => {
    const messagesToExport = persistentMessagesRef.current;
    const hasMessages = Array.isArray(messagesToExport) && messagesToExport.length > 0;
    const hasResult = Boolean(result?.content || result?.summary || result?.text);
    const hasPrompt = Boolean(currentTask?.prompt);

    if (!hasMessages && !hasResult && !hasPrompt) {
      toast.info('No chat session messages to export yet');
      return;
    }

    const exported = exportChatSession(
      {
        taskId: taskId || currentTaskIdRef.current,
        prompt: currentTask?.prompt || '',
        format: currentTask?.options?.format || 'chat',
        status: taskStatus,
        messages: messagesToExport,
        steps: stepsRef.current,
        result,
      },
      format
    );

    const formatLabel = format === 'pdf' ? 'PDF' : format === 'markdown' ? 'Markdown' : 'JSON';
    toast.success(`Exported chat session as ${formatLabel} (${exported.filename})`);
  }, [result, currentTask, taskId, taskStatus]);

  const deleteTask = useCallback(async (id: string) => {
    try {
      await (blink.db as any).tasks.delete(id);
      return true;
    } catch (e) {
      console.error('Failed to delete task:', e);
      return false;
    }
  }, [isAuthenticated]);

  const displayMessages = useMemo(() => {
    const rawList: any[] = [...persistentMessages];
    const isTurnActive = (isLoading || taskStatus === 'running') && !finalizedRequestIdsRef.current.has(activeRequestIdRef.current);

    let currentTurnSdkText = '';
    if (isTurnActive && Array.isArray(messages) && messages.length > 0) {
      for (let i = messages.length - 1; i >= 0; i--) {
        const m = messages[i];
        if (!m) continue;
        if (m.role === 'user') break;
        if (
          m.role === 'assistant' &&
          (!m.id || !completedSdkMsgIdsRef.current.has(String(m.id))) &&
          typeof m.content === 'string' &&
          m.content.trim().length > 0
        ) {
          currentTurnSdkText = m.content;
          break;
        }
      }
    }

    const candidateLiveText = isTurnActive ? (liveStreamText.trim() || currentTurnSdkText) : '';
    const liveMsgId = activeAssistantMsgIdRef.current || 'live-assistant-current';

    if (candidateLiveText && isTurnActive) {
      const last = rawList[rawList.length - 1];
      if (last?.role === 'assistant' && last?.id === liveMsgId) {
        rawList[rawList.length - 1] = {
          ...last,
          content: candidateLiveText,
          status: 'streaming',
        };
      } else if (last?.role === 'user') {
        rawList.push({
          id: liveMsgId,
          role: 'assistant',
          content: candidateLiveText,
          timestamp: new Date().toISOString(),
          status: 'streaming',
        });
      }
    }

    const deduped: any[] = [];
    const seenIds = new Set<string>();
    for (const msg of rawList) {
      if (!msg) continue;
      if (msg.id && seenIds.has(msg.id)) continue;
      if (msg.id) seenIds.add(msg.id);
      deduped.push(msg);
    }
    return deduped;
  }, [persistentMessages, messages, isLoading, taskStatus, liveStreamText]);

  // Continuous periodic auto-save registration: tracks live messages, streaming updates, steps, and status
  useEffect(() => {
    const activeId = taskId || currentTaskIdRef.current;
    if (activeId) {
      /* chatAutoSave.updateSession({
        taskId: activeId,
        conversationId: activeId,
        userId: user?.id || 'usr_manus_default',
        prompt: currentTask?.prompt || '',
        title: currentTask?.prompt ? cleanChatTitle(currentTask.prompt) : undefined,
        outputFormat: currentTask?.options?.format,
        chartType: currentTask?.options?.chartType,
        status: taskStatus,
        messages: displayMessages,
        steps,
        result,
        chartData
      }); */
    }
  }, [taskId, currentTask, taskStatus, displayMessages, steps, result, chartData, user]);

  const reorderSteps = useCallback((newSteps: Step[]) => {
    setSteps(newSteps);
  }, []);

  return {
    taskId,
    loadTask,
    startTask,
    sendMessage,
    resetTask,
    stopTask,
    exportToPDF,
    deleteTask,
    currentTask,
    steps,
    setSteps,
    reorderSteps,
    taskStatus,
    result,
    chartData,
    messages: displayMessages,
    isLoading,
    phase
  };
}
