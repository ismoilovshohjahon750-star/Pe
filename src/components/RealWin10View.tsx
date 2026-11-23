import { useEffect, useRef, useState } from 'react';
import {
  mapClientPointToScreen,
  type RealAgentFrame,
  type RealAgentStatus,
} from '../desktop/bridge.ts';
import {
  isTouchCapableEnvironment,
  resolveKeyboardLockedPortrait,
} from '../utils/remoteKeyboard.ts';
import {
  focusMobileKeyboardInput,
  RemoteScreenKeyboardBridge,
} from './RemoteScreenKeyboardBridge.tsx';

interface RealWin10ViewProps {
  status: RealAgentStatus;
  frame: RealAgentFrame | null;
  allowRotate?: boolean;
  onClickAt: (x: number, y: number, button: 'left' | 'right' | 'double') => void;
  onScrollAt: (x: number, y: number, deltaY: number) => void;
  onTypeText: (text: string, enter: boolean) => void;
  onPressKey: (key: string) => void;
}

const SPECIAL_KEY_MAP: Record<string, string> = {
  Enter: 'Enter',
  Escape: 'Escape',
  Backspace: 'Backspace',
  Tab: 'Tab',
  Delete: 'Delete',
  Home: 'Home',
  End: 'End',
  PageUp: 'PageUp',
  PageDown: 'PageDown',
  ArrowUp: 'ArrowUp',
  ArrowDown: 'ArrowDown',
  ArrowLeft: 'ArrowLeft',
  ArrowRight: 'ArrowRight',
};

