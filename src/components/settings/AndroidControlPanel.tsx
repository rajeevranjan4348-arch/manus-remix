import React, { useCallback, useEffect, useState } from 'react';
import { getAuth } from 'firebase/auth';
import { Activity, CheckCircle2, CircleAlert, Flashlight, Home, RefreshCw, Settings2, Smartphone, Volume1, Volume2 } from 'lucide-react';
import { toast } from 'sonner';

type BridgeStatus = 'checking' | 'connected' | 'disconnected' | 'not-configured';

type ControlAction = 'home' | 'flashlight_toggle' | 'volume_up' | 'volume_down' | 'open_settings' | 'launch_app';

const ACTIONS: Array<{ id: ControlAction; label: string; description: string; icon: React.ElementType }> = [
  { id: 'home', label: 'Home screen', description: 'Return to the Android launcher', icon: Home },
  { id: 'flashlight_toggle', label: 'Flashlight', description: 'Toggle the device torch', icon: Flashlight },
  { id: 'volume_up', label: 'Volume up', description: 'Increase media volume', icon: Volume2 },
  { id: 'volume_down', label: 'Volume down', description: 'Decrease media volume', icon: Volume1 },
  { id: 'open_settings', label: 'Open Settings', description: 'Open Android system settings', icon: Settings2 },
  { id: 'launch_app', label: 'Launch app', description: 'Open an installed app by package ID', icon: Smartphone },
];

export function AndroidControlPanel() {
  const [status, setStatus] = useState<BridgeStatus>('checking');
  const [deviceName, setDeviceName] = useState('');
  const [appPackage, setAppPackage] = useState('');
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState('');

  const request = useCallback(async (action: string, args: Record<string, unknown> = {}) => {
    const user = getAuth().currentUser;
    if (!user) throw new Error('Sign in before connecting an Android device.');
    const idToken = await user.getIdToken();
    const response = await fetch('/api/android-control', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
      body: JSON.stringify({ action, args }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      if (payload.code === 'BRIDGE_NOT_CONFIGURED') setStatus('not-configured');
      throw new Error(payload.message || payload.error || 'Android control request failed.');
    }
    return payload;
  }, []);

  const refreshStatus = useCallback(async () => {
    setStatus('checking');
    try {
      const result = await request('status');
      setStatus(result.connected ? 'connected' : 'disconnected');
      setDeviceName(typeof result.deviceName === 'string' ? result.deviceName : '');
      setLastResult(result.connected ? 'Android bridge connected and responding.' : 'Bridge is configured but the phone is offline.');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to check bridge status.';
      setStatus(message.toLowerCase().includes('not configured') ? 'not-configured' : 'disconnected');
      setLastResult(message);
    }
  }, [request]);

  useEffect(() => { void refreshStatus(); }, [refreshStatus]);

  const runAction = async (action: ControlAction) => {
    const label = ACTIONS.find(item => item.id === action)?.label || action;
    const args: Record<string, unknown> = {};
    if (action === 'launch_app') {
      const packageName = appPackage.trim();
      if (!/^[a-zA-Z][a-zA-Z0-9_]*(\.[a-zA-Z][a-zA-Z0-9_]*)+$/.test(packageName)) {
        toast.error('Enter a valid Android package ID, for example com.google.android.youtube.');
        return;
      }
      args.packageName = packageName;
    }
    const confirmation = action === 'launch_app' ? `Allow Manus to launch ${appPackage.trim()} on your paired phone?` : `Run “${label}” on your paired Android phone?`;
    if (!window.confirm(confirmation)) return;
    setBusyAction(action);
    try {
      const result = await request(action, args);
      setLastResult(typeof result.message === 'string' ? result.message : `${label} completed.`);
      toast.success(`${label} request sent`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Action failed.';
      setLastResult(message);
      toast.error(message);
    } finally {
      setBusyAction(null);
    }
  };

  const statusLabel = status === 'connected' ? 'Connected' : status === 'checking' ? 'Checking' : status === 'not-configured' ? 'Setup required' : 'Offline';
  const StatusIcon = status === 'connected' ? CheckCircle2 : status === 'checking' ? Activity : CircleAlert;

  return (
    <div className="space-y-5 animate-in fade-in duration-100">
      <div>
        <div className="flex items-center gap-2">
          <Smartphone size={17} />
          <h3 className="text-sm font-semibold text-foreground">Android Phone Control</h3>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">Control a paired Android device through an authenticated on-device bridge. Every action asks for confirmation.</p>
      </div>

      <div className="rounded-xl border border-border/70 p-4 space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <StatusIcon size={17} className={status === 'connected' ? 'text-emerald-500' : status === 'checking' ? 'text-muted-foreground' : 'text-amber-500'} />
            <div>
              <p className="text-xs font-medium text-foreground">Bridge status: {statusLabel}</p>
              {deviceName && <p className="text-[11px] text-muted-foreground">{deviceName}</p>}
            </div>
          </div>
          <button type="button" onClick={() => void refreshStatus()} disabled={status === 'checking'} className="inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs hover:bg-muted disabled:opacity-50">
            <RefreshCw size={12} className={status === 'checking' ? 'animate-spin' : ''} /> Check
          </button>
        </div>
        {status !== 'connected' && (
          <div className="rounded-lg bg-muted/50 p-3 text-[11px] leading-relaxed text-muted-foreground">
            {status === 'not-configured'
              ? 'The secure bridge is not configured on the server yet. Set FIREBASE_SERVICE_ACCOUNT_JSON, ANDROID_CONTROL_ALLOWED_UID, ANDROID_CONTROL_BRIDGE_URL, and ANDROID_CONTROL_BRIDGE_TOKEN in Netlify, then deploy and pair a compatible companion bridge on your Android device.'
              : status === 'checking'
                ? 'Checking the configured bridge…'
                : 'The bridge is not responding. Keep the companion service running, online, and paired.'}
          </div>
        )}
      </div>

      <div className="space-y-2">
        <h4 className="text-xs font-semibold text-foreground">Available actions</h4>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {ACTIONS.map(({ id, label, description, icon: Icon }) => (
            <button key={id} type="button" disabled={status !== 'connected' || busyAction !== null} onClick={() => void runAction(id)} className="flex items-start gap-3 rounded-xl border border-border/70 p-3 text-left transition-colors hover:bg-muted/50 disabled:cursor-not-allowed disabled:opacity-45">
              <Icon size={16} className="mt-0.5 shrink-0 text-muted-foreground" />
              <span className="min-w-0">
                <span className="block text-xs font-medium text-foreground">{busyAction === id ? 'Sending…' : label}</span>
                <span className="mt-0.5 block text-[10px] leading-relaxed text-muted-foreground">{description}</span>
              </span>
            </button>
          ))}
        </div>
        <label className="block space-y-1.5">
          <span className="text-xs font-medium text-foreground">Android app package ID</span>
          <input value={appPackage} onChange={event => setAppPackage(event.target.value)} placeholder="com.google.android.youtube" className="w-full rounded-lg border border-border bg-background px-3 py-2 text-xs outline-none focus:ring-2 focus:ring-ring" autoCapitalize="none" autoCorrect="off" />
        </label>
      </div>

      {lastResult && <p role="status" className="rounded-lg border border-border/60 p-3 text-[11px] leading-relaxed text-muted-foreground">{lastResult}</p>}

      <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-3 text-[11px] leading-relaxed text-muted-foreground">
        Android limits some actions by OS version and vendor. Screen reading, touch automation, notifications, calls, SMS, and sensitive data access must be separately permissioned and are not enabled by this basic control panel.
      </div>
    </div>
  );
}
