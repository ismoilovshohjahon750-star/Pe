import type {
  AppId,
  DesktopIconDef,
  DesktopState,
  DesktopWindow,
  HitTestResult,
  McpActivityEntry,
  WallpaperOption,
} from './types.ts';

export const VIRTUAL_WIDTH = 1280;
export const VIRTUAL_HEIGHT = 720;
export const TASKBAR_HEIGHT = 40;
export const TITLEBAR_HEIGHT = 32;

export const WALLPAPERS: WallpaperOption[] = [
  {
    id: 'win10-hero',
    name: 'Windows 10 Hero Prism',
    src: '/src/assets/images/win10_hero_wallpaper_1795102455685.jpg',
    accentHex: '#0078D4',
  },
  {
    id: 'win10-cobalt',
    name: 'Windows Cobalt Matte',
    src: '',
    accentHex: '#0063B1',
  },
  {
    id: 'win10-midnight',
    name: 'Slate Workstation Dark',
    src: '',
    accentHex: '#2563EB',
  },
];

export const DESKTOP_ICONS: DesktopIconDef[] = [
  { id: 'icon-explorer', appId: 'explorer', label: 'This PC', x: 18, y: 18 },
  {
    id: 'icon-docs',
    appId: 'explorer',
    label: 'Claude Docs',
    x: 18,
    y: 108,
    payload: { path: 'C:\\Users\\Claude\\Documents' },
  },
  { id: 'icon-powershell', appId: 'powershell', label: 'PowerShell', x: 18, y: 198 },
  { id: 'icon-edge', appId: 'edge', label: 'Microsoft Edge', x: 18, y: 288 },
  {
    id: 'icon-notepad',
    appId: 'notepad',
    label: 'Notepad',
    x: 18,
    y: 378,
    payload: {
      filePath: 'C:\\Users\\Claude\\Desktop\\Welcome_Claude.txt',
    },
  },
  { id: 'icon-paint', appId: 'paint', label: 'Paint', x: 18, y: 468 },
  { id: 'icon-taskmgr', appId: 'taskmgr', label: 'Task Manager', x: 112, y: 18 },
  { id: 'icon-settings', appId: 'settings', label: 'Settings', x: 112, y: 108 },
  { id: 'icon-calc', appId: 'calculator', label: 'Calculator', x: 112, y: 198 },
];

export const START_MENU_APPS: Array<{ appId: AppId; label: string; category: string }> = [
  { appId: 'explorer', label: 'File Explorer', category: 'System' },
  { appId: 'powershell', label: 'Windows PowerShell', category: 'Developer' },
  { appId: 'edge', label: 'Microsoft Edge', category: 'Internet' },
  { appId: 'notepad', label: 'Notepad', category: 'Productivity' },
  { appId: 'paint', label: 'Paint', category: 'Creativity' },
  { appId: 'calculator', label: 'Calculator', category: 'Utilities' },
  { appId: 'taskmgr', label: 'Task Manager', category: 'System' },
  { appId: 'settings', label: 'Settings', category: 'System' },
];

export const PINNED_TASKBAR_APPS: AppId[] = ['explorer', 'edge', 'powershell', 'notepad', 'paint'];

export function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}

