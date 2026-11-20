/**
 * Safe, non-disruptive clipboard and text-selection helpers.
 *
 * Guarantees:
 * - Never mutates or clears original message DOM nodes.
 * - Never resets scroll position or causes chat viewport jumps.
 * - Preserves any active user text selection when falling back to execCommand.
 * - Works across desktop browsers, Android Chrome, iOS Safari, and embedded WebViews.
 */

/**
 * Returns true if the user currently has a non-empty text selection active.
 * If `container` is provided, checks whether the selection intersects or is inside `container`.
 */
export function hasActiveTextSelection(container?: HTMLElement | null): boolean {
  if (typeof window === 'undefined' || typeof window.getSelection !== 'function') {
    return false;
  }

  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
    return false;
  }

  if (selection.toString().trim().length === 0) {
    return false;
  }

  if (!container) {
    return true;
  }

  try {
    const anchorNode = selection.anchorNode;
    const focusNode = selection.focusNode;
    return (
      (anchorNode !== null && container.contains(anchorNode)) ||
      (focusNode !== null && container.contains(focusNode))
    );
  } catch {
    return true;
  }
}

/**
 * Copies plain text to the system clipboard without modifying visible DOM nodes,
 * clearing message text, or jumping scroll position.
 */
export async function copyTextToClipboard(text: string): Promise<boolean> {
  if (typeof text !== 'string') {
    return false;
  }

  // Primary path: Modern Async Clipboard API (never touches DOM, focus, or selection)
  if (
    typeof navigator !== 'undefined' &&
    navigator.clipboard &&
    typeof navigator.clipboard.writeText === 'function'
  ) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Fall through to safe offscreen fallback (e.g. Android WebView / iframe permissions)
    }
  }

  // Fallback path: Offscreen readonly textarea that preserves active selection & scroll position
  if (typeof document === 'undefined' || !document.body) {
    return false;
  }

  const selection = typeof window !== 'undefined' ? window.getSelection() : null;
  const savedRanges: Range[] = [];
  if (selection && selection.rangeCount > 0) {
    for (let i = 0; i < selection.rangeCount; i++) {
      try {
        savedRanges.push(selection.getRangeAt(i).cloneRange());
      } catch {
        // ignore detached ranges
      }
    }
  }

  const activeEl =
    typeof HTMLElement !== 'undefined' && document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
  const prevScrollX = typeof window !== 'undefined' ? window.scrollX : 0;
  const prevScrollY = typeof window !== 'undefined' ? window.scrollY : 0;

  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', '');
  textarea.setAttribute('aria-hidden', 'true');
  textarea.tabIndex = -1;
  textarea.style.position = 'fixed';
  textarea.style.top = '0';
  textarea.style.left = '-9999px';
  textarea.style.width = '1px';
  textarea.style.height = '1px';
  textarea.style.padding = '0';
  textarea.style.border = '0';
  textarea.style.opacity = '0';
  textarea.style.pointerEvents = 'none';
  textarea.style.fontSize = '16px'; // Prevents iOS/Android auto-zoom on focus

  document.body.appendChild(textarea);

  let copied = false;
  try {
    try {
      textarea.focus({ preventScroll: true });
    } catch {
      textarea.focus();
    }
    textarea.select();
    textarea.setSelectionRange(0, textarea.value.length);
    copied = document.execCommand('copy');
  } catch {
    copied = false;
  } finally {
    if (textarea.parentNode) {
      textarea.parentNode.removeChild(textarea);
    }

    // Restore original selection ranges so user's highlighted text is never disturbed
    if (selection) {
      try {
        selection.removeAllRanges();
        for (const range of savedRanges) {
          selection.addRange(range);
        }
      } catch {
        // ignore if nodes changed
      }
    }

    // Restore focus without scrolling if an element was previously focused
    if (activeEl && activeEl !== document.body && document.contains(activeEl)) {
      try {
        activeEl.focus({ preventScroll: true });
      } catch {
        // ignore
      }
    }

    if (typeof window !== 'undefined' && (window.scrollX !== prevScrollX || window.scrollY !== prevScrollY)) {
      window.scrollTo(prevScrollX, prevScrollY);
    }
  }

  return copied;
}
