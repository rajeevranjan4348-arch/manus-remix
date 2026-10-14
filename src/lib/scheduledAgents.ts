/**
 * Scheduled Agents Manager for Manus AI
 * 
 * Provides persistent background agent schedules, intervals,
 * timezones, next-run calculations, pause/resume, and execution logging.
 */

import { auth, db } from './firebase';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { observability } from './observability';

export type ScheduleFrequency = 'hourly' | 'daily' | 'weekly' | 'custom_minutes';

export interface ScheduledAgentTask {
  id: string;
  userId: string;
  title: string;
  prompt: string;
  frequency: ScheduleFrequency;
  intervalMinutes?: number; // for custom_minutes
  timezone: string;
  status: 'active' | 'paused' | 'executing' | 'error';
  lastRunAt?: string;
  nextRunAt: string;
  executionCount: number;
  lastResultSummary?: string;
  createdAt: string;
}

const STORAGE_KEY = 'manus_scheduled_agents_v1';

class ScheduledAgentsService {
  private schedules = new Map<string, ScheduledAgentTask>();
  private timer: any = null;

  constructor() {
    this.loadFromStorage();
    this.startSchedulerLoop();
  }

  public getSchedules(userId?: string): ScheduledAgentTask[] {
    const list = Array.from(this.schedules.values());
    if (userId) {
      return list.filter(s => s.userId === userId || s.userId === 'usr_manus_default');
    }
    return list;
  }

  public calculateNextRun(frequency: ScheduleFrequency, intervalMinutes = 60): string {
    const now = Date.now();
    let addMs = 60 * 60 * 1000; // default 1 hour

    switch (frequency) {
      case 'hourly':
        addMs = 60 * 60 * 1000;
        break;
      case 'daily':
        addMs = 24 * 60 * 60 * 1000;
        break;
      case 'weekly':
        addMs = 7 * 24 * 60 * 60 * 1000;
        break;
      case 'custom_minutes':
        addMs = Math.max(5, intervalMinutes) * 60 * 1000;
        break;
    }

    return new Date(now + addMs).toISOString();
  }

  public async createSchedule(params: {
    userId: string;
    title: string;
    prompt: string;
    frequency: ScheduleFrequency;
    intervalMinutes?: number;
    timezone?: string;
  }): Promise<ScheduledAgentTask> {
    const id = `sched_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const now = new Date().toISOString();
    const nextRun = this.calculateNextRun(params.frequency, params.intervalMinutes);

    const schedule: ScheduledAgentTask = {
      id,
      userId: params.userId,
      title: params.title,
      prompt: params.prompt,
      frequency: params.frequency,
      intervalMinutes: params.intervalMinutes || 60,
      timezone: params.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
      status: 'active',
      nextRunAt: nextRun,
      executionCount: 0,
      createdAt: now,
    };

    this.schedules.set(id, schedule);
    await this.persist();
    return schedule;
  }

  public async toggleSchedule(id: string, status: 'active' | 'paused'): Promise<boolean> {
    const sched = this.schedules.get(id);
    if (!sched) return false;
    sched.status = status;
    await this.persist();
    return true;
  }

  public async deleteSchedule(id: string): Promise<boolean> {
    const deleted = this.schedules.delete(id);
    if (deleted) {
      await this.persist();
    }
    return deleted;
  }

  public async executeScheduleNow(id: string): Promise<{ success: boolean; summary: string }> {
    const sched = this.schedules.get(id);
    if (!sched) return { success: false, summary: 'Schedule not found' };

    sched.status = 'executing';
    this.persist();

    const traceId = observability.startTrace(`scheduled_run_${id}`);
    try {
      // Simulate task kick-off or trigger task event
      window.dispatchEvent(
        new CustomEvent('manus_scheduled_task_triggered', {
          detail: { scheduleId: id, prompt: sched.prompt, title: sched.title },
        })
      );

      const now = new Date().toISOString();
      sched.lastRunAt = now;
      sched.nextRunAt = this.calculateNextRun(sched.frequency, sched.intervalMinutes);
      sched.executionCount += 1;
      sched.status = 'active';
      sched.lastResultSummary = `Successfully triggered automated agent execution at ${new Date().toLocaleTimeString()}`;

      observability.endTrace(traceId);
      await this.persist();
      return { success: true, summary: sched.lastResultSummary };
    } catch (e: any) {
      sched.status = 'error';
      sched.lastResultSummary = `Execution error: ${e.message}`;
      observability.endTrace(traceId, { error: e.message });
      await this.persist();
      return { success: false, summary: sched.lastResultSummary };
    }
  }

  private startSchedulerLoop() {
    if (typeof window === 'undefined') return;
    if (this.timer) clearInterval(this.timer);

    // Check every 30 seconds
    this.timer = setInterval(() => {
      const now = Date.now();
      for (const [id, sched] of this.schedules) {
        if (sched.status === 'active' && sched.nextRunAt) {
          const runTime = new Date(sched.nextRunAt).getTime();
          if (now >= runTime) {
            this.executeScheduleNow(id);
          }
        }
      }
    }, 30000);
  }

  private async persist() {
    if (typeof window === 'undefined') return;
    const array = Array.from(this.schedules.values());
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(array));
      window.dispatchEvent(new CustomEvent('manus_schedules_updated'));
    } catch {}

    const currentUser = auth.currentUser;
    if (currentUser) {
      try {
        await setDoc(
          doc(db, 'users', currentUser.uid, 'settings', 'schedules'),
          { schedules: array, updatedAt: new Date().toISOString() },
          { merge: true }
        );
      } catch {}
    }
  }

  private loadFromStorage() {
    if (typeof window === 'undefined') return;
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          for (const s of parsed) {
            this.schedules.set(s.id, s);
          }
        }
      }
    } catch {}
  }
}

export const scheduledAgents = new ScheduledAgentsService();
