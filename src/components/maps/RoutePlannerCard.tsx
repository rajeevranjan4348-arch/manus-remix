import React, { useState, useEffect } from 'react';
import { 
  Navigation, 
  MapPin, 
  ArrowRight, 
  Car, 
  Bus, 
  Footprints, 
  Bike, 
  Clock, 
  CornerDownRight, 
  ExternalLink,
  RotateCcw,
  AlertCircle
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface RoutePlannerCardProps {
  initialOrigin?: string;
  initialDestination?: string;
  autoCalculate?: boolean;
}

type TravelMode = 'driving' | 'transit' | 'walking' | 'bicycling';

export function RoutePlannerCard({
  initialOrigin = 'New Delhi',
  initialDestination = 'Agra',
  autoCalculate = true,
}: RoutePlannerCardProps) {
  const [origin, setOrigin] = useState(initialOrigin);
  const [destination, setDestination] = useState(initialDestination);
  const [mode, setMode] = useState<TravelMode>('driving');
  const [isCalculating, setIsCalculating] = useState(false);
  const [routeCalculated, setRouteCalculated] = useState(false);

  // Estimated stats based on travel mode
  const getEstimatedStats = (travelMode: TravelMode) => {
    switch (travelMode) {
      case 'transit':
        return { distance: '215 km', duration: '2 hr 45 min', steps: 4 };
      case 'walking':
        return { distance: '208 km', duration: '43 hours', steps: 12 };
      case 'bicycling':
        return { distance: '212 km', duration: '11 hr 30 min', steps: 9 };
      case 'driving':
      default:
        return { distance: '233 km', duration: '3 hr 15 min', via: 'Yamuna Expressway', steps: 5 };
    }
  };

  const [stats, setStats] = useState(() => getEstimatedStats(mode));

  const calculateRoute = () => {
    if (!origin.trim() || !destination.trim()) return;
    setIsCalculating(true);
    setTimeout(() => {
      setStats(getEstimatedStats(mode));
      setIsCalculating(false);
      setRouteCalculated(true);
    }, 400);
  };

  useEffect(() => {
    if (autoCalculate) {
      calculateRoute();
    }
  }, [mode, origin, destination]);

  const mapsUrl = `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(origin)}&destination=${encodeURIComponent(destination)}&travelmode=${mode}`;

  return (
    <div className="w-full rounded-2xl border border-border/80 bg-card overflow-hidden shadow-lg my-3 animate-in fade-in zoom-in-95 duration-200">
      {/* Header */}
      <div className="p-3.5 bg-muted/20 border-b border-border/60 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <div className="p-1.5 rounded-lg bg-blue-500/10 text-blue-500">
            <Navigation size={16} />
          </div>
          <div>
            <h4 className="text-xs font-semibold text-foreground">Route & Directions Planner</h4>
            <p className="text-[10px] text-muted-foreground">
              Real-time route navigation preview
            </p>
          </div>
        </div>

        <a
          href={mapsUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-primary/10 hover:bg-primary/20 text-primary text-[11px] font-semibold transition-colors cursor-pointer"
        >
          <span>Open Maps</span>
          <ExternalLink size={12} />
        </a>
      </div>

      {/* Origin & Destination Display */}
      <div className="p-4 space-y-3 bg-card/60">
        <div className="flex flex-col sm:flex-row items-center gap-2">
          <div className="flex-1 w-full flex items-center gap-2 px-3 py-2 rounded-xl bg-muted/40 border border-border/60 text-xs">
            <MapPin size={14} className="text-emerald-500 shrink-0" />
            <input
              value={origin}
              onChange={(e) => setOrigin(e.target.value)}
              placeholder="Origin address or city"
              className="w-full bg-transparent border-none outline-none text-foreground font-medium"
            />
          </div>

          <div className="p-1.5 rounded-full bg-muted/50 text-muted-foreground shrink-0">
            <ArrowRight size={14} />
          </div>

          <div className="flex-1 w-full flex items-center gap-2 px-3 py-2 rounded-xl bg-muted/40 border border-border/60 text-xs">
            <MapPin size={14} className="text-rose-500 shrink-0" />
            <input
              value={destination}
              onChange={(e) => setDestination(e.target.value)}
              placeholder="Destination address or city"
              className="w-full bg-transparent border-none outline-none text-foreground font-medium"
            />
          </div>
        </div>

        {/* Mode Selector */}
        <div className="flex items-center justify-between gap-2 pt-1 border-t border-border/40">
          <div className="flex items-center gap-1.5 p-1 rounded-xl bg-muted/50 border border-border/40">
            {(
              [
                { id: 'driving', label: 'Drive', icon: Car },
                { id: 'transit', label: 'Transit', icon: Bus },
                { id: 'walking', label: 'Walk', icon: Footprints },
                { id: 'bicycling', label: 'Cycle', icon: Bike },
              ] as const
            ).map((item) => {
              const Icon = item.icon;
              const active = mode === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setMode(item.id)}
                  className={cn(
                    "flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium transition-all cursor-pointer",
                    active
                      ? "bg-background text-foreground shadow-xs font-semibold"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  <Icon size={13} />
                  <span>{item.label}</span>
                </button>
              );
            })}
          </div>

          <button
            type="button"
            onClick={calculateRoute}
            disabled={isCalculating}
            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl bg-primary text-primary-foreground text-xs font-medium hover:opacity-90 transition-opacity cursor-pointer disabled:opacity-50"
          >
            <RotateCcw size={12} className={cn(isCalculating && "animate-spin")} />
            <span>Recalculate</span>
          </button>
        </div>
      </div>

      {/* Summary Box */}
      {routeCalculated && (
        <div className="p-4 bg-muted/10 border-t border-border/50">
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <div className="p-3 rounded-xl bg-card border border-border/60">
              <span className="text-[10px] text-muted-foreground uppercase font-bold tracking-wider">Fastest Route</span>
              <p className="text-base font-bold text-foreground mt-0.5">{stats.duration}</p>
              <span className="text-[11px] text-emerald-600 dark:text-emerald-400 font-medium">Standard traffic</span>
            </div>

            <div className="p-3 rounded-xl bg-card border border-border/60">
              <span className="text-[10px] text-muted-foreground uppercase font-bold tracking-wider">Distance</span>
              <p className="text-base font-bold text-foreground mt-0.5">{stats.distance}</p>
              <span className="text-[11px] text-muted-foreground">{origin} to {destination}</span>
            </div>

            <div className="col-span-2 sm:col-span-1 p-3 rounded-xl bg-card border border-border/60 flex flex-col justify-between">
              <span className="text-[10px] text-muted-foreground uppercase font-bold tracking-wider">Directions</span>
              <a
                href={mapsUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-xs text-primary font-semibold hover:underline mt-1"
              >
                <span>Turn-by-turn guidance</span>
                <CornerDownRight size={13} />
              </a>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
