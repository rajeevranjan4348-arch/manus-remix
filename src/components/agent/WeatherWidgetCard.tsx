import React, { useState } from 'react';
import { 
  CloudSun, 
  Sun, 
  CloudRain, 
  CloudSnow, 
  CloudLightning, 
  Cloud, 
  Wind, 
  Droplets, 
  Thermometer, 
  Compass,
  MapPin
} from 'lucide-react';
import { WeatherData } from '@/lib/weatherService';
import { cn } from '@/lib/utils';

interface WeatherWidgetCardProps {
  data: WeatherData;
  className?: string;
}

export function WeatherWidgetCard({ data, className }: WeatherWidgetCardProps) {
  const [useFahrenheit, setUseFahrenheit] = useState(false);

  const getWeatherIcon = (code: number, size = 28) => {
    if (code === 0 || code === 1) return <Sun size={size} className="text-amber-500 animate-spin-slow" />;
    if (code === 2 || code === 3) return <CloudSun size={size} className="text-sky-500" />;
    if ([51, 53, 55, 61, 63, 65, 80, 81, 82].includes(code)) return <CloudRain size={size} className="text-blue-500" />;
    if ([71, 73, 75, 77, 85, 86].includes(code)) return <CloudSnow size={size} className="text-indigo-300" />;
    if ([95, 96, 99].includes(code)) return <CloudLightning size={size} className="text-purple-500" />;
    return <Cloud size={size} className="text-slate-400" />;
  };

  const currentTemp = useFahrenheit ? data.temperatureFahrenheit : data.temperature;
  const tempUnit = useFahrenheit ? '°F' : '°C';

  return (
    <div
      className={cn(
        "rounded-2xl border border-border/80 bg-gradient-to-br from-white via-white to-sky-50/40 dark:from-card dark:via-card dark:to-sky-950/20 p-5 shadow-sm hover:shadow-md transition-all max-w-xl mx-auto my-3 text-foreground",
        className
      )}
    >
      <div className="flex items-center justify-between border-b border-border/50 pb-3">
        <div className="flex items-center gap-2">
          <div className="p-2 rounded-xl bg-sky-500/10 text-sky-600 dark:text-sky-400">
            <MapPin size={18} />
          </div>
          <div>
            <h3 className="font-bold text-sm text-foreground flex items-center gap-1.5">
              {data.locationName}
              {data.country && <span className="text-xs text-muted-foreground font-normal">({data.country})</span>}
            </h3>
            <span className="text-[11px] text-muted-foreground">Live Weather Conditions</span>
          </div>
        </div>

        {/* C/F Unit Toggle */}
        <button
          onClick={() => setUseFahrenheit(!useFahrenheit)}
          className="text-xs font-mono font-semibold px-2.5 py-1 rounded-lg bg-muted/60 hover:bg-muted text-muted-foreground hover:text-foreground transition-colors cursor-pointer border border-border/50"
          title="Switch temperature unit"
        >
          {useFahrenheit ? '°F → °C' : '°C → °F'}
        </button>
      </div>

      {/* Main Temperature & Condition */}
      <div className="flex items-center justify-between py-4">
        <div className="flex items-center gap-3.5">
          <div className="p-3 rounded-2xl bg-muted/40 backdrop-blur-sm">
            {getWeatherIcon(data.weatherCode, 38)}
          </div>
          <div>
            <div className="text-3xl font-extrabold tracking-tight text-foreground font-sans">
              {currentTemp}{tempUnit}
            </div>
            <div className="text-xs font-medium text-muted-foreground mt-0.5">
              {data.condition} • Feels like {useFahrenheit ? Math.round((data.apparentTemperature * 9) / 5 + 32) : data.apparentTemperature}{tempUnit}
            </div>
          </div>
        </div>

        {/* Stats Grid */}
        <div className="grid grid-cols-2 gap-2 text-xs">
          <div className="flex items-center gap-1.5 p-2 rounded-xl bg-muted/30">
            <Droplets size={14} className="text-blue-500" />
            <div>
              <span className="text-[10px] text-muted-foreground block">Humidity</span>
              <span className="font-semibold">{data.humidity}%</span>
            </div>
          </div>
          <div className="flex items-center gap-1.5 p-2 rounded-xl bg-muted/30">
            <Wind size={14} className="text-teal-500" />
            <div>
              <span className="text-[10px] text-muted-foreground block">Wind</span>
              <span className="font-semibold">{data.windSpeed} km/h</span>
            </div>
          </div>
        </div>
      </div>

      {/* 5-Day Forecast Strip */}
      {data.forecast && data.forecast.length > 0 && (
        <div className="pt-3 border-t border-border/50">
          <span className="text-[11px] font-semibold text-muted-foreground block mb-2">5-Day Forecast</span>
          <div className="grid grid-cols-5 gap-1.5">
            {data.forecast.map((day, idx) => {
              const maxT = useFahrenheit ? Math.round((day.maxTemp * 9) / 5 + 32) : day.maxTemp;
              const minT = useFahrenheit ? Math.round((day.minTemp * 9) / 5 + 32) : day.minTemp;
              return (
                <div key={idx} className="flex flex-col items-center p-2 rounded-xl bg-muted/20 text-center">
                  <span className="text-[10px] font-medium text-muted-foreground">{day.day}</span>
                  <div className="my-1.5">{getWeatherIcon(day.weatherCode, 16)}</div>
                  <span className="text-xs font-bold text-foreground">{maxT}°</span>
                  <span className="text-[10px] text-muted-foreground">{minT}°</span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
