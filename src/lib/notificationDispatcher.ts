/**
 * Notifications and Task Updates Dispatcher for Deku AI
 * 
 * Handles browser and Android push/local notifications, task completion alerts,
 * approval triggers, sound effects, quiet hours, and duplicate throttling.
 */

import { playNotificationSound } from './settingsStore';
import { observability } from './observability';
import { getFirebaseAuthorizationHeader } from './firebaseAuthorization';
import {
  liveSyncClient,
  type LiveSyncClientEvent,
  type LiveSyncEventListener,
  type LiveSyncSnapshot,
} from './liveSyncClient';

export type NotificationChannel = 'task_completed' | 'task_failed' | 'approval_needed' | 'schedule_triggered';

export interface NotificationPayload {
  title: string;
  body: string;
  channel: NotificationChannel;
  taskId?: string;
  sound?: boolean;
}

class NotificationDispatcherService {
  private lastDispatched = new Map<string, number>();
  private liveSyncUnsub: (() => void) | null = null;

  public startLiveSync(userId: string): void {
    if (!userId || typeof window === 'undefined') return;
    if (!this.liveSyncUnsub) {
      this.liveSyncUnsub = liveSyncClient.subscribe((event) => {
        if (!event.notifyUser) return;
        const channel: NotificationChannel =
          event.type === 'task:failed' || event.type === 'multi_agent:failed'
            ? 'task_failed'
            : event.type === 'approval:required'
              ? 'approval_needed'
              : event.type === 'schedule:executed'
                ? 'schedule_triggered'
                : 'task_completed';

        void this.dispatch({
          title: event.title,
          body: event.message,
          channel,
          taskId: event.taskId || event.resourceId,
        });
      });
    }
    liveSyncClient.start(userId);
  }

  public stopLiveSync(): void {
    liveSyncClient.stop();
    if (this.liveSyncUnsub) {
      this.liveSyncUnsub();
      this.liveSyncUnsub = null;
    }
  }

  public onSyncEvent(listener: LiveSyncEventListener): () => void {
    return liveSyncClient.subscribe(listener);
  }

  public async fetchSyncSnapshot(): Promise<LiveSyncSnapshot | null> {
    return liveSyncClient.fetchSnapshot();
  }

  public async acknowledgeNotification(notificationId: string): Promise<boolean> {
    return liveSyncClient.acknowledgeNotification(notificationId);
  }

  public async fetchDurableNotifications(unreadOnly = false): Promise<any[]> {
    const authHeader = await getFirebaseAuthorizationHeader();
    if (!authHeader) return [];
    const qs = unreadOnly ? '?unreadOnly=true' : '';
    const res = await fetch(`/api/tasks/notifications${qs}`, {
      headers: { Accept: 'application/json', Authorization: authHeader },
    });
    if (!res.ok) return [];
    const data = await res.json().catch(() => ({}));
    return Array.isArray(data.notifications) ? data.notifications : [];
  }

  public async markDurableNotificationRead(notificationId: string): Promise<boolean> {
    const authHeader = await getFirebaseAuthorizationHeader();
    if (!authHeader) return false;
    const res = await fetch('/api/tasks/notifications/read', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: authHeader },
      body: JSON.stringify({ notificationId }),
    });
    return res.ok;
  }

  /**
   * Check if current time falls into quiet hours
   */
  public isQuietHours(startHour = 22, endHour = 7): boolean {
    const currentHour = new Date().getHours();
    if (startHour > endHour) {
      return currentHour >= startHour || currentHour < endHour;
    }
    return currentHour >= startHour && currentHour < endHour;
  }

  /**
   * Dispatch notification to user through authorized channels
   */
  public async dispatch(payload: NotificationPayload): Promise<boolean> {
    const dedupeKey = `${payload.channel}_${payload.title}_${payload.body.slice(0, 30)}`;
    const now = Date.now();
    const lastTime = this.lastDispatched.get(dedupeKey) || 0;

    if (now - lastTime < 5000) {
      return false;
    }
    this.lastDispatched.set(dedupeKey, now);

    if (payload.sound !== false && !this.isQuietHours()) {
      try {
        playNotificationSound();
      } catch {}
    }

    if (typeof window !== 'undefined' && 'Notification' in window) {
      if (Notification.permission === 'granted') {
        try {
          new Notification(payload.title, {
            body: payload.body,
            icon: '/favicon.ico',
            tag: payload.taskId || payload.channel,
          });

          observability.log({
            level: 'info',
            category: 'notifications',
            message: `Dispatched notification: "${payload.title}"`,
          });

          return true;
        } catch (e) {
          console.warn('[NotificationDispatcher] Dispatch notice:', e);
        }
      }
    }

    return false;
  }
}

export type { LiveSyncClientEvent, LiveSyncSnapshot };
export const notificationDispatcher = new NotificationDispatcherService();
