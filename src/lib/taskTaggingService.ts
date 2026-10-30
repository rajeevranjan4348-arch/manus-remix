/**
 * Automatic Task Tagging Service
 *
 * Categorizes and tags AI tasks (e.g., 'Research', 'Coding', 'Analysis', 'Design', 'Writing', 'Automation')
 * based on prompt content, output formats, steps, and generated results after completion.
 */

import { updateConversation } from './chatDatabase';
import { blink } from './blink';

export type TaskTag = 'Research' | 'Coding' | 'Analysis' | 'Design' | 'Writing' | 'Automation' | 'General';

export interface TagStyle {
  label: TaskTag;
  bgClass: string;
  textClass: string;
  borderClass: string;
  badgeClass: string;
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
 * Classifies prompt content and execution results into auto-assigned tags.
 */
export function classifyTaskTags(prompt: string, resultContext?: any): TaskTag[] {
  if (!prompt || typeof prompt !== 'string') return ['General'];

  const lowerPrompt = prompt.toLowerCase();
  const lowerContent = typeof resultContext?.content === 'string' ? resultContext.content.toLowerCase() : '';
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
 * Automatically tags a task after completion and persists the tags to storage & UI event bus.
 */
export async function tagTaskAfterCompletion(
  taskId: string,
  prompt: string,
  resultContext?: any
): Promise<TaskTag[]> {
  if (!taskId) return ['General'];

  const tags = classifyTaskTags(prompt, resultContext);

  try {
    // 1. Update IndexedDB Conversation Record
    await updateConversation(taskId, {
      metadata: {
        tags,
        taggedAt: new Date().toISOString(),
      },
    });

    // 2. Update Blink DB tasks collection if present
    try {
      const existingTask = await (blink.db as any).tasks.get(taskId).catch(() => null);
      if (existingTask) {
        await (blink.db as any).tasks.update(taskId, {
          tags: JSON.stringify(tags),
        });
      }
    } catch (e) {
      console.warn('[TaskTaggingService] Blink DB task update notice:', e);
    }

    // 3. Emit global event to update UI in real-time
    if (typeof window !== 'undefined') {
      window.dispatchEvent(
        new CustomEvent('task_tagged', {
          detail: { taskId, tags },
        })
      );
      window.dispatchEvent(new CustomEvent('manus_tasks_updated'));
    }
  } catch (err) {
    console.error('[TaskTaggingService] Failed to tag task:', err);
  }

  return tags;
}
