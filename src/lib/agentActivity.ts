export type AgentActivityStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';

export interface AgentActivityEvent {
  taskId: string;
  eventId: string;
  activityId: string;
  title: string;
  description: string;
  toolName: string;
  status: AgentActivityStatus;
  timestamp: string;
  resultSummary?: string;
  details?: string;
  errorStatus?: string;
}

export type AgentActivityInput = Omit<AgentActivityEvent, 'eventId' | 'timestamp'> & {
  eventId?: string;
  timestamp?: string;
};

export const AGENT_ACTIVITY_EVENT = 'manus_agent_activity';
export const AGENT_ACTIVITY_CANCEL_EVENT = 'manus_agent_activity_cancel';
const MAX_ACTIVITY_TEXT = 240;
let localEventSequence = 0;

const VALID_STATUSES = new Set<AgentActivityStatus>([
  'queued', 'running', 'completed', 'failed', 'cancelled',
]);

/** Remove controls and redact likely credential values before any activity reaches storage or UI. */
export function sanitizeActivityText(value: unknown, maxLength = MAX_ACTIVITY_TEXT): string {
  if (typeof value !== 'string') return '';
  return value
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\b(Bearer\s+)[A-Za-z0-9._~+/=-]+/gi, '$1[redacted]')
    .replace(/\b(api[_ -]?key|access[_ -]?token|refresh[_ -]?token|password|passwd|secret|authorization)\b\s*[:=]\s*[^\s,;]+/gi, '$1=[redacted]')
    .replace(/\b[A-Za-z0-9_-]{24,}\.[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}\b/g, '[redacted token]')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

function safeIdentifier(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback;
  const normalized = value.replace(/[^A-Za-z0-9_.:-]/g, '').slice(0, 160);
  return normalized || fallback;
}

export function parseAgentActivityEvent(value: unknown): AgentActivityEvent | null {
  if (!value || typeof value !== 'object') return null;
  const item = value as Record<string, unknown>;
  const taskId = safeIdentifier(item.taskId, '');
  const eventId = safeIdentifier(item.eventId, '');
  const activityId = safeIdentifier(item.activityId, '');
  const status = item.status as AgentActivityStatus;
  const title = sanitizeActivityText(item.title, 90);
  const description = sanitizeActivityText(item.description, 180);
  const toolName = safeIdentifier(item.toolName, 'agent');
  if (!taskId || !eventId || !activityId || !title || !description || !VALID_STATUSES.has(status)) return null;
  const timestamp = typeof item.timestamp === 'string' && !Number.isNaN(Date.parse(item.timestamp))
    ? new Date(item.timestamp).toISOString()
    : new Date().toISOString();
  const resultSummary = sanitizeActivityText(item.resultSummary, 180);
  const details = sanitizeActivityText(item.details, 500);
  const errorStatus = safeIdentifier(item.errorStatus, '');
  return {
    taskId,
    eventId,
    activityId,
    title,
    description,
    toolName,
    status,
    timestamp,
    ...(resultSummary ? { resultSummary } : {}),
    ...(details ? { details } : {}),
    ...(errorStatus ? { errorStatus } : {}),
  };
}

export function createAgentActivityEvent(input: AgentActivityInput): AgentActivityEvent | null {
  localEventSequence += 1;
  const timestamp = input.timestamp || new Date().toISOString();
  return parseAgentActivityEvent({
    ...input,
    eventId: input.eventId || `client:${Date.now().toString(36)}:${localEventSequence.toString(36)}`,
    timestamp,
  });
}

export function dispatchAgentActivity(value: unknown): AgentActivityEvent | null {
  const activity = parseAgentActivityEvent(value);
  if (!activity || typeof window === 'undefined' || typeof window.dispatchEvent !== 'function') return activity;
  try {
    window.dispatchEvent(new CustomEvent<AgentActivityEvent>(AGENT_ACTIVITY_EVENT, { detail: activity }));
  } catch {}
  return activity;
}

export function publishAgentActivity(input: AgentActivityInput): AgentActivityEvent | null {
  return dispatchAgentActivity(createAgentActivityEvent(input));
}

const STATUS_RANK: Record<AgentActivityStatus, number> = {
  queued: 0,
  running: 1,
  completed: 2,
  failed: 2,
  cancelled: 2,
};

