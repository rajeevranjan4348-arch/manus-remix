/**
 * Notifications and Task Updates Dispatcher for Manus AI
 * 
 * Handles browser and Android push/local notifications, task completion alerts,
 * approval triggers, sound effects, quiet hours, and duplicate throttling.
 */

import { playNotificationSound } from './settingsStore';
import { observability } from './observability';

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

    // Throttle duplicates within 5 seconds
    if (now - lastTime < 5000) {
      return false;
    }
    this.lastDispatched.set(dedupeKey, now);

    // Play chime sound if enabled and not during quiet hours
    if (payload.sound !== false && !this.isQuietHours()) {
      try {
        playNotificationSound();
      } catch {}
    }

    // Native / Web Notification API
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

export const notificationDispatcher = new NotificationDispatcherService();
