import { describe, it, expect, beforeEach, vi } from 'vitest';
import { extractWeatherQuery, fetchWeatherByCity, getWeatherConditionName } from '../lib/weatherService';
import {
  saveChatHistoryToLocalStorage,
  getChatHistoryFromLocalStorage,
  clearChatHistoryBackup,
} from '../lib/chatAutoSave';

describe('Weather Service Tests', () => {
  it('should correctly extract weather intent and city from queries', () => {
    const res1 = extractWeatherQuery('What is the weather in Delhi?');
    expect(res1.isWeather).toBe(true);
    expect(res1.city?.toLowerCase()).toBe('delhi');

    const res2 = extractWeatherQuery("What's weather today?");
    expect(res2.isWeather).toBe(true);
    expect(res2.city).toBeUndefined();
  });

  it('should handle follow-up city responses like Delhi', () => {
    const recentMessages = [
      { role: 'user', content: "What's weather today?" },
      { role: 'assistant', content: 'Which city or location would you like to check the weather for?' },
    ];
    const res = extractWeatherQuery('Delhi', recentMessages);
    expect(res.isWeather).toBe(true);
    expect(res.city?.toLowerCase()).toBe('delhi');
  });

  it('should map WMO weather codes to human-readable condition names', () => {
    expect(getWeatherConditionName(0)).toBe('Clear sky');
    expect(getWeatherConditionName(3)).toBe('Overcast');
    expect(getWeatherConditionName(61)).toBe('Slight rain');
    expect(getWeatherConditionName(95)).toBe('Thunderstorm');
  });

  it('should fetch real weather data for Delhi', async () => {
    const data = await fetchWeatherByCity('Delhi');
    expect(data).not.toBeNull();
    if (data) {
      expect(data.locationName.toLowerCase()).toContain('delhi');
      expect(data.temperature).toBeDefined();
      expect(data.condition).toBeDefined();
      expect(data.forecast.length).toBeGreaterThan(0);
    }
  });
});

describe('Chat History Auto-Save Tests', () => {
  const storageMap = new Map<string, string>();
  const mockLocalStorage = {
    getItem: (key: string) => storageMap.get(key) ?? null,
    setItem: (key: string, value: string) => storageMap.set(key, value),
    removeItem: (key: string) => storageMap.delete(key),
    clear: () => storageMap.clear(),
    get length() { return storageMap.size; },
    key: (index: number) => Array.from(storageMap.keys())[index] ?? null,
  };

  beforeEach(() => {
    storageMap.clear();
    vi.stubGlobal('localStorage', mockLocalStorage);
    vi.stubGlobal('window', { localStorage: mockLocalStorage });
  });

  it('should save and retrieve chat history from localStorage', () => {
    const taskId = 'task_test_123';
    const messages = [
      { id: '1', role: 'user', content: "What's weather in Delhi?" },
      { id: '2', role: 'assistant', content: 'The weather in Delhi is 28°C and clear.' },
    ];

    const saved = saveChatHistoryToLocalStorage({
      taskId,
      currentTask: { prompt: "What's weather in Delhi?", options: {} },
      messages,
      taskStatus: 'completed',
    });

    expect(saved).toBe(true);

    const retrieved = getChatHistoryFromLocalStorage(taskId);
    expect(retrieved).not.toBeNull();
    expect(retrieved?.messages.length).toBe(2);
    expect(retrieved?.messages[0].content).toBe("What's weather in Delhi?");
  });

  it('should clear backup correctly', () => {
    const taskId = 'task_test_456';
    saveChatHistoryToLocalStorage({
      taskId,
      currentTask: { prompt: 'Test', options: {} },
      messages: [{ id: '1', role: 'user', content: 'Test' }],
    });

    clearChatHistoryBackup(taskId);
    const retrieved = getChatHistoryFromLocalStorage(taskId);
    expect(retrieved).toBeNull();
  });
});
