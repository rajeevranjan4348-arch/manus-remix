/**
 * Automatic Task Tagging Service
 *
 * Categorizes and tags AI tasks ('Research', 'Coding', 'Analysis', 'Design', 'Writing', 'Automation', 'General')
 * by analyzing task prompts, titles, messages, and generated outputs using the server-side Gemini API
 * with resilient local classification fallback and real-time persistence.
 */

import { updateConversation } from './chatDatabase';
import { blink } from './blink';

export type TaskTag = 'Research' | 'Coding' | 'Analysis' | 'Design' | 'Writing' | 'Automation' | 'General';

export const SESSION_TAGS_STORAGE_KEY = 'manus_session_tags';

export interface TagStyle {
  label: TaskTag;
  bgClass: string;
  textClass: string;
  borderClass: string;
  badgeClass: string;
}

export interface TaskTagAnalysisRequest {
  id?: string;
  title?: string;
  prompt?: string;
  content?: string;
  messages?: Array<{ role: string; content: string }>;
  resultContext?: any;
}

export const TASK_TAG_STYLES: Record<TaskTag, TagStyle> = {
  Research: {
    label: 'Research',
    bgClass: 'bg-[#F2F2F2] dark:bg-[#171717]',
    textClass: 'text-[#000000] dark:text-[#FFFFFF]',
    borderClass: 'border-[#E0E0E0] dark:border-[#333333]',
    badgeClass: 'bg-[#F2F2F2] dark:bg-[#171717] text-[#000000] dark:text-[#FFFFFF] border-[#E0E0E0] dark:border-[#333333]',
  },
  Coding: {
    label: 'Coding',
    bgClass: 'bg-[#F2F2F2] dark:bg-[#171717]',
    textClass: 'text-[#000000] dark:text-[#FFFFFF]',
    borderClass: 'border-[#E0E0E0] dark:border-[#333333]',
    badgeClass: 'bg-[#F2F2F2] dark:bg-[#171717] text-[#000000] dark:text-[#FFFFFF] border-[#E0E0E0] dark:border-[#333333]',
  },
  Analysis: {
    label: 'Analysis',
    bgClass: 'bg-[#F2F2F2] dark:bg-[#171717]',
    textClass: 'text-[#000000] dark:text-[#FFFFFF]',
    borderClass: 'border-[#E0E0E0] dark:border-[#333333]',
    badgeClass: 'bg-[#F2F2F2] dark:bg-[#171717] text-[#000000] dark:text-[#FFFFFF] border-[#E0E0E0] dark:border-[#333333]',
  },
  Design: {
    label: 'Design',
    bgClass: 'bg-[#F2F2F2] dark:bg-[#171717]',
    textClass: 'text-[#000000] dark:text-[#FFFFFF]',
    borderClass: 'border-[#E0E0E0] dark:border-[#333333]',
    badgeClass: 'bg-[#F2F2F2] dark:bg-[#171717] text-[#000000] dark:text-[#FFFFFF] border-[#E0E0E0] dark:border-[#333333]',
  },
  Writing: {
    label: 'Writing',
    bgClass: 'bg-[#F2F2F2] dark:bg-[#171717]',
    textClass: 'text-[#000000] dark:text-[#FFFFFF]',
    borderClass: 'border-[#E0E0E0] dark:border-[#333333]',
    badgeClass: 'bg-[#F2F2F2] dark:bg-[#171717] text-[#000000] dark:text-[#FFFFFF] border-[#E0E0E0] dark:border-[#333333]',
  },
  Automation: {
    label: 'Automation',
    bgClass: 'bg-[#F2F2F2] dark:bg-[#171717]',
    textClass: 'text-[#000000] dark:text-[#FFFFFF]',
    borderClass: 'border-[#E0E0E0] dark:border-[#333333]',
    badgeClass: 'bg-[#F2F2F2] dark:bg-[#171717] text-[#000000] dark:text-[#FFFFFF] border-[#E0E0E0] dark:border-[#333333]',
  },
  General: {
    label: 'General',
    bgClass: 'bg-[#F2F2F2] dark:bg-[#171717]',
    textClass: 'text-[#777777] dark:text-[#AAAAAA]',
    borderClass: 'border-[#E0E0E0] dark:border-[#333333]',
    badgeClass: 'bg-[#F2F2F2] dark:bg-[#171717] text-[#777777] dark:text-[#AAAAAA] border-[#E0E0E0] dark:border-[#333333]',
  },
};

