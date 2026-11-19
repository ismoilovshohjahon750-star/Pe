import {
  appendActivity,
  closeWindow,
  createInitialDesktopState,
  focusWindow,
  getWindowsLayoutSummary,
  hitTestDesktop,
  moveCursor,
  moveWindow,
  openAppWindow,
  resizeWindow,
  toggleMaximizeWindow,
  toggleMinimizeWindow,
} from '../desktop/engine.ts';
import type { AppId, DesktopState, PaintStroke } from '../desktop/types.ts';
import {
  deleteWinPath,
  ensureDriveSeeded,
  listWinDir,
  readWinFile,
  writeWinFile,
} from './filesystem.ts';
import { renderDesktopPngBase64 } from './screenshot.ts';
import { executeWindowsCommand } from './terminal.ts';

type Listener = (state: DesktopState) => void;

class DesktopStore {
  private state: DesktopState;
  private listeners = new Set<Listener>();
  private mcpToken = process.env.MCP_AUTH_TOKEN || 'claudewin-mcp-secret';

  constructor() {
    ensureDriveSeeded();
    this.state = createInitialDesktopState();
  }

  getState(): DesktopState {
    return this.state;
  }

  getAuthToken(): string {
    return this.mcpToken;
  }

  setAuthEnabled(enabled: boolean): DesktopState {
    this.state = { ...this.state, authEnabled: enabled, lastUpdatedAt: Date.now() };
    this.emit();
    return this.state;
  }

  setViewerCount(count: number): void {
    this.state = { ...this.state, viewerCount: count };
    this.emit();
  }

