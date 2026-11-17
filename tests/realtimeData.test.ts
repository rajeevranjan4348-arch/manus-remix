import { describe, expect, it } from 'vitest';
import {
  buildRealtimeTemporalSystemBlock,
  detectCryptoQuery,
  detectCurrencyQuery,
  detectWeatherCity,
  getLiveTemporalContext,
  isRealtimeOrLiveFactQuery,
} from '../server/realtimeDataService';
import { generateResilientResponse, needsLiveSearch } from '../server/geminiService';

describe('Real-Time Data & Live Information Service', () => {
  it('computes accurate live temporal context with UTC, IST, and world clocks', () => {
    const fixedDate = new Date('2026-11-01T14:30:00.000Z');
    const ctx = getLiveTemporalContext(fixedDate);

    expect(ctx.isoUtc).toBe('2026-11-01T14:30:00.000Z');
    expect(ctx.unixMs).toBe(fixedDate.getTime());
    expect(ctx.dayOfWeek).toBe('Sunday');
    expect(ctx.istFormatted).toBeTruthy();
    expect(ctx.utcFormatted).toBeTruthy();
    expect(ctx.worldClocks.newYorkEst).toBeTruthy();
    expect(ctx.worldClocks.londonGmt).toBeTruthy();
    expect(ctx.worldClocks.newDelhiIst).toBeTruthy();
    expect(ctx.worldClocks.tokyoJst).toBeTruthy();
  });

  it('builds a system instruction temporal context block', () => {
    const fixedDate = new Date('2026-11-01T14:30:00.000Z');
    const block = buildRealtimeTemporalSystemBlock(fixedDate);
    expect(block).toContain('[VERIFIED REAL-TIME CLOCK & TEMPORAL CONTEXT]');
    expect(block).toContain('2026-11-01T14:30:00.000Z');
    expect(block).toContain('World Clocks:');
  });

  it('detects weather queries and extracts city names', () => {
    expect(detectWeatherCity('What is the weather in Tokyo today?')).toEqual({
      wantsWeather: true,
      city: 'Tokyo',
    });
    expect(detectWeatherCity('current temperature in New Delhi')).toEqual({
      wantsWeather: true,
      city: 'New Delhi',
    });
    expect(detectWeatherCity('weather forecast right now')).toEqual({
      wantsWeather: true,
      city: 'New Delhi',
    });
    expect(detectWeatherCity('How to write a React hook')).toEqual({
      wantsWeather: false,
    });
  });

  it('detects currency exchange rate queries and amounts', () => {
    expect(detectCurrencyQuery('Convert 250 USD to INR')).toEqual({
      wantsCurrency: true,
      base: 'USD',
      target: 'INR',
      amount: 250,
    });
    expect(detectCurrencyQuery('What is the exchange rate for EUR to GBP?')).toEqual({
      wantsCurrency: true,
      base: 'EUR',
      target: 'GBP',
      amount: 1,
    });
    expect(detectCurrencyQuery('dollar to rupee exchange rate today')).toEqual({
      wantsCurrency: true,
      base: 'USD',
      target: 'INR',
      amount: 1,
    });
    expect(detectCurrencyQuery('Write a Python function').wantsCurrency).toBe(false);
  });

  it('detects cryptocurrency queries', () => {
    expect(detectCryptoQuery('What is the Bitcoin price right now?')).toBe(true);
    expect(detectCryptoQuery('ETH and SOL price today')).toBe(true);
    expect(detectCryptoQuery('Hello how are you')).toBe(false);
  });

  it('correctly classifies live/real-time queries while keeping greetings and model identity off live search', () => {
    expect(isRealtimeOrLiveFactQuery('Hello there!')).toBe(false);
    expect(isRealtimeOrLiveFactQuery('Which model are you?')).toBe(false);
    expect(needsLiveSearch('Which model are you')).toBe(false);

    expect(isRealtimeOrLiveFactQuery('What is the current weather in Mumbai?')).toBe(true);
    expect(isRealtimeOrLiveFactQuery('Bitcoin price today')).toBe(true);
    expect(isRealtimeOrLiveFactQuery('Latest tech news today')).toBe(true);
    expect(isRealtimeOrLiveFactQuery('USD to INR exchange rate')).toBe(true);
    expect(needsLiveSearch('What time is it right now?')).toBe(true);
  });

  it('provides live time and date in generateResilientResponse for temporal questions', () => {
    const answer = generateResilientResponse('What time is it right now?');
    expect(answer).toContain('Live Real-Time Date & Clock');
    expect(answer).toContain('India Standard Time (IST):');
    expect(answer).toContain('UTC Time:');
    expect(answer).toContain('Global World Clocks');
  });
});
