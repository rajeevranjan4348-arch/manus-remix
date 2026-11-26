/**
 * Scheduled Agents Manager for Deku AI
 * 
 * Provides persistent background agent schedules, intervals,
 * timezones, next-run calculations, pause/resume, and execution logging.
 */

import { auth, db } from './firebase';
import { doc, setDoc } from 'firebase/firestore';
import { getFirebaseAuthorizationHeader } from './firebaseAuthorization';
import { observability } from './observability';

export type ScheduleFrequency = 'hourly' | 'daily' | 'weekly' | 'custom_minutes';

export interface ScheduledAgentTask {
  id: string;
  userId: string;
  title: string;
  prompt: string;
  frequency: ScheduleFrequency;
  intervalMinutes?: number;
  timezone: string;
  status: 'active' | 'paused' | 'executing' | 'error';
  lastRunAt?: string;
  nextRunAt: string;
  executionCount: number;
  lastResultSummary?: string;
  createdAt: string;
  serverScheduleId?: string;
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
      return list.filter((s) => s.userId === userId || s.userId === 'usr_manus_default');
    }
    return list;
  }

  public calculateNextRun(frequency: ScheduleFrequency, intervalMinutes = 60): string {
    const now = Date.now();
    let addMs = 60 * 60 * 1000;

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

  public async fetchServerSchedules(): Promise<{ ok: boolean; schedules?: any[]; error?: string }> {
    const authHeader = await getFirebaseAuthorizationHeader();
    if (!authHeader) return { ok: false, error: 'Authentication required.' };
    const res = await fetch('/api/scheduler/list', {
      headers: { Accept: 'application/json', Authorization: authHeader },
    });
    return res.json().catch(() => ({ ok: false, error: `HTTP ${res.status}` }));
  }

  public async createSchedule(params: {
    userId: string;
    title: string;
    prompt: string;
    frequency: ScheduleFrequency;
    intervalMinutes?: number;
    timezone?: string;
    cronExpression?: string;
  }): Promise<ScheduledAgentTask> {
    const tz = params.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
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
      timezone: tz,
      status: 'active',
      nextRunAt: nextRun,
      executionCount: 0,
      createdAt: now,
    };

    // Persist to Feature 05 durable server scheduler when authenticated
    if (typeof window !== 'undefined' && typeof fetch === 'function') {
      try {
        const authHeader = await getFirebaseAuthorizationHeader();
        if (authHeader) {
          const kind = params.cronExpression
            ? 'cron'
            : params.frequency === 'daily'
              ? 'daily'
              : params.frequency === 'weekly'
                ? 'weekly'
                : 'interval';
          const res = await fetch('/api/scheduler/create', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: authHeader },
            body: JSON.stringify({
              name: params.title,
              kind,
              timeZone: tz,
              intervalMinutes: params.frequency === 'hourly' ? 60 : params.intervalMinutes || 60,
              cronExpression: params.cronExpression,
              taskTitle: params.title,
              taskPrompt: params.prompt,
            }),
          });
          if (res.ok) {
            const payload = await res.json().catch(() => ({}));
            if (payload.schedule?.scheduleId) {
              schedule.serverScheduleId = payload.schedule.scheduleId;
              if (payload.schedule.nextRunAt) schedule.nextRunAt = payload.schedule.nextRunAt;
            }
          }
        }
      } catch {}
    }

    this.schedules.set(id, schedule);
    await this.persist();
    return schedule;
  }

  public async toggleSchedule(id: string, status: 'active' | 'paused'): Promise<boolean> {
    const sched = this.schedules.get(id);
    if (!sched) return false;
    sched.status = status;
    if (sched.serverScheduleId && typeof window !== 'undefined' && typeof fetch === 'function') {
      const authHeader = await getFirebaseAuthorizationHeader();
      if (authHeader) {
        await fetch(`/api/scheduler/${status === 'paused' ? 'pause' : 'resume'}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: authHeader },
          body: JSON.stringify({ scheduleId: sched.serverScheduleId }),
        }).catch(() => {});
      }
    }
    await this.persist();
    return true;
  }

  public async deleteSchedule(id: string): Promise<boolean> {
    const sched = this.schedules.get(id);
    const deleted = this.schedules.delete(id);
    if (sched?.serverScheduleId && typeof window !== 'undefined' && typeof fetch === 'function') {
      const authHeader = await getFirebaseAuthorizationHeader();
      if (authHeader) {
        await fetch('/api/scheduler/cancel', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: authHeader },
          body: JSON.stringify({ scheduleId: sched.serverScheduleId }),
        }).catch(() => {});
      }
    }
    if (deleted) {
      await this.persist();
    }
    return deleted;
  }

  public async executeScheduleNow(id: string): Promise<{ success: boolean; summary: string }> {
    const sched = this.schedules.get(id);
    if (!sched) return { success: false, summary: 'Schedule not found' };

    sched.status = 'executing';
    await this.persist();

    const traceId = observability.startTrace(`scheduled_run_${id}`);
    try {
      let dispatchedTaskId: string | undefined;
      if (sched.serverScheduleId && typeof window !== 'undefined' && typeof fetch === 'function') {
        const authHeader = await getFirebaseAuthorizationHeader();
        if (authHeader) {
          const res = await fetch('/api/scheduler/run-now', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: authHeader },
            body: JSON.stringify({ scheduleId: sched.serverScheduleId }),
          });
          if (res.ok) {
            const payload = await res.json().catch(() => ({}));
            dispatchedTaskId = payload.dispatched?.[0]?.taskId;
          }
        }
      }

      if (typeof window !== 'undefined') {
        window.dispatchEvent(
          new CustomEvent('manus_scheduled_task_triggered', {
            detail: { scheduleId: id, taskId: dispatchedTaskId, prompt: sched.prompt, title: sched.title },
          }),
        );
      }

      const now = new Date().toISOString();
      sched.lastRunAt = now;
      sched.nextRunAt = this.calculateNextRun(sched.frequency, sched.intervalMinutes);
      sched.executionCount += 1;
      sched.status = 'active';
      sched.lastResultSummary = dispatchedTaskId
        ? `Dispatched durable background task ${dispatchedTaskId} at ${new Date().toLocaleTimeString()}`
        : `Triggered scheduled run at ${new Date().toLocaleTimeString()}`;

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

    this.timer = setInterval(() => {
      const now = Date.now();
      for (const [id, sched] of this.schedules) {
        if (sched.status === 'active' && !sched.serverScheduleId && sched.nextRunAt) {
          const runTime = new Date(sched.nextRunAt).getTime();
          if (now >= runTime) {
            void this.executeScheduleNow(id);
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
          { merge: true },
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
