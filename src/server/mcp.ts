import fs from 'node:fs';
import path from 'node:path';
import type { Request, Response } from 'express';
import { resolveMcpExecutionMode } from '../desktop/bridge.ts';
import { getWindowsLayoutSummary } from '../desktop/engine.ts';
import type { AppId } from '../desktop/types.ts';
import { desktopStore } from './desktopStore.ts';
import { realLinuxDesktop } from './realLinuxDesktop.ts';
import { realWin10Bridge } from './realWin10Bridge.ts';

interface JsonRpcRequest {
  jsonrpc?: string;
  id?: string | number | null;
  method: string;
  params?: Record<string, unknown>;
}

interface McpToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

const MCP_TOOLS: McpToolDef[] = [
  {
    name: 'desktop_screenshot',
    description:
      'Capture a live screenshot of the Debian 12 Linux X11 desktop (1280x720 coordinate space) along with all open X11 window IDs/bounds, active window title, and cursor coordinates.',
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: 'desktop_move',
    description: 'Move the Linux X11 mouse cursor to (x, y) in the 1280x720 desktop.',
    inputSchema: {
      type: 'object',
      properties: {
        x: { type: 'number', description: 'X coordinate (0..1279)' },
        y: { type: 'number', description: 'Y coordinate (0..719)' },
      },
      required: ['x', 'y'],
    },
  },
  {
    name: 'desktop_click',
    description:
      'Move mouse to (x, y) and click on Linux X11 UI elements (desktop icons, menus, windows, browser links, taskbar).',
    inputSchema: {
      type: 'object',
      properties: {
        x: { type: 'number', description: 'X coordinate (0..1279)' },
        y: { type: 'number', description: 'Y coordinate (0..719)' },
        button: {
          type: 'string',
          enum: ['left', 'right', 'middle', 'double'],
          description: 'Mouse button or double-click (default: left)',
        },
      },
      required: ['x', 'y'],
    },
  },
  {
    name: 'desktop_drag',
    description:
      'Press mouse button at (startX, startY), drag to (endX, endY), and release (move windows, select text, drag sliders).',
    inputSchema: {
      type: 'object',
      properties: {
        startX: { type: 'number', description: 'Start X (0..1279)' },
        startY: { type: 'number', description: 'Start Y (0..719)' },
        endX: { type: 'number', description: 'End X (0..1279)' },
        endY: { type: 'number', description: 'End Y (0..719)' },
        button: { type: 'string', enum: ['left', 'right', 'middle'] },
      },
      required: ['startX', 'startY', 'endX', 'endY'],
    },
  },
  {
    name: 'desktop_scroll',
    description: 'Scroll mouse wheel up/down/left/right at (x, y) on the Linux X11 desktop.',
    inputSchema: {
      type: 'object',
      properties: {
        x: { type: 'number', description: 'X coordinate (default 640)' },
        y: { type: 'number', description: 'Y coordinate (default 360)' },
        direction: { type: 'string', enum: ['up', 'down', 'left', 'right'], description: 'Scroll direction' },
        clicks: { type: 'number', description: 'Number of wheel steps (1..25, default 3)' },
      },
      required: ['direction'],
    },
  },
  {
    name: 'desktop_type',
    description: 'Type text (supports multi-line) into the currently focused Linux X11 window.',
    inputSchema: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'Text to type' },
        enter: { type: 'boolean', description: 'Press Return after typing' },
      },
      required: ['text'],
    },
  },
  {
    name: 'desktop_key',
    description:
      'Press a keyboard key or shortcut on X11 (e.g. Return, Escape, Tab, Ctrl+C, Ctrl+S, Ctrl+L, Ctrl+Shift+T, Alt+F4, Alt+Tab, Super, F5, Up, Down).',
    inputSchema: {
      type: 'object',
      properties: {
        key: { type: 'string', description: 'Key or shortcut e.g. Return, Ctrl+C, Alt+F4, Ctrl+L' },
      },
      required: ['key'],
    },
  },
  {
    name: 'open_app',
    description:
      'Launch a Linux GUI application on DISPLAY=:99 (terminal, chromium, files, mousepad, calculator, taskmgr, settings) or any custom Linux command.',
    inputSchema: {
      type: 'object',
      properties: {
        app: {
          type: 'string',
          description:
            'App name: terminal, chromium, files, mousepad, calculator, taskmgr, settings (or custom app name)',
        },
        command: { type: 'string', description: 'Optional arbitrary bash/GUI command to launch on DISPLAY=:99' },
        filePath: { type: 'string', description: 'Optional file path for mousepad or folder path for files' },
        url: { type: 'string', description: 'Optional URL when opening chromium' },
      },
      required: ['app'],
    },
  },
  {
    name: 'window_list',
    description: 'List all currently open Linux X11 windows with windowId, title, pid, geometry (x, y, width, height), and active status.',
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: 'window_control',
    description: 'Focus, minimize, maximize, move, resize, or close any open Linux X11 window by windowId, title substring, or "active".',
    inputSchema: {
      type: 'object',
      properties: {
        windowId: { type: 'string', description: 'Numeric X11 windowId, partial window title, or "active"' },
        action: { type: 'string', enum: ['focus', 'minimize', 'maximize', 'close', 'move', 'resize'] },
        x: { type: 'number' },
        y: { type: 'number' },
        width: { type: 'number' },
        height: { type: 'number' },
      },
      required: ['windowId', 'action'],
    },
  },
  {
    name: 'run_bash',
    description:
      'Execute any Linux bash command as root with DISPLAY=:99 (supports apt, python3, node, curl, git, systemctl/process management, GUI launches with background=true).',
    inputSchema: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'Bash command to execute' },
        cwd: { type: 'string', description: 'Working directory (default: /root)' },
        timeoutMs: { type: 'number', description: 'Timeout in ms (1000..120000, default 30000)' },
        background: { type: 'boolean', description: 'Run detached in background and return immediately' },
      },
      required: ['command'],
    },
  },
  {
    name: 'run_powershell',
    description:
      'Alias for run_bash on the Debian 12 Linux desktop (runs bash commands with DISPLAY=:99).',
    inputSchema: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'Shell command to execute' },
      },
      required: ['command'],
    },
  },
  {
    name: 'file_list',
    description: 'List files and folders inside a Linux directory (default: /root/Desktop).',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Linux directory path e.g. /root/Desktop or /app/applet' },
      },
    },
  },
  {
    name: 'file_read',
    description: 'Read a text or code file from the Linux filesystem.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Linux file path' },
      },
      required: ['path'],
    },
  },
  {
    name: 'file_write',
    description:
      'Create or overwrite a file on the Linux filesystem (persisted on disk) and optionally open it in Mousepad.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Linux file path e.g. /root/Projects/app.py' },
        content: { type: 'string', description: 'File contents' },
        openInEditor: { type: 'boolean', description: 'Open the file in Mousepad on screen (default false)' },
        openInNotepad: { type: 'boolean', description: 'Alias for openInEditor' },
      },
      required: ['path', 'content'],
    },
  },
  {
    name: 'file_delete',
    description: 'Delete a file or directory on the Linux filesystem.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Linux path to delete' },
      },
      required: ['path'],
    },
  },
  {
    name: 'browser_navigate',
    description: 'Open Chromium on the Linux desktop and navigate to any URL or local file.',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'https://... URL or file:///... path' },
      },
      required: ['url'],
    },
  },
  {
    name: 'wait',
    description: 'Pause execution for ms milliseconds (100..10000) while waiting for apps, pages, or commands to update on screen.',
    inputSchema: {
      type: 'object',
      properties: {
        ms: { type: 'number', description: 'Milliseconds to wait (default 1000, max 10000)' },
      },
    },
  },
];