export function createWindowForApp(
  appId: AppId,
  zIndex: number,
  existingCount: number,
  payload?: Record<string, unknown>,
): DesktopWindow {
  const offset = (existingCount % 5) * 28;
  const id = `win-${appId}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

  switch (appId) {
    case 'explorer': {
      const targetPath =
        typeof payload?.path === 'string' && payload.path.trim()
          ? payload.path
          : 'C:\\Users\\Claude\\Desktop';
      return {
        id,
        appId,
        title: 'File Explorer',
        x: 190 + offset,
        y: 64 + offset,
        width: 720,
        height: 460,
        zIndex,
        minimized: false,
        maximized: false,
        focused: true,
        explorer: {
          currentPath: targetPath,
          selectedName: null,
        },
      };
    }
    case 'powershell':
      return {
        id,
        appId,
        title: 'Windows PowerShell',
        x: 240 + offset,
        y: 90 + offset,
        width: 740,
        height: 440,
        zIndex,
        minimized: false,
        maximized: false,
        focused: true,
        powershell: {
          cwd: 'C:\\Users\\Claude',
          running: false,
          lines: [
            {
              id: 'ps-init-1',
              kind: 'info',
              text: 'Windows PowerShell — Microsoft Windows 10 Pro (Build 19045.4651)',
            },
            {
              id: 'ps-init-2',
              kind: 'info',
              text: 'MCP Sandbox Drive mounted at C:\\Users\\Claude. Ready for Claude AI.',
            },
          ],
        },
      };
    case 'edge': {
      const initialUrl =
        typeof payload?.url === 'string' && payload.url.trim()
          ? payload.url
          : 'https://modelcontextprotocol.io';
      return {
        id,
        appId,
        title: 'Microsoft Edge',
        x: 150 + offset,
        y: 48 + offset,
        width: 860,
        height: 540,
        zIndex,
        minimized: false,
        maximized: false,
        focused: true,
        edge: {
          activeTabId: 'tab-1',
          tabs: [
            {
              id: 'tab-1',
              title: 'ClaudeWin 10 Pro Start',
              url: initialUrl,
              contentText:
                typeof payload?.contentText === 'string'
                  ? payload.contentText
                  : 'Welcome to Microsoft Edge on ClaudeWin 10 Pro. Enter any URL or let Claude AI call browser_navigate via MCP to browse pages live.',
              links: [],
              loading: false,
            },
          ],
        },
      };
    }
    case 'notepad': {
      const filePath =
        typeof payload?.filePath === 'string' && payload.filePath.trim()
          ? payload.filePath
          : 'C:\\Users\\Claude\\Desktop\\Untitled.txt';
      const content =
        typeof payload?.content === 'string'
          ? payload.content
          : 'ClaudeWin 10 Pro Workstation\r\nConnected via Model Context Protocol (MCP).\r\n';
      const fileName = filePath.split('\\').pop() || 'Untitled.txt';
      return {
        id,
        appId,
        title: `${fileName} - Notepad`,
        x: 280 + offset,
        y: 110 + offset,
        width: 620,
        height: 430,
        zIndex,
        minimized: false,
        maximized: false,
        focused: true,
        notepad: {
          filePath,
          content,
          dirty: false,
        },
      };
    }
    case 'paint':
      return {
        id,
        appId,
        title: 'Untitled - Paint',
        x: 210 + offset,
        y: 76 + offset,
        width: 720,
        height: 490,
        zIndex,
        minimized: false,
        maximized: false,
        focused: true,
        paint: {
          strokes: [],
          activeColor: '#0078D4',
          brushSize: 4,
        },
      };
    case 'taskmgr':
      return {
        id,
        appId,
        title: 'Task Manager',
        x: 310 + offset,
        y: 96 + offset,
        width: 580,
        height: 420,
        zIndex,
        minimized: false,
        maximized: false,
        focused: true,
      };
    case 'settings':
      return {
        id,
        appId,
        title: 'Settings',
        x: 220 + offset,
        y: 72 + offset,
        width: 700,
        height: 470,
        zIndex,
        minimized: false,
        maximized: false,
        focused: true,
        settings: {
          section:
            payload?.section === 'personalization' || payload?.section === 'mcp'
              ? payload.section
              : 'system',
        },
      };
    case 'calculator':
      return {
        id,
        appId,
        title: 'Calculator',
        x: 420 + offset,
        y: 120 + offset,
        width: 320,
        height: 450,
        zIndex,
        minimized: false,
        maximized: false,
        focused: true,
        calculator: {
          display: '0',
          expression: '',
        },
      };
  }
}

export function createInitialDesktopState(): DesktopState {
  const welcomeWindow = createWindowForApp('notepad', 1, 0, {
    filePath: 'C:\\Users\\Claude\\Desktop\\Welcome_Claude.txt',
    content: [
      'ClaudeWin 10 Pro — Dedicated AI Workstation',
      '==========================================',
      '',
      'Status: Ready for Claude AI via Model Context Protocol (MCP)',
      'Drive:  C:\\Users\\Claude (Persistent Sandbox)',
      '',
      'Available capabilities for Claude AI:',
      '  - Mouse & keyboard control (desktop_click, desktop_type, desktop_key)',
      '  - Live PNG screen inspection (desktop_screenshot)',
      '  - PowerShell / Node / Python execution (run_powershell)',
      '  - Real file system read/write (file_list, file_read, file_write)',
      '  - Microsoft Edge web browsing (browser_navigate)',
      '  - Paint drawing & Notepad editing',
      '',
      'Connect Claude Desktop or Claude.ai to /mcp to watch Claude work live!',
    ].join('\n'),
  });

  const psWindow = createWindowForApp('powershell', 2, 1);
  psWindow.x = 500;
  psWindow.y = 210;
  psWindow.width = 680;
  psWindow.height = 380;
  welcomeWindow.x = 220;
  welcomeWindow.y = 66;
  welcomeWindow.focused = false;

  return {
    screenWidth: VIRTUAL_WIDTH,
    screenHeight: VIRTUAL_HEIGHT,
    taskbarHeight: TASKBAR_HEIGHT,
    wallpaperId: 'win10-hero',
    windows: [welcomeWindow, psWindow],
    nextZIndex: 3,
    cursor: {
      x: 640,
      y: 360,
      clicking: false,
      button: 'left',
      actor: 'idle',
      lastMovedAt: Date.now(),
    },
    startMenuOpen: false,
    selectedIconId: null,
    clipboard: '',
    activities: [
      {
        id: 'act-boot',
        timestamp: new Date().toISOString(),
        source: 'system',
        tool: 'win10_boot',
        argsSummary: 'Windows 10 Pro 22H2 (Build 19045.4651)',
        resultSummary: 'Desktop session initialized with MCP server ready',
        status: 'ok',
        durationMs: 12,
      },
    ],
    viewerCount: 0,
    mcpSessionCount: 0,
    authEnabled: false,
    lastUpdatedAt: Date.now(),
  };
}

export function focusWindow(state: DesktopState, windowId: string): DesktopState {
  const target = state.windows.find((w) => w.id === windowId);
  if (!target) return state;
  const z = state.nextZIndex;
  return {
    ...state,
    nextZIndex: z + 1,
    startMenuOpen: false,
    lastUpdatedAt: Date.now(),
    windows: state.windows.map((w) =>
      w.id === windowId
        ? { ...w, focused: true, minimized: false, zIndex: z }
        : { ...w, focused: false },
    ),
  };
}

export function openAppWindow(
  state: DesktopState,
  appId: AppId,
  payload?: Record<string, unknown>,
): { state: DesktopState; windowId: string } {
  const existing = state.windows.find((w) => w.appId === appId);
  if (existing && !payload?.forceNew) {
    let updated = focusWindow(state, existing.id);
    if (appId === 'notepad' && payload && (payload.filePath || payload.content !== undefined)) {
      const filePath =
        typeof payload.filePath === 'string'
          ? payload.filePath
          : existing.notepad?.filePath ?? 'C:\\Users\\Claude\\Desktop\\Untitled.txt';
      const content =
        typeof payload.content === 'string'
          ? payload.content
          : existing.notepad?.content ?? '';
      const fileName = filePath.split('\\').pop() || 'Untitled.txt';
      updated = {
        ...updated,
        windows: updated.windows.map((w) =>
          w.id === existing.id
            ? {
                ...w,
                title: `${fileName} - Notepad`,
                notepad: { filePath, content, dirty: false },
              }
            : w,
        ),
      };
    } else if (appId === 'explorer' && typeof payload?.path === 'string') {
      updated = {
        ...updated,
        windows: updated.windows.map((w) =>
          w.id === existing.id
            ? {
                ...w,
                explorer: { currentPath: String(payload.path), selectedName: null },
              }
            : w,
        ),
      };
    } else if (appId === 'settings' && typeof payload?.section === 'string') {
      updated = {
        ...updated,
        windows: updated.windows.map((w) =>
          w.id === existing.id
            ? {
                ...w,
                settings: {
                  section:
                    payload.section === 'personalization' || payload.section === 'mcp'
                      ? payload.section
                      : 'system',
                },
              }
            : w,
        ),
      };
    }
    return { state: updated, windowId: existing.id };
  }

  const z = state.nextZIndex;
  const win = createWindowForApp(appId, z, state.windows.length, payload);
  return {
    windowId: win.id,
    state: {
      ...state,
      nextZIndex: z + 1,
      startMenuOpen: false,
      lastUpdatedAt: Date.now(),
      windows: [...state.windows.map((w) => ({ ...w, focused: false })), win],
    },
  };
}

export function closeWindow(state: DesktopState, windowId: string): DesktopState {
  const remaining = state.windows.filter((w) => w.id !== windowId);
  const sorted = [...remaining].filter((w) => !w.minimized).sort((a, b) => b.zIndex - a.zIndex);
  const topId = sorted[0]?.id;
  return {
    ...state,
    lastUpdatedAt: Date.now(),
    windows: remaining.map((w) => ({ ...w, focused: w.id === topId })),
  };
}

export function toggleMinimizeWindow(state: DesktopState, windowId: string): DesktopState {
  const target = state.windows.find((w) => w.id === windowId);
  if (!target) return state;
  if (target.minimized) {
    return focusWindow(state, windowId);
  }
  const updated = state.windows.map((w) =>
    w.id === windowId ? { ...w, minimized: true, focused: false } : w,
  );
  const top = [...updated].filter((w) => !w.minimized).sort((a, b) => b.zIndex - a.zIndex)[0];
  return {
    ...state,
    lastUpdatedAt: Date.now(),
    windows: updated.map((w) => ({ ...w, focused: w.id === top?.id })),
  };
}

export function toggleMaximizeWindow(state: DesktopState, windowId: string): DesktopState {
  const focused = focusWindow(state, windowId);
  return {
    ...focused,
    windows: focused.windows.map((w) =>
      w.id === windowId ? { ...w, maximized: !w.maximized } : w,
    ),
  };
}

export function moveWindow(state: DesktopState, windowId: string, x: number, y: number): DesktopState {
  return {
    ...state,
    lastUpdatedAt: Date.now(),
    windows: state.windows.map((w) =>
      w.id === windowId
        ? {
            ...w,
            maximized: false,
            x: clamp(Math.round(x), -w.width + 80, state.screenWidth - 80),
            y: clamp(Math.round(y), 0, state.screenHeight - state.taskbarHeight - 28),
          }
        : w,
    ),
  };
}

export function resizeWindow(
  state: DesktopState,
  windowId: string,
  width: number,
  height: number,
): DesktopState {
  return {
    ...state,
    lastUpdatedAt: Date.now(),
    windows: state.windows.map((w) =>
      w.id === windowId
        ? {
            ...w,
            maximized: false,
            width: clamp(Math.round(width), 280, state.screenWidth),
            height: clamp(Math.round(height), 220, state.screenHeight - state.taskbarHeight),
          }
        : w,
    ),
  };
}

export function moveCursor(
  state: DesktopState,
  x: number,
  y: number,
  actor: 'claude' | 'user' | 'idle' = 'claude',
  clicking = false,
  button: 'left' | 'right' = 'left',
): DesktopState {
  return {
    ...state,
    lastUpdatedAt: Date.now(),
    cursor: {
      x: clamp(Math.round(x), 0, state.screenWidth - 1),
      y: clamp(Math.round(y), 0, state.screenHeight - 1),
      clicking,
      button,
      actor,
      lastMovedAt: Date.now(),
    },
  };
}

export function getWindowBounds(
  win: DesktopWindow,
  screenWidth = VIRTUAL_WIDTH,
  screenHeight = VIRTUAL_HEIGHT,
  taskbarHeight = TASKBAR_HEIGHT,
): { x: number; y: number; width: number; height: number } {
  if (win.maximized) {
    return {
      x: 0,
      y: 0,
      width: screenWidth,
      height: screenHeight - taskbarHeight,
    };
  }
  return {
    x: win.x,
    y: win.y,
    width: win.width,
    height: win.height,
  };
}

export function hitTestDesktop(state: DesktopState, x: number, y: number): HitTestResult {
  const taskbarTop = state.screenHeight - state.taskbarHeight;

  // 1. Taskbar hit test
  if (y >= taskbarTop) {
    if (x <= 48) {
      return { target: 'start-button' };
    }
    // Taskbar window tabs start after search box (x=248) + pinned buttons
    const pinnedStart = 256;
    const pinSlotWidth = 42;
    const pinnedEnd = pinnedStart + PINNED_TASKBAR_APPS.length * pinSlotWidth;
    if (x >= pinnedStart && x < pinnedEnd) {
      const idx = Math.floor((x - pinnedStart) / pinSlotWidth);
      const appId = PINNED_TASKBAR_APPS[idx];
      if (appId) return { target: 'taskbar-pin', appId };
    }
    const openStart = pinnedEnd + 8;
    if (x >= openStart) {
      const idx = Math.floor((x - openStart) / 140);
      const win = state.windows[idx];
      if (win) return { target: 'taskbar-window', windowId: win.id };
    }
    return { target: 'desktop-blank' };
  }

  // 2. Start Menu (x: 0..420, y: 200..680)
  if (state.startMenuOpen && x >= 0 && x <= 420 && y >= 200 && y < taskbarTop) {
    const rowHeight = 40;
    const listTop = 216;
    const idx = Math.floor((y - listTop) / rowHeight);
    if (x >= 48 && x <= 230 && idx >= 0 && idx < START_MENU_APPS.length) {
      return { target: 'start-menu-app', appId: START_MENU_APPS[idx].appId };
    }
  }

  // 3. Open non-minimized windows sorted top-to-bottom
  const visibleWindows = [...state.windows]
    .filter((w) => !w.minimized)
    .sort((a, b) => b.zIndex - a.zIndex);

  for (const win of visibleWindows) {
    const b = getWindowBounds(win, state.screenWidth, state.screenHeight, state.taskbarHeight);
    if (x >= b.x && x <= b.x + b.width && y >= b.y && y <= b.y + b.height) {
      if (y <= b.y + TITLEBAR_HEIGHT) {
        if (x >= b.x + b.width - 46) {
          return { target: 'window-close', windowId: win.id };
        }
        if (x >= b.x + b.width - 92) {
          return { target: 'window-maximize', windowId: win.id };
        }
        if (x >= b.x + b.width - 138) {
          return { target: 'window-minimize', windowId: win.id };
        }
        return { target: 'window-titlebar', windowId: win.id };
      }
      return {
        target: 'window-body',
        windowId: win.id,
        relX: x - b.x,
        relY: y - b.y - TITLEBAR_HEIGHT,
      };
    }
  }

  // 4. Desktop icons
  for (const icon of DESKTOP_ICONS) {
    if (x >= icon.x && x <= icon.x + 80 && y >= icon.y && y <= icon.y + 82) {
      return {
        target: 'desktop-icon',
        iconId: icon.id,
        appId: icon.appId,
        payload: icon.payload,
      };
    }
  }

  return { target: 'desktop-blank' };
}

export function appendActivity(
  state: DesktopState,
  entry: Omit<McpActivityEntry, 'id' | 'timestamp'>,
): DesktopState {
  const nextEntry: McpActivityEntry = {
    ...entry,
    id: `act-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    timestamp: new Date().toISOString(),
  };
  return {
    ...state,
    lastUpdatedAt: Date.now(),
    activities: [nextEntry, ...state.activities].slice(0, 80),
  };
}

export function getWindowsLayoutSummary(state: DesktopState) {
  return {
    screen: { width: state.screenWidth, height: state.screenHeight, taskbarHeight: state.taskbarHeight },
    startButton: { x: 24, y: 700 },
    startMenuOpen: state.startMenuOpen,
    cursor: { x: state.cursor.x, y: state.cursor.y },
    desktopIcons: DESKTOP_ICONS.map((i) => ({
      id: i.id,
      appId: i.appId,
      label: i.label,
      centerX: i.x + 40,
      centerY: i.y + 40,
    })),
    windows: [...state.windows]
      .sort((a, b) => b.zIndex - a.zIndex)
      .map((w) => {
        const bounds = getWindowBounds(w, state.screenWidth, state.screenHeight, state.taskbarHeight);
        return {
          id: w.id,
          appId: w.appId,
          title: w.title,
          focused: w.focused,
          minimized: w.minimized,
          maximized: w.maximized,
          bounds,
          closeButton: { x: bounds.x + bounds.width - 23, y: bounds.y + 16 },
        };
      }),
  };
}
