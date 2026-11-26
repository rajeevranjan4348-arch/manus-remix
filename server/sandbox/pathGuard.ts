/**
 * Workspace path guard (Feature 06).
 *
 * Every filesystem and terminal working-directory path from the agent is
 * validated here before it reaches the provider. Absolute host paths can
 * never be formed from a validated virtual path; the provider only ever
 * receives workspace-relative paths.
 */

export const MAX_PATH_LENGTH = 512;
export const MAX_PATH_DEPTH = 32;

export interface PathResolution {
  valid: boolean;
  /** Normalized workspace-relative path (no leading slash). */
  virtualPath?: string;
  error?: string;
}

/**
 * Resolve and validate a client-supplied path against the workspace root.
 * Rejects: null bytes, control characters, traversal segments, absolute
 * paths, Windows drive letters, NTFS alternate data streams, over-long or
 * over-deep paths. Accepts '' and '.' as the workspace root.
 */
export function resolveWorkspacePath(rawPath: string): PathResolution {
  const input = String(rawPath === undefined || rawPath === null ? '' : rawPath).trim();
  if (input === '' || input === '.') {
    return { valid: true, virtualPath: '' };
  }
  if (input.length > MAX_PATH_LENGTH) {
    return { valid: false, error: 'Path exceeds maximum length' };
  }
  if (input.includes('\\u0000')) {
    return { valid: false, error: 'Path contains null bytes' };
  }
  // Control characters
  // eslint-disable-next-line no-control-regex
  if (/\\u0000-\\u001f|\\u007f/.test(input)) {
    return { valid: false, error: 'Path contains control characters' };
  }
  if (input.startsWith('/') || input.startsWith('\\\\')) {
    return { valid: false, error: 'Absolute paths are not permitted inside a workspace' };
  }
  if (/^[a-zA-Z]:/.test(input)) {
    return { valid: false, error: 'Drive-letter paths are not permitted inside a workspace' };
  }
  if (/:[^\\/]/.test(input)) {
    return { valid: false, error: 'Alternate data streams are not permitted' };
  }

  const segments = input.split(/[\\\\/]+/);
  const normalized: string[] = [];
  for (const segment of segments) {
    if (segment === '' || segment === '.') continue;
    if (segment === '..') {
      if (normalized.length === 0) {
        return { valid: false, error: 'Path traversal above the workspace root is forbidden' };
      }
      normalized.pop();
      continue;
    }
    normalized.push(segment);
  }

  const virtualPath = normalized.join('/');
  if (normalized.length > MAX_PATH_DEPTH) {
    return { valid: false, error: 'Path nesting exceeds the allowed depth' };
  }
  return { valid: true, virtualPath };
}

/**
 * Verify a provider-reported real path (after symlink resolution when the
 * provider supports it) still sits inside the workspace root. Escapes fail closed.
 */
export function assertWithinWorkspaceRoot(realPath: string, workspaceRoot: string): boolean {
  const normalizedReal = String(realPath || '').replace(/\\\\/g, '/');
  const normalizedRoot = String(workspaceRoot || '').replace(/\\\\/g, '/').replace(/\\/$/, '');
  if (!normalizedRoot) return false;
  if (normalizedReal === normalizedRoot) return true;
  return normalizedReal.startsWith(normalizedRoot + '/');
}
