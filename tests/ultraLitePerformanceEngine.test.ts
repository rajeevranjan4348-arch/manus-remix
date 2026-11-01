import { describe, it, expect, beforeEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import {
  detectDevicePerformanceProfile,
  getActivePerformanceProfile,
  setPerformanceProfileConfiguration,
  getVirtualizationBudget,
  BoundedLRUCache,
  trimAllManagedCaches,
  clearAllManagedCaches,
  createManagedObjectUrl,
  revokeManagedObjectUrl,
  revokeAllManagedObjectUrls,
  createAdaptiveStreamBatcher,
  deduplicateInFlightRequest,
  scheduleDebouncedStorageWrite,
  flushPendingStorageWrites,
  loadAIProviderIntegrationOnDemand,
  getLoadedAIProviderCount,
  measurePerformanceSnapshot,
  runUltraLiteBenchmark,
} from '../src/lib/performanceEngine';
import {
  useUltraLiteImage,
  resolveUltraLiteImageSync,
  downscaleRemoteImageUrl,
  createLowMemoryPlaceholderDataUrl,
} from '../src/hooks/useUltraLiteImage';

// Setup lightweight browser globals for Node test environment
const mockStorageMap = new Map<string, string>();
const mockLocalStorage: Storage = {
  getItem: (key: string) => mockStorageMap.get(key) ?? null,
  setItem: (key: string, value: string) => {
    mockStorageMap.set(key, String(value));
  },
  removeItem: (key: string) => {
    mockStorageMap.delete(key);
  },
  clear: () => {
    mockStorageMap.clear();
  },
  key: (index: number) => Array.from(mockStorageMap.keys())[index] ?? null,
  get length() {
    return mockStorageMap.size;
  },
};

if (typeof (globalThis as any).localStorage === 'undefined') {
  (globalThis as any).localStorage = mockLocalStorage;
}

if (typeof (globalThis as any).document === 'undefined') {
  (globalThis as any).document = {
    documentElement: {
      dataset: {} as Record<string, string>,
      style: {},
    },
    head: {
      appendChild: () => {},
    },
    createElement: () => ({
      setAttribute: () => {},
      appendChild: () => {},
      style: {},
    }),
    createTextNode: () => ({}),
    getElementsByTagName: () => ({ length: 48 }),
    querySelectorAll: () => [],
    addEventListener: () => {},
    removeEventListener: () => {},
  };
}

if (typeof (globalThis as any).window === 'undefined') {
  const listeners = new Map<string, Set<Function>>();
  (globalThis as any).window = {
    fetch: typeof globalThis.fetch === 'function' ? globalThis.fetch.bind(globalThis) : async () => new Response(),
    localStorage: mockLocalStorage,
    location: { origin: 'http://localhost:3000', pathname: '/', hostname: 'localhost' },
    addEventListener: (type: string, cb: Function) => {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)!.add(cb);
    },
    removeEventListener: (type: string, cb: Function) => {
      listeners.get(type)?.delete(cb);
    },
    dispatchEvent: (event: any) => {
      const set = listeners.get(event?.type);
      if (set) {
        set.forEach((fn) => fn(event));
      }
      return true;
    },
    setTimeout: globalThis.setTimeout.bind(globalThis),
    clearTimeout: globalThis.clearTimeout.bind(globalThis),
  };
}

if (typeof (globalThis as any).CustomEvent === 'undefined') {
  (globalThis as any).CustomEvent = class CustomEvent {
    type: string;
    detail: any;
    constructor(type: string, params?: { detail?: any }) {
      this.type = type;
      this.detail = params?.detail;
    }
  };
}