export function RealWin10View({
  status,
  frame,
  allowRotate = true,
  onClickAt,
  onScrollAt,
  onTypeText,
  onPressKey,
}: RealWin10ViewProps) {
  const lastWheelAt = useRef(0);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mobileInputRef = useRef<HTMLInputElement | null>(null);
  const [keyboardFocused, setKeyboardFocused] = useState(false);
  const prevPortraitRef = useRef(false);
  const [boxSize, setBoxSize] = useState({ width: 1280, height: 720 });

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const update = () => {
      setBoxSize({
        width: el.clientWidth || window.innerWidth || 1280,
        height: el.clientHeight || window.innerHeight || 720,
      });
    };
    update();

    let ro: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(update);
      ro.observe(el);
    }
    window.addEventListener('resize', update);
    const vv = typeof window !== 'undefined' ? window.visualViewport : null;
    vv?.addEventListener('resize', update);

    return () => {
      ro?.disconnect();
      window.removeEventListener('resize', update);
      vv?.removeEventListener('resize', update);
    };
  }, []);

  const screenW = frame?.width || status.screenWidth || 1920;
  const screenH = frame?.height || status.screenHeight || 1080;

  const isPortrait = resolveKeyboardLockedPortrait(
    allowRotate,
    boxSize.width,
    boxSize.height,
    keyboardFocused,
    prevPortraitRef.current,
    screenW,
    screenH,
  );
  prevPortraitRef.current = isPortrait;

  const availW = isPortrait ? boxSize.height : boxSize.width;
  const availH = isPortrait ? boxSize.width : boxSize.height;
  const scale = Math.max(0.1, Math.min(availW / screenW, availH / screenH));
  const fitW = Math.floor(screenW * scale);
  const fitH = Math.floor(screenH * scale);

  const mapCoords = (e: React.MouseEvent<HTMLImageElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    return mapClientPointToScreen(e.clientX, e.clientY, rect, screenW, screenH, isPortrait);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.target === mobileInputRef.current) return;
    if (e.metaKey) return;
    if (['Shift', 'Control', 'Alt', 'Meta', 'CapsLock'].includes(e.key)) return;

    if (e.ctrlKey && e.key.toLowerCase() === 's') {
      e.preventDefault();
      onPressKey('Ctrl+S');
      return;
    }
    if (e.ctrlKey && e.key.toLowerCase() === 'c') {
      e.preventDefault();
      onPressKey('Ctrl+C');
      return;
    }
    if (e.ctrlKey && e.key.toLowerCase() === 'v') {
      e.preventDefault();
      onPressKey('Ctrl+V');
      return;
    }
    if (e.altKey && e.key === 'F4') {
      e.preventDefault();
      onPressKey('Alt+F4');
      return;
    }

    const mapped = SPECIAL_KEY_MAP[e.key];
    if (mapped) {
      e.preventDefault();
      onPressKey(mapped);
      return;
    }

    if (e.key.length === 1 && !e.ctrlKey && !e.altKey) {
      e.preventDefault();
      onTypeText(e.key, false);
    }
  };

  return (
    <div
      ref={containerRef}
      tabIndex={0}
      onKeyDown={handleKeyDown}
      aria-label="Real PC Screen"
      className="relative flex-1 min-h-0 w-full flex items-center justify-center bg-[#03060C] overflow-hidden focus:outline-none"
    >
      {frame?.data ? (
        <>
          <img
            src={`data:${frame.mimeType};base64,${frame.data}`}
            alt="Connected real PC live stream"
            draggable={false}
            style={{
              width: `${fitW}px`,
              height: `${fitH}px`,
              maxWidth: 'none',
              maxHeight: 'none',
              touchAction: 'manipulation',
              transform: isPortrait ? 'rotate(90deg)' : undefined,
            }}
            onClick={(e) => {
              const { x, y } = mapCoords(e);
              onClickAt(x, y, 'left');
              if (isTouchCapableEnvironment()) {
                focusMobileKeyboardInput(mobileInputRef.current);
              } else {
                containerRef.current?.focus();
              }
            }}
            onDoubleClick={(e) => {
              const { x, y } = mapCoords(e);
              onClickAt(x, y, 'double');
            }}
            onContextMenu={(e) => {
              e.preventDefault();
              const { x, y } = mapCoords(e);
              onClickAt(x, y, 'right');
            }}
            onWheel={(e) => {
              const now = Date.now();
              if (now - lastWheelAt.current < 80) return;
              lastWheelAt.current = now;
              const { x, y } = mapCoords(e);
              onScrollAt(x, y, e.deltaY);
            }}
            className="shrink-0 select-none cursor-default"
          />

          <RemoteScreenKeyboardBridge
            inputRef={mobileInputRef}
            keyboardFocused={keyboardFocused}
            onFocusChange={setKeyboardFocused}
            specialKeyMap={SPECIAL_KEY_MAP}
            enterKey="Enter"
            backspaceKey="Backspace"
            ctrlKeyCase="upper"
            altF4Key="Alt+F4"
            onTypeText={onTypeText}
            onPressKey={onPressKey}
          />

          {frame.width === 960 && frame.height === 540 && (
            <div className="absolute top-3 left-1/2 -translate-x-1/2 z-20 bg-slate-900/90 backdrop-blur-xl border border-sky-400/40 rounded-2xl px-4 py-2.5 flex flex-wrap items-center gap-3 shadow-2xl text-xs">
              <span className="w-2.5 h-2.5 rounded-full bg-sky-400 animate-pulse" />
              <span className="text-sky-200 font-medium">🔒 PC Qulflangan (Win+L) — Fonda MCP &amp; PowerShell faol</span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => onPressKey('Enter')}
                  className="px-2.5 py-1 rounded-xl bg-sky-500/30 hover:bg-sky-500/50 border border-sky-300/50 text-white font-medium transition"
                >
                  🔓 Qulfni Uyg&apos;otish (Enter)
                </button>
                <button
                  type="button"
                  onClick={() => onTypeText('powershell', true)}
                  className="px-2.5 py-1 rounded-xl bg-white/10 hover:bg-white/20 border border-white/20 text-white transition"
                >
                  ⚡ PowerShell
                </button>
              </div>
            </div>
          )}
        </>
      ) : (
        <div className="text-center space-y-2 p-6">
          <div className="text-sm font-medium text-slate-200">
            Ulangan qurilma (PC / Android) ekrani kutilmoqda...
          </div>
        </div>
      )}
    </div>
  );
}
