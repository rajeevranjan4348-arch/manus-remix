/**
 * Server-Side Real-Time Weather Service
 * 
 * Fetches real weather data using Open-Meteo or configured weather provider secrets.
 * API keys are kept securely on the server and never exposed to the client.
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
 * Checks if a query is asking for weather, and detects location or if location is needed.
 * Inspects conversation history to handle multi-turn flows (e.g. "What's weather today?" -> "Delhi").
 */
export function extractWeatherQuery(
  text: string,
  messages?: Array<{ role: string; content: string }>
): { isWeather: boolean; city?: string; needsLocation: boolean } {
  if (!text) return { isWeather: false, needsLocation: false };
  const lower = text.toLowerCase().trim();

  // 1. Direct weather keyword check
  const isDirectWeather = /\b(weather|temperature|forecast|climate|rain today|snowing|is it cold|is it hot|sunny in)\b/i.test(lower);

  // 2. Context check from previous messages
  const lastAssistant = messages && messages.length > 0
    ? [...messages].reverse().find(m => m.role === 'assistant' || (m as any).role === 'model')
    : undefined;
  const lastAssistantText = lastAssistant?.content?.toLowerCase() || '';
  const askedForLocation = /\b(which city|which location|what city|provide the location|city or location|location to check)\b/i.test(lastAssistantText);
  const previousWeatherDiscussion = messages?.some(m => /\b(weather|forecast|temperature)\b/i.test(m.content?.toLowerCase() || ''));

  // 3. Try extract city from current text: "weather in Delhi", "Delhi weather", "forecast for Delhi"
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

  // 4. Multi-turn follow-up: If asked for location, or context is weather, and current text is a city candidate (e.g. "Delhi", "Delhi, India", "in Delhi")
  if (askedForLocation || previousWeatherDiscussion) {
    const cleanCityCandidate = lower
      .replace(/^(in|for|at)\s+/i, '')
      .replace(/\s+(please|today|now|thanks)$/i, '')
      .trim();
    if (cleanCityCandidate.length >= 2 && cleanCityCandidate.length <= 40 && !/^(hi|hello|hey|no|yes|stop|cancel)$/i.test(cleanCityCandidate)) {
      return { isWeather: true, city: cleanCityCandidate, needsLocation: false };
    }
  }

  if (isDirectWeather) {
    return { isWeather: true, needsLocation: true };
  }

  return { isWeather: false, needsLocation: false };
}

export interface WeatherRetryOptions {
  maxRetries?: number;
  initialDelayMs?: number;
  backoffFactor?: number;
  maxDelayMs?: number;
  timeoutMs?: number;
  onRetry?: (attempt: number, error: any, delayMs: number) => void;
}

/**
 * Checks whether an HTTP status code or Error represents a transient 5xx or timeout error
 * eligible for exponential backoff retries. Client errors (4xx) are never retried.
 */
export function isRetryableWeatherError(statusOrError: number | any): boolean {
  if (typeof statusOrError === 'number') {
    return statusOrError >= 500 && statusOrError <= 599;
  }
  if (!statusOrError) return false;
  const msg = String(statusOrError?.message || statusOrError).toLowerCase();
  const name = String(statusOrError?.name || '').toLowerCase();
  const code = String(statusOrError?.code || '').toLowerCase();

  if (name === 'aborterror' || name === 'timeouterror') return true;
  if (code === 'econnaborted' || code === 'etimedout' || code === 'econnreset' || code === 'enotfound') return true;
  if (msg.includes('timeout') || msg.includes('timed out') || msg.includes('network') || msg.includes('fetch failed')) return true;

  if (statusOrError?.response && typeof statusOrError.response.status === 'number') {
    return statusOrError.response.status >= 500 && statusOrError.response.status <= 599;
  }
  return false;
}

/**
 * Axios interceptor helper for resilient weather data fetching.
 * If Axios is used in the runtime, attaches exponential backoff retries on 5xx & timeouts.
 */
export function setupWeatherAxiosInterceptor(axiosInstance: any, options: WeatherRetryOptions = {}) {
  if (!axiosInstance?.interceptors?.response?.use) return axiosInstance;
  const maxRetries = options.maxRetries ?? 3;
  const initialDelayMs = options.initialDelayMs ?? 250;
  const backoffFactor = options.backoffFactor ?? 2;

  axiosInstance.interceptors.response.use(
    (response: any) => response,
    async (error: any) => {
      const config = error.config;
      if (!config) return Promise.reject(error);

      config.__retryCount = config.__retryCount || 0;
      const status = error.response?.status;
      const shouldRetry = isRetryableWeatherError(status || error);

      if (shouldRetry && config.__retryCount < maxRetries) {
        config.__retryCount += 1;
        const delay = Math.min(initialDelayMs * Math.pow(backoffFactor, config.__retryCount - 1), 3000);
        if (options.onRetry) options.onRetry(config.__retryCount, error, delay);
        await new Promise(res => setTimeout(res, delay));
        return axiosInstance(config);
      }
      return Promise.reject(error);
    }
  );
  return axiosInstance;
}

