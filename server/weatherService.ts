/**
 * Server-side weather adapter used by the Vite development API and Gemini agent.
 * Reuses the shared Open-Meteo implementation so the app has one weather source.
 */
import {
  extractWeatherQuery,
  fetchWeatherByCity,
  fetchWeatherByCoords,
  getWeatherConditionName,
  type WeatherData,
} from '../src/lib/weatherService';

export {
  extractWeatherQuery,
  fetchWeatherByCity,
  fetchWeatherByCoords,
  getWeatherConditionName,
};
export type { WeatherData };

export async function fetchServerWeather(
  city: string,
  timeoutMs = 8000,
): Promise<WeatherData | null> {
  const normalizedCity = city.trim();
  if (!normalizedCity) return null;

  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      fetchWeatherByCity(normalizedCity),
      new Promise<null>((resolve) => {
        timeoutId = setTimeout(() => resolve(null), Math.max(1, timeoutMs));
      }),
    ]);
  } catch (error) {
    console.warn('[Server Weather] Weather lookup failed:', error);
    return null;
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

export function formatWeatherResponse(weather: WeatherData): string {
  const forecast = weather.forecast
    .slice(0, 5)
    .map((day) => `- **${day.day}:** ${day.condition}, ${day.minTemp}–${day.maxTemp}°C`)
    .join('\n');

  return [
    `## Weather in ${weather.locationName}${weather.country ? `, ${weather.country}` : ''}`,
    '',
    `- **Current conditions:** ${weather.condition}`,
    `- **Temperature:** ${weather.temperature}°C (${weather.temperatureFahrenheit}°F)`,
    `- **Feels like:** ${weather.apparentTemperature}°C`,
    `- **Humidity:** ${weather.humidity}%`,
    `- **Wind:** ${weather.windSpeed} km/h`,
    `- **Precipitation:** ${weather.precipitation} mm`,
    '',
    forecast ? `### Forecast\n${forecast}` : '',
    '',
    '_Live weather data from Open-Meteo._',
  ].filter(Boolean).join('\n');
}
