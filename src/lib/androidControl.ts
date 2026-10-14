import { auth } from '@/lib/firebase';

export type AndroidControlAction =
  | 'status'
  | 'home'
  | 'flashlight_toggle'
  | 'volume_up'
  | 'volume_down'
  | 'open_settings'
  | 'launch_app'
  | 'search_in_app'
  | 'call_contact';

export interface AndroidControlIntent {
  action: AndroidControlAction;
  args?: Record<string, string>;
  label: string;
  requiresConfirmation?: boolean;
}

const APP_PACKAGES: Record<string, string> = {
  youtube: 'com.google.android.youtube',
  chrome: 'com.android.chrome',
  google: 'com.google.android.googlequicksearchbox',
  maps: 'com.google.android.apps.maps',
  whatsapp: 'com.whatsapp',
  spotify: 'com.spotify.music',
  instagram: 'com.instagram.android',
  facebook: 'com.facebook.katana',
  telegram: 'org.telegram.messenger',
  settings: 'com.android.settings',
  camera: 'com.android.camera2',
  phone: 'com.google.android.dialer',
};

const APP_ALIASES: Record<string, string> = {
  'google maps': 'maps',
  'youtube music': 'youtube',
  insta: 'instagram',
  wa: 'whatsapp',
  dialer: 'phone',
};

function resolveAppName(name: string): string {
  const key = name.trim().toLowerCase();
  return APP_ALIASES[key] || key;
}

export function parseAndroidControlIntent(prompt: string): AndroidControlIntent | null {
  const raw = prompt.trim();
  if (!raw || raw.length > 500) return null;
  const p = raw.toLowerCase().replace(/[.!?]+$/, '').trim();

  if (/^(?:check|show|get) (?:android )?(?:phone )?(?:control )?status$|^is (?:my )?phone connected$/.test(p)) {
    return { action: 'status', label: 'Check paired Android status' };
  }
  if (/^(?:go to )?home(?: screen)?$|^(?:press|tap) home$|^return to home screen$/.test(p)) {
    return { action: 'home', label: 'Go to home screen' };
  }
  if (/^(?:toggle|switch) (?:the )?(?:flashlight|torch)$/.test(p)) {
    return { action: 'flashlight_toggle', label: 'Toggle flashlight', requiresConfirmation: true };
  }
  if (/^(?:turn|volume) volume? ?up$|^(?:increase|raise) (?:the )?volume$|^volume up$/.test(p)) {
    return { action: 'volume_up', label: 'Increase volume', requiresConfirmation: true };
  }
  if (/^(?:turn|volume) volume? ?down$|^(?:decrease|lower) (?:the )?volume$|^volume down$/.test(p)) {
    return { action: 'volume_down', label: 'Decrease volume', requiresConfirmation: true };
  }
  if (/^(?:open|launch) (?:android )?settings$|^open phone settings$/.test(p)) {
    return { action: 'open_settings', label: 'Open Android settings', requiresConfirmation: true };
  }

  const callMatch = p.match(/^(?:call|phone|ring) ([a-z][a-z0-9 .'-]{0,79})$/i);
  if (callMatch) {
    const contact = callMatch[1].trim();
    if (/^(?:me|someone|anyone|emergency services)$/i.test(contact)) {
      return { action: 'call_contact', args: { contact }, label: 'Choose a contact to call', requiresConfirmation: true };
    }
    return { action: 'call_contact', args: { contact }, label: 'Call ' + contact, requiresConfirmation: true };
  }

  const searchPatterns = [
    /^(?:search|find|look up) (?:for )?(.{1,160}) (?:in|on) (youtube|youtube music|chrome|google|maps|google maps|whatsapp|spotify|instagram|facebook|telegram)$/,
    /^(?:search|find) (?:in|on) (youtube|youtube music|chrome|google|maps|google maps|whatsapp|spotify|instagram|facebook|telegram) (?:for )(.{1,160})$/,
  ];
  let searchMatch = p.match(searchPatterns[0]);
  let appName = '';
  let query = '';
  if (searchMatch) {
    query = searchMatch[1].trim();
    appName = resolveAppName(searchMatch[2]);
  } else {
    searchMatch = p.match(searchPatterns[1]);
    if (searchMatch) {
      appName = resolveAppName(searchMatch[1]);
      query = searchMatch[2].trim();
    }
  }
  if (searchMatch && APP_PACKAGES[appName] && query) {
    return {
      action: 'search_in_app',
      args: { packageName: APP_PACKAGES[appName], query },
      label: 'Search ' + appName + ' for "' + query + '"',
      requiresConfirmation: true,
    };
  }

  const openMatch = p.match(/^(?:open|launch|start) (youtube|youtube music|chrome|google|google maps|maps|whatsapp|spotify|instagram|facebook|telegram|settings|camera|phone|dialer)(?: app)?$/);
  if (openMatch) {
    const appName = resolveAppName(openMatch[1]);
    return {
      action: 'launch_app',
      args: { packageName: APP_PACKAGES[appName] },
      label: 'Open ' + appName,
      requiresConfirmation: true,
    };
  }
  return null;
}

export async function executeAndroidControlIntent(
  intent: AndroidControlIntent,
  options: { confirmed?: boolean } = {},
): Promise<{ success: boolean; message: string; data?: unknown }> {
  if (intent.requiresConfirmation && options.confirmed !== true) {
    return { success: false, message: 'Confirmation required: ' + intent.label + '. Ask the user to confirm before executing.' };
  }

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
      body: JSON.stringify({
        action: intent.action,
        args: intent.args || {},
        confirmed: options.confirmed === true,
      }),
      cache: 'no-store',
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const message = typeof data?.error === 'string' ? data.error : 'Android control failed (HTTP ' + response.status + ').';
      return { success: false, message };
    }
    return { success: data?.ok !== false, message: typeof data?.message === 'string' ? data.message : intent.label + ' request sent.', data };
  } catch {
    return { success: false, message: 'Could not reach the Android control service. Check the paired bridge and network connection.' };
  }
}
