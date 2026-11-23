export const KEYBOARD_SENTINEL = ' ';

export interface KeyboardDeltaResult {
  text: string;
  enter: boolean;
  backspaceCount: number;
}

/**
 * Extracts typed text, Enter, or Backspace from a sentinel-buffered hidden `<input>`.
 * A single space sentinel lets mobile soft keyboards (Android Gboard, Samsung, iOS)
 * report Backspace even when visually empty (`value === ''`) via `onChange`/`onInput`,
 * and avoids keyCode 229 / `'Unidentified'` swallows.
 */
export function extractKeyboardDelta(
  rawValue: string,
  sentinel: string = KEYBOARD_SENTINEL,
): KeyboardDeltaResult {
  if (rawValue.length === 0) {
    return { text: '', enter: false, backspaceCount: 1 };
  }

  let body = rawValue;
  if (sentinel.length > 0) {
    if (body.startsWith(sentinel)) {
      body = body.slice(sentinel.length);
    } else if (body.endsWith(sentinel)) {
      body = body.slice(0, body.length - sentinel.length);
    }
  }

  if (body.length === 0) {
    return { text: '', enter: false, backspaceCount: 0 };
  }

  const normalized = body.replace(/\r\n/g, '\n');
  if (normalized.endsWith('\n')) {
    return {
      text: normalized.slice(0, -1),
      enter: true,
      backspaceCount: 0,
    };
  }

  return {
    text: normalized,
    enter: false,
    backspaceCount: 0,
  };
}

/**
 * Keeps screen rotation locked while the mobile virtual keyboard is open so a sudden
 * viewport height drop (`boxSize.height < boxSize.width`) does not flip the streamed
 * desktop 90 degrees mid-typing.
 */
export function resolveKeyboardLockedPortrait(
  allowRotate: boolean,
  boxWidth: number,
  boxHeight: number,
  keyboardFocused: boolean,
  previousPortrait: boolean,
): boolean {
  if (!allowRotate) return false;
  if (keyboardFocused) return previousPortrait;
  return boxWidth > 0 && boxHeight > boxWidth;
}

export function isTouchCapableEnvironment(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    if (window.matchMedia && window.matchMedia('(pointer: coarse)').matches) {
      return true;
    }
  } catch {
    // ignore matchMedia failures on legacy browsers
  }
  if (typeof navigator !== 'undefined' && (navigator.maxTouchPoints || 0) > 0) {
    return true;
  }
  return 'ontouchstart' in window;
}
