/**
 * Task Tagger Utility Service ('src/services/taskTagger.ts')
 *
 * Uses AI model analysis (via server-side Gemini endpoint) with resilient local pattern fallback
 * to automatically categorize completed tasks into relevant tags (e.g., 'Research', 'Coding', 'Analysis', 'Design', 'Writing', 'Automation').
 * Saves tags to task metadata upon completion.
 */

import { updateConversation } from '@/lib/chatDatabase';
import { blink } from '@/lib/blink';
import { classifyTaskTags } from '@/lib/taskTaggingService';

export type TaskTag = 'Research' | 'Coding' | 'Analysis' | 'Design' | 'Writing' | 'Automation' | 'General';

/**
 * Analyzes the completed task's prompt and content using the AI model to determine relevant tags.
 */
export async function tagTaskWithAI(prompt: string, content?: string): Promise<string[]> {
  if (!prompt || typeof prompt !== 'string') {
    return ['General'];
  }

  const cleanPrompt = prompt.trim();
  const cleanContent = (content || '').trim();

  try {
    const response = await fetch('/api/tag-task', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        prompt: cleanPrompt,
        content: cleanContent.slice(0, 3000), // Enforce reasonable length bound
      }),
    });

    if (response.ok) {
      const data = await response.json();
      if (Array.isArray(data?.tags) && data.tags.length > 0) {
        const validTags = data.tags
          .filter((t: unknown): t is string => typeof t === 'string' && t.trim().length > 0)
          .map((t: string) => t.trim());
        if (validTags.length > 0) {
          return Array.from(new Set<string>(validTags)).slice(0, 3);
        }
      }
    }
  } catch (err) {
    console.warn('[taskTagger] Server AI tagging notice (using resilient fallback classifier):', err);
  }

  // Fallback to local classification engine
  return classifyTaskTags(cleanPrompt, { content: cleanContent });
}

/**
 * Processes and saves AI-generated tags to the task's metadata upon completion.
 */
export async function processTaskTags(
  taskId: string,
  prompt: string,
  content?: string
): Promise<string[]> {
  if (!taskId) return ['General'];

  // 1. Analyze prompt and content with AI model
  const tags = await tagTaskWithAI(prompt, content);

  try {
    // 2. Save tags to IndexedDB Conversation Metadata
    await updateConversation(taskId, {
      metadata: {
        tags,
        taggedAt: new Date().toISOString(),
      },
    });

    // 3. Save tags to Blink Tasks DB collection
    try {
      const existingTask = await (blink.db as any).tasks.get(taskId).catch(() => null);
      if (existingTask) {
        await (blink.db as any).tasks.update(taskId, {
          tags: JSON.stringify(tags),
        });
      }
    } catch (e) {
      console.warn('[taskTagger] Blink tasks DB update notice:', e);
    }

    // 4. Emit custom events to update UI real-time
    if (typeof window !== 'undefined') {
      window.dispatchEvent(
        new CustomEvent('task_tagged', {
          detail: { taskId, tags },
        })
      );
      window.dispatchEvent(new CustomEvent('manus_tasks_updated'));
    }
  } catch (err) {
    console.error('[taskTagger] Failed to save task tags:', err);
  }

  return tags;
}

export const taskTagger = {
  tagTaskWithAI,
  processTaskTags,
};

export default taskTagger;
