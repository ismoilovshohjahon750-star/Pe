import { Eye, EyeOff, KeyRound, Lock, ShieldAlert, Unlock } from 'lucide-react';
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

export interface UnlockPcResult {
  ok: boolean;
  message?: string;
  error?: string;
}

interface RealWin10ViewProps {
  status: RealAgentStatus;
  frame: RealAgentFrame | null;
  allowRotate?: boolean;
  onClickAt: (x: number, y: number, button: 'left' | 'right' | 'double') => void;
  onScrollAt: (x: number, y: number, deltaY: number) => void;
  onTypeText: (text: string, enter: boolean) => void;
  onPressKey: (key: string) => void;
  onUnlockPc?: (payload: { pin?: string; wake?: boolean; sas?: boolean }) => Promise<UnlockPcResult>;
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
  onUnlockPc,
}: RealWin10ViewProps) {
  const lastWheelAt = useRef(0);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mobileInputRef = useRef<HTMLInputElement | null>(null);
  const [keyboardFocused, setKeyboardFocused] = useState(false);
  const prevPortraitRef = useRef(false);
  const [boxSize, setBoxSize] = useState({ width: 1280, height: 720 });
  const [pcPin, setPcPin] = useState('');
  const [showPcPin, setShowPcPin] = useState(false);
  const [unlockBusy, setUnlockBusy] = useState(false);
  const [unlockFeedback, setUnlockFeedback] = useState<UnlockPcResult | null>(null);

  const isPcLocked = Boolean(frame?.locked || (frame && frame.width === 960 && frame.height === 540));

  useEffect(() => {
    if (!isPcLocked) {
      setPcPin('');
      setUnlockFeedback(null);
      setUnlockBusy(false);
    }
  }, [isPcLocked]);

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
    const target = e.target as HTMLElement | null;
    if (target === mobileInputRef.current) return;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;
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

  const submitPcUnlock = async (payload: { pin?: string; wake?: boolean; sas?: boolean }) => {
    if (!onUnlockPc) {
      if (payload.pin) {
        onTypeText(payload.pin, true);
      } else {
        onPressKey('Space');
      }
      return;
    }
    setUnlockBusy(true);
    setUnlockFeedback(null);
    try {
      const res = await onUnlockPc(payload);
      setUnlockFeedback(res);
      if (res.ok && payload.pin) {
        setPcPin('');
      }
    } catch (err) {
      setUnlockFeedback({
        ok: false,
        error: err instanceof Error ? err.message : 'Qulfni ochishda xatolik yuz berdi.',
      });
    } finally {
      setUnlockBusy(false);
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

          {isPcLocked && (
            <div
              data-testid="pc-lock-unlock-bar"
              className="absolute top-3 left-1/2 -translate-x-1/2 z-20 w-[min(94vw,680px)] bg-[#0A111E]/92 backdrop-blur-xl border border-sky-400/35 rounded-2xl px-3.5 py-2.5 shadow-2xl text-xs space-y-2"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <Lock className="w-3.5 h-3.5 text-sky-400 shrink-0" strokeWidth={2} />
                  <span className="text-sky-100 font-medium truncate">
                    {frame.lockServiceReady
                      ? 'PC Qulflangan (Win+L) — Jonli Winlogon tayyor'
                      : 'PC Qulflangan (Win+L) — Kod bilan ochish'}
                  </span>
                </div>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    disabled={unlockBusy}
                    onClick={() => void submitPcUnlock({ wake: true })}
                    className="px-2.5 py-1 rounded-xl bg-white/10 hover:bg-white/15 border border-white/15 text-slate-100 transition disabled:opacity-50"
                    title="Qulf pardasini ko'tarish (Space)"
                  >
                    Uyg&apos;otish
                  </button>
                  <button
                    type="button"
                    disabled={unlockBusy}
                    onClick={() => void submitPcUnlock({ sas: true })}
                    className="px-2.5 py-1 rounded-xl bg-white/10 hover:bg-white/15 border border-white/15 text-slate-100 transition disabled:opacity-50"
                    title="Ctrl+Alt+Del yuborish"
                  >
                    Ctrl+Alt+Del
                  </button>
                </div>
              </div>

              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!pcPin) return;
                  void submitPcUnlock({ pin: pcPin, wake: true });
                }}
                className="flex flex-wrap items-center gap-2"
              >
                <div className="relative flex-1 min-w-[180px]">
                  <KeyRound
                    className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
                    strokeWidth={1.75}
                  />
                  <input
                    type={showPcPin ? 'text' : 'password'}
                    value={pcPin}
                    onChange={(e) => setPcPin(e.target.value)}
                    placeholder="Windows PIN yoki parolni kiriting"
                    aria-label="Windows PIN yoki parol"
                    autoComplete="off"
                    className="w-full h-9 pl-8 pr-9 rounded-xl bg-[#050912] border border-slate-700/80 text-white placeholder:text-slate-500 text-xs focus:outline-none focus:border-sky-400"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPcPin((v) => !v)}
                    aria-label={showPcPin ? 'Parolni yashirish' : 'Parolni ko‘rsatish'}
                    className="absolute right-1.5 top-1/2 -translate-y-1/2 w-6 h-6 rounded-lg flex items-center justify-center text-slate-400 hover:text-white"
                  >
                    {showPcPin ? (
                      <EyeOff className="w-3.5 h-3.5" strokeWidth={1.75} />
                    ) : (
                      <Eye className="w-3.5 h-3.5" strokeWidth={1.75} />
                    )}
                  </button>
                </div>
                <button
                  type="submit"
                  disabled={unlockBusy || !pcPin}
                  className="h-9 px-3.5 rounded-xl bg-sky-500 hover:bg-sky-400 disabled:bg-slate-800 disabled:text-slate-500 text-white font-semibold flex items-center gap-1.5 transition"
                >
                  <Unlock className="w-3.5 h-3.5" strokeWidth={2} />
                  <span>{unlockBusy ? 'Ochilyapti...' : 'Qulfni Ochish'}</span>
                </button>
              </form>

              {unlockFeedback && (
                <div
                  role="alert"
                  className={`rounded-xl px-3 py-2 border flex items-start gap-2 text-[11px] leading-relaxed ${
                    unlockFeedback.ok
                      ? 'bg-emerald-500/15 border-emerald-400/35 text-emerald-200'
                      : 'bg-amber-500/15 border-amber-400/35 text-amber-100'
                  }`}
                >
                  <ShieldAlert className="w-3.5 h-3.5 shrink-0 mt-0.5" strokeWidth={2} />
                  <span>{unlockFeedback.ok ? unlockFeedback.message : unlockFeedback.error}</span>
                </div>
              )}
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
