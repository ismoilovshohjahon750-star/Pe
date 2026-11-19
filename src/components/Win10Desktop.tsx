import { useEffect, useRef, useState } from 'react';
import { Maximize2, Minimize2, Minus, Search, Volume2, Wifi, X } from 'lucide-react';
import {
  DESKTOP_ICONS,
  PINNED_TASKBAR_APPS,
  START_MENU_APPS,
  TASKBAR_HEIGHT,
  TITLEBAR_HEIGHT,
  VIRTUAL_HEIGHT,
  VIRTUAL_WIDTH,
  WALLPAPERS,
  getWindowBounds,
} from '../desktop/engine.ts';
import type { AppId, DesktopState, DesktopWindow } from '../desktop/types.ts';
import { AppGlyph, Win10Logo } from './Win10Icons.tsx';
import { CalculatorApp } from './apps/CalculatorApp.tsx';
import { EdgeApp } from './apps/EdgeApp.tsx';
import { ExplorerApp } from './apps/ExplorerApp.tsx';
import { NotepadApp } from './apps/NotepadApp.tsx';
import { PaintApp } from './apps/PaintApp.tsx';
import { PowerShellApp } from './apps/PowerShellApp.tsx';
import { SettingsApp } from './apps/SettingsApp.tsx';
import { TaskManagerApp } from './apps/TaskManagerApp.tsx';

export interface DesktopActions {
  openApp: (appId: AppId, payload?: Record<string, unknown>) => void;
  focusWindow: (windowId: string) => void;
  closeWindow: (windowId: string) => void;
  minimizeWindow: (windowId: string) => void;
  maximizeWindow: (windowId: string) => void;
  moveWindow: (windowId: string, x: number, y: number) => void;
  resizeWindow: (windowId: string, width: number, height: number) => void;
  toggleStartMenu: (open?: boolean) => void;
  setWallpaper: (wallpaperId: string) => void;
  explorerCd: (windowId: string, path: string) => void;
  notepadEdit: (windowId: string, content: string) => void;
  notepadSave: (windowId: string) => void;
  powershellRun: (windowId: string, command: string) => void;
  edgeNavigate: (windowId: string, url: string) => void;
  paintStroke: (
    windowId: string,
    stroke: { color: string; width: number; points: Array<{ x: number; y: number }> },
  ) => void;
  paintClear: (windowId: string) => void;
  calculatorUpdate: (windowId: string, display: string, expression: string) => void;
  settingsSection: (windowId: string, section: 'system' | 'personalization' | 'mcp') => void;
  openMcpModal: () => void;
}

interface Win10DesktopProps {
  state: DesktopState;
  interactive: boolean;
  actions: DesktopActions;
}

