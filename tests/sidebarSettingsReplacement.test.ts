import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const rootDir = process.cwd();
const readRepoFile = (relPath: string) =>
  fs.readFileSync(path.join(rootDir, relPath), 'utf-8');

describe('Sidebar — Replace Logout Button with Settings Button', () => {
  const sidebarSource = readRepoFile('src/components/layout/Sidebar.tsx');
  const appSource = readRepoFile('src/App.tsx');

  it('completely removes the Logout button, LogOut icon import, and sign-out trigger from Sidebar', () => {
    expect(sidebarSource).not.toContain('LogOut');
    expect(sidebarSource).not.toContain('fbSignOut');
    expect(sidebarSource).not.toContain('Sign out of Firebase');
    expect(sidebarSource).not.toContain('Click to sign out');
  });

  it('places the Settings gear icon on the right side of the profile card and prevents duplicate Settings icons', () => {
    // No duplicate settings entry in top navItems
    expect(sidebarSource).not.toContain("id: 'settings'");

    // Standalone Settings label row above the profile card is removed
    expect(sidebarSource).not.toContain('<span>Settings</span>');

    // Relocated Settings gear icon button inside the profile card on the right of Cloud Synced
    expect(sidebarSource).toContain('data-testid="sidebar-profile-card"');
    expect(sidebarSource).toContain('data-testid="sidebar-settings-button"');
    expect(sidebarSource).toContain('aria-label="Settings"');
    expect(sidebarSource).toContain('<Settings2');
    expect(sidebarSource).toContain('size={21}');
    expect(sidebarSource).toContain('strokeWidth={2.4}');

    const profileCardIdx = sidebarSource.indexOf('data-testid="sidebar-profile-card"');
    const cloudSyncedIdx = sidebarSource.indexOf('Cloud Synced', profileCardIdx);
    const settingsBtnIdx = sidebarSource.indexOf('data-testid="sidebar-settings-button"', profileCardIdx);
    expect(profileCardIdx).toBeGreaterThan(-1);
    expect(cloudSyncedIdx).toBeGreaterThan(profileCardIdx);
    expect(settingsBtnIdx).toBeGreaterThan(cloudSyncedIdx);

    // Collapsed sidebar Settings icon button remains intact
    expect(sidebarSource).toContain('data-testid="sidebar-collapsed-settings-button"');
  });

  it('reuses the existing sidebar button animation and touch-target classes without adding a new animation library', () => {
    expect(sidebarSource).toContain('manus-sidebar-item-slide');
    expect(sidebarSource).toContain('manus-icon-spring');
    expect(sidebarSource).toContain('manus-touch-target');
    expect(sidebarSource).toContain('transition-colors');
  });

  it('wires active Settings navigation state and opens the existing Settings experience', () => {
    expect(sidebarSource).toContain('isSettingsRouteActive');
    expect(sidebarSource).toContain("location.pathname.startsWith('/settings')");
    expect(sidebarSource).toContain("aria-current={isSettingsRouteActive ? 'page' : undefined}");
    expect(sidebarSource).toContain('handleOpenSettingsNavigation');
    expect(appSource).toContain("isSettingsActive={isSettingsOpen || location.pathname.startsWith('/settings')}");
  });

  it('preserves existing primary navigation buttons and the Projects section', () => {
    expect(sidebarSource).toContain("label: 'New Chat'");
    expect(sidebarSource).toContain("label: 'Connectors & Plugins'");
    expect(sidebarSource).toContain("label: 'Library'");
    expect(sidebarSource).toContain("label: 'Tag Analytics'");
    expect(sidebarSource).toContain('/* PROJECTS SECTION */');
    expect(sidebarSource).toContain('Projects</h3>');
  });
});
