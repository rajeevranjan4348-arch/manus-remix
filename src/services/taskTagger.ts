/**
 * Task Tagger Utility Service ('src/services/taskTagger.ts')
 *
 * Uses AI model analysis (via server-side Gemini endpoint `/api/tag-task`) with resilient local pattern fallback
 * to automatically categorize completed tasks into relevant tags ('Research', 'Coding', 'Analysis', 'Design', 'Writing', 'Automation', 'General').
 * Saves tags to task metadata and localStorage upon completion.
 */

import {
  analyzeTaskTagsWithGemini,
  tagTaskAfterCompletion,
  TaskTag,
} from '@/lib/taskTaggingService';

export type { TaskTag };

/**
 * Analyzes the completed task's prompt and content using the Gemini API to determine relevant tags.
 */
export async function tagTaskWithAI(prompt: string, content?: string): Promise<TaskTag[]> {
  if ((!prompt || typeof prompt !== 'string') && (!content || typeof content !== 'string')) {
    return ['General'];
  }

  return analyzeTaskTagsWithGemini({
    prompt: (prompt || '').trim(),
    content: (content || '').trim(),
  });
}

/**
 * Processes and saves Gemini-generated tags to the task's metadata and localStorage upon completion.
 */
export async function processTaskTags(
  taskId: string,
  prompt: string,
  content?: string
): Promise<TaskTag[]> {
  if (!taskId) return ['General'];

  return tagTaskAfterCompletion(taskId, prompt, {
    content: (content || '').trim(),
  });
}

export const taskTagger = {
  tagTaskWithAI,
  processTaskTags,
};

export default taskTagger;
