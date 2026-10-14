/**
 * Android Companion & Capacitor Integration for Manus AI
 * 
 * Provides native Android permission requests, Intent dispatching
 * (App open, Share sheet, System settings), Scrcpy bridge integration,
 * and graceful browser fallback.
 */

import { observability } from './observability';
import { approvalManager } from './approvalManager';

export interface AndroidDeviceInfo {
  isNativeAndroid: boolean;
  platform: 'android' | 'web';
  osVersion?: string;
  hasCameraPermission: boolean;
  hasMicPermission: boolean;
  hasNotificationPermission: boolean;
  scrcpyBridgeConfigured: boolean;
}

class AndroidCompanionService {
  /**
   * Check if running in Capacitor Native Android environment
   */
  public isCapacitor(): boolean {
    if (typeof window === 'undefined') return false;
    return Boolean((window as any).Capacitor?.isNativePlatform());
  }

  /**
   * Inspect active device capabilities and permissions
   */
  public async getDeviceInfo(): Promise<AndroidDeviceInfo> {
    const isNative = this.isCapacitor();
    let hasMic = false;
    let hasCam = false;
    let hasNotif = false;

    if (typeof navigator !== 'undefined' && navigator.permissions?.query) {
      try {
        const mic = await navigator.permissions.query({ name: 'microphone' as any });
        hasMic = mic.state === 'granted';
      } catch {}

      try {
        const cam = await navigator.permissions.query({ name: 'camera' as any });
        hasCam = cam.state === 'granted';
      } catch {}
    }

    if (typeof window !== 'undefined' && 'Notification' in window) {
      hasNotif = Notification.permission === 'granted';
    }

    return {
      isNativeAndroid: isNative,
      platform: isNative ? 'android' : 'web',
      hasCameraPermission: hasCam,
      hasMicPermission: hasMic,
      hasNotificationPermission: hasNotif,
      scrcpyBridgeConfigured: Boolean(process.env.SCRCPY_BRIDGE_URL),
    };
  }

  /**
   * Dispatch Android Share Sheet Intent (via Capacitor Share or Web Share API)
   */
  public async shareContent(title: string, text: string, url?: string): Promise<boolean> {
    if (typeof navigator !== 'undefined' && navigator.share) {
      try {
        await navigator.share({ title, text, url });
        return true;
      } catch (err: any) {
        if (err.name !== 'AbortError') {
          console.warn('[AndroidCompanion] Share notice:', err);
        }
      }
    }
    return false;
  }

  /**
   * Launch external URL or Deep Link Intent
   */
  public openAppOrUrl(url: string): void {
    if (typeof window !== 'undefined') {
      window.open(url, '_blank', 'noopener,noreferrer');
    }
  }

  /**
   * Request remote Android action via Scrcpy bridge (requires explicit user authorization)
   */
  public async sendDeviceInput(
    action: { type: 'key' | 'tap' | 'text'; key?: string; x?: number; y?: number; text?: string },
    isApproved?: boolean
  ): Promise<{ success: boolean; message: string }> {
    if (!isApproved) {
      approvalManager.proposeAction({
        toolName: 'android_device_input',
        title: `Android Device Input: ${action.type.toUpperCase()}`,
        description: `Execute device interaction on connected Android companion.`,
        parameters: action,
        riskLevel: 'sensitive',
        consequences: [
          'Directly injects input events into the connected Android device.',
          'May navigate, click buttons, or input text into active Android applications.',
        ],
      });

      return {
        success: false,
        message: 'APPROVAL_REQUIRED: User permission required before sending input to Android companion.',
      };
    }

    try {
      const res = await fetch('/api/android/scrcpy/input', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(action),
      });

      if (res.ok) {
        return { success: true, message: 'Input accepted by device bridge' };
      }
      return { success: false, message: `Bridge returned HTTP ${res.status}` };
    } catch {
      return { success: false, message: 'Android bridge service is not reachable in this session.' };
    }
  }
}

export const androidCompanion = new AndroidCompanionService();