const TAG_SYNONYM_MAP: Record<string, TaskTag> = {
  research: 'Research',
  search: 'Research',
  web: 'Research',
  coding: 'Coding',
  code: 'Coding',
  programming: 'Coding',
  development: 'Coding',
  debugging: 'Coding',
  engineering: 'Coding',
  analysis: 'Analysis',
  analytics: 'Analysis',
  data: 'Analysis',
  finance: 'Analysis',
  statistics: 'Analysis',
  design: 'Design',
  ui: 'Design',
  ux: 'Design',
  graphics: 'Design',
  styling: 'Design',
  writing: 'Writing',
  content: 'Writing',
  copywriting: 'Writing',
  drafting: 'Writing',
  editing: 'Writing',
  documentation: 'Writing',
  automation: 'Automation',
  workflow: 'Automation',
  integration: 'Automation',
  workspace: 'Automation',
  general: 'General',
  chat: 'General',
  other: 'General',
};

/**
 * Returns available system tags
 */
export function getAvailableTags(): TaskTag[] {
  return ['Research', 'Coding', 'Analysis', 'Design', 'Writing', 'Automation', 'General'];
}

/**
 * Retrieves tag styling rules
 */
export function getTagStyle(tag: string): TagStyle {
  return TASK_TAG_STYLES[tag as TaskTag] || TASK_TAG_STYLES.General;
}

/**
 * Normalizes raw tag arrays/strings (e.g. from Gemini API or DB storage) to canonical TaskTag values.
 */
export function normalizeClientTaskTags(
  rawTags: unknown,
  fallbackPrompt = '',
  fallbackContext?: any
): TaskTag[] {
  let candidateList: unknown[] = [];

  if (Array.isArray(rawTags)) {
    candidateList = rawTags;
  } else if (typeof rawTags === 'string' && rawTags.trim()) {
    const trimmed = rawTags.trim();
    if (trimmed.startsWith('[')) {
      try {
        const parsed = JSON.parse(trimmed);
        if (Array.isArray(parsed)) candidateList = parsed;
      } catch {
        candidateList = trimmed.split(',');
      }
    } else {
      candidateList = trimmed.split(',');
    }
  }

  const available = getAvailableTags();
  const normalized: TaskTag[] = [];

  for (const item of candidateList) {
    if (typeof item !== 'string') continue;
    const clean = item.trim();
    if (!clean) continue;

    const exact = available.find((t) => t.toLowerCase() === clean.toLowerCase());
    const mapped = exact || TAG_SYNONYM_MAP[clean.toLowerCase()];
    if (mapped && !normalized.includes(mapped)) {
      normalized.push(mapped);
    }
  }

  if (normalized.length > 1 && normalized.includes('General')) {
    const specific = normalized.filter((t) => t !== 'General');
    if (specific.length > 0) return specific.slice(0, 2);
  }

  if (normalized.length > 0) {
    return normalized.slice(0, 2);
  }

  if (fallbackPrompt || fallbackContext) {
    return classifyTaskTags(fallbackPrompt, fallbackContext);
  }

  return ['General'];
}

/**
 * Reads persisted AI session tags from localStorage.
 */