  setMcpSessionCount(count: number): void {
    this.state = { ...this.state, mcpSessionCount: count };
    this.emit();
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emit(): void {
    for (const fn of this.listeners) {
      fn(this.state);
    }
  }

  private update(next: DesktopState): DesktopState {
    this.state = next;
    this.emit();
    return this.state;
  }

  logActivity(
    source: 'mcp' | 'user' | 'system',
    tool: string,
    argsSummary: string,
    resultSummary: string,
    status: 'running' | 'ok' | 'error' = 'ok',
    durationMs = 8,
  ): void {
    this.update(
      appendActivity(this.state, {
        source,
        tool,
        argsSummary,
        resultSummary,
        status,
        durationMs,
      }),
    );
  }

  // --- Window & Desktop Actions ---
  openApp(appId: AppId, payload?: Record<string, unknown>, actor: 'mcp' | 'user' = 'user'): string {
    let resolvedPayload = payload ? { ...payload } : undefined;
    if (appId === 'notepad' && resolvedPayload?.filePath && resolvedPayload.content === undefined) {
      try {
        const file = readWinFile(String(resolvedPayload.filePath));
        resolvedPayload.content = file.content;
      } catch {
        // Use default content if file doesn't exist yet
      }
    }
    const { state, windowId } = openAppWindow(this.state, appId, resolvedPayload);
    this.update(state);
    if (actor === 'mcp') {
      this.logActivity('mcp', 'open_app', appId, `Opened ${appId} (${windowId})`);
    }
    return windowId;
  }

  focusWin(windowId: string): void {
    this.update(focusWindow(this.state, windowId));
  }

  closeWin(windowId: string): void {
    this.update(closeWindow(this.state, windowId));
  }

  minimizeWin(windowId: string): void {
    this.update(toggleMinimizeWindow(this.state, windowId));
  }

  maximizeWin(windowId: string): void {
    this.update(toggleMaximizeWindow(this.state, windowId));
  }

  moveWin(windowId: string, x: number, y: number): void {
    this.update(moveWindow(this.state, windowId, x, y));
  }

  resizeWin(windowId: string, width: number, height: number): void {
    this.update(resizeWindow(this.state, windowId, width, height));
  }

  toggleStartMenu(open?: boolean): void {
    this.update({
      ...this.state,
      startMenuOpen: open ?? !this.state.startMenuOpen,
      lastUpdatedAt: Date.now(),
    });
  }

  setWallpaper(wallpaperId: string): void {
    this.update({
      ...this.state,
      wallpaperId,
      lastUpdatedAt: Date.now(),
    });
  }

  setExplorerPath(windowId: string, winPath: string): void {
    this.update({
      ...this.state,
      lastUpdatedAt: Date.now(),
      windows: this.state.windows.map((w) =>
        w.id === windowId && w.explorer
          ? { ...w, explorer: { ...w.explorer, currentPath: winPath, selectedName: null } }
          : w,
      ),
    });
  }

  updateNotepadContent(windowId: string, content: string, filePath?: string, dirty = true): void {
    this.update({
      ...this.state,
      lastUpdatedAt: Date.now(),
      windows: this.state.windows.map((w) => {
        if (w.id !== windowId || !w.notepad) return w;
        const nextPath = filePath ?? w.notepad.filePath;
        const name = nextPath.split('\\').pop() || 'Untitled.txt';
        return {
          ...w,
          title: `${dirty ? '*' : ''}${name} - Notepad`,
          notepad: { filePath: nextPath, content, dirty },
        };
      }),
    });
  }

  saveNotepad(windowId: string): { winPath: string; size: number } {
    const win = this.state.windows.find((w) => w.id === windowId);
    if (!win?.notepad) {
      throw new Error('Notepad window not found');
    }
    const res = writeWinFile(win.notepad.filePath, win.notepad.content);
    this.updateNotepadContent(windowId, win.notepad.content, res.winPath, false);
    return res;
  }

  updateCalculator(windowId: string, display: string, expression: string): void {
    this.update({
      ...this.state,
      lastUpdatedAt: Date.now(),
      windows: this.state.windows.map((w) =>
        w.id === windowId ? { ...w, calculator: { display, expression } } : w,
      ),
    });
  }

  updateSettingsSection(windowId: string, section: 'system' | 'personalization' | 'mcp'): void {
    this.update({
      ...this.state,
      lastUpdatedAt: Date.now(),
      windows: this.state.windows.map((w) =>
        w.id === windowId ? { ...w, settings: { section } } : w,
      ),
    });
  }

  // --- Cursor & Physical Screen Interactions (used by MCP + Live Observer) ---
  moveMouse(x: number, y: number, actor: 'claude' | 'user' = 'claude'): void {
    this.update(moveCursor(this.state, x, y, actor, false, 'left'));
  }

  clickAt(
    x: number,
    y: number,
    button: 'left' | 'right' | 'double' = 'left',
    actor: 'claude' | 'user' = 'claude',
  ): { hit: string } {
    const btnKind = button === 'right' ? 'right' : 'left';
    this.update(moveCursor(this.state, x, y, actor, true, btnKind));

    const hit = hitTestDesktop(this.state, x, y);
    let hitLabel: string = hit.target;

    if (hit.target === 'start-button') {
      this.toggleStartMenu();
    } else if (hit.target === 'start-menu-app') {
      this.openApp(hit.appId, undefined, actor === 'claude' ? 'mcp' : 'user');
    } else if (hit.target === 'taskbar-pin') {
      this.openApp(hit.appId, undefined, actor === 'claude' ? 'mcp' : 'user');
    } else if (hit.target === 'taskbar-window') {
      const targetWin = this.state.windows.find((w) => w.id === hit.windowId);
      if (targetWin?.focused && !targetWin.minimized) {
        this.minimizeWin(hit.windowId);
      } else {
        this.focusWin(hit.windowId);
      }
    } else if (hit.target === 'window-close') {
      this.closeWin(hit.windowId);
    } else if (hit.target === 'window-maximize') {
      this.maximizeWin(hit.windowId);
    } else if (hit.target === 'window-minimize') {
      this.minimizeWin(hit.windowId);
    } else if (hit.target === 'window-titlebar' || hit.target === 'window-body') {
      this.focusWin(hit.windowId);
    } else if (hit.target === 'desktop-icon') {
      if (button === 'double') {
        this.openApp(hit.appId, hit.payload, actor === 'claude' ? 'mcp' : 'user');
        hitLabel = `opened:${hit.appId}`;
      } else {
        this.update({
          ...this.state,
          selectedIconId: hit.iconId,
          startMenuOpen: false,
          lastUpdatedAt: Date.now(),
        });
      }
    } else {
      this.update({
        ...this.state,
        selectedIconId: null,
        startMenuOpen: false,
        lastUpdatedAt: Date.now(),
      });
    }

    setTimeout(() => {
      this.update(moveCursor(this.state, x, y, actor, false, btnKind));
    }, 220);

    return { hit: hitLabel };
  }

  async typeText(text: string, appendNewline = false): Promise<{ targetApp: string }> {
    const focused = this.state.windows.find((w) => w.focused && !w.minimized);
    if (!focused) {
      this.update({ ...this.state, clipboard: text, lastUpdatedAt: Date.now() });
      return { targetApp: 'clipboard (no focused window)' };
    }

    if (focused.appId === 'notepad' && focused.notepad) {
      const next = focused.notepad.content + text + (appendNewline ? '\n' : '');
      this.updateNotepadContent(focused.id, next, focused.notepad.filePath, true);
      return { targetApp: 'notepad' };
    }

    if (focused.appId === 'powershell' && focused.powershell) {
      const res = await this.runPowerShell(text, focused.id);
      return { targetApp: `powershell (${res.cwd})` };
    }

    if (focused.appId === 'edge' && focused.edge) {
      if (text.startsWith('http://') || text.startsWith('https://')) {
        await this.navigateEdge(text, focused.id);
        return { targetApp: 'edge (navigated)' };
      }
    }

    this.update({ ...this.state, clipboard: text, lastUpdatedAt: Date.now() });
    return { targetApp: focused.appId };
  }

  async pressKey(key: string): Promise<{ handled: string }> {
    const k = key.trim().toLowerCase();
    if (k === 'win' || k === 'meta' || k === 'super') {
      this.toggleStartMenu();
      return { handled: 'Toggled Start Menu' };
    }
    const focused = this.state.windows.find((w) => w.focused && !w.minimized);
    if (!focused) {
      return { handled: `Key ${key} (no active window)` };
    }
    if (k === 'alt+f4') {
      this.closeWin(focused.id);
      return { handled: `Closed ${focused.title}` };
    }
    if (k === 'ctrl+s' && focused.appId === 'notepad') {
      const saved = this.saveNotepad(focused.id);
      return { handled: `Saved ${saved.winPath}` };
    }
    if (k === 'enter' && focused.appId === 'notepad' && focused.notepad) {
      this.updateNotepadContent(focused.id, focused.notepad.content + '\n', focused.notepad.filePath, true);
      return { handled: 'Inserted newline in Notepad' };
    }
    return { handled: `Dispatched ${key} to ${focused.title}` };
  }

  async runPowerShell(
    command: string,
    targetWindowId?: string,
  ): Promise<{ cwd: string; stdout: string; stderr: string; exitCode: number; windowId: string }> {
    let win =
      (targetWindowId && this.state.windows.find((w) => w.id === targetWindowId)) ||
      this.state.windows.find((w) => w.appId === 'powershell');

    let windowId: string;
    if (!win) {
      windowId = this.openApp('powershell', undefined, 'user');
    } else {
      windowId = win.id;
      this.focusWin(windowId);
    }

    win = this.state.windows.find((w) => w.id === windowId)!;
    const currentCwd = win.powershell?.cwd || 'C:\\Users\\Claude';

    // Append prompt line immediately so live viewers see the command appear before output finishes
    const promptId = `ps-${Date.now().toString(36)}-cmd`;
    this.update({
      ...this.state,
      lastUpdatedAt: Date.now(),
      windows: this.state.windows.map((w) =>
        w.id === windowId && w.powershell
          ? {
              ...w,
              powershell: {
                ...w.powershell,
                running: true,
                lines: [
                  ...w.powershell.lines,
                  { id: promptId, kind: 'prompt' as const, text: `PS ${currentCwd}> ${command}` },
                ].slice(-120),
              },
            }
          : w,
      ),
    });

    const result = await executeWindowsCommand(command, currentCwd);

    this.update({
      ...this.state,
      lastUpdatedAt: Date.now(),
      windows: this.state.windows.map((w) => {
        if (w.id !== windowId || !w.powershell) return w;
        if (result.clear) {
          return {
            ...w,
            powershell: { cwd: result.cwd, running: false, lines: [] },
          };
        }
        const newLines = [...w.powershell.lines];
        if (result.stdout) {
          for (const line of result.stdout.replace(/\r?\n$/, '').split(/\r?\n/)) {
            newLines.push({
              id: `ps-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
              kind: 'stdout',
              text: line,
            });
          }
        }
        if (result.stderr) {
          for (const line of result.stderr.replace(/\r?\n$/, '').split(/\r?\n/)) {
            newLines.push({
              id: `ps-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
              kind: 'stderr',
              text: line,
            });
          }
        }
        return {
          ...w,
          powershell: {
            cwd: result.cwd,
            running: false,
            lines: newLines.slice(-140),
          },
        };
      }),
    });

    return { ...result, windowId };
  }

  async navigateEdge(
    urlInput: string,
    targetWindowId?: string,
  ): Promise<{ url: string; title: string; contentText: string; windowId: string }> {
    let win =
      (targetWindowId && this.state.windows.find((w) => w.id === targetWindowId)) ||
      this.state.windows.find((w) => w.appId === 'edge');
    const windowId = win ? win.id : this.openApp('edge', { url: urlInput }, 'user');
    this.focusWin(windowId);

    const normalizedUrl = urlInput.trim();

    // Local C:\ file preview inside Edge
    if (/^[a-zA-Z]:\\/.test(normalizedUrl)) {
      const file = readWinFile(normalizedUrl);
      const title = normalizedUrl.split('\\').pop() || 'Local File';
      this.setEdgeTabState(windowId, {
        title,
        url: normalizedUrl,
        contentText: file.content,
        links: [],
        loading: false,
      });
      return { url: normalizedUrl, title, contentText: file.content, windowId };
    }

    const safeUrl = /^https?:\/\//i.test(normalizedUrl) ? normalizedUrl : `https://${normalizedUrl}`;
    this.setEdgeTabState(windowId, {
      title: 'Loading...',
      url: safeUrl,
      contentText: `Fetching ${safeUrl}...`,
      links: [],
      loading: true,
    });

    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 8000);
      const resp = await fetch(safeUrl, {
        signal: controller.signal,
        headers: { 'User-Agent': 'ClaudeWin10-Edge/1.0' },
      });
      clearTimeout(timer);
      const html = await resp.text();
      const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
      const title = titleMatch ? titleMatch[1].replace(/\s+/g, ' ').trim() : safeUrl;

      const links: Array<{ text: string; href: string }> = [];
      const linkRegex = /<a\s+[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
      let match: RegExpExecArray | null;
      while ((match = linkRegex.exec(html)) !== null && links.length < 15) {
        const href = match[1];
        const text = match[2].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
        if (text && href && !href.startsWith('javascript:')) {
          try {
            const abs = new URL(href, safeUrl).toString();
            links.push({ text: text.slice(0, 80), href: abs });
          } catch {
            // skip invalid link
          }
        }
      }

      const stripped = html
        .replace(/<script[\s\S]*?<\/script>/gi, ' ')
        .replace(/<style[\s\S]*?<\/style>/gi, ' ')
        .replace(/<\/(p|div|h1|h2|h3|h4|li|tr|br)>/gi, '\n')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/[ \t]+/g, ' ')
        .replace(/\n\s*\n+/g, '\n\n')
        .trim()
        .slice(0, 6000);

      this.setEdgeTabState(windowId, {
        title,
        url: safeUrl,
        contentText: stripped || '(Empty response body)',
        links,
        loading: false,
      });
      return { url: safeUrl, title, contentText: stripped, windowId };
    } catch (err) {
      const msg = (err as Error).message || 'Network request failed';
      this.setEdgeTabState(windowId, {
        title: 'Cannot reach page',
        url: safeUrl,
        contentText: `Could not fetch ${safeUrl}: ${msg}`,
        links: [],
        loading: false,
        error: msg,
      });
      return { url: safeUrl, title: 'Error', contentText: msg, windowId };
    }
  }

  private setEdgeTabState(
    windowId: string,
    patch: {
      title: string;
      url: string;
      contentText: string;
      links: Array<{ text: string; href: string }>;
      loading: boolean;
      error?: string;
    },
  ): void {
    this.update({
      ...this.state,
      lastUpdatedAt: Date.now(),
      windows: this.state.windows.map((w) => {
        if (w.id !== windowId || !w.edge) return w;
        const activeId = w.edge.activeTabId;
        return {
          ...w,
          title: `${patch.title} - Microsoft Edge`,
          edge: {
            ...w.edge,
            tabs: w.edge.tabs.map((t) => (t.id === activeId ? { ...t, ...patch } : t)),
          },
        };
      }),
    });
  }

  addPaintStroke(stroke: Omit<PaintStroke, 'id'>, clearFirst = false, targetWindowId?: string): string {
    let win =
      (targetWindowId && this.state.windows.find((w) => w.id === targetWindowId)) ||
      this.state.windows.find((w) => w.appId === 'paint');
    const windowId = win ? win.id : this.openApp('paint', undefined, 'user');
    this.focusWin(windowId);

    const newStroke: PaintStroke = {
      ...stroke,
      id: `stk-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    };
    this.update({
      ...this.state,
      lastUpdatedAt: Date.now(),
      windows: this.state.windows.map((w) => {
        if (w.id !== windowId || !w.paint) return w;
        return {
          ...w,
          paint: {
            ...w.paint,
            strokes: clearFirst ? [newStroke] : [...w.paint.strokes, newStroke].slice(-300),
          },
        };
      }),
    });
    return windowId;
  }

  clearPaint(windowId: string): void {
    this.update({
      ...this.state,
      lastUpdatedAt: Date.now(),
      windows: this.state.windows.map((w) =>
        w.id === windowId && w.paint ? { ...w, paint: { ...w.paint, strokes: [] } } : w,
      ),
    });
  }

  getScreenshotPayload() {
    return {
      pngBase64: renderDesktopPngBase64(this.state),
      layout: getWindowsLayoutSummary(this.state),
    };
  }

  // Expose filesystem wrappers
  fsList = listWinDir;
  fsRead = readWinFile;
  fsWrite = writeWinFile;
  fsDelete = deleteWinPath;
}

export const desktopStore = new DesktopStore();
