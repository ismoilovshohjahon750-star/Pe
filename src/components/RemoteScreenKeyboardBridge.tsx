import { useCallback, useRef, type FormEvent, type KeyboardEvent, type RefObject } from 'react';
import { Keyboard } from 'lucide-react';
import { extractKeyboardDelta, KEYBOARD_SENTINEL } from '../utils/remoteKeyboard.ts';

interface RemoteScreenKeyboardBridgeProps {
  inputRef: RefObject<HTMLInputElement | null>;
  keyboardFocused: boolean;
  onFocusChange: (focused: boolean) => void;
  specialKeyMap: Record<string, string>;
  enterKey: string;
  backspaceKey: string;
  ctrlKeyCase?: 'lower' | 'upper';
  altF4Key: string;
  onTypeText: (text: string, enter: boolean) => void;
  onPressKey: (key: string) => void;
}

export function focusMobileKeyboardInput(el: HTMLInputElement | null): void {
  if (!el) return;
  if (!el.value) {
    el.value = KEYBOARD_SENTINEL;
  }
  try {
    el.focus({ preventScroll: true });
  } catch {
    el.focus();
  }
  try {
    const pos = el.value.length;
    el.setSelectionRange(pos, pos);
  } catch {
    // ignore selection range errors on unsupported inputs
  }
}

export function RemoteScreenKeyboardBridge({
  inputRef,
  keyboardFocused,
  onFocusChange,
  specialKeyMap,
  enterKey,
  backspaceKey,
  ctrlKeyCase = 'lower',
  altF4Key,
  onTypeText,
  onPressKey,
}: RemoteScreenKeyboardBridgeProps) {
  const composingRef = useRef(false);

  const resetToSentinel = useCallback((el: HTMLInputElement | null) => {
    if (!el) return;
    el.value = KEYBOARD_SENTINEL;
    try {
      el.setSelectionRange(KEYBOARD_SENTINEL.length, KEYBOARD_SENTINEL.length);
    } catch {
      // ignore
    }
  }, []);

  const flushInputValue = useCallback(
    (rawValue: string, el: HTMLInputElement | null) => {
      const delta = extractKeyboardDelta(rawValue, KEYBOARD_SENTINEL);
      resetToSentinel(el);

      if (delta.backspaceCount > 0) {
        for (let i = 0; i < delta.backspaceCount; i += 1) {
          onPressKey(backspaceKey);
        }
        return;
      }

      if (delta.text.length > 0) {
        onTypeText(delta.text, delta.enter);
      } else if (delta.enter) {
        onPressKey(enterKey);
      }
    },
    [backspaceKey, enterKey, onPressKey, onTypeText, resetToSentinel],
  );

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.metaKey) return;
    const isIme =
      composingRef.current ||
      e.nativeEvent.isComposing ||
      e.key === 'Unidentified' ||
      e.keyCode === 229;
    if (isIme && e.key !== 'Enter' && e.keyCode !== 13) return;
    if (['Shift', 'Control', 'Alt', 'Meta', 'CapsLock'].includes(e.key)) return;

    if (e.ctrlKey && e.key.length === 1) {
      e.preventDefault();
      const ch = ctrlKeyCase === 'upper' ? e.key.toUpperCase() : e.key.toLowerCase();
      onPressKey(`${ctrlKeyCase === 'upper' ? 'Ctrl' : 'ctrl'}+${ch}`);
      return;
    }

    if (e.altKey && e.key === 'F4') {
      e.preventDefault();
      onPressKey(altF4Key);
      return;
    }

    if (e.key === 'Enter' || e.keyCode === 13) {
      e.preventDefault();
      composingRef.current = false;
      const el = e.currentTarget;
      const pending = extractKeyboardDelta(el.value, KEYBOARD_SENTINEL).text;
      resetToSentinel(el);
      if (pending.length > 0) {
        onTypeText(pending, true);
      } else {
        onPressKey(enterKey);
      }
      return;
    }

    if (e.key === 'Backspace') {
      e.preventDefault();
      composingRef.current = false;
      resetToSentinel(e.currentTarget);
      onPressKey(backspaceKey);
      return;
    }

    if (e.key === ' ') return;

    const mapped = specialKeyMap[e.key];
    if (mapped) {
      e.preventDefault();
      onPressKey(mapped);
    }
  };

  const handleSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    composingRef.current = false;
    const el = inputRef.current;
    const pending = el ? extractKeyboardDelta(el.value, KEYBOARD_SENTINEL).text : '';
    resetToSentinel(el);
    if (pending.length > 0) {
      onTypeText(pending, true);
    } else {
      onPressKey(enterKey);
    }
  };

  return (
    <>
      <form
        onSubmit={handleSubmit}
        className="fixed left-2 top-14 w-4 h-4 overflow-hidden opacity-0 pointer-events-none z-10"
        aria-hidden={!keyboardFocused}
      >
        <input
          ref={inputRef}
          type="text"
          defaultValue={KEYBOARD_SENTINEL}
          inputMode="text"
          enterKeyHint="go"
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="none"
          spellCheck={false}
          aria-label="Telefon klaviaturasi kiritish"
          className="w-full h-full bg-transparent text-[16px] text-transparent caret-transparent border-0 outline-none p-0 m-0"
          onFocus={(e) => {
            if (!e.currentTarget.value) {
              resetToSentinel(e.currentTarget);
            }
            onFocusChange(true);
          }}
          onBlur={() => {
            composingRef.current = false;
            resetToSentinel(inputRef.current);
            onFocusChange(false);
          }}
          onCompositionStart={() => {
            composingRef.current = true;
          }}
          onCompositionEnd={(e) => {
            composingRef.current = false;
            flushInputValue(e.currentTarget.value, e.currentTarget);
          }}
          onChange={(e) => {
            if (composingRef.current || (e.nativeEvent as InputEvent)?.isComposing) return;
            flushInputValue(e.currentTarget.value, e.currentTarget);
          }}
          onKeyDown={handleKeyDown}
        />
      </form>

      <button
        type="button"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => {
          if (keyboardFocused) {
            inputRef.current?.blur();
          } else {
            focusMobileKeyboardInput(inputRef.current);
          }
        }}
        aria-pressed={keyboardFocused}
        aria-label={keyboardFocused ? 'Klaviaturani yopish' : 'Telefon klaviaturasini ochish'}
        title={keyboardFocused ? 'Klaviaturani yopish' : 'Klaviatura'}
        className={`absolute bottom-3 right-3 z-20 inline-flex items-center justify-center w-9 h-9 rounded-full border transition-all duration-150 cursor-pointer ${
          keyboardFocused
            ? 'bg-cyan-500/35 border-cyan-300/75 text-cyan-100 shadow-[0_0_18px_rgba(34,211,238,0.45)]'
            : 'bg-[#0F172A]/85 supports-[backdrop-filter]:bg-white/10 supports-[backdrop-filter]:backdrop-blur-xl border-white/25 text-white/85 hover:text-white hover:bg-white/20 shadow-[0_4px_14px_rgba(0,0,0,0.45)]'
        }`}
      >
        <Keyboard className="w-4 h-4" strokeWidth={1.75} />
      </button>
    </>
  );
}
