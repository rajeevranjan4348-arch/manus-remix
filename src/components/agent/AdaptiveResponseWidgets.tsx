import React from 'react';
import { CloudSun, Calculator, Code2, Search, GitCompareArrows, ListChecks, Sparkles, ExternalLink, Copy, Check } from 'lucide-react';
import { toast } from 'sonner';

type WidgetKind = 'weather' | 'math' | 'code' | 'research' | 'compare' | 'plan' | 'creative';

function detectWidgetKind(question: string, answer: string): WidgetKind | null {
  const q = question.toLowerCase();
  if (/\\b(weather|forecast|temperature|rain today|humidity)\\b/.test(q)) return 'weather';
  if (/\\b(solve|calculate|equation|math|mathematics|derivative|integral|formula|simplify)\\b/.test(q)) return 'math';
  if (/\\b(write code|debug|program|typescript|javascript|python|html|css|function|api endpoint)\\b/.test(q) || /\x60\x60\x60(?:\w+)?/.test(answer)) return 'code';
  if (/\\b(research|latest news|sources|cite|current events|find information|look up)\\b/.test(q)) return 'research';
  if (/\\b(compare|comparison|versus|\\bvs\\b|difference between)\\b/.test(q)) return 'compare';
  if (/\\b(plan|schedule|roadmap|steps to|checklist|organize|itinerary)\\b/.test(q)) return 'plan';
  if (/\\b(generate an image|draw|design a poster|make an image|create a logo|visualize)\\b/.test(q)) return 'creative';
  return null;
}

