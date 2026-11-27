/**
 * Live Screen Share Engine Utilities
 *
 * Pure browser-safe helpers for display capture capability detection,
 * frame scaling, JPEG frame extraction, and SSE delta parsing for
 * real-time multimodal AI screen analysis.
 */

export type ScreenShareStatus =
  | 'idle'
  | 'requesting'
  | 'sharing'
  | 'paused'
  | 'denied'
  | 'unavailable'
  | 'ended';

export interface ScaledDimensions {
  width: number;
  height: number;
}

export interface ScreenShareErrorClassification {
  status: 'denied' | 'unavailable' | 'idle';
  message: string;
  cancelledByUser: boolean;
}

export function isScreenShareSupported(): boolean {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') {
    return false;
  }
  return Boolean(window.isSecureContext && navigator.mediaDevices && typeof navigator.mediaDevices.getDisplayMedia === 'function');
}

export function classifyScreenShareError(err: unknown): ScreenShareErrorClassification {
  const errorObj = err as { name?: string; message?: string } | null;
  const name = String(errorObj?.name || '');
  const message = String(errorObj?.message || '');

  if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
    const looksCancelled = /cancel|dismiss|closed/i.test(message);
    return {
      status: looksCancelled ? 'idle' : 'denied',
      cancelledByUser: looksCancelled,
      message: looksCancelled
        ? 'Screen selection was cancelled. Click Start Screen Share to choose a window, tab, or screen.'
        : 'Screen sharing permission was denied. Allow screen recording permission in your browser or OS settings and try again.',
    };
  }

  if (name === 'AbortError') {
    return {
      status: 'idle',
      cancelledByUser: true,
      message: 'Screen sharing was cancelled before starting.',
    };
  }

  if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
    return {
      status: 'unavailable',
      cancelledByUser: false,
      message: 'No shareable screen, window, or browser tab was found.',
    };
  }

  if (name === 'NotReadableError' || name === 'TrackStartError') {
    return {
      status: 'unavailable',
      cancelledByUser: false,
      message: 'Your operating system prevented capturing this display surface. Check OS screen recording permissions.',
    };
  }

  if (name === 'SecurityError') {
    return {
      status: 'denied',
      cancelledByUser: false,
      message: 'Screen capture is blocked by the browser security or permissions policy in this frame.',
    };
  }

  return {
    status: 'unavailable',
    cancelledByUser: false,
    message: message || 'Unable to start live screen share in this browser.',
  };
}

/**
 * Scales source screen dimensions down proportionally so the longest edge
 * never exceeds `maxEdge` (default 1280px) while preserving aspect ratio.
 */
export function computeScaledFrameDimensions(
  sourceWidth: number,
  sourceHeight: number,
  maxEdge = 1280,
): ScaledDimensions {
  const safeW = Math.max(1, Math.round(sourceWidth || 1280));
  const safeH = Math.max(1, Math.round(sourceHeight || 720));
  const longest = Math.max(safeW, safeH);
  if (longest <= maxEdge) {
    return { width: safeW, height: safeH };
  }
  const ratio = maxEdge / longest;
  return {
    width: Math.max(1, Math.round(safeW * ratio)),
    height: Math.max(1, Math.round(safeH * ratio)),
  };
}

/**
 * Captures the current live video frame to a compressed JPEG data URL.
 */
export function captureVideoFrameToDataUrl(
  video: HTMLVideoElement,
  canvas: HTMLCanvasElement,
  maxEdge = 1280,
  quality = 0.82,
): string | null {
  const rawW = video.videoWidth;
  const rawH = video.videoHeight;
  if (!rawW || !rawH) return null;

  const { width, height } = computeScaledFrameDimensions(rawW, rawH, maxEdge);
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  ctx.drawImage(video, 0, 0, width, height);
  return canvas.toDataURL('image/jpeg', quality);
}

/**
 * Captures the current live video frame as a File object suitable for chat attachment & library storage.
 */
export async function captureVideoFrameToFile(
  video: HTMLVideoElement,
  canvas: HTMLCanvasElement,
  maxEdge = 1600,
  quality = 0.88,
): Promise<File | null> {
  const rawW = video.videoWidth;
  const rawH = video.videoHeight;
  if (!rawW || !rawH) return null;

  const { width, height } = computeScaledFrameDimensions(rawW, rawH, maxEdge);
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  ctx.drawImage(video, 0, 0, width, height);

  return new Promise<File | null>((resolve) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          resolve(null);
          return;
        }
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        resolve(new File([blob], `screen_share_${timestamp}.jpg`, { type: 'image/jpeg' }));
      },
      'image/jpeg',
      quality,
    );
  });
}

/**
 * Wraps a live captured screen frame with the user's question in the exact
 * `[IMAGE_DATA_URL:...]` multimodal format consumed by `/api/gemini/stream` and `netlify/functions/agent`.
 */
export function buildScreenSharePromptPayload(frameDataUrl: string, question: string): string {
  const trimmedQuestion = question.trim() || 'Describe what is currently visible on my screen and highlight anything important or actionable.';
  return `[IMAGE_DATA_URL:${frameDataUrl}]\n${trimmedQuestion}`;
}

export interface ParsedSseEvent {
  kind: 'ignore' | 'done' | 'delta' | 'error';
  text?: string;
  error?: string;
}

/**
 * Parses a single SSE line emitted by `/api/gemini/stream`.
 */
export function parseGeminiStreamSseLine(rawLine: string): ParsedSseEvent {
  const line = rawLine.trim();
  if (!line.startsWith('data: ')) {
    return { kind: 'ignore' };
  }
  const dataStr = line.slice(6).trim();
  if (!dataStr) return { kind: 'ignore' };
  if (dataStr === '[DONE]') return { kind: 'done' };

  try {
    const parsed = JSON.parse(dataStr);
    if (parsed.type === 'heartbeat' || parsed.type === 'ping' || parsed.type === 'stream-open') {
      return { kind: 'ignore' };
    }
    if (parsed.type === 'text-delta' && typeof parsed.delta === 'string') {
      return { kind: 'delta', text: parsed.delta };
    }
    if (typeof parsed.delta === 'string') {
      return { kind: 'delta', text: parsed.delta };
    }
    if (typeof parsed.choices?.[0]?.delta?.content === 'string') {
      return { kind: 'delta', text: parsed.choices[0].delta.content };
    }
    if (parsed.type === 'error') {
      return { kind: 'error', error: String(parsed.error || 'AI screen analysis failed.') };
    }
    return { kind: 'ignore' };
  } catch {
    return { kind: 'ignore' };
  }
}

export function formatDisplaySurfaceLabel(surface?: string): string {
  switch (surface) {
    case 'monitor':
      return 'Entire Screen';
    case 'window':
      return 'Application Window';
    case 'browser':
      return 'Browser Tab';
    default:
      return 'Live Screen';
  }
}