export function getStoredSessionTags(): Record<string, TaskTag[]> {
  if (typeof window === 'undefined' || !window.localStorage) return {};
  try {
    const raw = window.localStorage.getItem(SESSION_TAGS_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return {};

    const result: Record<string, TaskTag[]> = {};
    for (const [key, val] of Object.entries(parsed)) {
      const normalized = normalizeClientTaskTags(val);
      if (normalized.length > 0) {
        result[key] = normalized;
      }
    }
    return result;
  } catch {
    return {};
  }
}

/**
 * Persists AI-assigned tags for a session into localStorage and notifies subscribers.
 */
export function saveSessionTags(sessionId: string, tags: TaskTag[] | string[]): Record<string, TaskTag[]> {
  if (!sessionId) return getStoredSessionTags();
  const normalized = normalizeClientTaskTags(tags);
  const current = getStoredSessionTags();
  const updated: Record<string, TaskTag[]> = {
    ...current,
    [sessionId]: normalized,
  };

  if (typeof window !== 'undefined' && window.localStorage) {
    try {
      window.localStorage.setItem(SESSION_TAGS_STORAGE_KEY, JSON.stringify(updated));
      window.dispatchEvent(
        new CustomEvent('manus_session_tags_updated', {
          detail: { sessionId, tags: normalized },
        })
      );
      window.dispatchEvent(
        new CustomEvent('task_tagged', {
          detail: { taskId: sessionId, tags: normalized },
        })
      );
    } catch {
      // Ignore storage quota errors
    }
  }

  return updated;
}

/**
 * Removes stored tags for a deleted session.
 */
export function removeSessionTags(sessionId: string): Record<string, TaskTag[]> {
  const current = getStoredSessionTags();
  if (!sessionId || !(sessionId in current)) return current;
  const updated = { ...current };
  delete updated[sessionId];

  if (typeof window !== 'undefined' && window.localStorage) {
    try {
      window.localStorage.setItem(SESSION_TAGS_STORAGE_KEY, JSON.stringify(updated));
      window.dispatchEvent(
        new CustomEvent('manus_session_tags_updated', {
          detail: { sessionId, tags: undefined },
        })
      );
    } catch {
      // Ignore storage errors
    }
  }
  return updated;
}

/**
 * Classifies prompt content and execution results into auto-assigned tags.
 */
export function classifyTaskTags(prompt: string, resultContext?: any): TaskTag[] {
  const rawContextContent =
    typeof resultContext === 'string'
      ? resultContext
      : typeof resultContext?.content === 'string'
        ? resultContext.content
        : Array.isArray(resultContext?.messages)
          ? resultContext.messages.map((m: any) => m?.content || '').join(' ')
          : '';

  if ((!prompt || typeof prompt !== 'string') && !rawContextContent) return ['General'];

  const lowerPrompt = (typeof prompt === 'string' ? prompt : '').toLowerCase();
  const lowerContent = rawContextContent.toLowerCase();
  const combinedText = `${lowerPrompt} ${lowerContent}`;

  const scores: Record<TaskTag, number> = {
    Research: 0,
    Coding: 0,
    Analysis: 0,
    Design: 0,
    Writing: 0,
    Automation: 0,
    General: 0,
  };

  // 1. Coding Rules
  const codingKeywords = [
    'code', 'function', 'typescript', 'javascript', 'react', 'python', 'html', 'css',
    'bug', 'fix', 'refactor', 'api', 'endpoint', 'json', 'sql', 'database', 'git',
    'repository', 'script', 'algorithm', 'syntax', 'error', 'compile', 'build',
    'class', 'import', 'export', 'node', 'express', 'vite', 'component', 'props', 'state'
  ];
  codingKeywords.forEach((kw) => {
    if (lowerPrompt.includes(kw)) scores.Coding += 3;
    else if (lowerContent.includes(kw)) scores.Coding += 1;
  });
  if (/```(ts|tsx|js|jsx|py|json|html|css|sql|sh|bash)/i.test(combinedText)) {
    scores.Coding += 5;
  }

  // 2. Research Rules
  const researchKeywords = [
    'search', 'research', 'find', 'who is', 'what is', 'latest', 'news', 'url', 'http',
    'https', 'article', 'wikipedia', 'google', 'lookup', 'compare', 'review', 'source',
    'citations', 'history', 'biography', 'study', 'explore', 'investigate', 'facts', 'summary'
  ];
  researchKeywords.forEach((kw) => {
    if (lowerPrompt.includes(kw)) scores.Research += 3;
    else if (lowerContent.includes(kw)) scores.Research += 1;
  });
  if (resultContext?.type === 'web_search' || lowerPrompt.includes('http://') || lowerPrompt.includes('https://')) {
    scores.Research += 4;
  }

  // 3. Analysis Rules
  const analysisKeywords = [
    'analyze', 'analysis', 'csv', 'data', 'chart', 'graph', 'plot', 'statistics',
    'dataset', 'table', 'metrics', 'trend', 'report', 'forecast', 'sales', 'revenue',
    'growth', 'percent', 'percentage', 'summary', 'insights', 'benchmark', 'correlation'
  ];
  analysisKeywords.forEach((kw) => {
    if (lowerPrompt.includes(kw)) scores.Analysis += 3;
    else if (lowerContent.includes(kw)) scores.Analysis += 1;
  });
  if (resultContext?.chartData || resultContext?.type === 'graph' || resultContext?.type === 'spreadsheet') {
    scores.Analysis += 6;
  }

  // 4. Design Rules
  const designKeywords = [
    'design', 'ui', 'ux', 'layout', 'css', 'tailwind', 'theme', 'color', 'palette',
    'icon', 'logo', 'mockup', 'wireframe', 'styling', 'shadow', 'font', 'typography',
    'responsive', 'banner', 'illustration', 'image', 'svg', 'component design'
  ];
  designKeywords.forEach((kw) => {
    if (lowerPrompt.includes(kw)) scores.Design += 3;
    else if (lowerContent.includes(kw)) scores.Design += 1;
  });

  // 5. Writing Rules
  const writingKeywords = [
    'write', 'essay', 'draft', 'blog', 'email', 'letter', 'poem', 'story', 'document',
    'doc', 'article', 'paraphrase', 'translate', 'headline', 'copywrite', 'scriptwriter',
    'outline', 'proofread', 'grammar', 'rewrite'
  ];
  writingKeywords.forEach((kw) => {
    if (lowerPrompt.includes(kw)) scores.Writing += 3;
    else if (lowerContent.includes(kw)) scores.Writing += 1;
  });

  // 6. Automation Rules
  const automationKeywords = [
    'automate', 'connector', 'workspace', 'calendar', 'gmail', 'drive', 'webhook',
    'schedule', 'bot', 'integration', 'workflow', 'task queue', 'action', 'trigger'
  ];
  automationKeywords.forEach((kw) => {
    if (lowerPrompt.includes(kw)) scores.Automation += 3;
    else if (lowerContent.includes(kw)) scores.Automation += 1;
  });

  // Collect tags that scored above threshold (sorted by score descending)
  const rankedTags = (Object.keys(scores) as TaskTag[])
    .filter((tag) => tag !== 'General' && scores[tag] >= 3)
    .sort((a, b) => scores[b] - scores[a]);

  if (rankedTags.length === 0) {
    // If scores are low, check for fallback single matches
    const topTag = (Object.keys(scores) as TaskTag[])
      .filter((tag) => tag !== 'General')
      .sort((a, b) => scores[b] - scores[a])[0];
    if (topTag && scores[topTag] > 0) {
      return [topTag];
    }
    return ['General'];
  }

  // Return up to 2 top tags
  return rankedTags.slice(0, 2);
}

/**
 * Synchronously resolves tags for a session item by checking:
 * 1. Explicit tags on the task object (array or JSON string)
 * 2. Stored Gemini-assigned session tags (from localStorage or passed map)
 * 3. Instant local classification of prompt, title, and content
 */
export function resolveTaskTags(
  task: {
    id?: string;
    prompt?: string;
    title?: string;
    content?: string;
    tags?: string[] | string;
    result?: any;
  },
  storedTagsMap?: Record<string, TaskTag[]>
): TaskTag[] {
  if (!task) return ['General'];

  const map = storedTagsMap || getStoredSessionTags();
  if (task.id && Array.isArray(map[task.id]) && map[task.id].length > 0) {
    return map[task.id];
  }

  if (Array.isArray(task.tags) && task.tags.length > 0) {
    return normalizeClientTaskTags(task.tags, task.prompt || task.title || '', {
      content: task.content,
      ...(typeof task.result === 'object' ? task.result : {}),
    });
  }

  if (typeof task.tags === 'string' && task.tags.trim().length > 0) {
    return normalizeClientTaskTags(task.tags, task.prompt || task.title || '', {
      content: task.content,
      ...(typeof task.result === 'object' ? task.result : {}),
    });
  }

  return classifyTaskTags(task.prompt || task.title || '', {
    content: task.content,
    ...(typeof task.result === 'object' ? task.result : {}),
  });
}

const inFlightTagRequests = new Map<string, Promise<TaskTag[]>>();

/**
 * Persists tags to localStorage, IndexedDB, and Blink DB for a given task ID.
 */
async function persistTagsForSession(taskId: string, tags: TaskTag[]): Promise<void> {
  if (!taskId) return;
  saveSessionTags(taskId, tags);

  try {
    await updateConversation(taskId, {
      metadata: {
        tags,
        taggedAt: new Date().toISOString(),
      },
    });
  } catch {
    // Non-fatal in environments without IndexedDB
  }

  try {
    const existingTask = await (blink.db as any).tasks.get(taskId).catch(() => null);
    if (existingTask) {
      await (blink.db as any).tasks.update(taskId, {
        tags: JSON.stringify(tags),
      });
    }
  } catch {
    // Non-fatal if task is only stored in IndexedDB
  }
}

/**
 * Analyzes task content using the server-side Gemini API (`/api/tag-task`)
 * to categorize a session into 'Research', 'Coding', 'Writing', 'Analysis', 'Design', 'Automation', or 'General'.
 */
export async function analyzeTaskTagsWithGemini(
  request: TaskTagAnalysisRequest
): Promise<TaskTag[]> {
  const promptText = (request.prompt || request.title || '').trim();
  const contentText =
    typeof request.content === 'string'
      ? request.content.trim()
      : typeof request.resultContext?.content === 'string'
        ? request.resultContext.content.trim()
        : '';

  if (!promptText && !contentText && (!request.messages || request.messages.length === 0)) {
    return ['General'];
  }

  const dedupeKey = request.id || `${promptText.slice(0, 80)}::${contentText.slice(0, 80)}`;
  const existingInFlight = inFlightTagRequests.get(dedupeKey);
  if (existingInFlight) {
    return existingInFlight;
  }

  const runAnalysis = async (): Promise<TaskTag[]> => {
    let resolvedTags: TaskTag[] | null = null;

    if (typeof fetch === 'function') {
      try {
        const response = await fetch('/api/tag-task', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
          },
          body: JSON.stringify({
            sessionId: request.id,
            title: request.title,
            prompt: promptText,
            content: contentText.slice(0, 4000),
            messages: Array.isArray(request.messages) ? request.messages.slice(-12) : undefined,
          }),
        });

        if (response.ok) {
          const data = await response.json();
          if (Array.isArray(data?.tags) && data.tags.length > 0) {
            resolvedTags = normalizeClientTaskTags(data.tags, promptText, {
              content: contentText,
              ...(typeof request.resultContext === 'object' ? request.resultContext : {}),
            });
          }
        }
      } catch {
        // Resilient fallback to local classifier when offline or during unit tests
      }
    }

    if (!resolvedTags || resolvedTags.length === 0) {
      resolvedTags = classifyTaskTags(promptText, {
        content: contentText,
        messages: request.messages,
        ...(typeof request.resultContext === 'object' ? request.resultContext : {}),
      });
    }

    if (request.id) {
      await persistTagsForSession(request.id, resolvedTags);
    }

    return resolvedTags;
  };

  const promise = runAnalysis().finally(() => {
    inFlightTagRequests.delete(dedupeKey);
  });

  inFlightTagRequests.set(dedupeKey, promise);
  return promise;
}

/**
 * Automatically categorizes any untagged sessions in the background using the Gemini API
 * and persists their categories so HistoryPanel displays them reactively.
 */
export async function autoTagSessionBatch(
  sessions: Array<{
    id: string;
    title?: string;
    prompt?: string;
    content?: string;
    tags?: string[] | string;
    messages?: Array<{ role: string; content: string }>;
  }>
): Promise<Record<string, TaskTag[]>> {
  const stored = getStoredSessionTags();
  if (!Array.isArray(sessions) || sessions.length === 0) return stored;

  const untagged = sessions.filter((s) => {
    if (!s?.id) return false;
    if (Array.isArray(stored[s.id]) && stored[s.id].length > 0) return false;
    if (Array.isArray(s.tags) && s.tags.length > 0) {
      saveSessionTags(s.id, s.tags);
      return false;
    }
    if (typeof s.tags === 'string' && s.tags.trim().length > 0) {
      saveSessionTags(s.id, normalizeClientTaskTags(s.tags, s.prompt || s.title || '', { content: s.content }));
      return false;
    }
    return Boolean((s.prompt || s.title || s.content || '').trim());
  });

  if (untagged.length === 0) {
    return getStoredSessionTags();
  }

  const batchSlice = untagged.slice(0, 20);

  if (typeof fetch === 'function') {
    try {
      const response = await fetch('/api/tag-task', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          sessions: batchSlice.map((s) => ({
            id: s.id,
            title: s.title,
            prompt: s.prompt,
            content: (s.content || '').slice(0, 3000),
            messages: s.messages,
          })),
        }),
      });

      if (response.ok) {
        const data = await response.json();
        if (data?.results && typeof data.results === 'object') {
          await Promise.allSettled(
            batchSlice.map(async (session) => {
              const raw = data.results[session.id];
              const normalized = normalizeClientTaskTags(raw, session.prompt || session.title || '', {
                content: session.content,
              });
              await persistTagsForSession(session.id, normalized);
            })
          );
          return getStoredSessionTags();
        }
      }
    } catch {
      // Fallback to individual or local classification below
    }
  }

  await Promise.allSettled(
    batchSlice.map(async (session) => {
      await analyzeTaskTagsWithGemini({
        id: session.id,
        title: session.title,
        prompt: session.prompt,
        content: session.content,
        messages: session.messages,
      });
    })
  );

  return getStoredSessionTags();
}

/**
 * Automatically tags a task after completion using Gemini API analysis (with instant local fallback)
 * and persists the tags to storage & UI event bus.
 */
export async function tagTaskAfterCompletion(
  taskId: string,
  prompt: string,
  resultContext?: any
): Promise<TaskTag[]> {
  if (!taskId) return ['General'];

  const tags = await analyzeTaskTagsWithGemini({
    id: taskId,
    prompt,
    content: typeof resultContext?.content === 'string' ? resultContext.content : undefined,
    messages: Array.isArray(resultContext?.messages) ? resultContext.messages : undefined,
    resultContext,
  });

  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('manus_tasks_updated'));
  }

  return tags;
}
