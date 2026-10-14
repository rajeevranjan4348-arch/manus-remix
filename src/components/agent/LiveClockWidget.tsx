import React, { useEffect, useState } from 'react';
import { Clock3, MapPin, ShieldCheck, VolumeX, Volume2 } from 'lucide-react';
import { cn } from '@/lib/utils';

interface LiveClockWidgetProps {
  className?: string;
  locationName?: string;
  timeZone?: string;
}

function getTimeParts(timeZone: string, now: Date) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone, hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).formatToParts(now);
  const part = (type: string) => parts.find(item => item.type === type)?.value || '00';
  const hour = Number(part('hour'));
  return {
    hour: part('hour'), minute: part('minute'), second: part('second'),
    period: hour >= 12 ? 'PM' : 'AM',
    hour12: String(hour % 12 || 12).padStart(2, '0'),
    date: new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short', month: 'short', day: 'numeric' }).format(now),
    offset: new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'short' }).formatToParts(now).find(p => p.type === 'timeZoneName')?.value || timeZone,
  };
}

export function LiveClockWidget({ className, locationName = 'New Delhi', timeZone = 'Asia/Kolkata' }: LiveClockWidgetProps) {
  const [now, setNow] = useState(() => new Date());
  const [smoothSweep, setSmoothSweep] = useState(true);
  const [muted, setMuted] = useState(true);
  const [dialStyle, setDialStyle] = useState<'Obsidian' | 'Blue' | 'Titanium'>('Obsidian');
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 250);
    return () => window.clearInterval(timer);
  }, []);
  const time = getTimeParts(timeZone, now);
  const hourNumber = Number(time.hour) % 12;
  const minuteNumber = Number(time.minute);
  const secondNumber = Number(time.second);
  const hourAngle = hourNumber * 30 + minuteNumber * 0.5;
  const minuteAngle = minuteNumber * 6 + secondNumber * 0.1;
  const secondAngle = secondNumber * 6;
  const face = dialStyle === 'Blue' ? 'from-slate-950 via-sky-950 to-slate-950' : dialStyle === 'Titanium' ? 'from-zinc-700 via-zinc-950 to-zinc-800' : 'from-slate-900 via-[#05070c] to-black';
  return (
    <section aria-label={`Live time in ${locationName}`} className={cn('my-3 w-full max-w-2xl overflow-hidden rounded-[2.5rem] border border-white/20 bg-gradient-to-br from-[#101322] via-[#070b13] to-[#031015] p-4 text-white shadow-xl sm:p-7', className)}>
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3 py-2 text-sm sm:px-4">
          <MapPin size={16} className="shrink-0 text-cyan-400" />
          <span className="truncate font-medium">{locationName}</span>
          <span className="text-white/45">⌄</span>
        </div>
        <div className="flex shrink-0 items-center gap-2 rounded-full border border-cyan-500/40 bg-cyan-950/60 px-3 py-1.5 font-mono text-xs tracking-wider text-cyan-300">
          <span className="h-2 w-2 animate-pulse rounded-full bg-cyan-400" /> LIVE {time.offset}
        </div>
      </div>
      <div className="grid grid-cols-1 items-center gap-4 py-5 sm:grid-cols-[1fr_210px] sm:py-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-baseline gap-1.5 font-mono leading-none tracking-tight">
            <span className="text-5xl tabular-nums sm:text-[3.4rem]">{time.hour}:{time.minute}</span>
            <span className="text-xl font-bold text-cyan-400 tabular-nums">:{time.second}</span>
            <span className="ml-1 text-sm font-semibold text-white/65">{time.period}</span>
          </div>
          <p className="mt-4 text-base"><span className="font-semibold text-cyan-300">{time.date.split(',')[0]}</span><span className="mx-2 text-white/35">•</span><span className="text-white/80">{time.date.split(',').slice(1).join(',').trim()}</span></p>
          <p className="mt-2 text-sm font-semibold text-white/85">{locationName}<span className="mx-2 text-white/30">•</span><span className="font-normal text-white/45">{timeZone} ({time.offset})</span></p>
        </div>
        <div className={cn('mx-auto flex aspect-square w-44 items-center justify-center rounded-full border border-white/35 bg-gradient-to-br p-2 shadow-[0_0_25px_rgba(34,211,238,0.08)] sm:w-[205px]', face)}>
          <svg viewBox="0 0 200 200" className="h-full w-full" role="img" aria-label={`Analog clock ${time.hour}:${time.minute}:${time.second}`}>
            <circle cx="100" cy="100" r="96" fill="none" stroke="rgba(255,255,255,.24)" strokeWidth="1.5" />
            <circle cx="100" cy="100" r="88" fill="none" stroke="rgba(255,255,255,.18)" strokeWidth="1" />
            {Array.from({length:60},(_,i)=><line key={i} x1="100" y1={i%5===0?12:16} x2="100" y2={i%5===0?21:19} transform={`rotate(${i*6} 100 100)`} stroke={i%5===0?'#f8fafc':'#94a3b8'} strokeWidth={i%5===0?2.5:1} strokeLinecap="round" opacity={i%5===0?1:.7}/>)}
            {[12,3,6,9].map((n)=><text key={n} x={n===3?166:n===9?34:100} y={n===12?39:n===6?162:106} textAnchor="middle" dominantBaseline="middle" fill="white" fontSize="17" fontWeight="700">{n}</text>)}
            <g transform={`rotate(${hourAngle} 100 100)`}><line x1="100" y1="107" x2="100" y2="64" stroke="#f8fafc" strokeWidth="7" strokeLinecap="round"/><line x1="100" y1="107" x2="100" y2="64" stroke="#94a3b8" strokeWidth="2" strokeLinecap="round"/></g>
            <g transform={`rotate(${minuteAngle} 100 100)`}><line x1="100" y1="112" x2="100" y2="38" stroke="#e2e8f0" strokeWidth="4.5" strokeLinecap="round"/></g>
            <g transform={`rotate(${secondAngle} 100 100)`}><line x1="100" y1="122" x2="100" y2="29" stroke="#22d3ee" strokeWidth="1.8" strokeLinecap="round"/></g>
            <circle cx="100" cy="100" r="7" fill="#e2e8f0" stroke="#22d3ee" strokeWidth="2"/><circle cx="100" cy="100" r="2.5" fill="#0891b2"/>
          </svg>
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-white/15 pt-4 text-xs">
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={()=>setSmoothSweep(v=>!v)} className="rounded-full border border-white/15 bg-white/5 px-3 py-1.5 hover:bg-white/10"><span className="mr-1.5 text-cyan-400">●</span>{smoothSweep?'Smooth Sweep':'Tick Mode'}</button>
          <button type="button" onClick={()=>setMuted(v=>!v)} aria-label={muted?'Enable clock sound':'Mute clock sound'} className="rounded-full border border-white/15 bg-white/5 p-1.5 hover:bg-white/10">{muted?<VolumeX size={15}/>:<Volume2 size={15}/>}</button>
          <span className="rounded-full border border-white/15 bg-white/5 px-3 py-1.5">24H</span>
        </div>
        <div className="flex items-center gap-1 rounded-full border border-white/15 bg-white/5 p-1">
          {(['Obsidian','Blue','Titanium'] as const).map(style=><button type="button" key={style} onClick={()=>setDialStyle(style)} className={cn('rounded-lg px-2.5 py-1.5 transition-colors',dialStyle===style?'bg-cyan-500/20 text-cyan-300':'text-white/55 hover:text-white')}>{style}</button>)}
        </div>
      </div>
      <p className="mt-3 flex items-center gap-1.5 text-[11px] text-white/40"><ShieldCheck size={13}/> Device-independent live clock • Updates automatically</p>
    </section>
  );
}
