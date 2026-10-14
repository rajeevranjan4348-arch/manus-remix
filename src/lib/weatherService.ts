/**
 * Real-Time Weather Service
 * 
 * Supports both server-side proxy (/api/weather) and client-side Open-Meteo API.
 * High-precision live data (temperature, conditions, 5-day forecast, humidity, wind).
 * Zero API keys exposed in frontend code.
 */

export interface WeatherData {
  locationName: string;
  country?: string;
  latitude: number;
  longitude: number;
  temperature: number; // Celsius
  temperatureFahrenheit: number;
  apparentTemperature: number;
  humidity: number; // %
  windSpeed: number; // km/h
  precipitation: number; // mm
  isDay: boolean;
  weatherCode: number;
  condition: string;
  source: string;
  units: {
    temperature: '°C' | '°F';
    windSpeed: 'km/h';
    humidity: '%';
    precipitation: 'mm';
  };
  forecast: {
    day: string;
    weatherCode: number;
    condition: string;
    maxTemp: number;
    minTemp: number;
    maxTempF?: number;
    minTempF?: number;
  }[];
}

export interface WeatherQueryResult {
  isWeather: boolean;
  city?: string;
  needsLocation: boolean;
}

const WMO_CODE_MAP: Record<number, string> = {
  0: 'Clear sky',
  1: 'Mainly clear',
  2: 'Partly cloudy',
  3: 'Overcast',
  45: 'Fog',
  48: 'Depositing rime fog',
  51: 'Light drizzle',
  53: 'Moderate drizzle',
  55: 'Dense drizzle',
  61: 'Slight rain',
  63: 'Moderate rain',
  65: 'Heavy rain',
  71: 'Slight snowfall',
  73: 'Moderate snowfall',
  75: 'Heavy snowfall',
  77: 'Snow grains',
  80: 'Slight rain showers',
  81: 'Moderate rain showers',
  82: 'Violent rain showers',
  85: 'Slight snow showers',
  86: 'Heavy snow showers',
  95: 'Thunderstorm',
  96: 'Thunderstorm with slight hail',
  99: 'Thunderstorm with heavy hail',
};

export function getWeatherConditionName(code: number): string {
  return WMO_CODE_MAP[code] || 'Clear';
}

/**
 * Checks if a user prompt is asking about weather, and extracts city name if present.
 * Inspects chat history to recognize follow-up locations (e.g. "Delhi").
 */
export function extractWeatherQuery(
  text: string,
  previousMessages?: Array<{ role: string; content: string }>
): WeatherQueryResult {
  if (!text) return { isWeather: false, needsLocation: false };
  const lower = text.toLowerCase().trim();

  // 1. Direct weather keyword match
  const isDirectWeather =
    /\b(weather|temperature|forecast|climate|rain today|snowing|is it cold|is it hot|sunny in)\b/i.test(lower);

  // 2. Multi-turn context check from conversation history
  const lastAssistant = previousMessages && previousMessages.length > 0
    ? [...previousMessages].reverse().find(m => m.role === 'assistant')
    : undefined;
  const lastAssistantText = lastAssistant?.content?.toLowerCase() || '';
  const askedForLocation =
    /\b(which city|which location|what city|provide the location|city or location|location to check)\b/i.test(lastAssistantText);
  const previousWeatherDiscussion =
    previousMessages?.some(m => /\b(weather|forecast|temperature)\b/i.test(m.content?.toLowerCase() || ''));

  // 3. Extract city directly from patterns: "weather in Delhi", "Delhi weather", "forecast for Delhi"
  const inPattern = /(?:weather|temperature|forecast|climate)\s+(?:in|for|at|of)\s+([a-zA-Z\s,]+?)(?:\?|\.|$|\s+(?:today|tomorrow|this week))/i;
  const inMatch = lower.match(inPattern);
  if (inMatch && inMatch[1] && inMatch[1].trim().length > 1) {
    return { isWeather: true, city: inMatch[1].trim(), needsLocation: false };
  }

  const prefixPattern = /^([a-zA-Z\s,]+?)\s+(?:weather|temperature|forecast)(?:\?|\.|$)/i;
  const prefixMatch = lower.match(prefixPattern);
  if (prefixMatch && prefixMatch[1] && prefixMatch[1].trim().length > 1 && prefixMatch[1].length < 35) {
    const candidate = prefixMatch[1].replace(/^(what is|whats|how is|hows|the)\s+/i, '').trim();
    if (candidate) {
      return { isWeather: true, city: candidate, needsLocation: false };
    }
  }

  // 4. Follow-up query answering location prompt: "Delhi", "Delhi, India", "in Delhi"
  if (askedForLocation || previousWeatherDiscussion) {
    const cleanCandidate = lower
      .replace(/^(in|for|at)\s+/i, '')
      .replace(/\s+(please|today|now|thanks)$/i, '')
      .trim();
    if (cleanCandidate.length >= 2 && cleanCandidate.length <= 40 && !/^(hi|hello|hey|no|yes|stop|cancel)$/i.test(cleanCandidate)) {
      return { isWeather: true, city: cleanCandidate, needsLocation: false };
    }
  }

  if (isDirectWeather) {
    return { isWeather: true, needsLocation: true };
  }

  return { isWeather: false, needsLocation: false };
}

