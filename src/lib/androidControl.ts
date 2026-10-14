import { auth } from '@/lib/firebase';

export type AndroidControlAction =
  | 'status'
  | 'home'
  | 'flashlight_toggle'
  | 'volume_up'
  | 'volume_down'
  | 'open_settings'
  | 'launch_app';

export interface AndroidControlIntent {
  action: AndroidControlAction;
  args?: Record<string, string>;
  label: string;
}

const APP_PACKAGES: Record<string, string> = {
  youtube: 'com.google.android.youtube',
  chrome: 'com.android.chrome',
  maps: 'com.google.android.apps.maps',
  whatsapp: 'com.whatsapp',
  spotify: 'com.spotify.music',
  settings: 'com.android.settings',
  camera: 'com.android.camera2',
};

export function parseAndroidControlIntent(prompt: string): AndroidControlIntent | null {
  const p = prompt.trim().toLowerCase().replace(/[.!?]+$/, '');
  if (!p || p.length > 500) return null;

  if (/^(?:check|show|get) (?:android )?(?:phone )?(?:control )?status$|^is (?:my )?phone connected$/.test(p)) {
    return { action: 'status', label: 'Check paired Android status' };
  }
  if (/^(?:go to )?home(?: screen)?$|^(?:press|tap) home$|^return to home screen$/.test(p)) {
    return { action: 'home', label: 'Go to home screen' };
  }
  if (/^(?:toggle|switch) (?:the )?(?:flashlight|torch)$|^(?:toggle|switch) flashlight$/.test(p)) {
    return { action: 'flashlight_toggle', label: 'Toggle flashlight' };
  }
  if (/^(?:turn|volume) volume? ?up$|^(?:increase|raise) (?:the )?volume$|^volume up$/.test(p)) {
    return { action: 'volume_up', label: 'Increase volume' };
  }
  if (/^(?:turn|volume) volume? ?down$|^(?:decrease|lower) (?:the )?volume$|^volume down$/.test(p)) {
    return { action: 'volume_down', label: 'Decrease volume' };
  }
  if (/^(?:open|launch) (?:android )?settings$|^open phone settings$/.test(p)) {
    return { action: 'open_settings', label: 'Open Android settings' };
  }

  const openMatch = p.match(/^(?:open|launch|start) (youtube|chrome|google maps|maps|whatsapp|spotify|settings|camera)(?: app)?$/);
  if (openMatch) {
    const appName = openMatch[1] === 'google maps' ? 'maps' : openMatch[1];
    return { action: 'launch_app', args: { packageName: APP_PACKAGES[appName] }, label: 'Open ' + appName };
  }
  return null;
}

export async function executeAndroidControlIntent(intent: AndroidControlIntent): Promise<{ success: boolean; message: string; data?: unknown }> {
  const currentUser = auth.currentUser;
  if (!currentUser) {
    return { success: false, message: 'Sign in to Manus with the paired Firebase account before using Android control.' };
  }

  try {
    const token = await currentUser.getIdToken();
    const response = await fetch('/api/android-control', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + token,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({ action: intent.action, args: intent.args || {} }),
      cache: 'no-store',
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const message = typeof data?.error === 'string' ? data.error : 'Android control failed (HTTP ' + response.status + ').';
      return { success: false, message };
    }
    return { success: true, message: typeof data?.message === 'string' ? data.message : intent.label + ' completed.', data };
  } catch {
    return { success: false, message: 'Could not reach the Android control service. Check the paired bridge and network connection.' };
  }
}
