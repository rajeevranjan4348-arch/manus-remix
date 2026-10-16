import React, { useMemo, useState } from 'react';
import {
  ArrowLeft, Check, ChevronRight, CircleHelp, Cloud, Code2, Cpu, Eye, EyeOff,
  Github, Globe, KeyRound, LockKeyhole, MessageSquare, Puzzle, RefreshCw,
  ShieldCheck, SlidersHorizontal, Sparkles, Terminal, Timer, Workflow, Zap
} from 'lucide-react';
import { getSettings, saveSettings } from '@/lib/settingsStore';
import type { UserSettings } from '@/types/settings';
import { toast } from 'sonner';
import { WorkspaceConnectButton } from '../workspace/WorkspaceConnectButton';
import { GitHubRepositoryBrowser } from './GitHubRepositoryBrowser';

export type StitchSettingsView = 'ai_models' | 'connectors_integrations' | 'work_execution';

interface Props {
  view: StitchSettingsView;
  onBack: () => void;
}

const MODELS = [
  { id: 'manus-1.6-lite', name: 'Manus 1.6 Lite', provider: 'Manus', detail: 'Fast everyday assistance', tag: 'FAST' },
  { id: 'manus-1.6-max', name: 'Manus 1.6 Max', provider: 'Manus', detail: 'Deep reasoning and complex tasks', tag: 'REASONING' },
  { id: 'gemini-3.1-pro-preview', name: 'Gemini Pro', provider: 'Google', detail: 'Long-context analysis and multimodal work', tag: 'MULTIMODAL' },
  { id: 'gemini-3.8-flash', name: 'Gemini Flash', provider: 'Google', detail: 'Fast responses and document analysis', tag: 'FAST' },
  { id: 'claude-3.5-sonnet', name: 'Claude Sonnet', provider: 'Anthropic', detail: 'Structured coding and engineering', tag: 'CODE' },
];