/** Merge a single event into a bounded task feed, deduplicating replayed SSE event IDs. */
export function mergeAgentActivityEvent(
  previous: AgentActivityEvent[],
  value: unknown,
  maxItems = 32
): AgentActivityEvent[] {
  const event = parseAgentActivityEvent(value);
  if (!event || previous.some(existing => existing.eventId === event.eventId)) return previous;
  const existingIndex = previous.findIndex(existing => existing.activityId === event.activityId);
  let next: AgentActivityEvent[];
  if (existingIndex < 0) {
    next = [...previous, event];
  } else {
    const existing = previous[existingIndex];
    // Ignore delayed or replayed state transitions that would move an activity backwards.
    if (STATUS_RANK[event.status] < STATUS_RANK[existing.status]) return previous;
    if (STATUS_RANK[existing.status] === 2 && STATUS_RANK[event.status] === 2 && existing.status !== event.status) return previous;
    next = [...previous];
    next[existingIndex] = {
      ...existing,
      ...event,
      resultSummary: event.resultSummary || existing.resultSummary,
      details: event.details || existing.details,
    };
  }
  return next.slice(-Math.max(1, maxItems));
}

export interface ToolActivitySummary {
  title: string;
  description: string;
  resultSummary?: string;
}

/** Classify a real tool invocation without exposing its arguments or raw output. */
export function summarizeToolActivity(
  toolName: string,
  args: unknown,
  output: unknown,
  status: AgentActivityStatus
): ToolActivitySummary {
  const normalizedTool = toolName.toLowerCase().replace(/[^a-z0-9_:-]/g, '');
  const argRecord = args && typeof args === 'object' ? args as Record<string, unknown> : {};
  const commandValue = argRecord.command ?? argRecord.cmd ?? argRecord.script;
  const command = typeof commandValue === 'string' ? commandValue.toLowerCase() : '';
  let title = 'Running agent tool';

  if (normalizedTool.includes('web_search') || normalizedTool === 'search') title = 'Searching the web';
  else if (normalizedTool.includes('fetch_url') || normalizedTool.includes('browser') || normalizedTool.includes('web_open')) title = 'Opening and inspecting a webpage';
  else if (normalizedTool.includes('read_file')) title = 'Reading a file';
  else if (normalizedTool.includes('list_dir') || normalizedTool.includes('glob_file_search') || normalizedTool === 'grep') title = 'Inspecting repository files';
  else if (normalizedTool.includes('run_terminal_cmd') || normalizedTool.includes('run_code')) {
    if (/\b(tsc|typescript|typecheck|type-check|lint)\b/.test(command)) title = 'Running TypeScript validation';
    else if (/\b(npm|pnpm|bun|yarn)\s+(run\s+)?test\b|\b(vitest|jest|playwright|cypress)\b/.test(command)) title = 'Running automated tests';
    else if (/\b(npm|pnpm|bun|yarn)\s+(run\s+)?build\b|\b(vite\s+build|next\s+build|webpack)\b/.test(command)) title = 'Running build verification';
    else if (/\b(npm|pnpm|bun|yarn)\s+(audit|outdated|ls|list)\b/.test(command)) title = 'Checking dependencies';
    else if (/\b(git\s+(status|diff|show|log)|diff\s+--check)\b/.test(command)) title = 'Verifying repository changes';
    else title = 'Executing a terminal command';
  } else if (normalizedTool.includes('github')) title = 'Running a GitHub operation';
  else if (normalizedTool.includes('firebase') || normalizedTool.includes('auth')) title = 'Checking authentication configuration';
  else if (normalizedTool.includes('database') || normalizedTool.startsWith('db_') || normalizedTool.includes('firestore')) title = 'Checking database data';
  else if (normalizedTool.includes('api')) title = 'Calling an API';
  else if (normalizedTool.includes('connector')) title = 'Running a connected-app action';
  else title = `Running ${toolName.replace(/[_-]+/g, ' ')}`;

  const descriptions: Record<AgentActivityStatus, string> = {
    queued: 'The tool call is queued.',
    running: 'The tool call is running.',
    completed: 'The tool call returned successfully.',
    failed: 'The tool call returned an error.',
    cancelled: 'The tool call was cancelled.',
  };
  let resultSummary: string | undefined;
  if (status === 'completed' || status === 'failed') {
    const record = output && typeof output === 'object' ? output as Record<string, unknown> : {};
    const outputText = typeof output === 'string'
      ? output
      : [record.stdout, record.output, record.text, record.result, record.stderr]
          .filter(value => typeof value === 'string')
          .join('\n');
    if (title === 'Running automated tests') {
      const passed = outputText.match(/\btests?\s+(\d+)\s+passed\b/i)?.[1] ?? outputText.match(/\b(\d+)\s+passed\b/i)?.[1];
      const failed = outputText.match(/\btests?\s+(\d+)\s+failed\b/i)?.[1] ?? outputText.match(/\b(\d+)\s+failed\b/i)?.[1];
      const skipped = outputText.match(/\b(\d+)\s+skipped\b/i)?.[1];
      if (passed || failed || skipped) {
        resultSummary = `Tests: ${passed || '0'} passed, ${failed || '0'} failed, ${skipped || '0'} skipped.`;
      } else {
        resultSummary = status === 'completed'
          ? 'The test command completed; detailed totals were not reported.'
          : 'The test command failed; detailed totals were not reported.';
      }
    } else if (title === 'Running TypeScript validation') {
      resultSummary = status === 'completed' ? 'No TypeScript errors were reported.' : 'TypeScript validation failed.';
    } else if (title === 'Running build verification') {
      resultSummary = status === 'completed' ? 'The build command completed successfully.' : 'Build verification failed.';
    } else if (title === 'Checking dependencies') {
      resultSummary = status === 'completed' ? 'The dependency check completed.' : 'The dependency check failed.';
    } else if (status === 'completed') {
      resultSummary = 'Tool output received.';
    }
  }

  return { title, description: descriptions[status], ...(resultSummary ? { resultSummary } : {}) };
}

