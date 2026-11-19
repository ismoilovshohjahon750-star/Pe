export type AppId =
  | 'explorer'
  | 'powershell'
  | 'edge'
  | 'notepad'
  | 'paint'
  | 'taskmgr'
  | 'settings'
  | 'calculator';

export interface DesktopIconDef {
  id: string;
  appId: AppId;
  label: string;
  x: number;
  y: number;
  payload?: Record<string, unknown>;
}

export interface NotepadDocData {
  filePath: string;
  content: string;
  dirty: boolean;
}

export interface TerminalLine {
  id: string;
  kind: 'prompt' | 'stdout' | 'stderr' | 'info';
  text: string;
}

export interface PowerShellData {
  cwd: string;
  lines: TerminalLine[];
  running: boolean;
}

export interface EdgeTab {
  id: string;
  title: string;
  url: string;
  contentText: string;
  links: Array<{ text: string; href: string }>;
  loading: boolean;
  error?: string;
}

export interface EdgeData {
  tabs: EdgeTab[];
  activeTabId: string;
}

export interface ExplorerData {
  currentPath: string;
  selectedName: string | null;
}

export interface PaintStroke {
  id: string;
  color: string;
  width: number;
  points: Array<{ x: number; y: number }>;
}

export interface PaintData {
  strokes: PaintStroke[];
  activeColor: string;
  brushSize: number;
}

export interface SettingsData {
  section: 'system' | 'personalization' | 'mcp';
}

export interface CalculatorData {
  display: string;
  expression: string;
}

export interface DesktopWindow {
  id: string;
  appId: AppId;
  title: string;
  x: number;
  y: number;
  width: number;
  height: number;
  zIndex: number;
  minimized: boolean;
  maximized: boolean;
  focused: boolean;
  explorer?: ExplorerData;
  powershell?: PowerShellData;
  edge?: EdgeData;
  notepad?: NotepadDocData;
  paint?: PaintData;
  settings?: SettingsData;
  calculator?: CalculatorData;
}

export interface CursorState {
  x: number;
  y: number;
  clicking: boolean;
  button: 'left' | 'right';
  actor: 'claude' | 'user' | 'idle';
  lastMovedAt: number;
}

export interface McpActivityEntry {
  id: string;
  timestamp: string;
  source: 'mcp' | 'user' | 'system';
  tool: string;
  argsSummary: string;
  resultSummary: string;
  status: 'running' | 'ok' | 'error';
  durationMs: number;
}

export interface FileEntry {
  name: string;
  winPath: string;
  isDirectory: boolean;
  size: number;
  modifiedAt: string;
  extension: string;
}

export interface WallpaperOption {
  id: string;
  name: string;
  src: string;
  accentHex: string;
}

export interface DesktopState {
  screenWidth: number;
  screenHeight: number;
  taskbarHeight: number;
  wallpaperId: string;
  windows: DesktopWindow[];
  nextZIndex: number;
  cursor: CursorState;
  startMenuOpen: boolean;
  selectedIconId: string | null;
  clipboard: string;
  activities: McpActivityEntry[];
  viewerCount: number;
  mcpSessionCount: number;
  authEnabled: boolean;
  lastUpdatedAt: number;
}

export type HitTestResult =
  | { target: 'start-button' }
  | { target: 'start-menu-app'; appId: AppId }
  | { target: 'taskbar-window'; windowId: string }
  | { target: 'taskbar-pin'; appId: AppId }
  | { target: 'window-close'; windowId: string }
  | { target: 'window-maximize'; windowId: string }
  | { target: 'window-minimize'; windowId: string }
  | { target: 'window-titlebar'; windowId: string }
  | { target: 'window-body'; windowId: string; relX: number; relY: number }
  | { target: 'desktop-icon'; iconId: string; appId: AppId; payload?: Record<string, unknown> }
  | { target: 'desktop-blank' };