// Active Legacy SSE sessions for /sse + /messages
const sseClients = new Map<string, Response>();

function verifyMcpAuth(req: Request): boolean {
  const state = desktopStore.getState();
  if (!state.authEnabled) return true;
  const auth = req.headers.authorization || '';
  const queryToken = typeof req.query.token === 'string' ? req.query.token : '';
  const expected = desktopStore.getAuthToken();
  return auth === `Bearer ${expected}` || queryToken === expected;
}

async function callMcpTool(name: string, args: Record<string, unknown>) {
  const started = Date.now();
  try {
    const target = realWin10Bridge.getExecutionTarget();
    if (target === 'linux' && !realLinuxDesktop.getStatus().running) {
      await realLinuxDesktop.ensureStarted();
    }

    const mode = resolveMcpExecutionMode(
      target,
      realWin10Bridge.getStatus().connected,
      realLinuxDesktop.getStatus().running,
      name,
    );

    if (mode === 'linux') {
      let linuxResult: { content: Array<Record<string, unknown>>; isError?: boolean };
      let linuxSummary = '';

      switch (name) {
        case 'desktop_screenshot': {
          const frame = await realLinuxDesktop.captureScreenshotFrame(true);
          const meta = await realLinuxDesktop.getSnapshotMeta();
          linuxSummary = `Captured Linux X11 frame (${frame.width}x${frame.height})`;
          linuxResult = {
            content: [
              { type: 'image', data: frame.data, mimeType: frame.mimeType },
              {
                type: 'text',
                text: JSON.stringify({ target: 'linux', ...meta }, null, 2),
              },
            ],
          };
          break;
        }
        case 'desktop_move': {
          const x = Number(args.x ?? 640);
          const y = Number(args.y ?? 360);
          linuxSummary = await realLinuxDesktop.moveMouse(x, y);
          linuxResult = { content: [{ type: 'text', text: linuxSummary }] };
          break;
        }
        case 'desktop_click': {
          const x = Number(args.x ?? 640);
          const y = Number(args.y ?? 360);
          const button =
            args.button === 'right' || args.button === 'middle' || args.button === 'double'
              ? args.button
              : 'left';
          linuxSummary = await realLinuxDesktop.click(x, y, button);
          const [frame, meta] = await Promise.all([
            realLinuxDesktop.captureScreenshotFrame(true),
            realLinuxDesktop.getSnapshotMeta(),
          ]);
          linuxResult = {
            content: [
              { type: 'image', data: frame.data, mimeType: frame.mimeType },
              {
                type: 'text',
                text: JSON.stringify({ clicked: { x, y, button }, ...meta }, null, 2),
              },
            ],
          };
          break;
        }
        case 'desktop_drag': {
          const startX = Number(args.startX ?? 0);
          const startY = Number(args.startY ?? 0);
          const endX = Number(args.endX ?? 0);
          const endY = Number(args.endY ?? 0);
          const button =
            args.button === 'right' || args.button === 'middle' ? args.button : 'left';
          linuxSummary = await realLinuxDesktop.dragMouse(startX, startY, endX, endY, button);
          linuxResult = { content: [{ type: 'text', text: linuxSummary }] };
          break;
        }
        case 'desktop_scroll': {
          const x = Number(args.x ?? 640);
          const y = Number(args.y ?? 360);
          const dir =
            args.direction === 'up' ||
            args.direction === 'down' ||
            args.direction === 'left' ||
            args.direction === 'right'
              ? args.direction
              : 'down';
          const clicks = Number(args.clicks ?? 3);
          linuxSummary = await realLinuxDesktop.scrollDirection(x, y, dir, clicks);
          linuxResult = { content: [{ type: 'text', text: linuxSummary }] };
          break;
        }
        case 'desktop_type': {
          const text = String(args.text ?? '');
          const enter = Boolean(args.enter);
          linuxSummary = await realLinuxDesktop.typeText(text, enter);
          linuxResult = { content: [{ type: 'text', text: linuxSummary }] };
          break;
        }
        case 'desktop_key': {
          const key = String(args.key ?? 'Return');
          linuxSummary = await realLinuxDesktop.pressKey(key);
          linuxResult = { content: [{ type: 'text', text: linuxSummary }] };
          break;
        }
        case 'open_app': {
          const app = String(args.app ?? 'terminal');
          const filePath = typeof args.filePath === 'string' ? args.filePath : undefined;
          const url = typeof args.url === 'string' ? args.url : undefined;
          const command = typeof args.command === 'string' ? args.command : undefined;
          linuxSummary = await realLinuxDesktop.openApp(app, { filePath, url, command });
          linuxResult = { content: [{ type: 'text', text: linuxSummary }] };
          break;
        }
        case 'window_list': {
          const windows = await realLinuxDesktop.listWindows();
          linuxSummary = `Listed ${windows.length} X11 windows`;
          linuxResult = {
            content: [{ type: 'text', text: JSON.stringify({ windows }, null, 2) }],
          };
          break;
        }
        case 'window_control': {
          const windowId = String(args.windowId ?? 'active');
          const rawAction = String(args.action ?? 'focus');
          const action =
            rawAction === 'minimize' ||
            rawAction === 'maximize' ||
            rawAction === 'close' ||
            rawAction === 'move' ||
            rawAction === 'resize'
              ? rawAction
              : 'focus';
          linuxSummary = await realLinuxDesktop.controlWindow(windowId, action, {
            x: args.x !== undefined ? Number(args.x) : undefined,
            y: args.y !== undefined ? Number(args.y) : undefined,
            width: args.width !== undefined ? Number(args.width) : undefined,
            height: args.height !== undefined ? Number(args.height) : undefined,
          });
          linuxResult = { content: [{ type: 'text', text: linuxSummary }] };
          break;
        }
        case 'run_bash':
        case 'run_powershell': {
          const command = String(args.command ?? '');
          const res = await realLinuxDesktop.runBash(command, {
            cwd: typeof args.cwd === 'string' ? args.cwd : undefined,
            timeoutMs: args.timeoutMs !== undefined ? Number(args.timeoutMs) : undefined,
            background: Boolean(args.background),
          });
          linuxSummary = `Bash exit ${res.exitCode} in ${res.cwd}`;
          linuxResult = {
            content: [{ type: 'text', text: JSON.stringify(res, null, 2) }],
          };
          break;
        }
        case 'file_list': {
          const dirPath = realLinuxDesktop.resolveLinuxPath(
            typeof args.path === 'string' ? args.path : '/root/Desktop',
          );
          const items = fs.readdirSync(dirPath, { withFileTypes: true }).map((entry) => {
            const full = path.join(dirPath, entry.name);
            let size = 0;
            try {
              if (entry.isFile()) size = fs.statSync(full).size;
            } catch {
              // ignore
            }
            return {
              name: entry.name,
              path: full,
              type: entry.isDirectory() ? 'dir' : 'file',
              size,
            };
          });
          linuxSummary = `${items.length} items in ${dirPath}`;
          linuxResult = {
            content: [
              {
                type: 'text',
                text: JSON.stringify({ path: dirPath, entries: items }, null, 2),
              },
            ],
          };
          break;
        }
        case 'file_read': {
          const targetPath = realLinuxDesktop.resolveLinuxPath(String(args.path));
          const content = fs.readFileSync(targetPath, 'utf8');
          linuxSummary = `Read ${content.length} chars from ${targetPath}`;
          linuxResult = { content: [{ type: 'text', text: content }] };
          break;
        }
        case 'file_write': {
          const targetPath = realLinuxDesktop.resolveLinuxPath(String(args.path));
          const content = String(args.content ?? '');
          fs.mkdirSync(path.dirname(targetPath), { recursive: true });
          fs.writeFileSync(targetPath, content, 'utf8');
          const openInEditor = args.openInEditor === true || args.openInNotepad === true;
          if (openInEditor) {
            await realLinuxDesktop.openApp('mousepad', { filePath: targetPath });
          }
          linuxSummary = `Wrote ${Buffer.byteLength(content)} bytes to ${targetPath}`;
          linuxResult = {
            content: [
              {
                type: 'text',
                text: JSON.stringify({ path: targetPath, size: Buffer.byteLength(content) }),
              },
            ],
          };
          break;
        }
        case 'file_delete': {
          const targetPath = realLinuxDesktop.resolveLinuxPath(String(args.path));
          const existed = fs.existsSync(targetPath);
          if (existed) {
            fs.rmSync(targetPath, { recursive: true, force: true });
          }
          linuxSummary = existed ? `Deleted ${targetPath}` : `Not found ${targetPath}`;
          linuxResult = {
            content: [{ type: 'text', text: JSON.stringify({ path: targetPath, deleted: existed }) }],
          };
          break;
        }
        case 'browser_navigate': {
          const url = String(args.url ?? 'https://modelcontextprotocol.io');
          linuxSummary = await realLinuxDesktop.openApp('chromium', { url });
          linuxResult = { content: [{ type: 'text', text: linuxSummary }] };
          break;
        }
        case 'wait': {
          const ms = Math.max(100, Math.min(10000, Number(args.ms ?? 1000)));
          await new Promise((r) => setTimeout(r, ms));
          linuxSummary = `Waited ${ms}ms`;
          linuxResult = { content: [{ type: 'text', text: linuxSummary }] };
          break;
        }
        default:
          linuxSummary = `Unsupported tool on Linux: ${name}`;
          linuxResult = {
            isError: true,
            content: [{ type: 'text', text: linuxSummary }],
          };
      }

      desktopStore.logActivity(
        'mcp',
        name,
        `[Linux] ${JSON.stringify(args).slice(0, 95)}`,
        linuxSummary,
        linuxResult.isError ? 'error' : 'ok',
        Date.now() - started,
      );
      return linuxResult;
    }

    if (mode === 'real-win10') {
      if (name === 'wait') {
        const ms = Math.max(100, Math.min(10000, Number(args.ms ?? 1000)));
        await new Promise((r) => setTimeout(r, ms));
        const msg = `Waited ${ms}ms`;
        desktopStore.logActivity('mcp', name, 'real-win10', msg, 'ok', Date.now() - started);
        return { content: [{ type: 'text', text: msg }] };
      }
      if (name === 'desktop_screenshot') {
        const frame = realWin10Bridge.getLatestFrame();
        const status = realWin10Bridge.getStatus();
        if (frame?.data) {
          const summary = `Captured real Windows 10 Pro frame (${frame.width}x${frame.height})`;
          desktopStore.logActivity('mcp', name, 'real-win10', summary, 'ok', Date.now() - started);
          return {
            content: [
              { type: 'image', data: frame.data, mimeType: frame.mimeType },
              {
                type: 'text',
                text: JSON.stringify({
                  target: 'real-win10',
                  hostname: status.hostname,
                  osVersion: status.osVersion,
                  screen: { width: frame.width, height: frame.height },
                  cursor: { x: frame.cursorX, y: frame.cursorY },
                }),
              },
            ],
          };
        }
      }
      const agentOut = await realWin10Bridge.executeOnAgent(name, args);
      const textOut = typeof agentOut === 'string' ? agentOut : JSON.stringify(agentOut, null, 2);
      desktopStore.logActivity(
        'mcp',
        name,
        `[Real Win10] ${JSON.stringify(args).slice(0, 90)}`,
        textOut.slice(0, 140),
        'ok',
        Date.now() - started,
      );
      return {
        content: [{ type: 'text', text: textOut }],
      };
    }

    let result: { content: Array<Record<string, unknown>>; isError?: boolean };
    let summary = '';

    switch (name) {
      case 'desktop_screenshot': {
        const { pngBase64, layout } = desktopStore.getScreenshotPayload();
        summary = `Captured 640x360 PNG (${layout.windows.length} windows)`;
        result = {
          content: [
            { type: 'image', data: pngBase64, mimeType: 'image/png' },
            { type: 'text', text: JSON.stringify(layout, null, 2) },
          ],
        };
        break;
      }
      case 'desktop_move': {
        const x = Number(args.x ?? 640);
        const y = Number(args.y ?? 360);
        desktopStore.moveMouse(x, y, 'claude');
        summary = `Moved cursor to (${x}, ${y})`;
        result = { content: [{ type: 'text', text: summary }] };
        break;
      }
      case 'desktop_click': {
        const x = Number(args.x ?? 640);
        const y = Number(args.y ?? 360);
        const button =
          args.button === 'right' || args.button === 'double' ? args.button : 'left';
        const { hit } = desktopStore.clickAt(x, y, button, 'claude');
        summary = `${button} click (${x}, ${y}) -> ${hit}`;
        result = {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                clicked: { x, y, button, hit },
                layout: getWindowsLayoutSummary(desktopStore.getState()),
              }),
            },
          ],
        };
        break;
      }
      case 'desktop_type': {
        const text = String(args.text ?? '');
        const enter = Boolean(args.enter);
        const res = await desktopStore.typeText(text, enter);
        summary = `Typed ${text.length} chars into ${res.targetApp}`;
        result = { content: [{ type: 'text', text: summary }] };
        break;
      }
      case 'desktop_key': {
        const key = String(args.key ?? 'Enter');
        const res = await desktopStore.pressKey(key);
        summary = res.handled;
        result = { content: [{ type: 'text', text: summary }] };
        break;
      }
      case 'open_app': {
        const app = String(args.app) as AppId;
        const payload: Record<string, unknown> = {};
        if (typeof args.filePath === 'string') {
          payload.filePath = args.filePath;
          payload.path = args.filePath;
        }
        if (typeof args.url === 'string') payload.url = args.url;
        const winId = desktopStore.openApp(app, payload, 'user');
        summary = `Opened ${app} (${winId})`;
        result = {
          content: [
            {
              type: 'text',
              text: JSON.stringify({ windowId: winId, app, layout: getWindowsLayoutSummary(desktopStore.getState()) }),
            },
          ],
        };
        break;
      }
      case 'window_control': {
        const windowId = String(args.windowId);
        const action = String(args.action);
        if (action === 'focus') desktopStore.focusWin(windowId);
        else if (action === 'minimize') desktopStore.minimizeWin(windowId);
        else if (action === 'maximize') desktopStore.maximizeWin(windowId);
        else if (action === 'close') desktopStore.closeWin(windowId);
        else if (action === 'move') desktopStore.moveWin(windowId, Number(args.x ?? 100), Number(args.y ?? 100));
        else if (action === 'resize') desktopStore.resizeWin(windowId, Number(args.width ?? 640), Number(args.height ?? 440));
        summary = `${action} on ${windowId}`;
        result = { content: [{ type: 'text', text: summary }] };
        break;
      }
      case 'run_powershell': {
        const command = String(args.command ?? '');
        const res = await desktopStore.runPowerShell(command);
        summary = `Exit ${res.exitCode} in ${res.cwd}`;
        result = {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                cwd: res.cwd,
                exitCode: res.exitCode,
                stdout: res.stdout,
                stderr: res.stderr,
              }),
            },
          ],
        };
        break;
      }
      case 'file_list': {
        const dirPath = typeof args.path === 'string' ? args.path : 'C:\\Users\\Claude\\Desktop';
        const listing = desktopStore.fsList(dirPath);
        summary = `${listing.entries.length} items in ${listing.winPath}`;
        result = { content: [{ type: 'text', text: JSON.stringify(listing, null, 2) }] };
        break;
      }
      case 'file_read': {
        const filePath = String(args.path);
        const file = desktopStore.fsRead(filePath);
        summary = `Read ${file.size} bytes from ${file.winPath}`;
        result = { content: [{ type: 'text', text: file.content }] };
        break;
      }
      case 'file_write': {
        const filePath = String(args.path);
        const content = String(args.content ?? '');
        const openInNotepad = args.openInNotepad !== false;
        const written = desktopStore.fsWrite(filePath, content);
        if (openInNotepad) {
          desktopStore.openApp('notepad', { filePath: written.winPath, content }, 'user');
        }
        summary = `Wrote ${written.size} bytes to ${written.winPath}`;
        result = { content: [{ type: 'text', text: JSON.stringify(written) }] };
        break;
      }
      case 'file_delete': {
        const delPath = String(args.path);
        const res = desktopStore.fsDelete(delPath);
        summary = res.deleted ? `Deleted ${res.winPath}` : `Not found ${res.winPath}`;
        result = { content: [{ type: 'text', text: JSON.stringify(res) }] };
        break;
      }
      case 'browser_navigate': {
        const url = String(args.url ?? 'https://modelcontextprotocol.io');
        const nav = await desktopStore.navigateEdge(url);
        summary = `Loaded "${nav.title}" (${nav.url})`;
        result = {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                url: nav.url,
                title: nav.title,
                contentPreview: nav.contentText.slice(0, 3000),
              }),
            },
          ],
        };
        break;
      }
      case 'paint_draw': {
        const rawPoints = Array.isArray(args.points) ? args.points : [];
        const points = rawPoints
          .map((p) => ({
            x: Number((p as Record<string, unknown>).x ?? 0),
            y: Number((p as Record<string, unknown>).y ?? 0),
          }))
          .slice(0, 500);
        const color = typeof args.color === 'string' ? args.color : '#0078D4';
        const width = Math.max(1, Math.min(24, Number(args.width ?? 4)));
        const clearFirst = Boolean(args.clearFirst);
        desktopStore.addPaintStroke({ color, width, points }, clearFirst);
        summary = `Drew ${points.length}-point stroke (${color})`;
        result = { content: [{ type: 'text', text: summary }] };
        break;
      }
      default:
        return {
          isError: true,
          content: [{ type: 'text', text: `Unknown tool: ${name}` }],
        };
    }

    desktopStore.logActivity(
      'mcp',
      name,
      JSON.stringify(args).slice(0, 110),
      summary,
      'ok',
      Date.now() - started,
    );
    return result;
  } catch (err) {
    const msg = (err as Error).message || 'Tool execution error';
    desktopStore.logActivity(
      'mcp',
      name,
      JSON.stringify(args).slice(0, 110),
      msg,
      'error',
      Date.now() - started,
    );
    return {
      isError: true,
      content: [{ type: 'text', text: msg }],
    };
  }
}