export function Win10Desktop({ state, interactive, actions }: Win10DesktopProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const [selectedIconId, setSelectedIconId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [clockNow, setClockNow] = useState(() => new Date());

  const dragRef = useRef<{
    type: 'move' | 'resize';
    windowId: string;
    startClientX: number;
    startClientY: number;
    origX: number;
    origY: number;
    origW: number;
    origH: number;
  } | null>(null);

  useEffect(() => {
    const timer = setInterval(() => setClockNow(new Date()), 15000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const updateScale = () => {
      const rect = el.getBoundingClientRect();
      const availW = Math.max(160, rect.width - 16);
      const availH = Math.max(120, rect.height - 16);
      const s = Math.min(availW / VIRTUAL_WIDTH, availH / VIRTUAL_HEIGHT);
      setScale(Math.max(0.24, Math.min(s, 1.35)));
    };
    updateScale();
    const ro = new ResizeObserver(updateScale);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const handlePointerMove = (e: PointerEvent) => {
      const d = dragRef.current;
      if (!d) return;
      const dx = (e.clientX - d.startClientX) / scale;
      const dy = (e.clientY - d.startClientY) / scale;
      if (d.type === 'move') {
        actions.moveWindow(d.windowId, d.origX + dx, d.origY + dy);
      } else {
        actions.resizeWindow(d.windowId, d.origW + dx, d.origH + dy);
      }
    };
    const handlePointerUp = () => {
      dragRef.current = null;
    };
    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
    };
  }, [actions, scale]);

  const wallpaper = WALLPAPERS.find((w) => w.id === state.wallpaperId) || WALLPAPERS[0];
  const visibleWindows = [...state.windows]
    .filter((w) => !w.minimized)
    .sort((a, b) => a.zIndex - b.zIndex);

  const filteredStartApps = searchQuery.trim()
    ? START_MENU_APPS.filter((a) =>
        a.label.toLowerCase().includes(searchQuery.trim().toLowerCase()),
      )
    : START_MENU_APPS;

  const timeStr = clockNow.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const dateStr = clockNow.toLocaleDateString([], {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });

  const showClaudeCursor =
    state.cursor.actor === 'claude' || Date.now() - state.cursor.lastMovedAt < 8000;

  return (
    <div
      ref={containerRef}
      data-testid="win10-desktop-viewport"
      className="relative flex-1 w-full h-full min-h-[260px] flex items-center justify-center bg-[#060A12] overflow-hidden p-2 sm:p-3"
    >
      <div
        style={{
          width: VIRTUAL_WIDTH * scale,
          height: VIRTUAL_HEIGHT * scale,
        }}
        className="relative shrink-0 shadow-2xl border border-slate-800/90 overflow-hidden"
      >
        <div
          className="win10-shell absolute top-0 left-0 origin-top-left select-none overflow-hidden"
          style={{
            width: VIRTUAL_WIDTH,
            height: VIRTUAL_HEIGHT,
            transform: `scale(${scale})`,
            background: wallpaper.src
              ? '#051226'
              : `linear-gradient(135deg, #061326 0%, ${wallpaper.accentHex} 100%)`,
          }}
          onClick={() => {
            setSelectedIconId(null);
            if (state.startMenuOpen && interactive) {
              actions.toggleStartMenu(false);
            }
          }}
        >
          {/* Wallpaper Image with Fallback */}
          {wallpaper.src && (
            <img
              src={wallpaper.src}
              alt="Windows 10 Pro desktop wallpaper"
              referrerPolicy="no-referrer"
              className="absolute inset-0 w-full h-full object-cover pointer-events-none"
            />
          )}

          {/* Desktop Icons */}
          <div className="absolute inset-0 bottom-[40px] pointer-events-none">
            {DESKTOP_ICONS.map((icon) => {
              const selected = selectedIconId === icon.id || state.selectedIconId === icon.id;
              return (
                <button
                  key={icon.id}
                  type="button"
                  style={{ left: icon.x, top: icon.y, width: 82, height: 82 }}
                  onClick={(e) => {
                    e.stopPropagation();
                    setSelectedIconId(icon.id);
                  }}
                  onDoubleClick={(e) => {
                    e.stopPropagation();
                    if (interactive) actions.openApp(icon.appId, icon.payload);
                  }}
                  aria-label={`Desktop icon ${icon.label}`}
                  className={`pointer-events-auto absolute flex flex-col items-center justify-center gap-1.5 p-1.5 rounded-sm text-center transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-400 ${
                    selected
                      ? 'bg-sky-500/35 border border-sky-300/60'
                      : 'border border-transparent hover:bg-white/10'
                  }`}
                >
                  <AppGlyph appId={icon.appId} size={32} />
                  <span className="text-[11px] leading-tight text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.95)] line-clamp-2">
                    {icon.label}
                  </span>
                </button>
              );
            })}
          </div>

          {/* Open Windows */}
          {visibleWindows.map((win) => {
            const bounds = getWindowBounds(win);
            return (
              <div
                key={win.id}
                data-testid={`window-${win.appId}`}
                style={{
                  left: bounds.x,
                  top: bounds.y,
                  width: bounds.width,
                  height: bounds.height,
                  zIndex: win.zIndex + 10,
                }}
                onMouseDown={() => {
                  if (interactive && !win.focused) actions.focusWindow(win.id);
                }}
                className={`absolute flex flex-col bg-white overflow-hidden transition-shadow ${
                  win.focused
                    ? 'ring-1 ring-[#0078D4] shadow-[0_18px_42px_rgba(0,0,0,0.55)]'
                    : 'ring-1 ring-slate-700/60 shadow-[0_8px_22px_rgba(0,0,0,0.35)]'
                }`}
              >
                {/* Titlebar */}
                <div
                  style={{ height: TITLEBAR_HEIGHT }}
                  onPointerDown={(e) => {
                    if (!interactive) return;
                    actions.focusWindow(win.id);
                    if ((e.target as HTMLElement).closest('button')) return;
                    if (win.maximized) return;
                    dragRef.current = {
                      type: 'move',
                      windowId: win.id,
                      startClientX: e.clientX,
                      startClientY: e.clientY,
                      origX: win.x,
                      origY: win.y,
                      origW: win.width,
                      origH: win.height,
                    };
                  }}
                  onDoubleClick={() => {
                    if (interactive) actions.maximizeWindow(win.id);
                  }}
                  className={`flex items-center justify-between pl-2.5 shrink-0 select-none ${
                    win.focused ? 'bg-white text-slate-900' : 'bg-slate-100 text-slate-600'
                  } border-b border-slate-200`}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <AppGlyph appId={win.appId} size={15} />
                    <span className="text-xs font-medium truncate">{win.title}</span>
                  </div>

                  <div className="flex items-center h-full shrink-0">
                    <button
                      type="button"
                      disabled={!interactive}
                      onClick={() => actions.minimizeWindow(win.id)}
                      aria-label={`Minimize ${win.title}`}
                      className="w-[46px] h-full flex items-center justify-center hover:bg-slate-200 disabled:opacity-50"
                    >
                      <Minus className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      disabled={!interactive}
                      onClick={() => actions.maximizeWindow(win.id)}
                      aria-label={`Maximize ${win.title}`}
                      className="w-[46px] h-full flex items-center justify-center hover:bg-slate-200 disabled:opacity-50"
                    >
                      {win.maximized ? (
                        <Minimize2 className="w-3 h-3" />
                      ) : (
                        <Maximize2 className="w-3 h-3" />
                      )}
                    </button>
                    <button
                      type="button"
                      disabled={!interactive}
                      onClick={() => actions.closeWindow(win.id)}
                      aria-label={`Close ${win.title}`}
                      className="w-[46px] h-full flex items-center justify-center hover:bg-[#E81123] hover:text-white disabled:opacity-50"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                {/* Window App Body */}
                <div className="flex-1 min-h-0 overflow-hidden relative">
                  {renderWindowApp(win, state, interactive, actions)}
                </div>

                {/* Bottom-Right Resize Grip */}
                {!win.maximized && interactive && (
                  <div
                    onPointerDown={(e) => {
                      e.stopPropagation();
                      dragRef.current = {
                        type: 'resize',
                        windowId: win.id,
                        startClientX: e.clientX,
                        startClientY: e.clientY,
                        origX: win.x,
                        origY: win.y,
                        origW: win.width,
                        origH: win.height,
                      };
                    }}
                    className="absolute right-0 bottom-0 w-3.5 h-3.5 cursor-nwse-resize"
                  />
                )}
              </div>
            );
          })}

          {/* Start Menu */}
          {state.startMenuOpen && (
            <div
              onClick={(e) => e.stopPropagation()}
              style={{ bottom: TASKBAR_HEIGHT, left: 0, width: 470, height: 460, zIndex: 900 }}
              className="absolute flex bg-[#18181B]/95 backdrop-blur-md text-slate-100 border-t border-r border-slate-700/80 shadow-2xl"
            >
              {/* Left Rail */}
              <div className="w-12 bg-[#111115] flex flex-col items-center justify-end py-3 gap-3 border-r border-slate-800">
                <div
                  title="Claude AI Administrator"
                  className="w-7 h-7 rounded-full bg-[#0078D4] flex items-center justify-center text-[11px] font-semibold text-white"
                >
                  CA
                </div>
                <button
                  type="button"
                  onClick={() => actions.openApp('settings', { section: 'system' })}
                  aria-label="Open Windows Settings"
                  className="p-2 hover:bg-white/10 rounded"
                >
                  <AppGlyph appId="settings" size={16} />
                </button>
              </div>

              {/* App List */}
              <div className="w-48 py-2 px-1.5 overflow-y-auto win10-scroll border-r border-slate-800">
                <div className="px-2 py-1 text-[11px] font-semibold text-slate-400">
                  All Applications
                </div>
                {filteredStartApps.map((app) => (
                  <button
                    key={app.appId}
                    type="button"
                    disabled={!interactive}
                    onClick={() => {
                      actions.openApp(app.appId);
                      setSearchQuery('');
                    }}
                    className="w-full flex items-center gap-2.5 px-2 py-2 text-xs text-left hover:bg-white/10 rounded-sm disabled:opacity-60"
                  >
                    <AppGlyph appId={app.appId} size={18} />
                    <span className="truncate">{app.label}</span>
                  </button>
                ))}
              </div>

              {/* Metro Tiles */}
              <div className="flex-1 p-3 overflow-y-auto">
                <div className="text-[11px] font-semibold text-slate-400 mb-2">
                  Claude AI Workstation
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {START_MENU_APPS.slice(0, 6).map((app) => (
                    <button
                      key={app.appId}
                      type="button"
                      disabled={!interactive}
                      onClick={() => actions.openApp(app.appId)}
                      className="h-20 p-2.5 bg-[#0078D4]/85 hover:bg-[#0078D4] flex flex-col justify-between items-start text-left transition-colors disabled:opacity-60"
                    >
                      <AppGlyph appId={app.appId} size={22} />
                      <span className="text-[11px] font-medium text-white truncate w-full">
                        {app.label}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Windows 10 Taskbar */}
          <div
            onClick={(e) => e.stopPropagation()}
            style={{ height: TASKBAR_HEIGHT, zIndex: 950 }}
            className="absolute bottom-0 left-0 right-0 bg-[#101014]/95 backdrop-blur-md border-t border-white/10 flex items-center justify-between text-white"
          >
            <div className="flex items-center h-full min-w-0">
              {/* Start Button */}
              <button
                type="button"
                aria-label="Start Menu"
                disabled={!interactive}
                onClick={() => actions.toggleStartMenu()}
                className={`w-12 h-full flex items-center justify-center hover:bg-white/10 transition-colors shrink-0 ${
                  state.startMenuOpen ? 'bg-white/15 text-[#38BDF8]' : 'text-white hover:text-[#38BDF8]'
                }`}
              >
                <Win10Logo className="w-4 h-4" />
              </button>

              {/* Search Box */}
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  if (interactive && filteredStartApps[0]) {
                    actions.openApp(filteredStartApps[0].appId);
                    setSearchQuery('');
                  }
                }}
                className="flex items-center gap-2 w-48 h-full bg-white text-slate-800 px-3 border-r border-slate-300 shrink-0"
              >
                <Search className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                <input
                  type="text"
                  aria-label="Type here to search Windows"
                  value={searchQuery}
                  onFocus={() => {
                    if (interactive && !state.startMenuOpen) actions.toggleStartMenu(true);
                  }}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  readOnly={!interactive}
                  placeholder="Type here to search"
                  className="w-full text-xs bg-transparent focus:outline-none placeholder:text-slate-500"
                />
              </form>

              {/* Pinned Taskbar Icons */}
              <div className="flex items-center h-full px-1 border-r border-white/10 shrink-0">
                {PINNED_TASKBAR_APPS.map((appId) => {
                  const openWin = state.windows.find((w) => w.appId === appId);
                  return (
                    <button
                      key={appId}
                      type="button"
                      disabled={!interactive}
                      onClick={() => {
                        if (!openWin) {
                          actions.openApp(appId);
                        } else if (openWin.focused && !openWin.minimized) {
                          actions.minimizeWindow(openWin.id);
                        } else {
                          actions.focusWindow(openWin.id);
                        }
                      }}
                      aria-label={`Taskbar ${appId}`}
                      className={`relative w-10 h-full flex items-center justify-center hover:bg-white/10 transition-colors ${
                        openWin?.focused ? 'bg-white/15' : ''
                      }`}
                    >
                      <AppGlyph appId={appId} size={18} />
                      {openWin && (
                        <span
                          className={`absolute bottom-0 left-1.5 right-1.5 h-0.5 ${
                            openWin.focused ? 'bg-[#38BDF8]' : 'bg-slate-400'
                          }`}
                        />
                      )}
                    </button>
                  );
                })}
              </div>

              {/* Open Window Tabs */}
              <div className="flex items-center h-full overflow-x-auto px-1 gap-0.5">
                {state.windows.map((w) => (
                  <button
                    key={w.id}
                    type="button"
                    disabled={!interactive}
                    onClick={() => {
                      if (w.focused && !w.minimized) {
                        actions.minimizeWindow(w.id);
                      } else {
                        actions.focusWindow(w.id);
                      }
                    }}
                    className={`relative h-full max-w-[155px] px-2.5 flex items-center gap-2 text-xs hover:bg-white/10 transition-colors shrink-0 ${
                      w.focused && !w.minimized ? 'bg-white/15 text-white' : 'text-slate-300'
                    }`}
                  >
                    <AppGlyph appId={w.appId} size={14} />
                    <span className="truncate">{w.title}</span>
                    <span
                      className={`absolute bottom-0 left-0 right-0 h-0.5 ${
                        w.focused && !w.minimized ? 'bg-[#0078D4]' : 'bg-slate-500/60'
                      }`}
                    />
                  </button>
                ))}
              </div>
            </div>

            {/* System Tray */}
            <div className="flex items-center h-full px-3 gap-3 text-[11px] text-slate-200 shrink-0">
              <Wifi className="w-3.5 h-3.5" aria-hidden="true" />
              <Volume2 className="w-3.5 h-3.5" aria-hidden="true" />
              <div className="text-right leading-tight font-mono-tabular">
                <div>{timeStr}</div>
                <div className="text-[10px] text-slate-400">{dateStr}</div>
              </div>
            </div>
          </div>

          {/* Live Claude AI Cursor Overlay */}
          {showClaudeCursor && (
            <div
              style={{
                transform: `translate3d(${state.cursor.x}px, ${state.cursor.y}px, 0)`,
                zIndex: 999,
              }}
              className="pointer-events-none absolute top-0 left-0 transition-transform duration-200 ease-out"
            >
              {state.cursor.clicking && (
                <span className="absolute -left-3 -top-3 w-7 h-7 rounded-full border-2 border-sky-400 animate-ping" />
              )}
              <svg width="20" height="24" viewBox="0 0 20 24" fill="none" aria-hidden="true">
                <path
                  d="M2 2L17 13.5L10.2 14.3L13.5 21L10.7 22.3L7.4 15.6L2 19.5V2Z"
                  fill="#FFFFFF"
                  stroke="#0F172A"
                  strokeWidth="1.5"
                />
              </svg>
              {state.cursor.actor === 'claude' && (
                <div className="ml-4 -mt-1 px-1.5 py-0.5 bg-[#0078D4] text-white text-[10px] font-medium shadow whitespace-nowrap">
                  Claude AI
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function renderWindowApp(
  win: DesktopWindow,
  state: DesktopState,
  interactive: boolean,
  actions: DesktopActions,
) {
  switch (win.appId) {
    case 'explorer':
      return (
        <ExplorerApp
          win={win}
          interactive={interactive}
          onChangePath={actions.explorerCd}
          onOpenFileInNotepad={(filePath, content) =>
            actions.openApp('notepad', { filePath, content })
          }
        />
      );
    case 'powershell':
      return (
        <PowerShellApp
          win={win}
          interactive={interactive}
          onRunCommand={actions.powershellRun}
        />
      );
    case 'edge':
      return (
        <EdgeApp
          win={win}
          interactive={interactive}
          onNavigate={actions.edgeNavigate}
        />
      );
    case 'notepad':
      return (
        <NotepadApp
          win={win}
          interactive={interactive}
          onEdit={actions.notepadEdit}
          onSave={actions.notepadSave}
        />
      );
    case 'paint':
      return (
        <PaintApp
          win={win}
          interactive={interactive}
          onAddStroke={actions.paintStroke}
          onClear={actions.paintClear}
        />
      );
    case 'taskmgr':
      return (
        <TaskManagerApp
          win={win}
          desktopState={state}
          onCloseTargetWindow={actions.closeWindow}
        />
      );
    case 'settings':
      return (
        <SettingsApp
          win={win}
          desktopState={state}
          interactive={interactive}
          onChangeSection={actions.settingsSection}
          onChangeWallpaper={actions.setWallpaper}
          onOpenMcpModal={actions.openMcpModal}
        />
      );
    case 'calculator':
      return (
        <CalculatorApp
          win={win}
          interactive={interactive}
          onUpdate={actions.calculatorUpdate}
        />
      );
  }
}