export function makeResearchActivity(
  event: { stage?: string; detail?: string; timestamp?: string },
  taskId: string,
  requestId: string,
  sequence: number
): AgentActivityEvent | null {
  const cached = /knowledge cache/i.test(event.detail || '');
  const definitions: Record<string, { title: string; description: string; toolName: string; status: AgentActivityStatus }> = {
    understanding_question: {
      title: 'Analyzing user request',
      description: 'The request was classified for response planning.',
      toolName: 'request-router',
      status: 'completed',
    },
    searching_sources: cached
      ? {
          title: 'Checking verified source cache',
          description: 'A fresh cached research record was retrieved.',
          toolName: 'knowledge-cache',
          status: 'completed',
        }
      : {
          title: 'Searching for relevant sources',
          description: 'Live source lookup has started.',
          toolName: 'live-search',
          status: 'running',
        },
    reading_information: {
      title: 'Reviewing search results',
      description: /Extracted\s+0\s+candidate source/i.test(event.detail || '')
        ? 'The source lookup returned no candidate information.'
        : 'The source lookup returned candidate information.',
      toolName: 'source-reader',
      status: 'completed',
    },
    verifying_facts: {
      title: 'Verifying source information',
      description: 'The source verification stage finished.',
      toolName: 'source-verifier',
      status: 'completed',
    },
    preparing_answer: {
      title: 'Preparing response',
      description: 'The available context is ready for response generation.',
      toolName: 'response-preparation',
      status: 'running',
    },
  };
  const definition = definitions[String(event.stage || '')];
  if (!definition) return null;
  const resultCount = (event.detail || '').match(/Extracted\s+(\d+)\s+candidate source/i)?.[1];
  return parseAgentActivityEvent({
    taskId,
    eventId: `${requestId}:rtie:${sequence}`,
    activityId: `${requestId}:rtie:${event.stage}`,
    ...definition,
    timestamp: event.timestamp || new Date().toISOString(),
    ...(resultCount ? { resultSummary: `${resultCount} candidate source(s) returned.` } : {}),
  });
}


export function makeResearchActivities(
  event: { stage?: string; detail?: string; timestamp?: string },
  taskId: string,
  requestId: string,
  sequence: number
): AgentActivityEvent[] {
  const activities: AgentActivityEvent[] = [];
  if (event.stage === 'reading_information') {
    const resultCount = (event.detail || '').match(/Extracted\s+(\d+)\s+candidate source/i)?.[1];
    const searchComplete = parseAgentActivityEvent({
      taskId,
      eventId: `${requestId}:rtie:${sequence}:search-complete`,
      activityId: `${requestId}:rtie:searching_sources`,
      title: 'Searching for relevant sources',
      description: resultCount === '0'
        ? 'The source lookup returned no candidate information.'
        : 'The source lookup returned candidate information.',
      toolName: 'live-search',
      status: 'completed',
      timestamp: event.timestamp || new Date().toISOString(),
      ...(resultCount ? { resultSummary: `${resultCount} candidate source(s) returned.` } : {}),
    });
    if (searchComplete) activities.push(searchComplete);
  }
  const activity = makeResearchActivity(event, taskId, requestId, sequence + 1);
  if (activity) activities.push(activity);
  return activities;
}