export async function handleJsonRpcMessage(body: JsonRpcRequest): Promise<Record<string, unknown> | null> {
  const { id, method, params } = body;

  // Notifications have no id and require no JSON-RPC response payload
  if (method === 'notifications/initialized' || method === 'notifications/cancelled') {
    return null;
  }

  if (method === 'initialize') {
    desktopStore.logActivity('mcp', 'mcp:initialize', 'Claude MCP handshake', 'Connected to Claude Linux Desktop', 'ok', 2);
    return {
      jsonrpc: '2.0',
      id: id ?? null,
      result: {
        protocolVersion: '2025-03-26',
        capabilities: {
          tools: { listChanged: false },
          resources: { subscribe: false, listChanged: false },
          prompts: { listChanged: false },
        },
        serverInfo: {
          name: 'claude-linux-desktop-mcp',
          version: '2.0.0',
        },
        instructions:
          'You are connected to a live Debian GNU/Linux 12 (Bookworm) X11 desktop (1280x720 on DISPLAY=:99) running Openbox, Chromium, XFCE4 Terminal, Mousepad, PCManFM, and Galculator. You have full autonomous control: use run_bash for shell/root commands, file_* for filesystem operations, open_app / browser_navigate to launch GUI apps or websites, window_list / window_control to manage windows, and desktop_screenshot / desktop_click / desktop_drag / desktop_scroll / desktop_type / desktop_key to see and control the live GUI.',
      },
    };
  }

  if (method === 'ping') {
    return { jsonrpc: '2.0', id: id ?? null, result: {} };
  }

  if (method === 'prompts/list') {
    return {
      jsonrpc: '2.0',
      id: id ?? null,
      result: { prompts: [] },
    };
  }

  if (method === 'tools/list') {
    return {
      jsonrpc: '2.0',
      id: id ?? null,
      result: { tools: MCP_TOOLS },
    };
  }

  if (method === 'tools/call') {
    const toolName = String(params?.name ?? '');
    const toolArgs = (params?.arguments as Record<string, unknown>) || {};
    const toolResult = await callMcpTool(toolName, toolArgs);
    return {
      jsonrpc: '2.0',
      id: id ?? null,
      result: toolResult,
    };
  }

  if (method === 'resources/list') {
    return {
      jsonrpc: '2.0',
      id: id ?? null,
      result: {
        resources: [
          {
            uri: 'linux://desktop/state',
            name: 'Debian Linux 12 Desktop State & Open X11 Windows',
            mimeType: 'application/json',
          },
          {
            uri: 'linux://fs/desktop',
            name: '/root/Desktop Directory Listing',
            mimeType: 'application/json',
          },
        ],
      },
    };
  }

  if (method === 'resources/read') {
    const uri = String(params?.uri ?? '');
    if (uri === 'linux://desktop/state' || uri === 'win10://desktop/state') {
      const meta = await realLinuxDesktop.getSnapshotMeta();
      return {
        jsonrpc: '2.0',
        id: id ?? null,
        result: {
          contents: [
            {
              uri,
              mimeType: 'application/json',
              text: JSON.stringify(meta, null, 2),
            },
          ],
        },
      };
    }
    if (uri === 'linux://fs/desktop' || uri === 'win10://drive/desktop') {
      const entries = fs.readdirSync('/root/Desktop', { withFileTypes: true }).map((e) => ({
        name: e.name,
        path: path.join('/root/Desktop', e.name),
        type: e.isDirectory() ? 'dir' : 'file',
      }));
      return {
        jsonrpc: '2.0',
        id: id ?? null,
        result: {
          contents: [
            {
              uri,
              mimeType: 'application/json',
              text: JSON.stringify({ path: '/root/Desktop', entries }, null, 2),
            },
          ],
        },
      };
    }
  }

  return {
    jsonrpc: '2.0',
    id: id ?? null,
    error: {
      code: -32601,
      message: `Method not found: ${method}`,
    },
  };
}