function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (next: boolean) => void; label: string }) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={label}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border transition-all duration-200 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40 ${checked ? 'border-white bg-white' : 'border-[#424449] bg-[#292B2F]'}`}>
      <span className={`h-4 w-4 rounded-full shadow-sm transition-transform duration-200 ease-out ${checked ? 'translate-x-[22px] bg-black' : 'translate-x-1 bg-[#A7A9AF]'}`} />
    </button>
  );
}

function SettingRow({ icon: Icon, title, description, trailing }: { icon: React.ElementType; title: string; description: string; trailing: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3.5 px-4 py-4">
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-[#34363B] bg-[#202226] text-[#D5D7DC]">
        <Icon size={18} strokeWidth={1.8} />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-[14px] font-medium text-[#F4F4F5]">{title}</p>
        <p className="mt-1 text-[12px] leading-5 text-[#92959E]">{description}</p>
      </div>
      <div className="shrink-0">{trailing}</div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return <section className="overflow-hidden rounded-[22px] border border-[#2D3035] bg-[#151619] shadow-[0_10px_30px_rgba(0,0,0,0.12)]"><div className="border-b border-[#2A2C30] px-4 py-3"><h3 className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#A1A4AD]">{title}</h3></div>{children}</section>;
}

export function StitchSettingsPanels({ view, onBack }: Props) {
  const [settings, setSettings] = useState<UserSettings>(() => getSettings());
  const [showKey, setShowKey] = useState(false);
  const [providerKey, setProviderKey] = useState('');
  const [showRepositoryBrowser, setShowRepositoryBrowser] = useState(false);
  const [connectorEnabled, setConnectorEnabled] = useState<Record<string, boolean>>(() => ({
    google: true, github: true, notion: false, slack: false, mcp: false,
    ...(getSettings().connectorEnabled || {})
  }));

  const update = <K extends keyof UserSettings>(key: K, value: UserSettings[K]) => {
    const next = saveSettings({ [key]: value } as Partial<UserSettings>);
    setSettings(next);
    toast.success('Setting saved');
  };

  const title = view === 'ai_models' ? 'AI Models & Providers' : view === 'connectors_integrations' ? 'Connectors & Integrations' : 'Work Mode Execution';
  const subtitle = view === 'ai_models'
    ? 'Choose the intelligence that powers Manus'
    : view === 'connectors_integrations'
      ? 'Manage connected apps and tools'
      : 'Control autonomy, execution and safety';

  const activeModel = useMemo(() => MODELS.find(model => model.id === settings.defaultModel) || MODELS[0], [settings.defaultModel]);

  const setConnector = (id: string, value: boolean) => {
    const next = { ...connectorEnabled, [id]: value };
    setConnectorEnabled(next);
    update('connectorEnabled', next);
  };

  return (
    <div className="fixed inset-0 z-[60] flex min-h-0 flex-col overflow-hidden bg-[#08090B] text-white animate-in slide-in-from-right-3 fade-in duration-300 ease-out">
      <header className="z-10 flex shrink-0 items-center gap-3 border-b border-white/[0.07] bg-[#090A0C]/90 px-4 pb-3 pt-[calc(env(safe-area-inset-top)+12px)] backdrop-blur-xl">
        <button type="button" onClick={onBack} aria-label="Back to Settings" className="flex h-10 w-10 items-center justify-center rounded-full text-[#E5E7EB] transition-all duration-200 hover:bg-white/[0.07] active:scale-95">
          <ArrowLeft size={21} />
        </button>
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-[17px] font-semibold tracking-[-0.02em]">{title}</h2>
          <p className="mt-0.5 truncate text-[11px] text-[#898D96]">{subtitle}</p>
        </div>
        <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-[#303238] bg-[#17191D] text-[#D9DBE1]"><SlidersHorizontal size={17} /></div>
      </header>

      <main key={view} className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-[calc(env(safe-area-inset-bottom)+28px)] pt-5 [scrollbar-width:none] animate-in fade-in slide-in-from-bottom-1 duration-300">
        <div className="mx-auto flex w-full max-w-xl flex-col gap-5">
          {view === 'ai_models' && <>
            <div className="rounded-[24px] border border-[#34363B] bg-gradient-to-br from-[#1D2025] to-[#111215] p-5">
              <div className="flex items-center gap-3">
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.05]"><Cpu size={22} /></div>
                <div><p className="text-[11px] uppercase tracking-[0.15em] text-[#9A9EA7]">Active engine</p><p className="mt-1 text-[18px] font-semibold">{activeModel.name}</p><p className="mt-1 text-[12px] text-[#A0A3AB]">{activeModel.provider} · {activeModel.tag}</p></div>
                <span className="ml-auto flex items-center gap-1.5 rounded-full border border-emerald-500/20 bg-emerald-500/[0.08] px-2.5 py-1 text-[10px] text-emerald-300"><span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />Selected</span>
              </div>
            </div>
            <Section title="Model selection">
              <div className="divide-y divide-[#292B30]">
                {MODELS.map(model => {
                  const selected = settings.defaultModel === model.id;
                  return <button key={model.id} type="button" onClick={() => update('defaultModel', model.id)} className={`flex w-full items-center gap-3 px-4 py-4 text-left transition-all duration-200 hover:bg-white/[0.035] active:scale-[0.995] ${selected ? 'bg-white/[0.035]' : ''}`}>
                    <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border ${selected ? 'border-white bg-white text-black' : 'border-[#555861] text-transparent'}`}>{selected && <Check size={13} strokeWidth={3} />}</span>
                    <span className="min-w-0 flex-1"><span className="flex flex-wrap items-center gap-2 text-[14px] font-medium">{model.name}<span className="rounded-md border border-[#34363B] bg-[#202227] px-1.5 py-0.5 text-[9px] tracking-wide text-[#AEB1B9]">{model.tag}</span></span><span className="mt-1 block text-[12px] text-[#92959E]">{model.detail}</span></span>
                    <span className="text-[11px] text-[#858994]">{model.provider}</span>
                  </button>;
                })}
              </div>
            </Section>
            <Section title="Routing & response">
              <SettingRow icon={Workflow} title="Automatic fallback" description="Use a secondary model when the selected provider is unavailable" trailing={<Toggle label="Automatic model fallback" checked={settings.providerFallbackEnabled ?? true} onChange={v => update('providerFallbackEnabled', v)} />} />
              <div className="mx-4 border-t border-[#292B30]" />
              <SettingRow icon={Zap} title="Response speed" description="Choose how quickly streamed responses are delivered" trailing={<select aria-label="Response speed" value={settings.streamingSpeed} onChange={e => update('streamingSpeed', e.target.value as UserSettings['streamingSpeed'])} className="max-w-[112px] rounded-xl border border-[#373A40] bg-[#202227] px-2.5 py-2 text-[12px] text-white outline-none focus:border-white/40"><option value="normal">Normal</option><option value="fast">Fast</option><option value="instant">Instant</option></select>} />
              <div className="mx-4 border-t border-[#292B30]" />
              <div className="px-4 py-4"><div className="mb-3 flex items-center justify-between"><div><p className="text-[14px] font-medium">Creativity / temperature</p><p className="mt-1 text-[12px] text-[#92959E]">Lower is more deterministic</p></div><span className="rounded-lg bg-[#24262B] px-2 py-1 font-mono text-[12px]">{settings.temperature.toFixed(2)}</span></div><input aria-label="Model temperature" type="range" min="0" max="1" step="0.05" value={settings.temperature} onChange={e => update('temperature', Number(e.target.value))} className="w-full accent-white" /><div className="mt-1 flex justify-between text-[10px] text-[#777B84]"><span>Precise</span><span>Balanced</span><span>Creative</span></div></div>
            </Section>
            <Section title="Provider credentials">
              <div className="px-4 py-4">
                <div className="mb-3 flex items-center gap-2 text-[13px] font-medium"><LockKeyhole size={16} className="text-[#B9BDC5]" />Secure API key entry</div>
                <p className="mb-3 text-[12px] leading-5 text-[#92959E]">Keys entered here are kept only in this screen's memory and are not saved to browser storage. For real provider access, configure secrets in Netlify environment variables.</p>
                <div className="flex gap-2"><div className="relative min-w-0 flex-1"><input aria-label="Temporary provider API key" type={showKey ? 'text' : 'password'} value={providerKey} onChange={e => setProviderKey(e.target.value)} placeholder="Paste key for temporary preview" autoComplete="off" className="w-full rounded-xl border border-[#363940] bg-[#0E0F12] px-3 py-3 pr-10 text-[12px] outline-none transition-colors placeholder:text-[#656973] focus:border-white/40" /><button type="button" onClick={() => setShowKey(v => !v)} aria-label={showKey ? 'Hide API key' : 'Show API key'} className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1.5 text-[#92959E] hover:text-white">{showKey ? <EyeOff size={15} /> : <Eye size={15} />}</button></div><button type="button" onClick={() => { setProviderKey(''); toast.info('No key was stored. Add provider secrets in Netlify environment variables.'); }} className="rounded-xl border border-[#393C42] px-3 text-[12px] text-[#D3D5DA] transition-colors hover:bg-white/[0.06]">Clear</button></div>
                <div className="mt-3 flex items-center gap-2 text-[11px] text-emerald-300"><ShieldCheck size={14} />Browser storage is not used for secrets</div>
              </div>
            </Section>
          </>}

          {view === 'connectors_integrations' && <>
            <div className="rounded-[22px] border border-[#34363B] bg-[#151619] p-4">
              <div className="flex items-start gap-3"><div className="flex h-10 w-10 items-center justify-center rounded-2xl border border-[#34363B] bg-[#202226]"><Puzzle size={18} /></div><div><p className="text-[15px] font-semibold">Your connected workspace</p><p className="mt-1 text-[12px] leading-5 text-[#92959E]">Control which external tools Manus can use. Connections and permissions are managed separately by each provider.</p></div></div>
            </div>
            <Section title="Available integrations">
              <div className="divide-y divide-[#292B30]">
                <div className="px-4 py-4"><div className="flex items-center gap-3"><div className="flex h-10 w-10 items-center justify-center rounded-2xl border border-[#34363B] bg-[#202226]"><Cloud size={18} /></div><div className="min-w-0 flex-1"><p className="text-[14px] font-medium">Google Workspace</p><p className="mt-1 text-[12px] text-[#92959E]">Drive, Calendar, Gmail and Docs</p></div><WorkspaceConnectButton /></div></div>
                <div className="px-4 py-4"><div className="flex items-center gap-3"><div className="flex h-10 w-10 items-center justify-center rounded-2xl border border-[#34363B] bg-[#202226]"><Github size={18} /></div><div className="min-w-0 flex-1"><p className="text-[14px] font-medium">GitHub</p><p className="mt-1 text-[12px] text-[#92959E]">Browse repositories and inspect source</p></div><button type="button" onClick={() => setShowRepositoryBrowser(v => !v)} className="rounded-xl border border-[#3A3D43] px-3 py-2 text-[12px] transition-colors hover:bg-white/[0.06]">{showRepositoryBrowser ? 'Hide' : 'Browse'}</button></div>{showRepositoryBrowser && <div className="mt-4 overflow-hidden rounded-xl border border-[#2D3035] bg-[#0D0E10] p-2"><GitHubRepositoryBrowser /></div>}</div>
                {[
                  { id: 'notion', name: 'Notion', desc: 'Pages, notes and knowledge bases', icon: MessageSquare },
                  { id: 'slack', name: 'Slack', desc: 'Search team conversations', icon: MessageSquare },
                  { id: 'mcp', name: 'Custom MCP server', desc: 'Connect a trusted tool server', icon: Terminal },
                ].map(item => <SettingRow key={item.id} icon={item.icon} title={item.name} description={item.desc} trailing={<Toggle label={`Enable ${item.name}`} checked={Boolean(connectorEnabled[item.id])} onChange={v => setConnector(item.id, v)} />} />)}
              </div>
            </Section>
            <div className="rounded-[18px] border border-amber-500/20 bg-amber-500/[0.05] p-4"><div className="flex gap-2.5"><ShieldCheck size={17} className="mt-0.5 shrink-0 text-amber-300" /><p className="text-[12px] leading-5 text-[#C6C8CE]">Only enable integrations you trust. A visible toggle does not complete OAuth setup by itself; provider authorization must be configured before the tool can run.</p></div></div>
          </>}

          {view === 'work_execution' && <>
            <div className="rounded-[22px] border border-[#34363B] bg-gradient-to-br from-[#1C1E22] to-[#111215] p-5">
              <div className="flex items-center gap-3"><div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.05]"><Workflow size={22} /></div><div><p className="text-[11px] uppercase tracking-[0.15em] text-[#9A9EA7]">Execution profile</p><p className="mt-1 text-[18px] font-semibold">{settings.autonomyLevel === 'high' ? 'High autonomy' : settings.autonomyLevel === 'medium' ? 'Balanced autonomy' : 'Supervised'}</p><p className="mt-1 text-[12px] text-[#A0A3AB]">Adjust how Manus plans and runs tasks</p></div></div>
            </div>
            <Section title="Autonomy & reasoning">
              <div className="px-4 py-4"><p className="text-[14px] font-medium">Autonomy level</p><p className="mt-1 text-[12px] text-[#92959E]">Higher autonomy can reduce interruptions; sensitive actions still require safeguards.</p><div className="mt-3 grid grid-cols-3 gap-2">{([{value:'low',label:'Supervised'},{value:'medium',label:'Balanced'},{value:'high',label:'High'}] as const).map(option => <button key={option.value} type="button" onClick={() => update('autonomyLevel', option.value)} className={`rounded-xl border px-2 py-3 text-[11px] font-medium transition-all duration-200 active:scale-[0.98] ${settings.autonomyLevel === option.value ? 'border-white/50 bg-white text-black' : 'border-[#363940] bg-[#202227] text-[#B7BAC2] hover:bg-white/[0.05]'}`}>{option.label}</button>)}</div></div>
              <div className="mx-4 border-t border-[#292B30]" />
              <div className="px-4 py-4"><div className="mb-3 flex items-center justify-between"><div><p className="text-[14px] font-medium">Reasoning steps</p><p className="mt-1 text-[12px] text-[#92959E]">Planning depth for multi-step tasks</p></div><span className="rounded-lg bg-[#24262B] px-2 py-1 font-mono text-[12px]">{settings.reasoningSteps}</span></div><input aria-label="Reasoning steps" type="range" min="1" max="12" step="1" value={settings.reasoningSteps} onChange={e => update('reasoningSteps', Number(e.target.value))} className="w-full accent-white" /></div>
            </Section>
            <Section title="Execution safeguards">
              <SettingRow icon={ShieldCheck} title="Human checkpoints" description="Pause before high-impact or irreversible actions" trailing={<Toggle label="Human checkpoints" checked={settings.humanCheckpoints} onChange={v => update('humanCheckpoints', v)} />} />
              <div className="mx-4 border-t border-[#292B30]" />
              <SettingRow icon={Code2} title="Code sandbox" description="Allow isolated code execution when supported" trailing={<Toggle label="Code sandbox" checked={settings.sandboxExecution} onChange={v => update('sandboxExecution', v)} />} />
              <div className="mx-4 border-t border-[#292B30]" />
              <SettingRow icon={Terminal} title="Terminal tools" description="Expose terminal tools only when configured on the server" trailing={<Toggle label="Terminal tools" checked={settings.terminalExecution} onChange={v => update('terminalExecution', v)} />} />
              <div className="mx-4 border-t border-[#292B30]" />
              <SettingRow icon={LockKeyhole} title="Approval policy" description="Choose when actions need your approval" trailing={<select aria-label="Approval policy" value={settings.toolApprovalPolicy || 'ask_sensitive'} onChange={e => update('toolApprovalPolicy', e.target.value as NonNullable<UserSettings['toolApprovalPolicy']>)} className="max-w-[125px] rounded-xl border border-[#373A40] bg-[#202227] px-2 py-2 text-[11px] text-white outline-none focus:border-white/40"><option value="ask_all">Ask every time</option><option value="ask_sensitive">Sensitive only</option><option value="auto_approve">Auto approve</option></select>} />
              <div className="mx-4 border-t border-[#292B30]" />
              <SettingRow icon={Timer} title="Task timeout" description="Maximum allowed duration for a task (UI preference)" trailing={<select aria-label="Task timeout" value={String(settings.taskTimeoutSeconds)} onChange={e => update('taskTimeoutSeconds', Number(e.target.value))} className="max-w-[125px] rounded-xl border border-[#373A40] bg-[#202227] px-2 py-2 text-[11px] text-white outline-none focus:border-white/40"><option value="60">1 minute</option><option value="300">5 minutes</option><option value="900">15 minutes</option><option value="1800">30 minutes</option></select>} />
            </Section>
            <div className="rounded-[18px] border border-[#34363B] bg-[#151619] p-4"><div className="flex items-start gap-2.5"><CircleHelp size={17} className="mt-0.5 shrink-0 text-[#B8BBC3]" /><p className="text-[12px] leading-5 text-[#92959E]">These preferences are saved locally. Runtime enforcement depends on the server and tools configured for this deployment; enabling a control here does not grant operating-system or terminal access by itself.</p></div></div>
          </>}
        </div>
      </main>
    </div>
  );
}
