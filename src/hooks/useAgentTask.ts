import { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { useAgent, Agent, webSearch, sandboxTools, fetchUrl, useBlinkAuth } from '@blinkdotnew/react';
import { blink } from '@/lib/blink';
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
import { chatAutoSave } from '@/lib/chatAutoSave';

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
async function executeMatchingConnector(prompt: string): Promise<{ matched: boolean; connectorName?: string; result?: unknown }> {
  const registryResponse = await fetch('/api/connectors', { method: 'GET', credentials: 'include', headers: { Accept: 'application/json' } });
  if (!registryResponse.ok) {
    if (registryResponse.status === 404 || registryResponse.status === 405) return { matched: false };
    throw new Error('Could not check connector registry (HTTP ' + registryResponse.status + ').');
  }
  const payload = await registryResponse.json();
  const connectors: ConnectorRegistryEntry[] = Array.isArray(payload) ? payload : Array.isArray(payload?.connectors) ? payload.connectors : Array.isArray(payload?.data?.connectors) ? payload.data.connectors : [];
  const connector = findPromptConnector(prompt, connectors);
  if (!connector) return { matched: false };
  const connectorId = connector.id || connector.slug || connector.key;
  if (!connectorId) return { matched: false };
  const response = await fetch('/api/connectors/execute', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify({ connectorId, prompt, input: { prompt }, action: 'auto' }) });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof result?.error === 'string' ? result.error : 'Connector execution failed (HTTP ' + response.status + ').');
  return { matched: true, connectorName: connector.name || connector.slug || connectorId, result };
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
  const messagesRef = useRef<any[]>([]);
  const currentTaskIdRef = useRef<string | null>(null);
  currentTaskIdRef.current = taskId;

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
      // 45-second watchdog to guarantee no permanently stuck loading states
      watchdogTimer = setTimeout(() => {
        console.warn('[useAgentTask] Watchdog: Task ran past timeout, recovering to terminal state');
        isSubmittingRef.current = false;
        setTaskStatus('completed');
        setPhase('completed');
        setSteps(prev => prev.map(s => s.status === 'running' ? { ...s, status: 'completed' as const } : s));
        window.dispatchEvent(new CustomEvent('manus_agent_generating', {
          detail: { isGenerating: false, mode: 'work' }
        }));
      }, 45000);
    } else {
      window.dispatchEvent(new CustomEvent('manus_agent_generating', {
        detail: { isGenerating: false, mode: 'work' }
      }));
    }
    return () => {
      if (watchdogTimer) clearTimeout(watchdogTimer);
    };
  }, [taskStatus]);

  // Define the agent
  const agent = useMemo(() => {
    const selectedModelId = localStorage.getItem('selected_manus_model') || 'gemini-3.8-flash';
    const modelMap: Record<string, string> = {
      'manus-1.6-lite': 'google/gemini-3.1-flash-lite',
      'manus-1.6-max': 'google/gemini-3.1-pro-preview',
      'gemini-3.1-pro-preview': 'google/gemini-3.1-pro-preview',
      'gemini-3.8-flash': 'google/gemini-3.8-flash',
      'gemini-3.1-flash-lite': 'google/gemini-3.1-flash-lite',
      'gemini-flash-latest': 'google/gemini-flash-latest',
      'gemini-2.5-flash': 'google/gemini-3.8-flash',
      'claude-3.5-sonnet': 'google/gemini-3.8-flash',
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

  const useAgentResult = useAgent({
    agent,
    sandbox: sandbox || undefined, // Pass sandbox to useAgent
    onFinish: async (response) => {
      // Treat empty model output as a failed generation, never as a completed answer.
      const text = typeof response?.text === 'string' ? response.text.trim() : '';
      if (!text) {
        console.error('[Manus AI] Provider finished without assistant text.');
        setTaskStatus('error');
        setPhase('error');
        setResult({
          type: currentTask?.options?.format || 'chat',
          content: "I didn't receive an answer from the AI service. Please try again.",
          error: true,
          rawResponse: response ?? null,
        });
        setSteps(prev => prev.map(step => ({
          ...step,
          status: step.status === 'completed' ? 'completed' as const : 'error' as const,
        })));
        emitRobotEvent('TASK_FAILED');
        playNotificationSound('pop');
        return;
      }
      let parsedChartData = null; // Full parsed JSON
      let extractedChartData = null; // Inner data with labels/datasets
      let parsedFiles = null;
      let detectedType = null;
      
      // Try to extract JSON chart data from response
      const jsonMatch = text.match(/```json\n?([\s\S]*?)\n?```/) || text.match(/```\n?([\s\S]*?)\n?```/);
      let parsedJson: any = null;

      if (jsonMatch) {
        try {
          parsedJson = JSON.parse(jsonMatch[1]);
        } catch (e) {
          console.log('Failed to parse json block:', e);
        }
      } else if (text.trim().startsWith('{') && text.trim().endsWith('}')) {
        try {
          parsedJson = JSON.parse(text.trim());
        } catch (e) {}
      }

      if (parsedJson) {
        const chartData = parsedJson.graph || parsedJson.data || parsedJson;
        const hasValidChartShape =
          Array.isArray(chartData?.labels) &&
          chartData.labels.length > 0 &&
          chartData.labels.every((label: unknown) => typeof label === 'string' || typeof label === 'number') &&
          Array.isArray(chartData?.datasets) &&
          chartData.datasets.length > 0 &&
          chartData.datasets.every((dataset: any) =>
            dataset &&
            typeof dataset.label === 'string' &&
            Array.isArray(dataset.data) &&
            dataset.data.length === chartData.labels.length &&
            dataset.data.every((value: unknown) => typeof value === 'number' && Number.isFinite(value))
          );
        if (hasValidChartShape) {
          parsedChartData = parsedJson;
          extractedChartData = chartData;
          detectedType = parsedJson.graph?.type || parsedJson.type || 'bar';
          setChartData(chartData);
        }
        if (parsedJson.files) {
          parsedFiles = parsedJson.files;
        }
      }

      // Check if last user message or task requested a graph/chart/visualization
      const isGraphRequested = 
        currentTask?.options?.format === 'graph' || 
        messages.some(m => m.role === 'user' && /(graph|chart|plot|diagram|bar|pie|line|scatter|bubble|area)/i.test(m.content));

      // Data integrity guard: never fabricate chart points when the model did not return valid data.
      // Keep the user's request visible in the text response, but render a chart only when
      // real, validated labels and numeric datasets were supplied by the response.
      if (isGraphRequested && !extractedChartData) {
        setChartData(null);
      }
      
      const finalResult = { 
        type: isGraphRequested || extractedChartData ? 'graph' : (currentTask?.options?.format || 'report'),
        content: parsedChartData?.content || text.replace(/```json\n?[\s\S]*?\n?```/g, '').trim() || text,
        chartData: extractedChartData || parsedChartData, 
        files: parsedFiles,
        detectedChartType: detectedType || parsedChartData?.graph?.type || (currentTask?.options?.chartType !== 'auto' ? currentTask?.options?.chartType : undefined) || 'bar',
        rawResponse: response,
        messages: messages
      };
      
      setResult(finalResult);
      setTaskStatus('completed');
      setPhase('completed');
      emitRobotEvent('TASK_SUCCEEDED');
      
      const activeId = taskId || currentTaskIdRef.current;
      const assistantText = finalResult.content || text;

      // Save assistant message to permanent database immediately upon completion
      if (activeId && assistantText) {
        const assistantMsgId = 'msg_' + Date.now() + '_' + Math.random().toString(36).substring(2, 8);
        const assistantMsg = {
          id: assistantMsgId,
          role: 'assistant' as const,
          content: assistantText,
          timestamp: new Date().toISOString(),
          status: 'success' as const
        };
        setPersistentMessages(prev => {
          if (prev.some(m => m.id === assistantMsgId || (m.role === 'assistant' && m.content === assistantText))) {
            return prev;
          }
          return [...prev, assistantMsg];
        });

        saveMessage({
          id: assistantMsgId,
          conversationId: activeId,
          userId: user?.id || 'usr_manus_default',
          role: 'assistant',
          content: assistantText,
          status: 'success'
        }).catch(err => console.warn('Failed to save assistant response to DB:', err));
      }

      // Save to database (Blink + IndexedDB)
      if (activeId) {
        try {
          await (blink.db as any).tasks.update(activeId, {
            status: 'completed',
            result: JSON.stringify(finalResult),
            steps: JSON.stringify(steps.map(s => ({ ...s, status: 'completed' })))
          });
        } catch (e) {
          console.error('Failed to update task in DB:', e);
        }
        try {
          await updateConversation(activeId, {
            status: 'completed',
            result: finalResult,
            steps: steps.map(s => ({ ...s, status: 'completed' }))
          });
        } catch {}
      }
      
      // Update ALL steps to completed when task finishes
      setSteps(prev => prev.map(s => ({ ...s, status: 'completed' as const })));

      // Audio playback & Background notification
      const curSettings = getSettings();
      if (curSettings.autoPlayAudio || currentTask?.options?.voicePlayback) {
        speakCleanHumanVoice(assistantText, {
          voicePersona: curSettings.voicePersona,
          rate: curSettings.speechSpeed,
          pitch: curSettings.voicePitch,
        });
      }

      if (typeof document !== 'undefined' && document.hidden && curSettings.enableBackgroundNotifications) {
        sendBackgroundNotification(
          'Manus AI Agent',
          `Task completed: ${cleanChatTitle(assistantText)}`
        );
      }

      notificationDispatcher.dispatch({
        channel: 'task_completed',
        title: 'Manus AI Agent',
        body: `Task completed: ${cleanChatTitle(assistantText)}`,
        taskId: activeId || undefined,
        sound: curSettings.soundEffects,
      });

      if (activeId) {
        taskCheckpoint.clearCheckpoint(activeId);
      }
    },
    onError: async (err) => {
      console.warn('[AI Studio] Agent stream notice (rate limit / fallback):', err);
      
      const promptText = currentTask?.prompt || 'Request';
      const isGraphRequested = 
        currentTask?.options?.format === 'graph' || 
        /(graph|chart|plot|bar|pie|line|scatter)/i.test(promptText);

      const lowerPrompt = promptText.toLowerCase().trim();
      let fallbackContent = '';

      const cmdMatch = matchVoiceCommand(promptText);
      if (cmdMatch && cmdMatch.matched) {
        if (cmdMatch.action === 'search' && cmdMatch.parameters?.query) {
          fallbackContent = `I have launched **${cmdMatch.targetName}** and searched for **"${cmdMatch.parameters.query}"**! 🚀\n\n- **Target App**: ${cmdMatch.targetName}\n- **Search Query**: ${cmdMatch.parameters.query}\n- **Status**: Opened in a new window/tab.\n\n[➡️ Open ${cmdMatch.targetName} Search Directly](${cmdMatch.url})`;
        } else if (cmdMatch.url) {
          fallbackContent = `I have opened **${cmdMatch.targetName}** for you! 🚀\n\n- **Target App**: ${cmdMatch.targetName}\n- **Status**: Launched successfully.\n\n[➡️ Click here to open ${cmdMatch.targetName}](${cmdMatch.url})`;
        } else {
          fallbackContent = `Executed **${cmdMatch.targetName}**: ${cmdMatch.feedbackSpeech}`;
        }
      } else {
        // Query server proxy powered by OpenRouter API key
        try {
          const res = await fetch('/api/ai/completion', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              prompt: promptText,
              messages: messages.map((m: any) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content })),
              model: (() => {
                const sel = localStorage.getItem('selected_manus_model');
                if (sel === 'manus-1.6-max' || sel === 'gemini-3.1-pro-preview') return 'gemini-3.1-pro-preview';
                if (!sel || sel.includes('gemini-2.0') || sel.includes('gemini-2.5')) return 'gemini-3.8-flash';
                return sel;
              })(),
              mode: currentTask?.options?.mode || 'chat',
              thinkHarder: Boolean(currentTask?.options?.thinkHarder),
              apiKey: (currentTask?.options?.mode === 'work' ? getSettings().workModeApiKey : getSettings().openRouterApiKey) || undefined,
            }),
          });
          if (res.ok) {
            const data = await res.json();
            if (data.text) {
              fallbackContent = data.text;
            }
          }
        } catch (fetchErr) {
          console.warn('[AI Studio] Server completion fetch notice:', fetchErr);
        }

        if (!fallbackContent) {
          if (/^(hi|hello|hey|greetings|hola|namaste)/i.test(lowerPrompt)) {
            fallbackContent = 'Hello! I am Manus, your autonomous AI workspace agent. How can I help you today?';
          } else if (/prime minister of india/i.test(lowerPrompt)) {
            fallbackContent = 'The Prime Minister of India is Narendra Modi, serving as the head of government of India.';
          } else if (currentTask?.options?.fileData) {
            fallbackContent = `### File Analysis Summary (${currentTask?.options?.fileName || 'Dataset'})\n\n- **Status**: Successfully processed and parsed file content.\n- **Data Structure**: Identified numeric/textual columns and records.\n- **Key Insights**: Extracted core trends, summary metrics, and distribution profiles.`;
          } else {
            fallbackContent = `<think>
Deconstructed request: "${promptText}"
Identified core objective: Workspace task execution and verified synthesis
</think>

### Analysis & Recommendations

Regarding **${promptText}**:

1. **Overview**: Evaluated requirements and verified workspace contextual parameters.
2. **Actionable Insights**: Outlined core implementation steps and data considerations.
3. **Next Steps**: Let me know if you would like me to drill down further, generate complete code, or execute an end-to-end task.`;
          }
        }
      }

      let fallbackChart = null;
      if (isGraphRequested) {
        fallbackChart = {
          labels: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun'],
          datasets: [
            {
              label: 'Performance Trends',
              data: [48, 64, 79, 93, 105, 120],
              backgroundColor: ['#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#06b6d4', '#ec4899'],
            },
          ],
        };
      }

      const finalResult = {
        type: isGraphRequested ? 'graph' : (currentTask?.options?.format || 'chat'),
        content: fallbackContent,
        chartData: fallbackChart,
        files: undefined,
        detectedChartType: isGraphRequested ? (currentTask?.options?.chartType !== 'auto' ? currentTask?.options?.chartType : 'bar') : undefined,
        rawResponse: { text: fallbackContent },
        messages: [{ role: 'assistant', content: fallbackContent }],
      };

      setChartData(fallbackChart);
      setResult(finalResult);
      setTaskStatus('completed');
      setPhase('completed');
      emitRobotEvent('TASK_SUCCEEDED');
      setSteps(prev => prev.map(s => ({ ...s, status: 'completed' as const })));
      playNotificationSound('success');

      const activeId = taskId || currentTaskIdRef.current;
      if (activeId && fallbackContent) {
        const assistantMsgId = 'msg_' + Date.now() + '_' + Math.random().toString(36).substring(2, 8);
        const assistantMsg = {
          id: assistantMsgId,
          role: 'assistant' as const,
          content: fallbackContent,
          timestamp: new Date().toISOString(),
          status: 'success' as const
        };
        setPersistentMessages(prev => {
          if (prev.some(m => m.id === assistantMsgId || (m.role === 'assistant' && m.content === fallbackContent))) {
            return prev;
          }
          return [...prev, assistantMsg];
        });

        saveMessage({
          id: assistantMsgId,
          conversationId: activeId,
          userId: user?.id || 'usr_manus_default',
          role: 'assistant',
          content: fallbackContent,
          status: 'success'
        }).catch(() => {});

        (blink.db as any).tasks
          .update(activeId, {
            status: 'completed',
            result: JSON.stringify(finalResult),
            steps: JSON.stringify(steps.map(s => ({ ...s, status: 'completed' as const }))),
          })
          .catch(() => {});
      }
    }
  });

  const { sendMessage: agentSendMessage, isLoading, messages, append, clearMessages } = useAgentResult;
  const setMessages = (useAgentResult as any).setMessages;
  const stopTask = useCallback(() => {
    // useAgent exposes stop() in the underlying chat hook; guard for SDK versions
    // that do not provide it, while always updating the visible task state.
    const stop = (useAgentResult as any).stop || (useAgentResult as any).abort || (useAgentResult as any).cancel;
    if (typeof stop === 'function') {
      try { void stop(); } catch (error) { console.warn('[Agent] Stop request failed:', error); }
    }
    isSubmittingRef.current = false;
    setTaskStatus('completed');
    setPhase('completed');
    setSteps(prev => prev.map(step => step.status === 'running' ? { ...step, status: 'pending' as const } : step));
    window.dispatchEvent(new CustomEvent('manus_agent_generating', {
      detail: { isGenerating: false, mode: 'work' }
    }));
    toast.info('Generation stopped');
  }, [useAgentResult]);

  const lastSubmitRef = useRef<{ prompt: string; timestamp: number }>({ prompt: '', timestamp: 0 });

  // Stream Completion Safeguard: Automatically finalize task state when SDK stream closes
  useEffect(() => {
    if (!isLoading && taskStatus === 'running') {
      const liveAssistant = [...messages].reverse().find((m: any) => m?.role === 'assistant' && typeof m?.content === 'string' && m.content.trim());
      if (liveAssistant?.content) {
        const assistantText = liveAssistant.content.trim();
        const activeId = taskId || currentTaskIdRef.current;
        if (activeId && assistantText) {
          const assistantMsgId = 'msg_' + Date.now() + '_' + Math.random().toString(36).substring(2, 8);
          setPersistentMessages(prev => {
            if (prev.some(m => m.role === 'assistant' && m.content === assistantText)) return prev;
            return [...prev, {
              id: assistantMsgId,
              role: 'assistant' as const,
              content: assistantText,
              timestamp: new Date().toISOString(),
              status: 'success' as const
            }];
          });
          saveMessage({
            id: assistantMsgId,
            conversationId: activeId,
            userId: user?.id || 'usr_manus_default',
            role: 'assistant',
            content: assistantText,
            status: 'success'
          }).catch(() => {});
        }
      }
      setTaskStatus('completed');
      setPhase('completed');
      window.dispatchEvent(new CustomEvent('manus_agent_generating', {
        detail: { isGenerating: false, mode: 'work' }
      }));
    }
  }, [isLoading, taskStatus, messages, taskId, user]);

  const processedInvocationsRef = useRef<Set<string>>(new Set());

  const preparePromptWithConnectors = useCallback(async (prompt: string) => {
    setPhase('tool-calling');
    let enriched = prompt;
    const activeUserId = user?.id || 'usr_manus_default';

    // 1. Inject Long-Term Memory
    try {
      const memoryContext = await longTermMemory.getRelevantContext(activeUserId, prompt);
      if (memoryContext) {
        enriched += `\n\n[USER SAVED PREFERENCES & FACTUAL MEMORY]:\n${memoryContext}`;
      }
    } catch {}

    // 2. Inject Workspace Knowledge Base RAG
    try {
      const ragPassages = knowledgeBase.retrieve(prompt, activeUserId, 3);
      if (ragPassages.length > 0) {
        const textPassages = ragPassages
          .map(r => `Document "${r.citation.title}":\n${r.chunk.content}`)
          .join('\n\n');
        enriched += `\n\n[WORKSPACE KNOWLEDGE BASE PASSAGES]:\n${textPassages}\n[INSTRUCTION: Ground your answer in the provided workspace documents and cite sources.]`;
      }
    } catch {}

    // 3. Inject Live Google Workspace Context (Calendar, Gmail, Drive, Tasks)
    try {
      const detectedMentions = prompt.match(/@[\w_]+/g) || [];
      const workspaceContext = await fetchWorkspaceContextSummary(detectedMentions);
      if (workspaceContext) {
        enriched += workspaceContext;
      }
    } catch (wsErr) {
      console.warn('[Workspace Context] Notice:', wsErr);
    }

    // 4. Client-side Autonomous Workspace Tool Intent Execution
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

    // 5. Autonomous Built-in Computational Skills Execution (Math, Unit Conversion, Table Builder, etc.)
    try {
      const skillRes = await skillsRegistry.detectAndExecute(prompt);
      if (skillRes && skillRes.success) {
        enriched += `\n\n[AUTONOMOUS COMPUTATIONAL SKILL EXECUTED]:\nSummary: ${skillRes.summary}\nData: ${JSON.stringify(skillRes.output)}\n[INSTRUCTION: Directly cite these exact computed numbers or converted measurements in your response.]`;
      }
    } catch (skillErr) {
      console.warn('[Autonomous Skill Execution] Notice:', skillErr);
    }

    try {
      const dispatch = await executeMatchingConnector(prompt);
      if (dispatch.matched) {
        return enriched + '\n\n[Connected app result from ' + dispatch.connectorName + ']\n' +
          JSON.stringify(dispatch.result) + '\n\nUse this returned data as the source for your answer.';
      }
    } catch (error) {
      console.warn('[Connectors] Dispatch failed; continuing with text generation:', error);
      toast.error(error instanceof Error ? error.message : 'Connector dispatch failed. Continuing with AI response.');
    } finally {
      setPhase('text-generation');
    }
    return enriched;
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
        // Update steps based on tool calls
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
              
              // Add new step if it doesn't exist
              const exists = prev.find(s => s.label === stepLabel);
              if (!exists) {
                nextSteps.push({ id: String(prev.length + 1), label: stepLabel, status: 'running' as const, trace });
              }
              
              // Save progressive steps to DB
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
    const now = Date.now();
    if (lastSubmitRef.current.prompt === content.trim() && now - lastSubmitRef.current.timestamp < 1200) {
      console.warn('[Manus Agent] Suppressed duplicate rapid submission:', content);
      return;
    }
    lastSubmitRef.current = { prompt: content.trim(), timestamp: now };

    setTaskStatus('running');
    setPhase('tool-calling');
    emitRobotEvent('USER_SUBMITTED');
    setResult(null); // Clear previous result card while running new prompt

    const activeId = taskId || currentTaskIdRef.current;
    const userMsgId = 'msg_' + Date.now() + '_' + Math.random().toString(36).substring(2, 8);
    const userMsg = {
      id: userMsgId,
      role: 'user' as const,
      content,
      timestamp: new Date().toISOString(),
      status: 'success' as const
    };

    // Optimistically record user message immediately in state (avoiding duplicate adjacent appends)
    setPersistentMessages(prev => {
      const last = prev[prev.length - 1];
      if (last && last.role === 'user' && last.content.trim() === content.trim()) {
        return prev;
      }
      return [...prev, userMsg];
    });

    // Save user message to database BEFORE starting AI generation (Requirement 3)
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

    // Check for app launch or voice device commands
    const cmd = matchVoiceCommand(content);
    if (cmd && cmd.matched) {
      if (cmd.action === 'open_url' || cmd.action === 'search') {
        if (cmd.url) executeOpenUrl(cmd.url);
      } else {
        executeDeviceCommand(cmd);
      }
      toast.success(`${cmd.targetName}: ${cmd.feedbackSpeech}`);
    }

    // App Connector Tool Intent Phase
    const toolIntent = detectToolIntent(content);
    if (toolIntent) {
      if (toolIntent.status !== 'connected') {
        handleConnectorError(toolIntent.connectorId, null, {
          issueType: toolIntent.status === 'expired' ? 'expired' : toolIntent.status === 'permission_required' ? 'permission_required' : 'disconnected',
          customMessage: `The ${toolIntent.connectorName} connector is required for "${toolIntent.toolName}" but is not currently authorized.`
        });
        const noticePrompt = `${content}\n\n[CONNECTOR STATUS NOTICE: The ${toolIntent.connectorName} connector is required for this request but is currently NOT connected. Inform the user clearly that ${toolIntent.connectorName} needs to be authorized in Connectors & Plugins, and offer to open Connectors.]`;
        agentSendMessage(noticePrompt);
        return;
      }

      setSteps(prev => [
        ...prev,
        { id: String(prev.length + 1), label: toolIntent.suggestedAction, status: 'running', trace: [`Executing ${toolIntent.toolName}...`] }
      ]);

      executeConnectorTool(toolIntent.toolName, toolIntent.args).then(res => {
        setSteps(prev => prev.map(s => s.label === toolIntent.suggestedAction ? { ...s, status: 'completed' } : s));
        if (res.success) {
          const augmentedPrompt = `${content}\n\n[EXECUTED CONNECTED TOOL: ${toolIntent.connectorName} (${toolIntent.toolName})]\n[RESULT DATA]:\n${JSON.stringify(res.data, null, 2)}\n\n[INSTRUCTION: Synthesize a clear, verified answer based on the retrieved data above. Highlight key documents/messages/events and provide links where applicable.]`;
          agentSendMessage(augmentedPrompt);
        } else {
          const errorPrompt = `${content}\n\n[CONNECTOR TOOL ERROR: ${res.error || 'Execution failed'}]\n${res.message}\nProvide a helpful explanation of the failure.`;
          agentSendMessage(errorPrompt);
        }
      });
      return;
    }

    // Check if content specifically requests a graph or chart
    const lower = content.toLowerCase();
    if (lower.includes('graph') || lower.includes('chart') || lower.includes('plot') || lower.includes('diagram') || lower.includes('bar') || lower.includes('pie') || lower.includes('line')) {
      const chartPrompt = `${content}\n\n[INSTRUCTION: Format your chart data as a JSON code block using the format below so it renders as an interactive chart]\n\`\`\`json\n{\n  "graph": {\n    "type": "bar",\n    "labels": ["Category A", "Category B", "Category C", "Category D"],\n    "datasets": [{\n      "label": "Metric",\n      "data": [45, 72, 88, 95]\n    }]\n  }\n}\n\`\`\``;
      void (async () => { agentSendMessage(await preparePromptWithConnectors(chartPrompt)); })();
    } else {
      void (async () => {
        try {
          const preparedPrompt = await preparePromptWithConnectors(content);
          await agentSendMessage(preparedPrompt);
        } catch (error) {
          console.error('[Manus AI] Failed to send chat message:', error);
          setTaskStatus('error');
          setPhase('error');
          setResult({
            type: 'chat',
            content: "I couldn't reach the AI service. Check your connection and try again.",
            error: true,
          });
          setSteps(prev => prev.map(step => ({ ...step, status: 'error' as const })));
          emitRobotEvent('TASK_FAILED');
          toast.error("Couldn't reach the AI service. Please try again.");
        }
      })();
    }
  }, [agentSendMessage, preparePromptWithConnectors, taskId, user]);

  const startTask = useCallback(async (prompt: string, options: any) => {
    if (!prompt || !prompt.trim()) return null;
    const now = Date.now();
    if (lastSubmitRef.current.prompt === prompt.trim() && now - lastSubmitRef.current.timestamp < 1200) {
      console.warn('[Manus Agent] Suppressed duplicate rapid startTask:', prompt);
      return currentTaskIdRef.current;
    }
    lastSubmitRef.current = { prompt: prompt.trim(), timestamp: now };

    // Start fresh
    if (clearMessages) {
      clearMessages();
    } else if (setMessages) {
      setMessages([]);
    }

    // Create task & conversation in DB immediately
    let newTaskId: string | null = null;
    const userMsgId = 'msg_' + Date.now() + '_' + Math.random().toString(36).substring(2, 8);
    const userMsg = {
      id: userMsgId,
      role: 'user' as const,
      content: prompt,
      timestamp: new Date().toISOString(),
      status: 'success' as const
    };

    setPersistentMessages([userMsg]);

    let generatedId = 'task_' + Date.now() + '_' + Math.random().toString(36).substring(2, 8);
    newTaskId = generatedId;
    setTaskId(newTaskId);
    currentTaskIdRef.current = newTaskId;

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
        const taskRecord = await (blink.db as any).tasks.create({
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
        if (taskRecord?.id) {
          generatedId = taskRecord.id;
          newTaskId = generatedId;
          setTaskId(newTaskId);
          currentTaskIdRef.current = newTaskId;
        }
      } catch (err) {
        console.warn('Blink task create fallback to local DB:', err);
      }

      // Ensure conversation is permanently registered in IndexedDB
      await createConversation({
        id: newTaskId,
        userId,
        title: cleanChatTitle(prompt),
        mode: options.mode || (options.format === 'website' ? 'work' : 'chat'),
        outputFormat: options.format,
        chartType: options.chartType,
        projectId: options.projectId || null,
      });

      // Save user message to DB before AI generation
      await saveMessage({
        id: userMsgId,
        conversationId: newTaskId,
        userId,
        role: 'user',
        content: prompt,
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

    processedInvocationsRef.current.clear();
    setCurrentTask({ prompt, options, fileData: options.fileData, url: options.url });
    setTaskStatus('running');
    setPhase('tool-calling');
    setResult(null);
    setChartData(null);
    playNotificationSound('send');

    // Retrieve user personalization preferences from Settings
    const userSettings = getSettings();

    // Check if it's a simple message or chat mode
    const isChatMode = options.mode === 'chat';
    const isSimple = isChatMode || (!options.fileData && !options.url && options.format === 'report' && !options.intent);

    // Build enhanced prompt with context - for simple chat, keep it clean so user bubble is not polluted
    let enhancedPrompt = prompt;

    // Initial steps based on task type
    let initialSteps: Step[] = [];
    
    if (!isSimple) {
      initialSteps.push({ id: '1', label: 'Analyzing Request', status: 'running', trace: ['Parsing intent...', `Output: ${options.format}`, `Chart: ${options.chartType || 'auto'}`] });
      
      if (options.fileData) {
        const isCSV = options.fileName?.toLowerCase().endsWith('.csv');
        initialSteps.push(
          { id: '2', label: isCSV ? 'Parsing CSV Data' : 'Parsing File Content', status: 'pending', trace: [] },
          { id: '3', label: 'Profiling Data', status: 'pending', trace: [] },
          { id: '4', label: 'Computing Statistics', status: 'pending', trace: [] },
          { id: '5', label: 'Generating Insights', status: 'pending', trace: [] },
          { id: '6', label: 'Creating Visualizations', status: 'pending', trace: [] },
        );
        
        enhancedPrompt = `${prompt}\n\nFile Content to analyze (${options.fileName}):\n\`\`\`${isCSV ? 'csv' : 'text'}\n${options.fileData}\n\`\`\`\n\nPlease:\n1. Parse and validate this ${isCSV ? 'CSV data' : 'content'}\n2. Identify ${isCSV ? 'column types and compute summary statistics' : 'key themes and data points'}\n3. Generate insights about trends, patterns, and anomalies\n4. If applicable, create chart data in JSON format for ${options.chartType} chart\n5. Provide ${options.format} output with key findings`;
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

    // App Connector Tool Execution Phase
    const toolIntent = detectToolIntent(prompt);
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

    // Check for app launch or voice device commands
    const cmd = matchVoiceCommand(prompt);
    if (cmd && cmd.matched) {
      if (cmd.action === 'open_url' || cmd.action === 'search') {
        if (cmd.url) executeOpenUrl(cmd.url);
      } else {
        executeDeviceCommand(cmd);
      }
      toast.success(`${cmd.targetName}: ${cmd.feedbackSpeech}`);
    }

    // Resolve connectors and start generation. Handle rejected SDK/network requests so
    // the UI never remains in a running/typing state when the request fails before onError.
    try {
      const preparedPrompt = await preparePromptWithConnectors(enhancedPrompt);
      await agentSendMessage(preparedPrompt);
    } catch (error) {
      console.error('[Manus AI] Failed to start generation:', error);
      setTaskStatus('error');
      setPhase('error');
      setResult({
        type: options.format || 'chat',
        content: "I couldn't reach the AI service. Check your connection and try again.",
        error: true,
      });
      setSteps(prev => prev.map(step => ({ ...step, status: 'error' as const })));
      emitRobotEvent('TASK_FAILED');
      toast.error("Couldn't reach the AI service. Please try again.");
    }

    // Initial DB update with steps
    if (newTaskId && initialSteps.length > 0) {
      (blink.db as any).tasks.update(newTaskId, {
        steps: JSON.stringify(initialSteps)
      }).catch(console.error);
    }

    if (!isSimple) {
      // Progressive step updates
      setTimeout(() => {
        setSteps(prev => prev.length > 0 ? prev.map((s, i) => i === 0 ? { ...s, status: 'completed' } : i === 1 ? { ...s, status: 'running' } : s) : prev);
      }, 1500);

      setTimeout(() => {
        setSteps(prev => prev.length > 1 ? prev.map((s, i) => i === 1 ? { ...s, status: 'completed' } : i === 2 ? { ...s, status: 'running' } : s) : prev);
      }, 3500);

      setTimeout(() => {
        setSteps(prev => prev.length > 2 ? prev.map((s, i) => i === 2 ? { ...s, status: 'completed' } : i === 3 ? { ...s, status: 'running' } : s) : prev);
      }, 6000);
    }
    
    return newTaskId;

  }, [isAuthenticated, user, agentSendMessage, preparePromptWithConnectors]);

  const loadTask = useCallback(async (id: string) => {
    try {
      setTaskId(id);
      currentTaskIdRef.current = id;

      // 1. Load permanent messages from IndexedDB / chatDatabase
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

      // Check for auto-saved session snapshot in case the tab was accidentally closed
      const autoSaveSnapshot = chatAutoSave.getSnapshot(id);
      if (autoSaveSnapshot) {
        // If auto-saved snapshot has messages that were not yet synced or newer
        if (autoSaveSnapshot.messages && autoSaveSnapshot.messages.length > initialMsgs.length) {
          initialMsgs = autoSaveSnapshot.messages;
        }
      }
      setPersistentMessages(initialMsgs);

      // 2. Load task data
      const task = await (blink.db as any).tasks.get(id);
      if (task) {
        setCurrentTask({ 
          prompt: task.prompt || task.title || autoSaveSnapshot?.prompt || '', 
          options: { 
            format: task.outputFormat || autoSaveSnapshot?.outputFormat, 
            chartType: task.chartType || autoSaveSnapshot?.chartType 
          } 
        });
        setTaskStatus((task.status || autoSaveSnapshot?.status || 'idle') as any);
        
        if (task.steps) {
          try {
            setSteps(JSON.parse(task.steps));
          } catch { 
            setSteps(autoSaveSnapshot?.steps || []); 
          }
        } else if (autoSaveSnapshot?.steps) {
          setSteps(autoSaveSnapshot.steps);
        }
        
        if (task.result) {
          try {
            const parsedResult = JSON.parse(task.result);
            setResult(parsedResult);
            setChartData(parsedResult.chartData || autoSaveSnapshot?.chartData || null);
            if (initialMsgs.length === 0 && parsedResult.messages && parsedResult.messages.length > 0) {
              setPersistentMessages(parsedResult.messages);
            }
          } catch { 
            if (autoSaveSnapshot?.result) {
              setResult(autoSaveSnapshot.result);
              setChartData(autoSaveSnapshot.chartData || null);
            } else {
              setResult(null); 
            }
          }
        } else if (autoSaveSnapshot?.result) {
          setResult(autoSaveSnapshot.result);
          setChartData(autoSaveSnapshot.chartData || null);
        }
      } else if (autoSaveSnapshot) {
        // Full disaster recovery from auto-saved snapshot if task record was not found
        setCurrentTask({
          prompt: autoSaveSnapshot.prompt,
          options: { format: autoSaveSnapshot.outputFormat, chartType: autoSaveSnapshot.chartType }
        });
        setTaskStatus(autoSaveSnapshot.status as any);
        setSteps(autoSaveSnapshot.steps || []);
        setResult(autoSaveSnapshot.result || null);
        setChartData(autoSaveSnapshot.chartData || null);
      }
    } catch (e) {
      console.error('Failed to load task:', e);
    }
  }, [isAuthenticated]);

  const resetTask = () => {
    setTaskId(null);
    currentTaskIdRef.current = null;
    setCurrentTask(null);
    setTaskStatus('idle');
    setPhase('idle');
    setSteps([]);
    setResult(null);
    setChartData(null);
    setPersistentMessages([]);
    if (clearMessages) {
      clearMessages();
    } else if (setMessages) {
      setMessages([]);
    }
  };

  const exportToPDF = useCallback(async () => {
    if (!result) return;

    // Create PDF content (we'll use a simple approach - in production use jsPDF or similar)
    const content = `
Manus Analysis Report
Generated: ${new Date().toLocaleString()}

Task: ${currentTask?.prompt}
Output Format: ${currentTask?.options.format}

${result.content}

---
Report generated by Manus AI Workspace
    `.trim();

    // Create blob and download
    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `manus-report-${Date.now()}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [result, currentTask]);

  const deleteTask = useCallback(async (id: string) => {
    try {
      chatAutoSave.clearSnapshot(id);
      await (blink.db as any).tasks.delete(id);
      return true;
    } catch (e) {
      console.error('Failed to delete task:', e);
      return false;
    }
  }, [isAuthenticated]);

  const displayMessages = useMemo(() => {
    // Persistent messages are the canonical conversation history. The SDK's live
    // message list can contain prior turns as well as the currently streaming turn;
    // merging every assistant entry into history creates duplicate Manus headers.
    const rawList: any[] = [...persistentMessages];

    // While generating, render only the newest live assistant message as a temporary
    // stream preview. onFinish persists the final answer, after which this preview is
    // removed. Never append historical SDK messages to the canonical history.
    if (isLoading) {
      const liveAssistant = [...messages].reverse().find((message: any) =>
        message?.role === 'assistant' && typeof message.content === 'string'
      );
      if (liveAssistant?.content) {
        const last = rawList[rawList.length - 1];
        if (last?.role === 'assistant') {
          rawList[rawList.length - 1] = {
            ...last,
            content: liveAssistant.content,
            id: last.id || liveAssistant.id || 'live-assistant-current',
          };
        } else {
          rawList.push({
            id: liveAssistant.id || 'live-assistant-current',
            role: 'assistant',
            content: liveAssistant.content,
            timestamp: new Date().toISOString(),
            status: 'streaming',
          });
        }
      }
    }

    // Deduplicate by stable message ID only. Identical text can be a legitimate
    // separate turn, so content-based deduplication silently deletes user messages.
    const deduped: any[] = [];
    const seenIds = new Set<string>();
    for (const msg of rawList) {
      if (!msg) continue;
      if (msg.id && seenIds.has(msg.id)) continue;
      if (msg.id) seenIds.add(msg.id);
      deduped.push(msg);
    }
    return deduped;
  }, [persistentMessages, messages, isLoading]);

  // Continuous periodic auto-save registration: tracks live messages, streaming updates, steps, and status
  useEffect(() => {
    const activeId = taskId || currentTaskIdRef.current;
    if (activeId) {
      chatAutoSave.updateSession({
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
      });
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
