import React, { useMemo, useState } from 'react';
import { ArrowLeft, ExternalLink, Search, Layers, LoaderCircle, Eye, Code2 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import catalog from '@/data/galaxy-components.json';

type GalaxyItem = { path: string; category: string; creator: string; label: string; sourceUrl: string; githubUrl: string };
const items = (catalog as { components: GalaxyItem[] }).components;
const categories = ['All', ...Array.from(new Set(items.map(item => item.category)))];

export function GalaxyLibraryPage() {
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('All');
  const [selected, setSelected] = useState<GalaxyItem | null>(null);
  const [preview, setPreview] = useState('');
  const [loading, setLoading] = useState(false);
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
      // Preview in a sandboxed iframe: no scripts, forms, or top-level navigation.
      const safeHtml = html.replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, '')
        .replace(/\s+on[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '');
      setPreview(safeHtml);
    } catch (error) {
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
          <div className="mb-2 flex items-center gap-2 text-sm text-primary"><Layers size={16}/> UI COMPONENT LIBRARY</div>
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Galaxy UI Library</h1>
          <p className="mt-2 max-w-2xl text-sm text-muted-foreground">Search and preview all {items.length.toLocaleString()} community components from the Galaxy archive without replacing Manus Remix's existing screens.</p>
        </div>
        <a href="https://github.com/rajeevranjan4348-arch/galaxy" target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 text-sm text-primary hover:underline">Source repository <ExternalLink size={14}/></a>
      </div>

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
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <span className="text-xs text-muted-foreground">{item.category}</span>
              <h2 className="mt-1 break-words font-medium capitalize">{item.label || item.path.split('/').pop()}</h2>
              <p className="mt-1 truncate text-xs text-muted-foreground">by {item.creator}</p>
            </div>
            <Code2 size={17} className="shrink-0 text-muted-foreground"/>
          </div>
          <div className="mt-4 flex items-center gap-3">
            <button onClick={() => openPreview(item)} className="inline-flex items-center gap-2 rounded-lg bg-primary px-3 py-2 text-xs font-medium text-primary-foreground hover:opacity-90"><Eye size={14}/> Preview</button>
            <a href={item.githubUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">Source <ExternalLink size={12}/></a>
          </div>
        </article>)}
      </div>
      {filtered.length > 180 && <p className="py-6 text-center text-sm text-muted-foreground">Showing 180 of {filtered.length.toLocaleString()} results. Refine your search to find more components.</p>}
      {filtered.length === 0 && <div className="py-16 text-center text-sm text-muted-foreground">No components match this search.</div>}
    </div>

    {selected && <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-3 sm:p-6" role="dialog" aria-modal="true" aria-label="Component preview" onMouseDown={e => { if (e.target === e.currentTarget) setSelected(null); }}>
      <div className="flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-2xl">
        <div className="flex items-center justify-between gap-3 border-b border-border p-4">
          <div className="min-w-0"><h2 className="truncate font-semibold capitalize">{selected.label}</h2><p className="text-xs text-muted-foreground">{selected.category} · {selected.creator}</p></div>
          <div className="flex shrink-0 items-center gap-2">
            <a href={selected.githubUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-primary">GitHub <ExternalLink size={12}/></a>
            <button onClick={() => setSelected(null)} className="rounded-lg border border-border px-3 py-1.5 text-sm hover:bg-muted">Close</button>
          </div>
        </div>
        <div className="min-h-[300px] flex-1 bg-white">
          {loading ? <div className="flex h-[50vh] items-center justify-center gap-2 text-gray-600"><LoaderCircle className="animate-spin" size={18}/> Loading preview…</div> :
            <iframe title={selected.label} srcDoc={preview} sandbox="" referrerPolicy="no-referrer" className="h-[65vh] w-full border-0" />}
        </div>
        <div className="border-t border-border px-4 py-2 text-xs text-muted-foreground">Sandboxed preview · original community attribution retained in source link.</div>
      </div>
    </div>}
  </div>;
}

export default GalaxyLibraryPage;
