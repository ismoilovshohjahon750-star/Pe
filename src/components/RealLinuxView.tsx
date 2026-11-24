import { useEffect, useRef, useState } from 'react';
import {
  mapClientPointToScreen,
  type LinuxDesktopStatus,
  type RealAgentFrame,
} from '../desktop/bridge.ts';
import {
  isTouchCapableEnvironment,
  resolveKeyboardLockedPortrait,
} from '../utils/remoteKeyboard.ts';
import {
  focusMobileKeyboardInput,
  RemoteScreenKeyboardBridge,
} from './RemoteScreenKeyboardBridge.tsx';

interface RealLinuxViewProps {
  status: LinuxDesktopStatus;
  frame: RealAgentFrame | null;
  allowRotate?: boolean;
  onClickAt: (x: number, y: number, button: 'left' | 'right' | 'double') => void;
  onScrollAt: (x: number, y: number, deltaY: number) => void;
  onTypeText: (text: string, enter: boolean) => void;
  onPressKey: (key: string) => void;
  onRetry?: () => void;
}

const SPECIAL_KEY_MAP: Record<string, string> = {
  Enter: 'Return',
  Escape: 'Escape',
  Backspace: 'BackSpace',
  Tab: 'Tab',
  Delete: 'Delete',
  Home: 'Home',
  End: 'End',
  PageUp: 'Prior',
  PageDown: 'Next',
  ArrowUp: 'Up',
  ArrowDown: 'Down',
  ArrowLeft: 'Left',
  ArrowRight: 'Right',
  ' ': 'space',
};

export function RealLinuxView({
  status,
  frame,
  allowRotate = true,
  onClickAt,
  onScrollAt,
  onTypeText,
  onPressKey,
  onRetry,
}: RealLinuxViewProps) {
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

  const screenW = frame?.width || status.screenWidth || 1280;
  const screenH = frame?.height || status.screenHeight || 720;

  // Keep Linux screen horizontal (landscape) unless stacked vertically with J.A.R.V.I.S.,
  // and freeze rotation while the mobile virtual keyboard shrinks viewport height.
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
    if (e.metaKey) return;
    if (['Shift', 'Control', 'Alt', 'Meta', 'CapsLock'].includes(e.key)) return;

    if (e.ctrlKey && e.key.length === 1) {
      e.preventDefault();
      onPressKey(`ctrl+${e.key.toLowerCase()}`);
      return;
    }

    if (e.altKey && e.key === 'F4') {
      e.preventDefault();
      onPressKey('alt+F4');
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
      aria-label="Linux Desktop Screen"
      className="relative flex-1 min-h-0 w-full flex items-center justify-center bg-[#03060C] overflow-hidden focus:outline-none"
    >
      {frame?.data ? (
        <>
          <img
            src={`data:${frame.mimeType};base64,${frame.data}`}
            alt="Debian 12 Linux X11 desktop live stream"
            draggable={false}
            decoding="sync"
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
            enterKey="Return"
            backspaceKey="BackSpace"
            ctrlKeyCase="lower"
            altF4Key="alt+F4"
            onTypeText={onTypeText}
            onPressKey={onPressKey}
          />
        </>
      ) : (
        <div className="text-center space-y-2.5 p-6 max-w-md">
          <div className="text-sm font-medium text-slate-200">
            {status.error ? 'Linux X11 xatoligi' : 'Linux ekrani ishga tushmoqda...'}
          </div>
          {status.error && (
            <>
              <p className="text-xs text-slate-400 break-words">{status.error}</p>
              {onRetry && (
                <button
                  type="button"
                  onClick={onRetry}
                  className="px-3.5 py-1.5 rounded-full text-xs font-medium bg-white/10 hover:bg-white/15 border border-white/15 text-slate-100 transition-colors cursor-pointer"
                >
                  Qayta urinish
                </button>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
