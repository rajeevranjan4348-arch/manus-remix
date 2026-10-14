import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  extractWeatherQuery,
  fetchWeatherByCoords,
  fetchWeatherByCity,
  formatWeatherMarkdown,
  getWeatherConditionName,
  WeatherData,
} from '../src/lib/weatherService';
import {
  geocodeCity,
  fetchServerWeather,
  fetchServerWeatherWithRetry,
  formatWeatherResponse,
  isRetryableWeatherError,
  setupWeatherAxiosInterceptor,
} from '../server/weatherService';
import { StreamingCircuitBreaker } from '../server/circuitBreaker';
import { reliableResponseEngine } from '../src/lib/reliableResponseEngine';

describe('Weather Tool Calling & Lifecycle Test Suite', () => {
  describe('1. Weather Intent & Multi-Turn Location Extraction', () => {
    it('detects weather intent without location and requests location ("What\'s weather today?")', () => {
      const result = extractWeatherQuery("What's weather today?");
      expect(result.isWeather).toBe(true);
      expect(result.needsLocation).toBe(true);
      expect(result.city).toBeUndefined();
    });

    it('extracts "Delhi" when asked directly ("weather in Delhi")', () => {
      const result = extractWeatherQuery('weather in Delhi');
      expect(result.isWeather).toBe(true);
      expect(result.needsLocation).toBe(false);
      expect(result.city?.toLowerCase()).toBe('delhi');
    });

    it('extracts "Delhi" from prefix pattern ("Delhi weather")', () => {
      const result = extractWeatherQuery('Delhi weather');
      expect(result.isWeather).toBe(true);
      expect(result.needsLocation).toBe(false);
      expect(result.city?.toLowerCase()).toBe('delhi');
    });

    it('extracts "Delhi" from multi-turn context when assistant previously asked for location', () => {
      const previousMessages = [
        { role: 'user', content: "What's weather today?" },
        { role: 'assistant', content: 'Which city or location would you like to check the weather for? (e.g., Delhi, New York, London, Tokyo)' },
      ];

      const result = extractWeatherQuery('Delhi', previousMessages);
      expect(result.isWeather).toBe(true);
      expect(result.needsLocation).toBe(false);
      expect(result.city?.toLowerCase()).toBe('delhi');
    });

    it('extracts "Delhi, India" from conversational context', () => {
      const previousMessages = [
        { role: 'user', content: "What's the weather?" },
        { role: 'assistant', content: 'Which location to check?' },
      ];

      const result = extractWeatherQuery('Delhi, India', previousMessages);
      expect(result.isWeather).toBe(true);
      expect(result.needsLocation).toBe(false);
      expect(result.city?.toLowerCase()).toBe('delhi, india');
    });

    it('does not classify non-weather queries as weather', () => {
      expect(extractWeatherQuery('Write a React component').isWeather).toBe(false);
      expect(extractWeatherQuery('Hello how are you?').isWeather).toBe(false);
      expect(extractWeatherQuery('Calculate 42 * 9').isWeather).toBe(false);
    });
  });

  describe('2. Real Weather Data Structure & Formatting', () => {
    it('maps WMO codes to clear condition names', () => {
      expect(getWeatherConditionName(0)).toBe('Clear sky');
      expect(getWeatherConditionName(2)).toBe('Partly cloudy');
      expect(getWeatherConditionName(61)).toBe('Slight rain');
      expect(getWeatherConditionName(95)).toBe('Thunderstorm');
    });

    it('builds real weather data object with full metrics, forecast, units, and attribution', async () => {
      // Mock global fetch for coordinates to simulate reliable real weather provider response
      const mockForecastResponse = {
        current: {
          temperature_2m: 28.4,
          relative_humidity_2m: 48,
          apparent_temperature: 29.1,
          is_day: 1,
          precipitation: 0,
          weather_code: 0,
          wind_speed_10m: 11.5,
        },
        daily: {
          time: ['2026-10-14', '2026-10-15', '2026-10-16', '2026-10-17', '2026-10-18'],
          weather_code: [0, 1, 2, 61, 0],
          temperature_2m_max: [32.1, 33.0, 31.5, 27.8, 30.2],
          temperature_2m_min: [20.0, 21.2, 19.8, 18.5, 19.0],
        },
      };

      const originalFetch = global.fetch;
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => mockForecastResponse,
      } as any);

      try {
        const weather = await fetchWeatherByCoords(28.6139, 77.2090, 'Delhi', 'India');
        expect(weather).not.toBeNull();
        if (weather) {
          expect(weather.locationName).toBe('Delhi');
          expect(weather.country).toBe('India');
          expect(weather.temperature).toBe(28);
          expect(weather.temperatureFahrenheit).toBe(82);
          expect(weather.apparentTemperature).toBe(29);
          expect(weather.humidity).toBe(48);
          expect(weather.windSpeed).toBe(12);
          expect(weather.condition).toBe('Clear sky');
          expect(weather.source).toContain('Open-Meteo');
          expect(weather.units.temperature).toBe('°C');
          expect(weather.units.windSpeed).toBe('km/h');
          expect(weather.units.humidity).toBe('%');

          // Forecast verification
          expect(weather.forecast.length).toBe(5);
          expect(weather.forecast[0].day).toBe('Today');
          expect(weather.forecast[0].maxTemp).toBe(32);
          expect(weather.forecast[0].minTemp).toBe(20);
        }
      } finally {
        global.fetch = originalFetch;
      }
    });

    it('formats weather data into markdown containing metrics, forecast, units, attribution and json block', () => {
      const sampleData: WeatherData = {
        locationName: 'Delhi',
        country: 'India',
        latitude: 28.6139,
        longitude: 77.2090,
        temperature: 28,
        temperatureFahrenheit: 82,
        apparentTemperature: 29,
        humidity: 45,
        windSpeed: 12,
        precipitation: 0,
        isDay: true,
        weatherCode: 0,
        condition: 'Clear sky',
        source: 'Open-Meteo Real-Time Weather API',
        units: {
          temperature: '°C',
          windSpeed: 'km/h',
          humidity: '%',
          precipitation: 'mm',
        },
        forecast: [
          { day: 'Today', weatherCode: 0, condition: 'Clear sky', maxTemp: 32, minTemp: 20 },
          { day: 'Wed', weatherCode: 1, condition: 'Mainly clear', maxTemp: 33, minTemp: 21 },
        ],
      };

      const md = formatWeatherMarkdown(sampleData);
      expect(md).toContain('Weather in Delhi, India');
      expect(md).toContain('28°C (82°F)');
      expect(md).toContain('Clear sky');
      expect(md).toContain('Feels Like');
      expect(md).toContain('Humidity');
      expect(md).toContain('45%');
      expect(md).toContain('Wind Speed');
      expect(md).toContain('12 km/h');
      expect(md).toContain("Today's Forecast");
      expect(md).toContain('Source: Open-Meteo Real-Time Weather API');
      expect(md).toContain('```json');
      expect(md).toContain('"weather"');
    });
  });

  describe('3. Error Handling, Bounded Retries & Timeouts', () => {
    it('stops retrying after bounded retries on persistent network error', async () => {
      const originalFetch = global.fetch;
      let callCount = 0;
      global.fetch = vi.fn().mockImplementation(() => {
        callCount++;
        return Promise.reject(new Error('Network offline'));
      });

      try {
        const result = await fetchWeatherByCity('Delhi', 1);
        expect(result).toBeNull();
        // Initial attempt + 1 retry = 2 attempts * 2 calls = 4 calls max
        expect(callCount).toBeLessThanOrEqual(4);
      } finally {
        global.fetch = originalFetch;
      }
    });

    it('server weather handles unknown city without throwing', async () => {
      const originalFetch = global.fetch;
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ results: [] }),
      } as any);

      try {
        const result = await fetchServerWeather('NonExistentCityName123456');
        expect(result).toBeNull();
      } finally {
        global.fetch = originalFetch;
      }
    });

    it('identifies 5xx status and network/timeout errors as retryable, ignoring 4xx', () => {
      expect(isRetryableWeatherError(500)).toBe(true);
      expect(isRetryableWeatherError(502)).toBe(true);
      expect(isRetryableWeatherError(503)).toBe(true);
      expect(isRetryableWeatherError(504)).toBe(true);

      expect(isRetryableWeatherError(400)).toBe(false);
      expect(isRetryableWeatherError(404)).toBe(false);
      expect(isRetryableWeatherError(200)).toBe(false);

      expect(isRetryableWeatherError(new Error('signal timed out'))).toBe(true);
      expect(isRetryableWeatherError({ name: 'AbortError', message: 'The operation was aborted' })).toBe(true);
      expect(isRetryableWeatherError({ name: 'TimeoutError', message: 'Connection timed out' })).toBe(true);
      expect(isRetryableWeatherError({ response: { status: 503 } })).toBe(true);
      expect(isRetryableWeatherError({ response: { status: 404 } })).toBe(false);
    });

    it('wrapper function fetchServerWeatherWithRetry performs exponential backoff on 5xx and recovers', async () => {
      const originalFetch = global.fetch;
      let callCount = 0;
      const retryDelays: number[] = [];

      global.fetch = vi.fn().mockImplementation((url: string) => {
        callCount++;
        // First 2 calls fail with HTTP 503
        if (callCount <= 2) {
          return Promise.resolve({
            ok: false,
            status: 503,
            json: async () => ({ error: 'Service Unavailable' }),
          });
        }
        // Then geocoding succeeds
        if (url.includes('geocoding-api')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({
              results: [{ name: 'Delhi', country: 'India', latitude: 28.6139, longitude: 77.2090 }],
            }),
          });
        }
        // Then forecast succeeds
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({
            current: {
              temperature_2m: 29.0,
              relative_humidity_2m: 52,
              apparent_temperature: 30.1,
              is_day: 1,
              precipitation: 0,
              weather_code: 0,
              wind_speed_10m: 12.0,
            },
            daily: {
              time: ['2026-10-14'],
              weather_code: [0],
              temperature_2m_max: [33],
              temperature_2m_min: [21],
            },
          }),
        });
      });

      try {
        const data = await fetchServerWeatherWithRetry('Delhi', {
          maxRetries: 3,
          initialDelayMs: 10, // Fast test delay
          backoffFactor: 2,
          onRetry: (_attempt, _err, delayMs) => {
            retryDelays.push(delayMs);
          },
        });

        expect(data).not.toBeNull();
        expect(data?.locationName).toBe('Delhi');
        expect(data?.temperature).toBe(29);
        expect(retryDelays.length).toBe(2);
        // Exponential backoff check: second delay >= first delay
        expect(retryDelays[1]).toBeGreaterThanOrEqual(retryDelays[0] * 2);
      } finally {
        global.fetch = originalFetch;
      }
    });

    it('setupWeatherAxiosInterceptor adds response interceptor for 5xx backoff retries', async () => {
      let interceptorRegistered = false;
      let registeredErrorHandler: any = null;

      const mockAxios: any = {
        interceptors: {
          response: {
            use: vi.fn((successFn, errorFn) => {
              interceptorRegistered = true;
              registeredErrorHandler = errorFn;
            }),
          },
        },
      };

      setupWeatherAxiosInterceptor(mockAxios, { maxRetries: 2, initialDelayMs: 5 });
      expect(interceptorRegistered).toBe(true);
      expect(typeof registeredErrorHandler).toBe('function');
    });
  });

  describe('4. Loading State & Request Deduplication', () => {
    it('creates request fences and blocks duplicate active submissions', () => {
      const reqId = reliableResponseEngine.createRequestFence('task_test_123');
      expect(reliableResponseEngine.isRequestActive(reqId)).toBe(true);

      // Finalizing request releases the fence
      const finalized = reliableResponseEngine.finalizeRequest(reqId);
      expect(finalized.finalized).toBe(true);
      expect(reliableResponseEngine.isRequestActive(reqId)).toBe(false);

      // Subsequent finalization attempt is rejected cleanly (no double finish)
      const secondAttempt = reliableResponseEngine.finalizeRequest(reqId);
      expect(secondAttempt.finalized).toBe(false);
    });
  });

  describe('5. Circuit Breaker Pattern & Actionable Error Messages', () => {
    it('starts in CLOSED state, allows attempts, and records successes', () => {
      const cb = new StreamingCircuitBreaker({ failureThreshold: 3, resetTimeoutMs: 1000 });
      expect(cb.getState()).toBe('CLOSED');
      expect(cb.canAttempt()).toBe(true);

      cb.recordSuccess();
      expect(cb.getState()).toBe('CLOSED');
      expect(cb.canAttempt()).toBe(true);
    });

    it('trips from CLOSED to OPEN after reaching failureThreshold', () => {
      const cb = new StreamingCircuitBreaker({ failureThreshold: 3, resetTimeoutMs: 1000 });
      cb.recordFailure(new Error('Connection failed 1'));
      expect(cb.getState()).toBe('CLOSED');
      expect(cb.canAttempt()).toBe(true);

      cb.recordFailure(new Error('Connection failed 2'));
      expect(cb.getState()).toBe('CLOSED');
      expect(cb.canAttempt()).toBe(true);

      cb.recordFailure(new Error('Connection failed 3'));
      expect(cb.getState()).toBe('OPEN');
      expect(cb.canAttempt()).toBe(false);
    });

    it('formats actionable error messages for rate limits, timeouts, auth, and tripped circuit', () => {
      const cb = new StreamingCircuitBreaker({ failureThreshold: 2, resetTimeoutMs: 10000 });

      // Rate limit
      const rateLimitMsg = cb.formatActionableErrorMessage({ status: 429, message: 'Resource exhausted' });
      expect(rateLimitMsg).toContain('Rate Limit Exceeded');
      expect(rateLimitMsg).toContain('Retry Request');

      // Timeout
      const timeoutMsg = cb.formatActionableErrorMessage(new Error('Request deadline exceeded (timeout)'));
      expect(timeoutMsg).toContain('AI Response Timed Out');
      expect(timeoutMsg).toContain('Retry Request');

      // Auth error
      const authMsg = cb.formatActionableErrorMessage({ status: 401, message: 'API key not valid' });
      expect(authMsg).toContain('Authentication Error');
      expect(authMsg).toContain('GEMINI_API_KEY');

      // Tripped circuit message
      cb.recordFailure();
      cb.recordFailure();
      expect(cb.getState()).toBe('OPEN');
      const openCircuitMsg = cb.formatActionableErrorMessage();
      expect(openCircuitMsg).toContain('Circuit Breaker Tripped');
      expect(openCircuitMsg).toContain('Actionable Steps');
      expect(openCircuitMsg).toContain('Auto-Recovery');
    });

    it('transitions to HALF_OPEN after resetTimeout passes', async () => {
      const cb = new StreamingCircuitBreaker({ failureThreshold: 1, resetTimeoutMs: 50 });
      cb.recordFailure();
      expect(cb.getState()).toBe('OPEN');
      expect(cb.canAttempt()).toBe(false);

      await new Promise(r => setTimeout(r, 60));
      expect(cb.getState()).toBe('HALF_OPEN');
      expect(cb.canAttempt()).toBe(true);

      // Successful trial restores circuit to CLOSED
      cb.recordSuccess();
      expect(cb.getState()).toBe('CLOSED');
      expect(cb.canAttempt()).toBe(true);
    });
  });
});
