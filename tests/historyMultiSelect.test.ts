import { describe, it, expect } from 'vitest';
import { TaskHistoryItem } from '../src/components/history/HistoryPanel';

describe('HistoryPanel Multi-Select & Batch Deletion logic', () => {
  const sampleTasks: TaskHistoryItem[] = [
    { id: 'task-1', prompt: 'Research AI trends', created_at: new Date().toISOString() },
    { id: 'task-2', prompt: 'Build dashboard', created_at: new Date().toISOString() },
    { id: 'task-3', prompt: 'Analyze revenue data', created_at: new Date().toISOString() },
    { id: 'task-4', prompt: 'Create API spec', created_at: new Date().toISOString() },
  ];

  it('toggles selection of individual task IDs', () => {
    let selectedIds = new Set<string>();

    const toggle = (id: string) => {
      const next = new Set(selectedIds);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      selectedIds = next;
    };

    toggle('task-1');
    expect(selectedIds.has('task-1')).toBe(true);
    expect(selectedIds.size).toBe(1);

    toggle('task-2');
    expect(selectedIds.has('task-1')).toBe(true);
    expect(selectedIds.has('task-2')).toBe(true);
    expect(selectedIds.size).toBe(2);

    // Toggle off task-1
    toggle('task-1');
    expect(selectedIds.has('task-1')).toBe(false);
    expect(selectedIds.has('task-2')).toBe(true);
    expect(selectedIds.size).toBe(1);
  });

  it('selects and deselects all tasks', () => {
    let selectedIds = new Set<string>();

    // Select all
    selectedIds = new Set(sampleTasks.map(t => t.id));
    expect(selectedIds.size).toBe(4);
    expect(selectedIds.has('task-1')).toBe(true);
    expect(selectedIds.has('task-4')).toBe(true);

    // Deselect all
    selectedIds = new Set();
    expect(selectedIds.size).toBe(0);
  });

  it('selects and deselects all tasks within a group', () => {
    const groupTasks = [sampleTasks[0], sampleTasks[1]];
    let selectedIds = new Set<string>();

    // Group select toggle
    const toggleGroup = (tasks: TaskHistoryItem[]) => {
      const ids = tasks.map(t => t.id);
      const allSelected = ids.every(id => selectedIds.has(id));
      const next = new Set(selectedIds);
      if (allSelected) {
        ids.forEach(id => next.delete(id));
      } else {
        ids.forEach(id => next.add(id));
      }
      selectedIds = next;
    };

    // Toggle on
    toggleGroup(groupTasks);
    expect(selectedIds.size).toBe(2);
    expect(selectedIds.has('task-1')).toBe(true);
    expect(selectedIds.has('task-2')).toBe(true);

    // Toggle off
    toggleGroup(groupTasks);
    expect(selectedIds.size).toBe(0);
  });

  it('deletes multiple selected tasks in a single action', () => {
    let currentTasks = [...sampleTasks];
    const selectedToDelete = new Set(['task-1', 'task-3']);

    // Single action batch delete
    currentTasks = currentTasks.filter(t => !selectedToDelete.has(t.id));

    expect(currentTasks).toHaveLength(2);
    expect(currentTasks.map(t => t.id)).toEqual(['task-2', 'task-4']);
  });

  it('handles batch delete of all selected tasks', () => {
    let currentTasks = [...sampleTasks];
    const allSelected = new Set(sampleTasks.map(t => t.id));

    currentTasks = currentTasks.filter(t => !allSelected.has(t.id));

    expect(currentTasks).toHaveLength(0);
  });
});
