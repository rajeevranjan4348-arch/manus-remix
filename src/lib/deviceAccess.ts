/**
 * Shared, least-privilege browser device/file helpers.
 * These APIs never request access until called by an explicit user action.
 */
export const DEFAULT_MAX_FILE_BYTES = 20 * 1024 * 1024;

const SUPPORTED_EXTENSIONS = new Set([
  'png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'svg',
  'pdf', 'txt', 'md', 'csv', 'json', 'xml',
  'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx',
  'mp3', 'wav', 'm4a', 'mp4', 'webm', 'mov',
]);

export type FileValidationResult =
  | { ok: true }
  | { ok: false; reason: 'empty' | 'too-large' | 'unsupported'; message: string };

function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot < 0 ? '' : name.slice(dot + 1).toLowerCase();
}

export function validateUserSelectedFile(
  file: File | null | undefined,
  maxBytes = DEFAULT_MAX_FILE_BYTES,
): FileValidationResult {
  if (!file || file.size <= 0) {
    return { ok: false, reason: 'empty', message: 'This file is empty. Choose a different file.' };
  }
  if (file.size > maxBytes) {
    const maxMb = Math.round(maxBytes / (1024 * 1024));
    return { ok: false, reason: 'too-large', message: `File exceeds the ${maxMb} MB upload limit.` };
  }

  const ext = extensionOf(file.name);
  const type = (file.type || '').toLowerCase();
  const knownMime = type.startsWith('image/') ||
    type.startsWith('audio/') ||
    type.startsWith('video/') ||
    type === 'application/pdf' ||
    type.startsWith('text/') ||
    type === 'application/json' ||
    type === 'application/xml' ||
    type === 'application/msword' ||
    type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
    type === 'application/vnd.ms-excel' ||
    type === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
    type === 'application/vnd.ms-powerpoint' ||
    type === 'application/vnd.openxmlformats-officedocument.presentationml.presentation';

  if (!SUPPORTED_EXTENSIONS.has(ext) && !knownMime) {
    return {
      ok: false,
      reason: 'unsupported',
      message: 'This file format is not supported. Choose an image, PDF, text, office, audio, or video file.',
    };
  }
  return { ok: true };
}

export function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return 'Unknown size';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function getDeviceAccessError(error: unknown, device: 'microphone' | 'camera'): string {
  const name = error instanceof Error ? error.name : '';
  if (!window.isSecureContext) {
    return `${device === 'microphone' ? 'Microphone' : 'Camera'} access requires HTTPS or localhost.`;
  }
  if (name === 'NotAllowedError' || name === 'PermissionDeniedError' || name === 'SecurityError') {
    return `${device === 'microphone' ? 'Microphone' : 'Camera'} permission was blocked. Allow access in your browser site settings, then retry.`;
  }
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
    return device === 'microphone' ? 'No microphone was found on this device.' : 'No camera was found on this device.';
  }
  if (name === 'NotReadableError' || name === 'TrackStartError') {
    return `The ${device} is busy or unavailable. Close other apps using it and retry.`;
  }
  return `Could not access the ${device}. Check device and site permissions, then retry.`;
}

/** Stops every track, including when callers are cleaning up after an exception. */
export function stopMediaStream(stream: MediaStream | null | undefined): void {
  stream?.getTracks().forEach((track) => {
    try { track.stop(); } catch { /* Cleanup should be best-effort. */ }
  });
}
