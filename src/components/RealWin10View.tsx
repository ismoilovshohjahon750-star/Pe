import { useEffect, useRef, useState } from 'react';
import {
  mapClientPointToScreen,
  type RealAgentFrame,
  type RealAgentStatus,
} from '../desktop/bridge.ts';

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
  const [boxSize, setBoxSize] = useState({ width: 1280, height: 720 });

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const update = () => {
      setBoxSize({
        width: el.clientWidth || 1280,
        height: el.clientHeight || 720,
      });
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const screenW = frame?.width || status.screenWidth || 1920;
  const screenH = frame?.height || status.screenHeight || 1080;

  const isPortrait = allowRotate && boxSize.height > boxSize.width && boxSize.width > 0;
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
      className="flex-1 min-h-0 w-full flex items-center justify-center bg-[#03060C] overflow-hidden focus:outline-none"
    >
      {frame?.data ? (
        <img
          src={`data:${frame.mimeType};base64,${frame.data}`}
          alt="Connected real PC live stream"
          draggable={false}
          style={{
            width: `${fitW}px`,
            height: `${fitH}px`,
            maxWidth: 'none',
            maxHeight: 'none',
            transform: isPortrait ? 'rotate(90deg)' : undefined,
          }}
          onClick={(e) => {
            containerRef.current?.focus();
            const { x, y } = mapCoords(e);
            onClickAt(x, y, 'left');
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
