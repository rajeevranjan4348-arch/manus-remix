/**
 * Real-Time Weather Service
 * Uses Open-Meteo public APIs (Worldwide coverage, live satellite/model data, no API key required).
 */

export interface WeatherData {
  locationName: string;
  country?: string;
  latitude: number;
  longitude: number;
  temperature: number; // Celsius
  temperatureFahrenheit: number;
  apparentTemperature: number;
  humidity: number;
  windSpeed: number; // km/h
  precipitation: number;
  isDay: boolean;
  weatherCode: number;
  condition: string;
  forecast: {
    day: string;
    weatherCode: number;
    condition: string;
    maxTemp: number;
    minTemp: number;
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
 * Fetch real-time weather by city name
 */
export async function fetchWeatherByCity(cityName: string): Promise<WeatherData | null> {
  try {
    const cleanCity = cityName.trim();
    if (!cleanCity) return null;

    // 1. Geocode city name
    const geoUrl = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(cleanCity)}&count=1&language=en&format=json`;
    const geoRes = await fetch(geoUrl);
    if (!geoRes.ok) return null;
    const geoData = await geoRes.json();

    if (!geoData.results || geoData.results.length === 0) {
      return null;
    }

    const loc = geoData.results[0];
    return fetchWeatherByCoords(loc.latitude, loc.longitude, loc.name, loc.country);
  } catch (err) {
    console.warn('[Weather Service] Failed to fetch weather for city:', cityName, err);
    return null;
  }
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
    const res = await fetch(forecastUrl);
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
        forecast.push({
          day: i === 0 ? 'Today' : days[date.getDay()],
          weatherCode: code,
          condition: getWeatherConditionName(code),
          maxTemp: Math.round(data.daily.temperature_2m_max?.[i] ?? tempC),
          minTemp: Math.round(data.daily.temperature_2m_min?.[i] ?? tempC - 4),
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
      forecast,
    };
  } catch (err) {
    console.warn('[Weather Service] Failed to fetch weather for coords:', err);
    return null;
  }
}

/**
 * Checks if a user prompt is asking about weather, and extracts city name if present
 */
export function extractWeatherQuery(text: string): { isWeather: boolean; city?: string } {
  if (!text) return { isWeather: false };
  const lower = text.toLowerCase();

  const isWeatherMatch =
    /\b(weather|temperature|forecast|climate|rain today|snowing|is it cold|is it hot|sunny in)\b/i.test(lower);

  if (!isWeatherMatch) return { isWeather: false };

  // Try extracting city: "weather in Tokyo", "what's the weather for London", "Paris weather"
  const inPattern = /(?:weather|temperature|forecast|climate)\s+(?:in|for|at|of)\s+([a-zA-Z\s,]+?)(?:\?|\.|$|\s+(?:today|tomorrow|this week))/i;
  const match = lower.match(inPattern);

  if (match && match[1]) {
    return { isWeather: true, city: match[1].trim() };
  }

  const prefixPattern = /([a-zA-Z\s]+?)\s+(?:weather|temperature|forecast)(?:\?|\.|$)/i;
  const prefixMatch = lower.match(prefixPattern);
  if (prefixMatch && prefixMatch[1] && prefixMatch[1].length < 30) {
    const candidate = prefixMatch[1].replace(/^(what is|whats|how is|hows|the)\s+/i, '').trim();
    if (candidate) {
      return { isWeather: true, city: candidate };
    }
  }

  return { isWeather: true };
}