export async function handleStreamableMcpPost(req: Request, res: Response): Promise<void> {
  if (!verifyMcpAuth(req)) {
    res.status(401).json({ jsonrpc: '2.0', error: { code: -32001, message: 'Unauthorized Bearer token' } });
    return;
  }

  const body = req.body as JsonRpcRequest | JsonRpcRequest[];
  const sessionId = (req.headers['mcp-session-id'] as string) || `mcp-${Date.now().toString(36)}`;
  res.setHeader('Mcp-Session-Id', sessionId);

  if (Array.isArray(body)) {
    const responses = (await Promise.all(body.map((item) => handleJsonRpcMessage(item)))).filter(Boolean);
    res.status(200).json(responses);
    return;
  }

  const response = await handleJsonRpcMessage(body);
  if (response === null) {
    res.status(202).end();
    return;
  }
  res.status(200).json(response);
}

export function handleStreamableMcpGet(req: Request, res: Response): void {
  if (!verifyMcpAuth(req)) {
    res.status(401).end('Unauthorized');
    return;
  }
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
  });
  res.write(': connected\n\n');
  const keepalive = setInterval(() => {
    res.write(': keepalive\n\n');
  }, 15000);
  req.on('close', () => {
    clearInterval(keepalive);
  });
}

export function handleLegacySseGet(req: Request, res: Response): void {
  if (!verifyMcpAuth(req)) {
    res.status(401).end('Unauthorized');
    return;
  }
  const sessionId = `sse-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
  });
  sseClients.set(sessionId, res);
  desktopStore.setMcpSessionCount(sseClients.size);
  res.write(`event: endpoint\ndata: /messages?sessionId=${sessionId}\n\n`);

  const keepalive = setInterval(() => {
    res.write(': keepalive\n\n');
  }, 15000);

  req.on('close', () => {
    clearInterval(keepalive);
    sseClients.delete(sessionId);
    desktopStore.setMcpSessionCount(sseClients.size);
  });
}

export async function handleLegacySsePost(req: Request, res: Response): Promise<void> {
  if (!verifyMcpAuth(req)) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  const sessionId = String(req.query.sessionId || '');
  const sseRes = sseClients.get(sessionId);
  const body = req.body as JsonRpcRequest;
  const response = await handleJsonRpcMessage(body);
  if (sseRes && response !== null) {
    sseRes.write(`event: message\ndata: ${JSON.stringify(response)}\n\n`);
  }
  res.status(202).json(response ?? { ok: true });
}

export function getMcpToolManifest() {
  return MCP_TOOLS;
}
