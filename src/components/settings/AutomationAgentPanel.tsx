import React, { useCallback, useEffect, useState } from 'react';
import { Activity, Bot, CheckCircle2, CircleAlert, RefreshCw, ShieldCheck, Workflow } from 'lucide-react';
import { toast } from 'sonner';

type Capability = { id: string; label: string; ready: boolean; detail: string };
type StatusPayload = { capabilities?: Capability[]; message?: string };

export function AutomationAgentPanel() {
  const [capabilities, setCapabilities] = useState<Capability[]>([]);
  const [loading, setLoading] = useState(false);
  const [task, setTask] = useState('');
  const [plan, setPlan] = useState<string[]>([]);
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const response = await fetch('/api/automation-agent', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'status' }) });
      const data: StatusPayload = await response.json();
      if (!response.ok) throw new Error(data.message || 'Unable to read automation status.');
      setCapabilities(Array.isArray(data.capabilities) ? data.capabilities : []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Automation status unavailable.');
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const createPlan = async () => {
    if (!task.trim()) { toast.error('Describe the automation first.'); return; }
    setLoading(true); setError(''); setPlan([]);
    try {
      const response = await fetch('/api/automation-agent', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'plan', prompt: task.trim() }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || 'Could not create an automation plan.');
      setPlan(Array.isArray(data.steps) ? data.steps : []);
      if (data.steps?.length) toast.success('Automation plan created');
    } catch (e) { setError(e instanceof Error ? e.message : 'Planning failed.'); }
    finally { setLoading(false); }
  };

  const readyCount = capabilities.filter(item => item.ready).length;
  return (
    <div className="space-y-5 animate-in fade-in duration-100">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2"><Bot size={17} /><h3 className="text-sm font-semibold">Manus Automation Agent</h3></div>
          <p className="mt-1 text-xs text-muted-foreground">Plan multi-step work across research, connected apps, browser automation, AI models, and paired Android automations.</p>
        </div>
        <button type="button" onClick={() => void refresh()} disabled={loading} className="inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs hover:bg-muted disabled:opacity-50"><RefreshCw size={12} className={loading ? 'animate-spin' : ''}/> Refresh</button>
      </div>
      <div className="rounded-xl border border-border/70 p-3">
        <div className="flex items-center gap-2"><Activity size={15}/><span className="text-xs font-medium">{readyCount} of {capabilities.length} automation channels ready</span></div>
        <div className="mt-3 space-y-2">
          {capabilities.map(item => <div key={item.id} className="flex items-start gap-2 rounded-lg bg-muted/30 p-2.5">
            {item.ready ? <CheckCircle2 size={15} className="mt-0.5 shrink-0 text-emerald-500"/> : <CircleAlert size={15} className="mt-0.5 shrink-0 text-amber-500"/>}
            <div className="min-w-0"><p className="text-xs font-medium">{item.label}</p><p className="text-[11px] leading-relaxed text-muted-foreground">{item.detail}</p></div>
          </div>)}
          {!capabilities.length && !loading && <p className="text-xs text-muted-foreground">No status data returned. Check the Netlify deployment.</p>}
        </div>
      </div>
      <div className="space-y-2">
        <div className="flex items-center gap-2"><Workflow size={15}/><h4 className="text-xs font-semibold">Plan an automation</h4></div>
        <textarea value={task} onChange={e => setTask(e.target.value)} rows={3} maxLength={4000} placeholder="Example: research a topic, summarize sources, then prepare a calendar task…" className="w-full resize-y rounded-lg border border-border bg-background px-3 py-2 text-xs outline-none focus:ring-2 focus:ring-ring"/>
        <button type="button" onClick={() => void createPlan()} disabled={loading || !task.trim()} className="rounded-lg bg-foreground px-3 py-2 text-xs font-medium text-background disabled:opacity-50">{loading ? 'Working…' : 'Create plan'}</button>
      </div>
      {plan.length > 0 && <ol className="list-decimal space-y-2 pl-5 text-xs">{plan.map((step, index) => <li key={index} className="leading-relaxed">{step}</li>)}</ol>}
      {error && <p role="alert" className="rounded-lg border border-destructive/30 p-3 text-xs text-destructive">{error}</p>}
      <div className="flex items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-500/5 p-3 text-[11px] leading-relaxed text-muted-foreground"><ShieldCheck size={15} className="mt-0.5 shrink-0"/>Sensitive actions must be approved before execution. A channel marked unavailable needs its bridge, credentials, or device pairing configured; this panel never pretends a missing integration ran.</div>
    </div>
  );
}
