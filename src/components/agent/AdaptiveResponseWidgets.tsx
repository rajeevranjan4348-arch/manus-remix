import React from 'react';
import { CloudSun, Calculator, Code2, Search, GitCompareArrows, ListChecks, Sparkles, ExternalLink } from 'lucide-react';

type WidgetKind = 'weather' | 'math' | 'code' | 'research' | 'compare' | 'plan' | 'creative';

function detectKind(question: string, answer: string): WidgetKind | null {
  const q = question.toLowerCase();
  if (['weather', 'forecast', 'temperature', 'rain today', 'humidity'].some(x => q.includes(x))) return 'weather';
  if (['solve', 'calculate', 'equation', 'math', 'mathematics', 'derivative', 'integral', 'formula', 'simplify'].some(x => q.includes(x))) return 'math';
  if (['write code', 'debug', 'program', 'typescript', 'javascript', 'python', 'html', 'css', 'function', 'api endpoint'].some(x => q.includes(x)) || answer.includes('```')) return 'code';
  if (['research', 'latest news', 'sources', 'cite', 'current events', 'find information', 'look up'].some(x => q.includes(x))) return 'research';
  if (['compare', 'comparison', 'versus', ' vs ', 'difference between'].some(x => q.includes(x))) return 'compare';
  if (['plan', 'schedule', 'roadmap', 'steps to', 'checklist', 'organize', 'itinerary'].some(x => q.includes(x))) return 'plan';
  if (['generate an image', 'draw', 'design a poster', 'make an image', 'create a logo', 'visualize'].some(x => q.includes(x))) return 'creative';
  return null;
}

function WidgetShell({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return <section className="mt-3 overflow-hidden rounded-2xl border border-border/70 bg-card/80 shadow-sm animate-in fade-in slide-in-from-bottom-2 duration-300">
    <div className="flex items-center gap-2 border-b border-border/60 px-4 py-3 text-sm font-semibold">{icon}<span>{title}</span><span className="ml-auto rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">SMART WIDGET</span></div>
    <div className="p-4">{children}</div>
  </section>;
}

export function AdaptiveResponseWidgets({ question, answer }: { question: string; answer: string }) {
  const kind = detectKind(question, answer);
  if (!kind) return null;

  if (kind === 'weather') {
    const words = question.match(/(?:in|for|at)\s+([a-z][a-z .'-]{1,50})/i);
    const place = words?.[1]?.trim().replace(/[?.!,]+$/, '') || '';
    const url = 'https://www.google.com/search?q=' + encodeURIComponent('weather ' + place);
    return <WidgetShell icon={<CloudSun size={17} className="text-sky-500" />} title="Weather lookup">
      <p className="text-sm text-muted-foreground">Open current weather results{place ? ' for ' + place : ''}. This widget links to live results instead of inventing forecast data.</p>
      <a href={url} target="_blank" rel="noreferrer" className="mt-3 inline-flex items-center gap-2 rounded-xl bg-primary px-3 py-2 text-sm font-medium text-primary-foreground">Check live weather <ExternalLink size={14}/></a>
    </WidgetShell>;
  }
  if (kind === 'math') return <WidgetShell icon={<Calculator size={17} className="text-violet-500" />} title="Math workspace">
    <p className="text-sm text-muted-foreground">Math question detected. The answer above remains the source of truth; ask for a step-by-step solution to show the full working.</p>
  </WidgetShell>;
  if (kind === 'code') return <WidgetShell icon={<Code2 size={17} className="text-emerald-500" />} title="Code workspace">
    <p className="text-sm text-muted-foreground">Code-focused answer detected. Code blocks stay in the answer above; ask for tests or a runnable example when needed.</p>
  </WidgetShell>;
  if (kind === 'research') return <WidgetShell icon={<Search size={17} className="text-blue-500" />} title="Research panel">
    <p className="text-sm text-muted-foreground">Check the answer’s cited links and verify time-sensitive facts against current sources.</p>
    <a href={'https://www.google.com/search?q=' + encodeURIComponent(question)} target="_blank" rel="noreferrer" className="mt-3 inline-flex items-center gap-2 text-sm text-primary hover:underline">Search this question <ExternalLink size={13}/></a>
  </WidgetShell>;
  if (kind === 'compare') return <WidgetShell icon={<GitCompareArrows size={17} className="text-orange-500" />} title="Comparison view">
    <p className="text-sm text-muted-foreground">Compare the options by cost, features, advantages, and limitations. Ask Manus for a side-by-side table if details are missing.</p>
  </WidgetShell>;
  if (kind === 'plan') {
    const tasks = answer.split(String.fromCharCode(10)).map(s => s.trim()).filter(s => /^([-*•]|\d+[.)])\s+/.test(s)).slice(0, 6);
    return <WidgetShell icon={<ListChecks size={17} className="text-emerald-500" />} title="Action checklist">
      {tasks.length ? <ul className="space-y-2">{tasks.map((task, i) => <li key={i} className="flex gap-2 text-sm"><span className="mt-0.5 inline-flex h-4 w-4 shrink-0 rounded border border-border"/><span>{task.replace(/^([-*•]|\d+[.)])\s+/, '')}</span></li>)}</ul> : <p className="text-sm text-muted-foreground">Ask Manus to turn the answer into clear, checkable steps.</p>}
    </WidgetShell>;
  }
  return <WidgetShell icon={<Sparkles size={17} className="text-fuchsia-500" />} title="Creative workspace">
    <p className="text-sm text-muted-foreground">Creative request detected. Show the generation animation while work is running, then place the finished visual here when generation is connected.</p>
  </WidgetShell>;
}
