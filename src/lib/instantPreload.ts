/**
 * Instant Module Preloader & Promise Cache for Deku AI
 *
 * Caches dynamic import promises so React.lazy panels, modals, drawers, and views
 * resolve in 0ms on click/tap after background warming or pointer-intent hover/touch.
 */

type ModuleLoader<T> = () => Promise<T>;

function createCachedLoader<T>(loader: ModuleLoader<T>): ModuleLoader<T> {
  let cached: Promise<T> | null = null;
  return () => {
    if (!cached) {
      cached = loader().catch((err) => {
        cached = null;
        throw err;
      });
    }
    return cached;
  };
}

export const loadChatView = createCachedLoader(() =>
  import('@/components/agent/ChatView').then((m) => ({ default: m.ChatView }))
);

export const loadWebsiteBuilderView = createCachedLoader(() =>
  import('@/components/agent/WebsiteBuilderView').then((m) => ({ default: m.WebsiteBuilderView }))
);

export const loadHistoryPanel = createCachedLoader(() =>
  import('@/components/history/HistoryPanel').then((m) => ({ default: m.HistoryPanel }))
);

export const loadSettingsModal = createCachedLoader(() =>
  import('@/components/settings/SettingsModal').then((m) => ({ default: m.SettingsModal }))
);

export const loadConnectorsStorePanel = createCachedLoader(() =>
  import('@/components/connectors/ConnectorsStorePanel').then((m) => ({
    default: m.ConnectorsStorePanel,
  }))
);

export const loadTagAnalyticsModal = createCachedLoader(() =>
  import('@/components/analytics/TagAnalyticsModal').then((m) => ({
    default: m.TagAnalyticsModal,
  }))
);

export const loadAndroidVoiceSettings = createCachedLoader(() =>
  import('@/components/settings/AndroidVoiceSettings').then((m) => ({
    default: m.AndroidVoiceSettings,
  }))
);

export const loadAndroidConnectorsSettings = createCachedLoader(() =>
  import('@/components/settings/AndroidConnectorsSettings').then((m) => ({
    default: m.AndroidConnectorsSettings,
  }))
);

export const loadMyAIChat = createCachedLoader(() =>
  import('@/components/chat/MyAIChat').then((m) => ({ default: m.MyAIChat }))
);

export const loadProjectModal = createCachedLoader(() =>
  import('@/components/projects/ProjectModal').then((m) => ({ default: m.ProjectModal }))
);

export const loadProjectViewModal = createCachedLoader(() =>
  import('@/components/projects/ProjectViewModal').then((m) => ({ default: m.ProjectViewModal }))
);

export const loadConnectorConfigModal = createCachedLoader(() =>
  import('@/components/connectors/ConnectorConfigModal').then((m) => ({
    default: m.ConnectorConfigModal,
  }))
);

export const loadGoogleDrivePickerModal = createCachedLoader(() =>
  import('@/components/workspace/GoogleDrivePickerModal').then((m) => ({
    default: m.GoogleDrivePickerModal,
  }))
);

export function preloadChatView(): void {
  void loadChatView().catch(() => {});
}

export function preloadHistoryPanel(): void {
  void loadHistoryPanel().catch(() => {});
}

export function preloadSettingsModal(): void {
  void loadSettingsModal().catch(() => {});
}

export function preloadConnectorsPanel(): void {
  void loadConnectorsStorePanel().catch(() => {});
}

export function preloadTagAnalyticsModal(): void {
  void loadTagAnalyticsModal().catch(() => {});
}

export function preloadProjectModals(): void {
  void loadProjectModal().catch(() => {});
  void loadProjectViewModal().catch(() => {});
}

let workspaceWarmupScheduled = false;

/**
 * Warms high-frequency workspace chunks in the background right after first paint
 * so opening Chat, Connectors, Plugins, History, Settings, Analytics, or Projects
 * feels completely instantaneous on the very first click/tap.
 */
export function scheduleWorkspaceWarmup(): void {
  if (workspaceWarmupScheduled || typeof window === 'undefined') return;
  workspaceWarmupScheduled = true;

  const conn = (navigator as any)?.connection;
  if (conn?.saveData) {
    // On Data Saver connections, only pre-warm the core chat view
    window.setTimeout(() => preloadChatView(), 120);
    return;
  }

  const runWaveOne = () => {
    preloadChatView();
    preloadConnectorsPanel();
    preloadHistoryPanel();
    preloadSettingsModal();
  };

  const runWaveTwo = () => {
    preloadTagAnalyticsModal();
    preloadProjectModals();
  };

  const ric = (window as any).requestIdleCallback as
    | ((cb: () => void, opts?: { timeout: number }) => number)
    | undefined;

  if (typeof ric === 'function') {
    ric(
      () => {
        runWaveOne();
        ric(runWaveTwo, { timeout: 600 });
      },
      { timeout: 180 }
    );
  } else {
    window.setTimeout(() => {
      runWaveOne();
      window.setTimeout(runWaveTwo, 180);
    }, 60);
  }
}

export function dismissBootLoader(): void {
  if (typeof window === 'undefined') return;
  const dismiss = (window as any).__dekuDismissBootLoader;
  if (typeof dismiss === 'function') {
    dismiss();
  }
}
