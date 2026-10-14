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
export async function checkMicrophonePermissionState(): Promise<PermissionState> {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return 'unsupported';
  if (!window.isSecureContext) return 'denied';

  if (navigator.permissions && navigator.permissions.query) {
    try {
      const mic = await navigator.permissions.query({ name: 'microphone' as any });
      return mic.state as PermissionState;
    } catch {}
  }

  // Fallback: check device labels via enumerateDevices
  if (navigator.mediaDevices?.enumerateDevices) {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const hasGrantedAudio = devices.some(d => d.kind === 'audioinput' && d.label !== '');
      if (hasGrantedAudio) return 'granted';
    } catch {}
  }

  return 'prompt';
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

  // Fallback: Check device labels via enumerateDevices if query wasn't granted
  if (navigator.mediaDevices?.enumerateDevices) {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const hasGrantedAudio = devices.some(d => d.kind === 'audioinput' && d.label !== '');
      if (hasGrantedAudio) {
        result.microphone = 'granted';
      }
      const hasGrantedVideo = devices.some(d => d.kind === 'videoinput' && d.label !== '');
      if (hasGrantedVideo) {
        result.camera = 'granted';
      }
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
  if (typeof window === 'undefined' || typeof navigator === 'undefined') {
    return false;
  }

  // Browsers only expose getUserMedia on secure origins (HTTPS or localhost).
  if (!window.isSecureContext) {
    console.warn('[Microphone Permission] A secure HTTPS context is required.');
    return false;
  }

  if (!navigator.mediaDevices?.getUserMedia) {
    console.warn('[Microphone Permission] getUserMedia is unavailable in this browser or embedded frame.');
    return false;
  }

  // Embedded previews can deny microphone access through Permissions Policy.
  try {
    const policy = (document as Document & {
      permissionsPolicy?: { allowsFeature: (feature: string) => boolean };
      featurePolicy?: { allowsFeature: (feature: string) => boolean };
    }).permissionsPolicy ?? (document as Document & {
      featurePolicy?: { allowsFeature: (feature: string) => boolean };
    }).featurePolicy;

    if (policy && !policy.allowsFeature('microphone')) {
      console.warn('[Microphone Permission] This embedded page is not allowed to use the microphone.');
      return false;
    }
  } catch {
    // Policy inspection is not supported by every browser; let getUserMedia decide.
  }

  let stream: MediaStream | null = null;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    return stream.getAudioTracks().some((track) => track.readyState === 'live');
  } catch (error) {
    const name = error instanceof DOMException ? error.name : '';
    if (name === 'NotAllowedError' || name === 'PermissionDeniedError' || name === 'SecurityError') {
      console.warn('[Microphone Permission] Access was denied. Check browser site permissions and any device-level microphone privacy setting.');
    } else if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
      console.warn('[Microphone Permission] No microphone device was found.');
    } else if (name === 'NotReadableError' || name === 'TrackStartError') {
      console.warn('[Microphone Permission] The microphone is busy or unavailable to the browser.');
    } else {
      console.warn('[Microphone Permission] Could not obtain microphone access:', error);
    }
    return false;
  } finally {
    // Never leave a permission-check stream holding the microphone open.
    stream?.getTracks().forEach((track) => track.stop());
  }
}

/**
 * Request camera access (prompts browser permission dialog and returns boolean)
 */
export async function requestCameraAccess(): Promise<boolean> {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') {
    return false;
  }

  if (!window.isSecureContext) {
    console.warn('[Camera Permission] A secure HTTPS context is required.');
    return false;
  }

  if (!navigator.mediaDevices?.getUserMedia) {
    console.warn('[Camera Permission] getUserMedia is unavailable in this browser or embedded frame.');
    return false;
  }

  let stream: MediaStream | null = null;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } },
    });
    return stream.getVideoTracks().some((track) => track.readyState === 'live');
  } catch (error) {
    const name = error instanceof DOMException ? error.name : '';
    if (name === 'NotAllowedError' || name === 'PermissionDeniedError' || name === 'SecurityError') {
      console.warn('[Camera Permission] Access was denied. Check browser site permissions and camera settings.');
    } else if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
      console.warn('[Camera Permission] No camera device was found.');
    } else {
      console.warn('[Camera Permission] Could not obtain camera access:', error);
    }
    return false;
  } finally {
    stream?.getTracks().forEach((track) => track.stop());
  }
}

/**
 * Request camera access (prompts browser permission dialog and returns MediaStream)
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
