import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Eye, EyeOff, Lock, Unlock } from 'lucide-react';
import {
  isWinLockShortcut,
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
  const [unlockCode, setUnlockCode] = useState('');
  const [showCode, setShowCode] = useState(false);
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
  const isLocked = Boolean(frame?.locked ?? status.locked);
  const isReconnecting = Boolean(status.reconnecting);

  const isPortrait = resolveKeyboardLockedPortrait(
    allowRotate,
    boxSize.width,
    boxSize.height,
    keyboardFocused,
    prevPortraitRef.current,
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
    if (isWinLockShortcut(e.key, e.metaKey, e.ctrlKey, e.altKey)) {
      e.preventDefault();
      onPressKey('Win+L');
      return;
    }
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
    if (e.ctrlKey && e.key.toLowerCase() === 'a') {
      e.preventDefault();
      onPressKey('Ctrl+A');
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

  const handleUnlockSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!unlockCode) return;
    onTypeText(unlockCode, true);
    setUnlockCode('');
  };

  return (
    <div
      ref={containerRef}
      tabIndex={0}
      onKeyDown={handleKeyDown}
      aria-label="Real PC Screen"
      data-locked={isLocked ? 'true' : 'false'}
      data-reconnecting={isReconnecting ? 'true' : 'false'}
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

          {isReconnecting && (
            <div
              role="status"
              aria-live="polite"
              className="absolute top-3 left-1/2 -translate-x-1/2 z-20 inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-[#0F172A]/90 supports-[backdrop-filter]:bg-[#0F172A]/75 supports-[backdrop-filter]:backdrop-blur-xl border border-amber-300/35 text-xs font-medium text-amber-100 shadow-[0_6px_20px_rgba(0,0,0,0.5)]"
            >
              <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" aria-hidden="true" />
              <span>Aloqa tiklanmoqda...</span>
            </div>
          )}

          {isLocked && (
            <form
              onSubmit={handleUnlockSubmit}
              onKeyDown={(e) => e.stopPropagation()}
              aria-label="Windows qulfini ochish"
              className="absolute bottom-14 sm:bottom-3 left-1/2 -translate-x-1/2 z-20 w-[calc(100%-1.5rem)] max-w-md flex flex-wrap sm:flex-nowrap items-center gap-2 px-3 py-2 rounded-2xl bg-[#0B1220]/92 supports-[backdrop-filter]:bg-[#0B1220]/80 supports-[backdrop-filter]:backdrop-blur-2xl border border-cyan-300/35 shadow-[0_12px_32px_rgba(0,0,0,0.65)]"
            >
              <button
                type="button"
                onClick={() => onPressKey('Space')}
                title="Qulf ekranini uyg'otish (Space)"
                aria-label="Qulf ekranini uyg'otish"
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl bg-white/10 hover:bg-white/15 border border-white/20 text-[11px] font-medium text-cyan-100 whitespace-nowrap cursor-pointer transition-colors"
              >
                <Lock className="w-3.5 h-3.5 text-cyan-300" strokeWidth={1.75} />
                <span>Uyg‘otish</span>
              </button>

              <div className="relative flex-1 min-w-[140px] flex items-center">
                <input
                  type={showCode ? 'text' : 'password'}
                  value={unlockCode}
                  onChange={(e) => setUnlockCode(e.target.value)}
                  placeholder="PIN yoki parol..."
                  aria-label="PIN yoki parol"
                  autoComplete="off"
                  className="w-full pl-3 pr-8 py-1.5 rounded-xl bg-black/40 border border-white/20 text-xs text-white placeholder:text-slate-400 focus:outline-none focus:border-cyan-300/60"
                />
                <button
                  type="button"
                  onClick={() => setShowCode((prev) => !prev)}
                  aria-label={showCode ? 'Kodni yashirish' : "Kodni ko'rsatish"}
                  className="absolute right-2 text-slate-300 hover:text-white cursor-pointer"
                >
                  {showCode ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                </button>
              </div>

              <button
                type="submit"
                disabled={!unlockCode}
                aria-label="Kodni yuborib ochish"
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-cyan-500/30 hover:bg-cyan-500/45 disabled:opacity-45 border border-cyan-300/50 text-xs font-semibold text-white whitespace-nowrap cursor-pointer transition-colors"
              >
                <Unlock className="w-3.5 h-3.5" strokeWidth={1.75} />
                <span>Ochish</span>
              </button>
            </form>
          )}

          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => onPressKey('Win+L')}
            aria-label="PC ni qulflash (Win+L)"
            title="PC ni qulflash (Win+L)"
            className={`absolute bottom-3 right-14 z-20 inline-flex items-center justify-center gap-1.5 h-9 px-3 rounded-full border text-[11px] font-medium transition-all duration-150 cursor-pointer ${
              isLocked
                ? 'bg-cyan-500/30 border-cyan-300/70 text-cyan-100 shadow-[0_0_16px_rgba(34,211,238,0.4)]'
                : 'bg-[#0F172A]/85 supports-[backdrop-filter]:bg-white/10 supports-[backdrop-filter]:backdrop-blur-xl border-white/25 text-white/85 hover:text-white hover:bg-white/20 shadow-[0_4px_14px_rgba(0,0,0,0.45)]'
            }`}
          >
            <Lock className="w-3.5 h-3.5" strokeWidth={1.75} />
            <span>Win+L</span>
          </button>

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
        </>
      ) : (
        <div className="text-center space-y-2 p-6">
          <div className="text-sm font-medium text-slate-200">
            Haqiqiy PC ekrani kutilmoqda...
          </div>
        </div>
      )}
    </div>
  );
}
