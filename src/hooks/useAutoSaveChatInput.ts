import { useEffect, useRef } from 'react';

export interface UseAutoSaveChatInputOptions {
  /**
   * Current chat input text value.
   */
  value: string;
  /**
   * Callback to save the text value to localStorage or persistence layer.
   */
  onSave: (text: string) => void;
  /**
   * Debounce delay in milliseconds before triggering `onSave`.
   * Defaults to 500ms per requirements.
   */
  delay?: number;
  /**
   * Whether auto-saving is enabled.
   */
  enabled?: boolean;
}

/**
 * Custom React hook that auto-saves chat input text into localStorage
 * whenever the user pauses typing for more than `delay` milliseconds (default: 500ms).
 */
export function useAutoSaveChatInput({
  value,
  onSave,
  delay = 500,
  enabled = true,
}: UseAutoSaveChatInputOptions): void {
  const onSaveRef = useRef(onSave);
  onSaveRef.current = onSave;

  useEffect(() => {
    if (!enabled) return;

    const timer = setTimeout(() => {
      onSaveRef.current(value);
    }, delay);

    return () => {
      clearTimeout(timer);
    };
  }, [value, delay, enabled]);

  // Flush unsaved draft on component unmount or window beforeunload
  useEffect(() => {
    if (!enabled) return;

    const handleBeforeUnload = () => {
      onSaveRef.current(value);
    };

    window.addEventListener('beforeunload', handleBeforeUnload);

    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
      onSaveRef.current(value);
    };
  }, [value, enabled]);
}
