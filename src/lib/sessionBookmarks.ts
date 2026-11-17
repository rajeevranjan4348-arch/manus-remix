const BOOKMARKS_STORAGE_KEY = 'manus_bookmarked_sessions';

function readBookmarks(): string[] {
  if (typeof localStorage === 'undefined') return [];
  try {
    const parsed = JSON.parse(localStorage.getItem(BOOKMARKS_STORAGE_KEY) || '[]');
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : [];
  } catch {
    return [];
  }
}

export function getBookmarkedSessionIds(): string[] {
  return readBookmarks();
}

export function setSessionBookmarked(sessionId: string, bookmarked: boolean): string[] {
  const next = new Set(readBookmarks());
  if (bookmarked) next.add(sessionId);
  else next.delete(sessionId);

  const ids = Array.from(next);
  try {
    localStorage.setItem(BOOKMARKS_STORAGE_KEY, JSON.stringify(ids));
  } catch {
    // Keep the current UI usable if local storage is unavailable.
  }
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('manus_bookmarked_sessions_updated', { detail: { sessionId, bookmarked } }));
  }
  return ids;
}