describe('Ultra-Lite Performance Engine (2GB RAM Android Target)', () => {
  beforeEach(() => {
    if (typeof (globalThis as any).document !== 'undefined') {
      if (!(globalThis as any).document.documentElement) {
        (globalThis as any).document.documentElement = { dataset: {}, style: {} };
      } else {
        if (!(globalThis as any).document.documentElement.dataset) {
          (globalThis as any).document.documentElement.dataset = {};
        }
        if (!(globalThis as any).document.documentElement.style) {
          (globalThis as any).document.documentElement.style = {};
        }
      }
      if (typeof (globalThis as any).document.getElementsByTagName !== 'function') {
        (globalThis as any).document.getElementsByTagName = () => ({ length: 48 });
      }
    }
    mockStorageMap.clear();
    clearAllManagedCaches();
    revokeAllManagedObjectUrls();
    setPerformanceProfileConfiguration({
      ultraLiteMode: true,
      performanceProfile: 'ultra-lite',
    });
  });

  it('detects 2GB RAM Android devices as ultra-lite profile automatically', () => {
    const profile2GBAndroid = detectDevicePerformanceProfile({
      deviceMemory: 2,
      hardwareConcurrency: 4,
      userAgent: 'Mozilla/5.0 (Linux; Android 13; SM-A042F) AppleWebKit/537.36 Chrome/120.0.0.0 Mobile Safari/537.36',
    });
    expect(profile2GBAndroid.detectedProfile).toBe('ultra-lite');
    expect(profile2GBAndroid.isAndroid).toBe(true);
    expect(profile2GBAndroid.isLowEndAndroid).toBe(true);

    const profileLowCores = detectDevicePerformanceProfile({
      deviceMemory: 3,
      hardwareConcurrency: 4,
      userAgent: 'Mozilla/5.0 (Linux; Android 12; Redmi 10A)',
    });
    expect(profileLowCores.detectedProfile).toBe('ultra-lite');

    const profileHighEndDesktop = detectDevicePerformanceProfile({
      deviceMemory: 16,
      hardwareConcurrency: 12,
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0)',
    });
    expect(profileHighEndDesktop.detectedProfile).toBe('balanced');
  });

  it('supports manual Ultra-Lite mode toggle and applies data-perf-mode attribute to DOM', () => {
    setPerformanceProfileConfiguration({
      ultraLiteMode: false,
      performanceProfile: 'balanced',
    });
    expect(getActivePerformanceProfile()).toBe('balanced');
    expect(document.documentElement.dataset.perfMode).toBe('balanced');

    setPerformanceProfileConfiguration({
      ultraLiteMode: true,
      performanceProfile: 'auto',
    });
    expect(getActivePerformanceProfile()).toBe('ultra-lite');
    expect(document.documentElement.dataset.perfMode).toBe('ultra-lite');

    const budget = getVirtualizationBudget('ultra-lite');
    expect(budget.overscanTopPx).toBe(96);
    expect(budget.overscanBottomPx).toBe(128);
    expect(budget.maxRenderedMessagesWindow).toBeLessThanOrEqual(60);
    expect(budget.disableBackdropBlur).toBe(true);
    expect(budget.pauseDecorativeAnimations).toBe(true);
  });

  it('enforces strict BoundedLRUCache capacity, eviction, and global cache trimming', () => {
    const cache = new BoundedLRUCache<string, number>({ maxSize: 4, ttlMs: 60_000 });
    cache.set('a', 1);
    cache.set('b', 2);
    cache.set('c', 3);
    cache.set('d', 4);
    // Access 'a' so 'b' becomes oldest
    expect(cache.get('a')).toBe(1);
    cache.set('e', 5);

    expect(cache.size).toBe(4);
    expect(cache.has('b')).toBe(false);
    expect(cache.get('a')).toBe(1);
    expect(cache.get('e')).toBe(5);

    trimAllManagedCaches(0.5);
    expect(cache.size).toBeLessThanOrEqual(2);
  });

  it('manages ObjectURL lifecycle and prevents Blob URL leaks', () => {
    const blob1 = new Blob(['<html>1</html>'], { type: 'text/html' });
    const blob2 = new Blob(['<html>2</html>'], { type: 'text/html' });
    const url1 = createManagedObjectUrl(blob1, 'preview1');
    const url2 = createManagedObjectUrl(blob2, 'preview2');

    expect(url1).toBeTruthy();
    expect(url2).toBeTruthy();
    expect(measurePerformanceSnapshot().memory.activeObjectUrls).toBe(2);

    revokeManagedObjectUrl(url1);
    expect(measurePerformanceSnapshot().memory.activeObjectUrls).toBe(1);

    revokeAllManagedObjectUrls();
    expect(measurePerformanceSnapshot().memory.activeObjectUrls).toBe(0);
  });

  it('coalesces high-frequency SSE token deltas while flushing first token and completion immediately', () => {
    vi.useFakeTimers();
    try {
      const committedStates: string[] = [];

      const batcher = createAdaptiveStreamBatcher<string>((val) => {
        committedStates.push(val);
      }, 36);

      // First token flushes immediately for instant TTFT responsiveness
      batcher.schedule('Hello');
      expect(committedStates).toEqual(['Hello']);

      // Rapid burst of 40 SSE deltas within a single frame window
      let acc = 'Hello';
      for (let i = 0; i < 40; i++) {
        acc += ` token_${i}`;
        batcher.schedule(acc);
      }

      // Before timer fires, intermediate deltas are coalesced
      expect(committedStates.length).toBe(1);

      vi.advanceTimersByTime(50);
      expect(committedStates.length).toBe(2);
      expect(committedStates[1]).toContain('token_39');

      // Immediate flush on stream completion
      batcher.schedule(acc + ' DONE');
      batcher.flushNow();
      expect(committedStates[committedStates.length - 1]).toContain('DONE');

      const stats = batcher.getStats();
      expect(stats.rawChunks).toBe(42);
      // 42 token pushes resulted in only 3 React state commits (>92% reduction)
      expect(committedStates.length).toBe(3);

      batcher.cancel();
    } finally {
      vi.useRealTimers();
    }
  });

  it('deduplicates concurrent in-flight network/Firestore requests and debounces localStorage writes', async () => {
    let networkExecutionCount = 0;
    const taskFactory = async () => {
      networkExecutionCount += 1;
      await new Promise((r) => setTimeout(r, 15));
      return { ok: true, count: networkExecutionCount };
    };

    const [r1, r2, r3] = await Promise.all([
      deduplicateInFlightRequest('profile:user_1', taskFactory),
      deduplicateInFlightRequest('profile:user_1', taskFactory),
      deduplicateInFlightRequest('profile:user_1', taskFactory),
    ]);

    expect(networkExecutionCount).toBe(1);
    expect(r1).toEqual({ ok: true, count: 1 });
    expect(r2).toEqual({ ok: true, count: 1 });
    expect(r3).toEqual({ ok: true, count: 1 });

    // Debounced storage writes
    scheduleDebouncedStorageWrite('draft_key', () => localStorage.setItem('draft_key', 'step 1'), 500);
    scheduleDebouncedStorageWrite('draft_key', () => localStorage.setItem('draft_key', 'step 2'), 500);
    scheduleDebouncedStorageWrite('draft_key', () => localStorage.setItem('draft_key', 'final draft value'), 500);

    flushPendingStorageWrites();
    expect(localStorage.getItem('draft_key')).toBe('final draft value');
  });

  it('loads AI provider integrations lazily on demand', async () => {
    const mod = await loadAIProviderIntegrationOnDemand('gemini');
    expect(mod.id).toBe('gemini');
    expect(mod.supportsStreaming).toBe(true);
    expect(getLoadedAIProviderCount()).toBeGreaterThanOrEqual(1);
  });

  it('downscales or replaces heavy high-resolution images with low-memory thumbnails when ultra-lite profile is active', () => {
    expect(typeof useUltraLiteImage).toBe('function');
    setPerformanceProfileConfiguration({
      ultraLiteMode: true,
      performanceProfile: 'ultra-lite',
    });
    expect(getActivePerformanceProfile()).toBe('ultra-lite');

    // 1. High-resolution Unsplash / CDN URL gets downscaled to w=240, q=55
    const highResUnsplash = 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=2400&q=95';
    const downscaledResult = downscaleRemoteImageUrl(highResUnsplash, 240, 55);
    expect(downscaledResult.modified).toBe(true);
    expect(downscaledResult.url).toContain('w=240');
    expect(downscaledResult.url).toContain('q=55');

    const unsplashResolved = resolveUltraLiteImageSync(highResUnsplash, 'ultra-lite', {
      label: 'Unsplash Hero',
      maxDimension: 240,
    });
    expect(unsplashResolved.isOptimized).toBe(true);
    expect(unsplashResolved.isPlaceholder).toBe(false);
    expect(unsplashResolved.src).toContain('w=240');
    expect(unsplashResolved.estimatedMemorySavedKB).toBeGreaterThan(0);

    // 2. Heavy 4K static URL or large fileSizeBytes gets downscaled or replaced with low-memory SVG placeholder
    const heavyRawUrl = 'https://example.com/assets/photo_attachment.png';
    const syncResolvedWithSize = resolveUltraLiteImageSync(heavyRawUrl, 'ultra-lite', {
      label: '4K Render',
      fileSizeBytes: 1_500_000,
    });
    expect(syncResolvedWithSize.isOptimized).toBe(true);
    expect(syncResolvedWithSize.isPlaceholder).toBe(true);
    expect(syncResolvedWithSize.src.startsWith('data:image/svg+xml;utf8,')).toBe(true);
    expect(syncResolvedWithSize.estimatedMemorySavedKB).toBeGreaterThan(1000);

    // 3. Large inline base64 data URL gets replaced with low-memory SVG placeholder
    const largeBase64Image = 'data:image/png;base64,' + 'A'.repeat(80000);
    const base64Resolved = resolveUltraLiteImageSync(largeBase64Image, 'ultra-lite', {
      label: 'Camera Upload',
    });
    expect(base64Resolved.isOptimized).toBe(true);
    expect(base64Resolved.isPlaceholder).toBe(true);
    expect(base64Resolved.src.startsWith('data:image/svg+xml;utf8,')).toBe(true);

    // 4. When profile is 'balanced', resolveUltraLiteImageSync returns original image untouched
    const balancedResolved = resolveUltraLiteImageSync(largeBase64Image, 'balanced', {
      label: 'Camera Upload',
    });
    expect(balancedResolved.src).toBe(largeBase64Image);
    expect(balancedResolved.isOptimized).toBe(false);
    expect(balancedResolved.isPlaceholder).toBe(false);

    // 5. Verify placeholder SVG uses strict monochrome palette
    const placeholderSvg = decodeURIComponent(createLowMemoryPlaceholderDataUrl('Monochrome Preview'));
    expect(placeholderSvg).toContain('#FAFAFA');
    expect(placeholderSvg).toContain('#111111');
  });

  it('verifies lazy-loading, virtualization, and GPU reduction across App, ChatView, MarkdownRenderer, and index.css', () => {
    const appSource = fs.readFileSync(path.resolve(__dirname, '../src/App.tsx'), 'utf-8');
    const chatViewSource = fs.readFileSync(path.resolve(__dirname, '../src/components/agent/ChatView.tsx'), 'utf-8');
    const markdownSource = fs.readFileSync(path.resolve(__dirname, '../src/components/agent/MarkdownRenderer.tsx'), 'utf-8');
    const cssSource = fs.readFileSync(path.resolve(__dirname, '../src/index.css'), 'utf-8');

    // App.tsx lazy-loads WebsiteBuilderView, HistoryPanel, SettingsModal, and MyAIChat
    expect(appSource).toContain("import('./components/agent/WebsiteBuilderView')");
    expect(appSource).toContain("import('./components/history/HistoryPanel')");
    expect(appSource).toContain("import('./components/settings/SettingsModal')");

    // ChatView uses Virtuoso with virtualizationBudget and useUltraLiteImage
    expect(chatViewSource).toContain('getVirtualizationBudget');
    expect(chatViewSource).toContain('useUltraLiteImage');
    expect(chatViewSource).toContain('scheduleDebouncedStorageWrite');

    // MarkdownRenderer uses useUltraLiteImage for markdown images
    expect(markdownSource).toContain('useUltraLiteImage');
    expect(markdownSource).toContain('UltraLiteMarkdownImage');

    // index.css disables backdrop-filter and decorative animations in ultra-lite mode
    expect(cssSource).toContain('[data-perf-mode="ultra-lite"]');
    expect(cssSource).toContain('backdrop-filter: none !important');
    expect(cssSource).toContain('touch-action: manipulation');
  });

  it('captures real runtime benchmark & telemetry metrics', () => {
    setPerformanceProfileConfiguration({
      ultraLiteMode: true,
      performanceProfile: 'ultra-lite',
    });
    const benchmark = runUltraLiteBenchmark();
    const snapshot = measurePerformanceSnapshot();

    expect(benchmark.snapshot.activeProfile).toBe('ultra-lite');
    expect(benchmark.lruEvictionVerified).toBe(true);
    expect(benchmark.streamBatchingVerified).toBe(true);
    expect(benchmark.renderReductionRatio).toBeGreaterThanOrEqual(85);
    expect(snapshot.memory.domNodeCount).toBeGreaterThan(0);

    console.info('[ULTRA-LITE BENCHMARK METRICS]', JSON.stringify({ benchmark, snapshot }));
  });
});
