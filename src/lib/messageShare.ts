import { copyTextToClipboard } from './clipboard';

export interface ShareTextPayload {
  title?: string;
  text: string;
}

export type ShareTextOutcome = 'shared' | 'copied' | 'cancelled' | 'failed';

/**
 * Opens the native share sheet (Android, iOS, supported desktop browsers)
 * and gracefully falls back to copying to clipboard when navigator.share is unavailable.
 */
export async function shareTextContent({
  title = 'Deku AI',
  text,
}: ShareTextPayload): Promise<ShareTextOutcome> {
  const cleanText = (text || '').trim();
  if (!cleanText) return 'failed';

  if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
    try {
      await navigator.share({
        title,
        text: cleanText,
      });
      return 'shared';
    } catch (err: any) {
      // User intentionally dismissed the native share sheet — not an error.
      if (err?.name === 'AbortError') {
        return 'cancelled';
      }
      // SecurityError / NotAllowedError (e.g. iframe restrictions) -> fall back to clipboard.
    }
  }

  const copied = await copyTextToClipboard(cleanText);
  return copied ? 'copied' : 'failed';
}
