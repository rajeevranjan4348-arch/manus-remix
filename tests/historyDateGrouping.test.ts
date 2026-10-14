import { describe, it, expect } from 'vitest';
import { groupTasksByDate, TaskHistoryItem } from '../src/components/history/HistoryPanel';

describe('HistoryPanel date grouping', () => {
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();

  it('groups tasks created today into "Today"', () => {
    const tasks: TaskHistoryItem[] = [
      {
        id: 'task-today-1',
        prompt: 'Build landing page',
        title: 'Landing Page',
        created_at: new Date(todayStart + 1000 * 60).toISOString(),
      },
      {
        id: 'task-today-2',
        prompt: 'Fix styling bug',
        title: 'Bug Fix',
        created_at: new Date(todayStart + 1000 * 3600).toISOString(),
      }
    ];

    const groups = groupTasksByDate(tasks);
    expect(groups).toHaveLength(1);
    expect(groups[0].label).toBe('Today');
    expect(groups[0].tasks).toHaveLength(2);
    expect(groups[0].tasks.map(t => t.id)).toEqual(['task-today-1', 'task-today-2']);
  });

  it('groups tasks from yesterday and past 7 days into "This Week"', () => {
    const yesterdayTime = todayStart - 1000 * 3600 * 12; // 12 hours before today 00:00
    const threeDaysAgoTime = todayStart - 1000 * 3600 * 24 * 3;
    const sixDaysAgoTime = todayStart - 1000 * 3600 * 24 * 6;

    const tasks: TaskHistoryItem[] = [
      {
        id: 'task-yesterday',
        prompt: 'Analyze marketing report',
        title: 'Marketing Report',
        created_at: new Date(yesterdayTime).toISOString(),
      },
      {
        id: 'task-3days',
        prompt: 'Generate charts',
        title: 'Data Charts',
        created_at: new Date(threeDaysAgoTime).toISOString(),
      },
      {
        id: 'task-6days',
        prompt: 'Export PDF summary',
        title: 'PDF Export',
        created_at: new Date(sixDaysAgoTime).toISOString(),
      }
    ];

    const groups = groupTasksByDate(tasks);
    expect(groups).toHaveLength(1);
    expect(groups[0].label).toBe('This Week');
    expect(groups[0].tasks).toHaveLength(3);
    expect(groups[0].tasks.map(t => t.id)).toEqual(['task-yesterday', 'task-3days', 'task-6days']);
  });

  it('groups tasks older than 7 days into "Older"', () => {
    const eightDaysAgoTime = todayStart - 1000 * 3600 * 24 * 8;
    const thirtyDaysAgoTime = todayStart - 1000 * 3600 * 24 * 30;

    const tasks: TaskHistoryItem[] = [
      {
        id: 'task-8days',
        prompt: 'Setup database schema',
        title: 'Database Setup',
        created_at: new Date(eightDaysAgoTime).toISOString(),
      },
      {
        id: 'task-30days',
        prompt: 'Initial architecture discussion',
        title: 'Architecture Discussion',
        created_at: new Date(thirtyDaysAgoTime).toISOString(),
      }
    ];

    const groups = groupTasksByDate(tasks);
    expect(groups).toHaveLength(1);
    expect(groups[0].label).toBe('Older');
    expect(groups[0].tasks).toHaveLength(2);
    expect(groups[0].tasks.map(t => t.id)).toEqual(['task-8days', 'task-30days']);
  });

  it('correctly categorizes tasks across multiple date periods ("Today", "This Week", "Older")', () => {
    const tasks: TaskHistoryItem[] = [
      {
        id: 't1-today',
        prompt: 'Today task',
        created_at: new Date(todayStart + 3600000).toISOString(),
      },
      {
        id: 't2-week',
        prompt: 'This week task',
        created_at: new Date(todayStart - 86400000 * 2).toISOString(),
      },
      {
        id: 't3-older',
        prompt: 'Older task',
        created_at: new Date(todayStart - 86400000 * 14).toISOString(),
      }
    ];

    const groups = groupTasksByDate(tasks);
    expect(groups).toHaveLength(3);
    expect(groups.map(g => g.label)).toEqual(['Today', 'This Week', 'Older']);
    expect(groups.find(g => g.label === 'Today')?.tasks[0].id).toBe('t1-today');
    expect(groups.find(g => g.label === 'This Week')?.tasks[0].id).toBe('t2-week');
    expect(groups.find(g => g.label === 'Older')?.tasks[0].id).toBe('t3-older');
  });

  it('omits groups that have no tasks', () => {
    const tasks: TaskHistoryItem[] = [
      {
        id: 't1-today',
        prompt: 'Today task only',
        created_at: new Date(todayStart + 1000).toISOString(),
      }
    ];

    const groups = groupTasksByDate(tasks);
    expect(groups).toHaveLength(1);
    expect(groups[0].label).toBe('Today');
    expect(groups.some(g => g.label === 'This Week')).toBe(false);
    expect(groups.some(g => g.label === 'Older')).toBe(false);
  });

  it('returns empty array when no tasks are provided', () => {
    expect(groupTasksByDate([])).toEqual([]);
  });
});