function WidgetShell({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return <section className="mt-3 overflow-hidden rounded-2xl border border-border/70 bg-card/80 shadow-sm animate-in fade-in slide-in-from-bottom-2 duration-300">
    <div className="flex items-center gap-2 border-b border-border/60 px-4 py-3 text-sm font-semibold">{icon}<span>{title}</span><span className="ml-auto rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">SMART WIDGET</span></div>
    <div className="p-4">{children}</div>
  </section>;
}

export function AdaptiveResponseWidgets({ question, answer }: { question: string; answer: string }) {
  const kind = detectWidgetKind(question, answer);
  const [copied, setCopied] = React.useState(false);
  if (!kind) return null;

  if (kind === 'weather') {
    const match = question.match(/(?:in|for|at)\\s+([a-z][a-z .'-]{1,50})/i);
    const place = match?.[1]?.trim().replace(/[?.!,]+$/, '') || '';
    const url = 'https://www.google.com/search?q=' + encodeURIComponent('weather ' + place);
    return <WidgetShell icon={<CloudSun size={17} className="text-sky-500" />} title="Weather lookup">
      <p className="text-sm text-muted-foreground">Open a live weather result{place ? ' for ' + place : ''}. This card does not invent forecast data.</p>
      <a href={url} target="_blank" rel="noreferrer" className="mt-3 inline-flex items-center gap-2 rounded-xl bg-primary px-3 py-2 text-sm font-medium text-primary-foreground">Check live weather <ExternalLink size={14}/></a>
    </WidgetShell>;
  }

  if (kind === 'math') {
    const lines = answer.split(/\\n/).map(s => s.trim()).filter(s => s && (/=|≈|≠|≤|≥|√|∫|π|\\b(step|answer|solution)\\b/i.test(s))).slice(0, 5);
    return <WidgetShell icon={<Calculator size={17} className="text-violet-500" />} title="Math solution highlights">
      {lines.length ? <div className="space-y-2">{lines.map((line, i) => <div key={i} className="rounded-lg bg-muted/60 px-3 py-2 font-mono text-sm">{line.replace(/^[-*# ]+/, '')}</div>)}</div> : <p className="text-sm text-muted-foreground">The answer is shown above. Ask for “step-by-step solution” to expand the working.</p>}
    </WidgetShell>;
  }

  if (kind === 'code') {
    const match = answer.match(/\x60\x60\x60(?:[a-zA-Z0-9_-]+)?\\n([\\s\\S]*?)\x60\x60\x60/);
    const snippet = match?.[1]?.trim();
    return <WidgetShell icon={<Code2 size={17} className="text-emerald-500" />} title="Code workspace">
      <p className="text-sm text-muted-foreground">{snippet ? 'Code detected in the answer. Copy the first code block to your editor.' : 'Code-focused response detected. Ask for a complete runnable example if needed.'}</p>
      {snippet && <><pre className="mt-3 max-h-52 overflow-auto rounded-xl bg-muted p-3 text-xs leading-relaxed"><code>{snippet.slice(0, 3500)}</code></pre><button onClick={() => { void navigator.clipboard?.writeText(snippet).then(() => { setCopied(true); toast.success('Code copied'); }).catch(() => toast.error('Clipboard access unavailable')); }} className="mt-3 inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm hover:bg-muted">{copied ? <Check size={14}/> : <Copy size={14}/>} {copied ? 'Copied' : 'Copy code'}</button></>}
    </WidgetShell>;
  }

  if (kind === 'research') {
    const urls = Array.from(answer.matchAll(/https?:\\/\\/[^\\s)\\]]+/g), m => m[0].replace(/[.,;]+$/, '')).slice(0, 4);
    return <WidgetShell icon={<Search size={17} className="text-blue-500" />} title="Research panel">
      <p className="text-sm text-muted-foreground">Review the answer above and open available links. Verify time-sensitive facts against current sources.</p>
      {urls.length > 0 && <div className="mt-3 space-y-2">{urls.map((url, i) => <a key={url} href={url} target="_blank" rel="noreferrer" className="flex items-center gap-2 break-all rounded-lg border border-border p-2 text-xs text-primary hover:bg-muted"><ExternalLink size={13} className="shrink-0"/>Source {i + 1}: {url}</a>)}</div>}
      <a href={'https://www.google.com/search?q=' + encodeURIComponent(question)} target="_blank" rel="noreferrer" className="mt-3 inline-flex items-center gap-2 text-sm text-primary hover:underline">Search this question <ExternalLink size={13}/></a>
    </WidgetShell>;
  }

  if (kind === 'compare') {
    return <WidgetShell icon={<GitCompareArrows size={17} className="text-orange-500" />} title="Comparison view">
      <p className="text-sm text-muted-foreground">Compare the options mentioned in the answer by price, features, advantages, and limitations. If details are missing, ask Manus to fill the gaps.</p>
      <button onClick={() => toast('Ask Manus: make a side-by-side comparison table with pros, cons, and a recommendation.')} className="mt-3 rounded-lg border border-border px-3 py-2 text-sm hover:bg-muted">Prepare comparison table</button>
    </WidgetShell>;
  }

  if (kind === 'plan') {
    const tasks = answer.split(/\\n/).map(s => s.trim()).filter(s => /^(?:[-*•]|\\d+[.)])\\s+/.test(s)).slice(0, 6);
    return <WidgetShell icon={<ListChecks size={17} className="text-emerald-500" />} title="Action checklist">
      {tasks.length ? <ul className="space-y-2">{tasks.map((task, i) => <li key={i} className="flex gap-2 text-sm"><span className="mt-0.5 inline-flex h-4 w-4 shrink-0 rounded border border-border"/><span>{task.replace(/^(?:[-*•]|\\d+[.)])\\s+/, '')}</span></li>)}</ul> : <p className="text-sm text-muted-foreground">Ask Manus to turn the answer into clear, checkable steps.</p>}
    </WidgetShell>;
  }

  return <WidgetShell icon={<Sparkles size={17} className="text-fuchsia-500" />} title="Creative workspace">
    <p className="text-sm text-muted-foreground">Creative request detected. Keep the generation animation visible while work is in progress, then show the finished image or design here when an image-generation result is connected.</p>
  </WidgetShell>;
}
