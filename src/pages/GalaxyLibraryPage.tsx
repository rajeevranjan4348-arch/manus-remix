import React, { useMemo, useState } from 'react';
import { ArrowLeft, ExternalLink, Search, Layers, LoaderCircle, Eye, Code2, Sparkles, Check, Bell, MousePointer2, LayoutGrid } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import catalog from '@/data/galaxy-components.json';

type GalaxyItem = { path: string; category: string; creator: string; label: string; sourceUrl: string; githubUrl: string };
const items = (catalog as { components: GalaxyItem[] }).components;
const categories = ['All', ...Array.from(new Set(items.map(item => item.category)))];

function LiveComponentShowcase() {
  const [activeToggle, setActiveToggle] = useState(true);
  const [activeTab, setActiveTab] = useState('Buttons');
  const [checked, setChecked] = useState(true);
  const [choice, setChoice] = useState('Cards');
  const [demoInput, setDemoInput] = useState('');
  const [notice, setNotice] = useState(false);
  const tabs = ['Buttons', 'Cards', 'Loaders', 'Inputs', 'Toggles', 'Feedback'];

  return <div className="space-y-5">
    <div className="flex flex-wrap gap-2 rounded-xl border border-border bg-card p-2">
      {tabs.map(tab => <button key={tab} onClick={() => setActiveTab(tab)} className={\`rounded-lg px-3 py-2 text-sm transition-all \${activeTab === tab ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground hover:bg-muted hover:text-foreground'}\`}>{tab}</button>)}
    </div>

    {activeTab === 'Buttons' && <section className="rounded-2xl border border-border bg-card p-5 sm:p-6">
      <div className="mb-4"><h2 className="font-semibold">Button styles</h2><p className="text-sm text-muted-foreground">Interactive button patterns inspired by the Galaxy collection.</p></div>
      <div className="flex flex-wrap items-center gap-3">
        <button onClick={() => toast.success('Primary button clicked')} className="rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground shadow transition hover:-translate-y-0.5 hover:shadow-lg active:translate-y-0">Primary action</button>
        <button onClick={() => toast('Outline button clicked')} className="rounded-xl border border-border bg-background px-4 py-2.5 text-sm font-medium transition hover:border-primary hover:bg-muted">Outline</button>
        <button onClick={() => toast('Glow effect activated')} className="rounded-xl border border-violet-400/50 bg-violet-500/10 px-4 py-2.5 text-sm font-semibold text-violet-600 shadow-[0_0_18px_rgba(139,92,246,0.15)] transition hover:shadow-[0_0_24px_rgba(139,92,246,0.3)] dark:text-violet-300">✦ Glow button</button>
        <button onClick={() => toast('Button with icon clicked')} className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-emerald-500"><Sparkles size={15}/> Magic action</button>
        <button onClick={() => toast('Disabled button is only a demo')} disabled className="cursor-not-allowed rounded-xl bg-muted px-4 py-2.5 text-sm text-muted-foreground opacity-70">Disabled</button>
      </div>
    </section>}

    {activeTab === 'Cards' && <section className="space-y-3">
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        <article className="group rounded-2xl border border-border bg-card p-5 transition-all duration-200 hover:-translate-y-1 hover:border-primary/40 hover:shadow-xl"><div className="mb-4 flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary"><Layers size={20}/></div><h2 className="font-semibold">Layered card</h2><p className="mt-2 text-sm text-muted-foreground">A clean card with a subtle hover lift and border highlight.</p><button onClick={() => toast('Layered card selected')} className="mt-4 text-sm font-medium text-primary hover:underline">Explore card →</button></article>
        <article className="rounded-2xl border border-blue-500/20 bg-gradient-to-br from-blue-500/10 via-card to-violet-500/10 p-5 transition-transform hover:scale-[1.01]"><div className="mb-3 flex items-center gap-2 text-sm font-medium text-blue-600 dark:text-blue-300"><Sparkles size={16}/> Gradient panel</div><h2 className="font-semibold">Soft gradient</h2><p className="mt-2 text-sm text-muted-foreground">A gradient-backed card that respects the current theme.</p><div className="mt-4 h-1.5 overflow-hidden rounded-full bg-muted"><div className="h-full w-3/4 rounded-full bg-gradient-to-r from-blue-500 to-violet-500"/></div></article>
        <article className="rounded-2xl border border-border bg-card p-5 shadow-[0_4px_20px_rgba(0,0,0,0.04)]"><div className="mb-3 flex items-center justify-between"><h2 className="font-semibold">Status card</h2><span className="rounded-full bg-emerald-500/10 px-2.5 py-1 text-xs font-medium text-emerald-600 dark:text-emerald-300">Active</span></div><p className="text-sm text-muted-foreground">Status badges and compact metadata can be reused across app screens.</p><div className="mt-4 flex items-center justify-between border-t border-border pt-3 text-xs text-muted-foreground"><span>System status</span><span>Operational</span></div></article>
      </div>
    </section>}

    {activeTab === 'Loaders' && <section className="rounded-2xl border border-border bg-card p-5 sm:p-6">
      <h2 className="font-semibold">Loading animations</h2><p className="mb-5 mt-1 text-sm text-muted-foreground">Lightweight CSS loaders—no additional animation package required.</p>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <div className="flex min-h-28 items-center justify-center gap-3 rounded-xl border border-border p-4"><LoaderCircle className="animate-spin text-primary" size={23}/><span className="text-sm">Spinning loader</span></div>
        <div className="flex min-h-28 items-center justify-center gap-1 rounded-xl border border-border p-4" aria-label="Bouncing dots"><span className="h-2.5 w-2.5 animate-bounce rounded-full bg-primary [animation-delay:-0.3s]"/><span className="h-2.5 w-2.5 animate-bounce rounded-full bg-primary [animation-delay:-0.15s]"/><span className="h-2.5 w-2.5 animate-bounce rounded-full bg-primary"/></div>
        <div className="flex min-h-28 flex-col items-center justify-center gap-3 rounded-xl border border-border p-4"><div className="h-2 w-32 overflow-hidden rounded-full bg-muted"><div className="h-full w-2/3 animate-pulse rounded-full bg-gradient-to-r from-blue-500 via-violet-500 to-pink-500"/></div><span className="text-sm text-muted-foreground">Progress shimmer</span></div>
      </div>
    </section>}

    {activeTab === 'Inputs' && <section className="rounded-2xl border border-border bg-card p-5 sm:p-6">
      <h2 className="font-semibold">Input elements</h2><p className="mb-5 mt-1 text-sm text-muted-foreground">Try the text field and selectable options.</p>
      <div className="grid gap-5 md:grid-cols-2">
        <label className="block text-sm font-medium">Text input<input value={demoInput} onChange={e => setDemoInput(e.target.value)} placeholder="Type something…" className="mt-2 w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/15"/></label>
        <label className="block text-sm font-medium">Component type<select value={choice} onChange={e => setChoice(e.target.value)} className="mt-2 w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm outline-none focus:border-primary"><option>Cards</option><option>Buttons</option><option>Loaders</option><option>Inputs</option><option>Toggles</option></select></label>
        <label className="flex items-center gap-3 text-sm"><input type="checkbox" checked={checked} onChange={e => setChecked(e.target.checked)} className="h-4 w-4 accent-primary"/> Enable this option</label>
        <div className="rounded-xl bg-muted/60 p-3 text-sm text-muted-foreground">Preview: <span className="font-medium text-foreground">{demoInput || 'Your text'} · {choice} · {checked ? 'Enabled' : 'Disabled'}</span></div>
      </div>
    </section>}

    {activeTab === 'Toggles' && <section className="rounded-2xl border border-border bg-card p-5 sm:p-6">
      <h2 className="font-semibold">Toggle switches</h2><p className="mb-5 mt-1 text-sm text-muted-foreground">Functional toggle with a live status label.</p>
      <button role="switch" aria-checked={activeToggle} onClick={() => setActiveToggle(v => !v)} className={\`flex items-center gap-3 rounded-xl border border-border p-3 text-sm transition hover:bg-muted/60\`}><span className={\`relative h-6 w-11 rounded-full transition-colors \${activeToggle ? 'bg-emerald-500' : 'bg-muted-foreground/30'}\`}><span className={\`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform \${activeToggle ? 'translate-x-5' : 'translate-x-0.5'}\`}/></span><span>Notifications are <strong>{activeToggle ? 'on' : 'off'}</strong></span></button>
    </section>}

    {activeTab === 'Feedback' && <section className="rounded-2xl border border-border bg-card p-5 sm:p-6">
      <h2 className="font-semibold">Notifications and tooltips</h2><p className="mb-5 mt-1 text-sm text-muted-foreground">Feedback patterns wired to working actions.</p>
      <div className="flex flex-wrap items-center gap-3"><button onClick={() => toast.success('Saved successfully')} className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-emerald-500"><Check size={16}/> Show success toast</button><button onClick={() => toast.error('This is a sample error notification')} className="inline-flex items-center gap-2 rounded-xl border border-border px-4 py-2.5 text-sm hover:bg-muted"><Bell size={16}/> Show error toast</button><button title="This is a tooltip example" onClick={() => { setNotice(v => !v); toast('Tooltip example toggled'); }} className="inline-flex items-center gap-2 rounded-xl border border-border px-4 py-2.5 text-sm hover:bg-muted"><MousePointer2 size={16}/> Hover tooltip</button></div>
      {notice && <p className="mt-4 rounded-xl border border-primary/20 bg-primary/5 p-3 text-sm">Tooltip helper content: concise hints help users understand a control.</p>}
    </section>}

    <p className="text-xs text-muted-foreground">These are live, reusable React/Tailwind demo patterns inspired by Galaxy categories. They are additive examples, not automatic replacements for every existing screen.</p>
  </div>;
}

export function GalaxyLibraryPage() {
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('All');
  const [selected, setSelected] = useState<GalaxyItem | null>(null);
  const [preview, setPreview] = useState('');
  const [loading, setLoading] = useState(false);
  const [view, setView] = useState<'live' | 'catalog'>('live');
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items.filter(item => (category === 'All' || item.category === category) &&
      (!q || item.label.toLowerCase().includes(q) || item.creator.toLowerCase().includes(q) || item.path.toLowerCase().includes(q)));
  }, [query, category]);

  const openPreview = async (item: GalaxyItem) => {
    setSelected(item);
    setPreview('');
    setLoading(true);
    try {
      const response = await fetch(item.sourceUrl);
      if (!response.ok) throw new Error('Could not load this component from GitHub.');
      const html = await response.text();
      const safeHtml = html.replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, '')
        .replace(/\s+on[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '');
      setPreview(safeHtml);
    } catch {
      setPreview('<div style="font-family:system-ui;padding:24px">Preview could not be loaded. Open the original source on GitHub.</div>');
    } finally {
      setLoading(false);
    }
  };

  return <div className="h-full overflow-y-auto bg-background text-foreground">
    <div className="mx-auto max-w-7xl p-4 sm:p-6 lg:p-8">
      <button onClick={() => navigate(-1)} className="mb-5 inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft size={16}/> Back</button>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="mb-2 flex items-center gap-2 text-sm text-primary"><Layers size={16}/> GALAXY UI COMPONENTS</div>
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Galaxy UI Library</h1>
          <p className="mt-2 max-w-2xl text-sm text-muted-foreground">Try live components in Manus Remix, or search and preview all {items.length.toLocaleString()} community components from the Galaxy archive.</p>
        </div>
        <a href="https://github.com/rajeevranjan4348-arch/galaxy" target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 text-sm text-primary hover:underline">Source repository <ExternalLink size={14}/></a>
      </div>

      <div className="mt-6 flex flex-wrap gap-2 border-b border-border pb-3">
        <button onClick={() => setView('live')} className={\`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition \${view === 'live' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted'}\`}><LayoutGrid size={15}/> Live UI components</button>
        <button onClick={() => setView('catalog')} className={\`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition \${view === 'catalog' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted'}\`}><Code2 size={15}/> Full component catalogue ({items.length.toLocaleString()})</button>
      </div>

      {view === 'live' ? <div className="mt-5"><LiveComponentShowcase /></div> : <>
        <div className="mt-6 flex flex-col gap-3 sm:flex-row">
          <label className="flex min-w-0 flex-1 items-center gap-2 rounded-xl border border-border bg-card px-3 py-2.5">
            <Search size={17} className="text-muted-foreground"/>
            <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search components or creators..." className="w-full bg-transparent text-sm outline-none" />
            <span className="whitespace-nowrap text-xs text-muted-foreground">{filtered.length.toLocaleString()} results</span>
          </label>
          <select value={category} onChange={e => setCategory(e.target.value)} className="rounded-xl border border-border bg-card px-3 py-2.5 text-sm outline-none">
            {categories.map(value => <option key={value} value={value}>{value === 'All' ? 'All categories' : value}</option>)}
          </select>
        </div>
        <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {filtered.slice(0, 180).map(item => <article key={item.path} className="rounded-xl border border-border bg-card p-4 transition-colors hover:border-primary/50">
            <div className="flex items-start justify-between gap-3"><div className="min-w-0"><span className="text-xs text-muted-foreground">{item.category}</span><h2 className="mt-1 break-words font-medium capitalize">{item.label || item.path.split('/').pop()}</h2><p className="mt-1 truncate text-xs text-muted-foreground">by {item.creator}</p></div><Code2 size={17} className="shrink-0 text-muted-foreground"/></div>
            <div className="mt-4 flex items-center gap-3"><button onClick={() => openPreview(item)} className="inline-flex items-center gap-2 rounded-lg bg-primary px-3 py-2 text-xs font-medium text-primary-foreground hover:opacity-90"><Eye size={14}/> Preview</button><a href={item.githubUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">Source <ExternalLink size={12}/></a></div>
          </article>)}
        </div>
        {filtered.length > 180 && <p className="py-6 text-center text-sm text-muted-foreground">Showing 180 of {filtered.length.toLocaleString()} results. Refine your search to find more components.</p>}
        {filtered.length === 0 && <div className="py-16 text-center text-sm text-muted-foreground">No components match this search.</div>}
      </>}

    </div>
    {selected && <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-3 sm:p-6" role="dialog" aria-modal="true" aria-label="Component preview" onMouseDown={e => { if (e.target === e.currentTarget) setSelected(null); }}>
      <div className="flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-2xl">
        <div className="flex items-center justify-between gap-3 border-b border-border p-4"><div className="min-w-0"><h2 className="truncate font-semibold capitalize">{selected.label}</h2><p className="text-xs text-muted-foreground">{selected.category} · {selected.creator}</p></div><div className="flex shrink-0 items-center gap-2"><a href={selected.githubUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-primary">GitHub <ExternalLink size={12}/></a><button onClick={() => setSelected(null)} className="rounded-lg border border-border px-3 py-1.5 text-sm hover:bg-muted">Close</button></div></div>
        <div className="min-h-[300px] flex-1 bg-white">{loading ? <div className="flex h-[50vh] items-center justify-center gap-2 text-gray-600"><LoaderCircle className="animate-spin" size={18}/> Loading preview…</div> : <iframe title={selected.label} srcDoc={preview} sandbox="" referrerPolicy="no-referrer" className="h-[65vh] w-full border-0" />}</div>
        <div className="border-t border-border px-4 py-2 text-xs text-muted-foreground">Sandboxed preview · original community attribution retained in source link.</div>
      </div>
    </div>}
  </div>;
}

export default GalaxyLibraryPage;
