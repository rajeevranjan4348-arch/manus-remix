/**
 * Permissions & Background Behavior Manager for Manus
 * Handles browser permissions (Microphone, Camera, Geolocation, Notifications),
 * background task execution, and system-level alerts.
 */

export type PermissionType = 'microphone' | 'camera' | 'geolocation' | 'notifications';
export type PermissionState = 'granted' | 'denied' | 'prompt' | 'unsupported';

export interface PermissionsStatus {
  microphone: PermissionState;
  camera: PermissionState;
  geolocation: PermissionState;
  notifications: PermissionState;
}

/**
 * Query current permission status across supported browser APIs
 */
export async function getPermissionsStatus(): Promise<PermissionsStatus> {
  const result: PermissionsStatus = {
    microphone: 'prompt',
    camera: 'prompt',
    geolocation: 'prompt',
    notifications: 'prompt',
  };

  if (typeof window === 'undefined') return result;

  // 1. Notifications
  if ('Notification' in window) {
    result.notifications = Notification.permission as PermissionState;
  } else {
    result.notifications = 'unsupported';
  }

  // 2. Query navigator.permissions if available
  if (navigator.permissions && navigator.permissions.query) {
    try {
      const geo = await navigator.permissions.query({ name: 'geolocation' as any });
      result.geolocation = geo.state as PermissionState;
    } catch {}

    try {
      const mic = await navigator.permissions.query({ name: 'microphone' as any });
      result.microphone = mic.state as PermissionState;
    } catch {}

    try {
      const cam = await navigator.permissions.query({ name: 'camera' as any });
      result.camera = cam.state as PermissionState;
    } catch {}
  }

  return result;
}

/**
 * Request notification permission from user
 */
export async function requestNotificationPermission(): Promise<boolean> {
  if (typeof window === 'undefined' || !('Notification' in window)) {
    return false;
  }
  try {
    const permission = await Notification.requestPermission();
    return permission === 'granted';
  } catch {
    return false;
  }
}

/**
 * Send a background notification (e.g. when research task finishes in background tab)
 */
export function sendBackgroundNotification(title: string, body: string, icon?: string): boolean {
  if (typeof window === 'undefined' || !('Notification' in window)) return false;

  if (Notification.permission === 'granted') {
    try {
      const notif = new Notification(title, {
        body,
        icon: icon || '/favicon.ico',
        badge: '/favicon.ico',
      });

      notif.onclick = () => {
        window.focus();
        notif.close();
      };
      return true;
    } catch (err) {
      console.warn('[Notification Error]', err);
    }
  }
  return false;
}

/**
 * Request microphone access (prompts browser permission dialog)
 */
export async function requestMicrophonePermission(): Promise<boolean> {
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
    return false;
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    // Stop tracks immediately after granting
    stream.getTracks().forEach(t => t.stop());
    return true;
  } catch {
    return false;
  }
}

/**
 * Request camera access (prompts browser permission dialog)
 */
export async function requestCameraPermission(): Promise<MediaStream | null> {
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
    return null;
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } }
    });
    return stream;
  } catch {
    return null;
  }
}

/**
 * Request geolocation (for real-time weather and localized search)
 */
export function requestGeolocation(): Promise<{ latitude: number; longitude: number } | null> {
  if (typeof navigator === 'undefined' || !navigator.geolocation) {
    return Promise.resolve(null);
  }

  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        resolve({
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
        });
      },
      (err) => {
        console.warn('[Geolocation Error]', err.message);
        resolve(null);
      },
      { timeout: 8000 }
    );
  });
}
