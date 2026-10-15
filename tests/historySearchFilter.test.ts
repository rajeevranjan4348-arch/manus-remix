import { describe, it, expect } from 'vitest';

export interface TaskHistoryItem {
  id: string;
  prompt: string;
  title?: string;
  created_at: string;
  status?: string;
  mode?: string;
}

function filterTasksHelper(
  tasks: TaskHistoryItem[],
  searchQuery: string,
  dateFilter: 'all' | 'today' | 'yesterday' | 'week' | 'month' | 'custom',
  startDate?: string,
  endDate?: string,
  nowDate: Date = new Date('2026-10-14T12:00:00Z')
) {
  return tasks.filter(task => {
    const created = new Date(task.created_at || nowDate);
    const createdTime = created.getTime();

    // 1. Date Range Filter
    const todayStart = new Date(nowDate.getFullYear(), nowDate.getMonth(), nowDate.getDate()).getTime();
    const yesterdayStart = todayStart - 86400000;
    const weekStart = todayStart - 7 * 86400000;
    const monthStart = todayStart - 30 * 86400000;

    if (dateFilter === 'today') {
      if (createdTime < todayStart) return false;
    } else if (dateFilter === 'yesterday') {
      if (createdTime < yesterdayStart || createdTime >= todayStart) return false;
    } else if (dateFilter === 'week') {
      if (createdTime < weekStart) return false;
    } else if (dateFilter === 'month') {
      if (createdTime < monthStart) return false;
    } else if (dateFilter === 'custom') {
      if (startDate) {
        const sTime = new Date(startDate).getTime();
        if (!isNaN(sTime) && createdTime < sTime) return false;
      }
      if (endDate) {
        const eTime = new Date(endDate).getTime() + 86400000 - 1;
        if (!isNaN(eTime) && createdTime > eTime) return false;
      }
    }

    // 2. Keyword Filter
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase().trim();

    const title = (task.title || task.prompt || '').toLowerCase();
    const prompt = (task.prompt || '').toLowerCase();
    const status = (task.status || '').toLowerCase();
    const mode = (task.mode || '').toLowerCase();

    const dateFormatted = created.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      weekday: 'short'
    }).toLowerCase();
    const fullDate = created.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }).toLowerCase();
    const isoDate = created.toISOString().toLowerCase();

    return (
      title.includes(q) ||
      prompt.includes(q) ||
      status.includes(q) ||
      mode.includes(q) ||
      dateFormatted.includes(q) ||
      fullDate.includes(q) ||
      isoDate.includes(q)
    );
  });
}

describe('HistoryPanel Search & Date Filtering', () => {
  const mockTasks: TaskHistoryItem[] = [
    {
      id: 'task-1',
      title: 'Fix AI Streaming Loop',
      prompt: 'Investigate sse response infinite loading bug',
      created_at: '2026-10-14T10:00:00Z', // Today relative to 2026-10-14
      mode: 'work'
    },
    {
      id: 'task-2',
      title: 'Quantum Physics Intro',
      prompt: 'Explain quantum entanglement simply',
      created_at: '2026-10-13T15:30:00Z', // Yesterday relative to 2026-10-14
      mode: 'chat'
    },
    {
      id: 'task-3',
      title: 'Financial Analysis 2026',
      prompt: 'Create financial projection quarterly report',
      created_at: '2026-10-10T08:00:00Z', // Within 7 days
      mode: 'work'
    },
    {
      id: 'task-4',
      title: 'React Code Refactoring',
      prompt: 'Clean up state management and hook effects',
      created_at: '2026-09-20T14:00:00Z', // Older than 30 days
      mode: 'work'
    }
  ];

  const simulatedNow = new Date('2026-10-14T12:00:00Z');

  it('filters tasks by keyword search', () => {
    const results = filterTasksHelper(mockTasks, 'Quantum', 'all', undefined, undefined, simulatedNow);
    expect(results.length).toBe(1);
    expect(results[0].id).toBe('task-2');
  });

  it('filters tasks by prompt content', () => {
    const results = filterTasksHelper(mockTasks, 'infinite loading', 'all', undefined, undefined, simulatedNow);
    expect(results.length).toBe(1);
    expect(results[0].id).toBe('task-1');
  });

  it('filters tasks by date period preset: Today', () => {
    const results = filterTasksHelper(mockTasks, '', 'today', undefined, undefined, simulatedNow);
    expect(results.length).toBe(1);
    expect(results[0].id).toBe('task-1');
  });

  it('filters tasks by date period preset: Yesterday', () => {
    const results = filterTasksHelper(mockTasks, '', 'yesterday', undefined, undefined, simulatedNow);
    expect(results.length).toBe(1);
    expect(results[0].id).toBe('task-2');
  });

  it('filters tasks by date period preset: Past 7 Days', () => {
    const results = filterTasksHelper(mockTasks, '', 'week', undefined, undefined, simulatedNow);
    expect(results.length).toBe(3); // task-1, task-2, task-3
  });

  it('filters tasks by custom date range', () => {
    const results = filterTasksHelper(mockTasks, '', 'custom', '2026-10-01', '2026-10-13', simulatedNow);
    expect(results.length).toBe(2); // task-2 and task-3
  });

  it('combines keyword search and date filter', () => {
    const results = filterTasksHelper(mockTasks, 'work', 'week', undefined, undefined, simulatedNow);
    expect(results.length).toBe(2); // task-1 and task-3
  });

  it('filters tasks by full-text content using exported filterTasks', async () => {
    const { filterTasks, getContentSnippet } = await import('../src/components/history/HistoryPanel');

    const tasksWithContent = [
      {
        id: 'task-a',
        title: 'Backend API Design',
        prompt: 'Build REST endpoints for auth',
        content: 'We need PostgreSQL with Drizzle ORM and bcrypt password hashing',
        created_at: '2026-10-14T09:00:00Z',
        mode: 'work'
      },
      {
        id: 'task-b',
        title: 'UI Design Review',
        prompt: 'Review colors and layout',
        content: 'Tailwind CSS classes with glassmorphism navbar and dark mode toggle',
        created_at: '2026-10-14T11:00:00Z',
        mode: 'chat'
      }
    ];

    // Search by title
    const titleResults = filterTasks(tasksWithContent, 'Backend', 'all', undefined, undefined, simulatedNow);
    expect(titleResults.length).toBe(1);
    expect(titleResults[0].id).toBe('task-a');

    // Search by content keyword that does not appear in title or prompt
    const contentResults = filterTasks(tasksWithContent, 'bcrypt', 'all', undefined, undefined, simulatedNow);
    expect(contentResults.length).toBe(1);
    expect(contentResults[0].id).toBe('task-a');

    // Check snippet extractor
    const snippet = getContentSnippet(tasksWithContent[0].content, 'bcrypt');
    expect(snippet.toLowerCase()).toContain('bcrypt');

    // Search by another content keyword
    const glassmorphismResults = filterTasks(tasksWithContent, 'glassmorphism', 'all', undefined, undefined, simulatedNow);
    expect(glassmorphismResults.length).toBe(1);
    expect(glassmorphismResults[0].id).toBe('task-b');
  });
});