/**
 * Executes a resilient fetch call with exponential backoff on 5xx status codes and network/timeout errors.
 */
async function resilientFetch(url: string, timeoutMs: number, retryOptions: WeatherRetryOptions = {}): Promise<Response> {
  const maxRetries = retryOptions.maxRetries ?? 3;
  const initialDelayMs = retryOptions.initialDelayMs ?? 200;
  const backoffFactor = retryOptions.backoffFactor ?? 2;
  const maxDelayMs = retryOptions.maxDelayMs ?? 3000;

  let attempt = 0;
  while (true) {
    try {
      const res = await fetch(url, {
        signal: AbortSignal.timeout(timeoutMs),
        headers: { 'Accept': 'application/json' },
      });

      // If server returned 5xx, retry with exponential backoff
      if (res.status >= 500 && res.status <= 599 && attempt < maxRetries) {
        attempt++;
        const delay = Math.min(initialDelayMs * Math.pow(backoffFactor, attempt - 1), maxDelayMs);
        if (retryOptions.onRetry) retryOptions.onRetry(attempt, new Error(`HTTP ${res.status}`), delay);
        console.warn(`[Weather Service] 5xx received (${res.status}), retrying attempt ${attempt}/${maxRetries} after ${delay}ms...`);
        await new Promise(r => setTimeout(r, delay));
        continue;
      }

      return res;
    } catch (err: any) {
      if (isRetryableWeatherError(err) && attempt < maxRetries) {
        attempt++;
        const delay = Math.min(initialDelayMs * Math.pow(backoffFactor, attempt - 1), maxDelayMs);
        if (retryOptions.onRetry) retryOptions.onRetry(attempt, err, delay);
        console.warn(`[Weather Service] Timeout/network error, retrying attempt ${attempt}/${maxRetries} after ${delay}ms:`, err?.message || err);
        await new Promise(r => setTimeout(r, delay));
        continue;
      }
      throw err;
    }
  }
}

/**
 * Geocodes city name to latitude and longitude
 */
export async function geocodeCity(
  cityName: string,
  timeoutMs = 8000,
  retryOptions?: WeatherRetryOptions
): Promise<{ name: string; country?: string; latitude: number; longitude: number } | null> {
  const clean = cityName.trim();
  if (!clean) return null;

  try {
    const geoUrl = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(clean)}&count=1&language=en&format=json`;
    const res = await resilientFetch(geoUrl, timeoutMs, retryOptions);

    if (!res.ok) return null;
    const data = await res.json();
    if (!data.results || data.results.length === 0) return null;

    const loc = data.results[0];
    return {
      name: loc.name,
      country: loc.country,
      latitude: loc.latitude,
      longitude: loc.longitude,
    };
  } catch (err) {
    console.warn('[Server Weather] Geocoding notice:', err);
    return null;
  }
}

/**
 * Wrapper function for fetchServerWeather that implements exponential backoff retries for 5xx and timeout errors.
 */
export async function fetchServerWeatherWithRetry(
  cityName: string,
  options: WeatherRetryOptions = {}
): Promise<WeatherData | null> {
  const timeoutMs = options.timeoutMs ?? 8000;
  return fetchServerWeather(cityName, timeoutMs, options);
}

/**
 * Fetches real weather and forecast from weather provider with built-in resilient exponential backoff.
 */
export async function fetchServerWeather(
  cityName: string,
  timeoutMs = 8000,
  retryOptions?: WeatherRetryOptions
): Promise<WeatherData | null> {
  const cleanCity = cityName.trim();
  if (!cleanCity) return null;

  const geo = await geocodeCity(cleanCity, timeoutMs, retryOptions);
  if (!geo) return null;

  try {
    const forecastUrl = `https://api.open-meteo.com/v1/forecast?latitude=${geo.latitude}&longitude=${geo.longitude}&current=temperature_2m,relative_humidity_2m,apparent_temperature,is_day,precipitation,weather_code,wind_speed_10m&daily=weather_code,temperature_2m_max,temperature_2m_min&timezone=auto`;
    const res = await resilientFetch(forecastUrl, timeoutMs, retryOptions);

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
      locationName: geo.name,
      country: geo.country,
      latitude: geo.latitude,
      longitude: geo.longitude,
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
    console.warn('[Server Weather] Forecast fetch notice:', err);
    return null;
  }
}

/**
 * Format real weather data into user-facing structured markdown
 */
export function formatWeatherResponse(data: WeatherData): string {
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
