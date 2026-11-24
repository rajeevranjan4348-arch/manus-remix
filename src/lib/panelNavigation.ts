export type ActiveWorkspacePanel =
  | 'connectors'
  | 'plugins'
  | 'history'
  | 'settings'
  | 'analytics'
  | null;

const VALID_PANELS = new Set<string>([
  'connectors',
  'plugins',
  'history',
  'settings',
  'analytics',
]);

export const PANEL_QUERY_PARAM = 'panel';

export function parsePanelFromSearch(search: string): ActiveWorkspacePanel {
  if (!search) return null;
  try {
    const params = new URLSearchParams(search.startsWith('?') ? search : `?${search}`);
    const raw = params.get(PANEL_QUERY_PARAM)?.trim().toLowerCase() ?? '';
    if (VALID_PANELS.has(raw)) {
      return raw as Exclude<ActiveWorkspacePanel, null>;
    }
    return null;
  } catch {
    return null;
  }
}

export function buildSearchWithPanel(
  currentSearch: string,
  panel: ActiveWorkspacePanel,
): string {
  const params = new URLSearchParams(
    currentSearch ? (currentSearch.startsWith('?') ? currentSearch : `?${currentSearch}`) : '',
  );

  if (panel && VALID_PANELS.has(panel)) {
    params.set(PANEL_QUERY_PARAM, panel);
  } else {
    params.delete(PANEL_QUERY_PARAM);
  }

  const serialized = params.toString();
  return serialized ? `?${serialized}` : '';
}

export function isConnectorsPanelActive(panel: ActiveWorkspacePanel): boolean {
  return panel === 'connectors' || panel === 'plugins';
}

export function resolveConnectorsSection(
  panel: ActiveWorkspacePanel,
): 'connectors' | 'plugins' {
  return panel === 'plugins' ? 'plugins' : 'connectors';
}