/**
 * Fetch real-time weather by city name with bounded retries
 */
export async function fetchWeatherByCity(cityName: string, maxRetries = 1): Promise<WeatherData | null> {
  const cleanCity = cityName.trim();
  if (!cleanCity) return null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      // 1. Try server-side weather proxy endpoint first (safe, caches, no secrets in frontend)
      try {
        const srvRes = await fetch(`/api/weather?city=${encodeURIComponent(cleanCity)}`, {
          signal: AbortSignal.timeout(6000),
          headers: { 'Accept': 'application/json' },
        });
        if (srvRes.ok) {
          const srvData = await srvRes.json();
          if (srvData?.data) {
            return srvData.data as WeatherData;
          }
        }
      } catch (srvErr) {
        // Fall back to direct client geocoding if server proxy unavailable
      }

      // 2. Direct client geocoding via Open-Meteo
      const geoUrl = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(cleanCity)}&count=1&language=en&format=json`;
      const geoRes = await fetch(geoUrl, {
        signal: AbortSignal.timeout(8000),
        headers: { 'Accept': 'application/json' },
      });
      if (!geoRes.ok) throw new Error(`Geocoding HTTP ${geoRes.status}`);
      const geoData = await geoRes.json();

      if (!geoData.results || geoData.results.length === 0) {
        return null;
      }

      const loc = geoData.results[0];
      const weather = await fetchWeatherByCoords(loc.latitude, loc.longitude, loc.name, loc.country);
      if (weather) return weather;
    } catch (err) {
      if (attempt < maxRetries) {
        await new Promise(r => setTimeout(r, 400 * (attempt + 1)));
      } else {
        console.warn('[Weather Service] Failed to fetch weather for city after retries:', cityName, err);
      }
    }
  }

  return null;
}

/**
 * Fetch real-time weather by coordinates
 */
export async function fetchWeatherByCoords(
  latitude: number,
  longitude: number,
  locationName: string = 'Current Location',
  country?: string
): Promise<WeatherData | null> {
  try {
    const forecastUrl = `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current=temperature_2m,relative_humidity_2m,apparent_temperature,is_day,precipitation,weather_code,wind_speed_10m&daily=weather_code,temperature_2m_max,temperature_2m_min&timezone=auto`;
    const res = await fetch(forecastUrl, {
      signal: AbortSignal.timeout(8000),
      headers: { 'Accept': 'application/json' },
    });
    if (!res.ok) return null;
    const data = await res.json();

    const current = data.current;
    if (!current) return null;

    const tempC = Math.round(current.temperature_2m);
    const tempF = Math.round((tempC * 9) / 5 + 32);

    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const forecast: WeatherData['forecast'] = [];

    if (data.daily?.time && Array.isArray(data.daily.time)) {
      for (let i = 0; i < Math.min(5, data.daily.time.length); i++) {
        const date = new Date(data.daily.time[i]);
        const code = data.daily.weather_code?.[i] ?? 0;
        const maxC = Math.round(data.daily.temperature_2m_max?.[i] ?? tempC);
        const minC = Math.round(data.daily.temperature_2m_min?.[i] ?? tempC - 4);
        forecast.push({
          day: i === 0 ? 'Today' : days[date.getDay()],
          weatherCode: code,
          condition: getWeatherConditionName(code),
          maxTemp: maxC,
          minTemp: minC,
          maxTempF: Math.round((maxC * 9) / 5 + 32),
          minTempF: Math.round((minC * 9) / 5 + 32),
        });
      }
    }

    return {
      locationName,
      country,
      latitude,
      longitude,
      temperature: tempC,
      temperatureFahrenheit: tempF,
      apparentTemperature: Math.round(current.apparent_temperature ?? tempC),
      humidity: Math.round(current.relative_humidity_2m ?? 50),
      windSpeed: Math.round(current.wind_speed_10m ?? 10),
      precipitation: current.precipitation ?? 0,
      isDay: Boolean(current.is_day ?? 1),
      weatherCode: current.weather_code ?? 0,
      condition: getWeatherConditionName(current.weather_code ?? 0),
      source: 'Open-Meteo Real-Time Weather API',
      units: {
        temperature: '°C',
        windSpeed: 'km/h',
        humidity: '%',
        precipitation: 'mm',
      },
      forecast,
    };
  } catch (err) {
    console.warn('[Weather Service] Failed to fetch weather for coords:', err);
    return null;
  }
}

/**
 * Formats real weather data into user-facing structured markdown
 */
export function formatWeatherMarkdown(data: WeatherData): string {
  const todayForecast = data.forecast[0];
  const outlook = data.forecast.slice(1);

  let md = `### 🌤️ Weather in ${data.locationName}${data.country ? ', ' + data.country : ''}\n\n`;
  md += `**Current Conditions**:\n`;
  md += `- **Temperature**: ${data.temperature}°C (${data.temperatureFahrenheit}°F)\n`;
  md += `- **Condition**: ${data.condition}\n`;
  md += `- **Feels Like**: ${data.apparentTemperature}°C (${Math.round((data.apparentTemperature * 9) / 5 + 32)}°F)\n`;
  md += `- **Humidity**: ${data.humidity}%\n`;
  md += `- **Wind Speed**: ${data.windSpeed} km/h\n`;
  if (data.precipitation > 0) {
    md += `- **Precipitation**: ${data.precipitation} mm\n`;
  }
  md += `\n`;

  if (todayForecast) {
    md += `**Today's Forecast**:\n`;
    md += `- **High / Low**: ${todayForecast.maxTemp}°C (${todayForecast.maxTempF ?? Math.round((todayForecast.maxTemp * 9) / 5 + 32)}°F) / ${todayForecast.minTemp}°C (${todayForecast.minTempF ?? Math.round((todayForecast.minTemp * 9) / 5 + 32)}°F)\n`;
    md += `- **Expected Conditions**: ${todayForecast.condition}\n\n`;
  }

  if (outlook.length > 0) {
    md += `**5-Day Outlook**:\n`;
    for (const f of outlook) {
      md += `- **${f.day}**: ${f.condition} • High ${f.maxTemp}°C / Low ${f.minTemp}°C\n`;
    }
    md += `\n`;
  }

  md += `*Source: ${data.source}*\n\n`;
  md += `\`\`\`json\n${JSON.stringify({ weather: data }, null, 2)}\n\`\`\``;

  return md;
}
