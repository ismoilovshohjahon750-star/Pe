import 'dotenv/config';
import express from 'express';
import http from 'node:http';
import path from 'node:path';
import { WebSocket, WebSocketServer } from 'ws';
import { shouldSendToWsClient, type ExecutionTarget } from './src/desktop/bridge.ts';
import type { AppId } from './src/desktop/types.ts';
import { desktopStore } from './src/server/desktopStore.ts';
import { ensureDriveSeeded, makeWinDir } from './src/server/filesystem.ts';
import {
  getMcpToolManifest,
  handleJsonRpcMessage,
  handleLegacySseGet,
  handleLegacySsePost,
  handleStreamableMcpGet,
  handleStreamableMcpPost,
} from './src/server/mcp.ts';
import { realLinuxDesktop } from './src/server/realLinuxDesktop.ts';
import { realWin10Bridge } from './src/server/realWin10Bridge.ts';
import { renderDesktopPngBase64 } from './src/server/screenshot.ts';
import { buildAndroidTermuxAgent } from './src/server/androidTermuxAgent.ts';
import {
  buildCSharpPcAgentSource,
  buildExeBuilderBatchScript,
} from './src/server/pcAgentExeBuilder.ts';
import { buildPythonPcAgent } from './src/server/pcAgentPython.ts';
import { buildWindows10AgentPs1 } from './src/server/win10AgentScript.ts';
import {
  formatGeminiError,
  runJarvisChat,
  synthesizeJarvisSpeech,
  transcribeJarvisAudio,
  type JarvisChatMessage,
} from './src/server/jarvis.ts';
import { getSettingsKeys, saveSettingsKeys } from './src/server/settingsManager.ts';

const PORT = Number(process.env.PORT) || 3000;

async function startServer() {
  ensureDriveSeeded();
  const app = express();
  app.use(express.json({ limit: '16mb' }));

  // CORS & cache headers for MCP + cross-browser REST compatibility
  app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, Mcp-Session-Id');
    res.setHeader('Access-Control-Expose-Headers', 'Mcp-Session-Id');
    if (req.path.startsWith('/api/')) {
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
      res.setHeader('Pragma', 'no-cache');
    }
    if (req.method === 'OPTIONS') {
      res.status(204).end();
      return;
    }
    next();
  });

  // --- Model Context Protocol (MCP) Endpoints ---
  app.post('/mcp', (req, res) => {
    void handleStreamableMcpPost(req, res);
  });
  app.get('/mcp', (req, res) => {
    handleStreamableMcpGet(req, res);
  });
  app.delete('/mcp', (_req, res) => {
    res.status(200).json({ closed: true });
  });
  app.get('/sse', (req, res) => {
    handleLegacySseGet(req, res);
  });
  app.post('/messages', (req, res) => {
    void handleLegacySsePost(req, res);
  });

  // --- Desktop & Filesystem REST APIs ---
  app.get('/api/state', (_req, res) => {
    res.json(desktopStore.getState());
  });

  app.get('/api/mcp-info', (_req, res) => {
    const state = desktopStore.getState();
    res.json({
      serverName: 'claude-linux-desktop-mcp',
      protocolVersion: '2025-03-26',
      authEnabled: state.authEnabled,
      token: state.authEnabled ? desktopStore.getAuthToken() : null,
      tools: getMcpToolManifest(),
    });
  });

  app.get('/api/real-win10/status', (_req, res) => {
    res.json({
      target: realWin10Bridge.getExecutionTarget(),
      agent: realWin10Bridge.getStatus(),
      devices: realWin10Bridge.getDevices(),
      activeDeviceId: realWin10Bridge.getActiveDeviceId(),
      linux: realLinuxDesktop.getStatus(),
    });
  });

  app.post('/api/real-win10/target', (req, res) => {
    const raw = req.body?.target;
    const target: ExecutionTarget =
      raw === 'real-win10' ? 'real-win10' : raw === 'linux' ? 'linux' : 'sandbox';
    const updated = realWin10Bridge.setExecutionTarget(target);
    res.json({ target: updated });
  });

  app.get('/api/real-win10/devices', (_req, res) => {
    res.json({
      devices: realWin10Bridge.getDevices(),
      activeDeviceId: realWin10Bridge.getActiveDeviceId(),
      frames: realWin10Bridge.getAllFrames(),
    });
  });

  app.post('/api/real-win10/active-device', (req, res) => {
    const deviceId = String(req.body?.deviceId || '');
    const summary = realWin10Bridge.setActiveDevice(deviceId);
    if (!summary) {
      res.status(404).json({ ok: false, error: 'Device not found' });
      return;
    }
    res.json({ ok: true, activeDevice: summary });
  });

  app.get('/api/real-win10/frame', (_req, res) => {
    const deviceId = typeof _req.query.deviceId === 'string' ? _req.query.deviceId : undefined;
    res.json({
      target: realWin10Bridge.getExecutionTarget(),
      status: realWin10Bridge.getStatus(deviceId),
      frame: realWin10Bridge.getLatestFrame(deviceId),
      devices: realWin10Bridge.getDevices(),
      activeDeviceId: realWin10Bridge.getActiveDeviceId(),
    });
  });

  app.get('/api/linux/status', (_req, res) => {
    res.json({
      status: realLinuxDesktop.getStatus(),
      frame: realLinuxDesktop.getLatestFrame(),
    });
  });

  app.get('/api/linux/frame', (_req, res) => {
    res.json({
      status: realLinuxDesktop.getStatus(),
      frame: realLinuxDesktop.getLatestFrame(),
    });
  });

  app.post('/api/linux/restart', async (_req, res) => {
    const status = await realLinuxDesktop.restart();
    res.json({ status });
  });

  app.post('/api/desktop/input', async (req, res) => {
    try {
      const msg = (req.body || {}) as { type?: string; [k: string]: unknown };
      switch (msg.type) {
        case 'user:linux_click':
          await realLinuxDesktop.click(
            Number(msg.x ?? 0),
            Number(msg.y ?? 0),
            msg.button === 'right' || msg.button === 'double' ? msg.button : 'left',
          );
          break;
        case 'user:linux_scroll':
          await realLinuxDesktop.scroll(
            Number(msg.x ?? 640),
            Number(msg.y ?? 360),
            Number(msg.deltaY ?? 0),
          );
          break;
        case 'user:linux_type':
          await realLinuxDesktop.typeText(String(msg.text ?? ''), Boolean(msg.enter));
          break;
        case 'user:linux_key':
          await realLinuxDesktop.pressKey(String(msg.key ?? 'Return'));
          break;
        case 'user:real_click':
          if (realWin10Bridge.getStatus().connected) {
            await realWin10Bridge.executeOnAgent('desktop_click', {
              x: Number(msg.x ?? 0),
              y: Number(msg.y ?? 0),
              button: msg.button === 'right' || msg.button === 'double' ? msg.button : 'left',
            });
          }
          break;
        case 'user:real_scroll':
          if (realWin10Bridge.getStatus().connected) {
            await realWin10Bridge.executeOnAgent('desktop_scroll', {
              x: Number(msg.x ?? 640),
              y: Number(msg.y ?? 360),
              direction: Number(msg.deltaY ?? 0) > 0 ? 'down' : 'up',
              clicks: 3,
            });
          }
          break;
        case 'user:real_type':
          if (realWin10Bridge.getStatus().connected) {
            await realWin10Bridge.executeOnAgent('desktop_type', {
              text: String(msg.text ?? ''),
              enter: Boolean(msg.enter),
            });
          }
          break;
        case 'user:real_key':
          if (realWin10Bridge.getStatus().connected) {
            await realWin10Bridge.executeOnAgent('desktop_key', {
              key: String(msg.key ?? 'Enter'),
            });
          }
          break;
        default:
          res.status(400).json({ ok: false, error: 'Unsupported input action' });
          return;
      }
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ ok: false, error: (err as Error).message });
    }
  });

  app.get('/api/real-win10-agent.ps1', (req, res) => {
    const fwdProto = String(req.headers['x-forwarded-proto'] || '')
      .split(',')[0]
      .trim()
      .toLowerCase();
    const proto = fwdProto === 'https' || req.protocol === 'https' ? 'wss' : 'ws';
    const host = req.headers.host || `localhost:${PORT}`;
    const state = desktopStore.getState();
    const token = state.authEnabled ? desktopStore.getAuthToken() : null;
    const script = buildWindows10AgentPs1(`${proto}://${host}/agent-ws`, token);
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Content-Disposition', 'inline; filename="win10-claude-agent.ps1"');
    res.send(script);
  });

  app.get('/api/real-pc-agent.py', (req, res) => {
    const fwdProto = String(req.headers['x-forwarded-proto'] || '')
      .split(',')[0]
      .trim()
      .toLowerCase();
    const proto = fwdProto === 'https' || req.protocol === 'https' ? 'wss' : 'ws';
    const host = req.headers.host || `localhost:${PORT}`;
    const state = desktopStore.getState();
    const token = state.authEnabled ? desktopStore.getAuthToken() : null;
    const script = buildPythonPcAgent(`${proto}://${host}/agent-ws`, token);
    res.setHeader('Content-Type', 'text/x-python; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="real-pc-agent.py"');
    res.send(script);
  });

  app.get('/api/android-termux-agent.py', (req, res) => {
    const fwdProto = String(req.headers['x-forwarded-proto'] || '')
      .split(',')[0]
      .trim()
      .toLowerCase();
    const proto = fwdProto === 'https' || req.protocol === 'https' ? 'wss' : 'ws';
    const host = req.headers.host || `localhost:${PORT}`;
    const state = desktopStore.getState();
    const token = state.authEnabled ? desktopStore.getAuthToken() : null;
    const script = buildAndroidTermuxAgent(`${proto}://${host}/agent-ws`, token);
    res.setHeader('Content-Type', 'text/x-python; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="android-termux-agent.py"');
    res.send(script);
  });

  app.get('/api/real-pc-agent.cs', (req, res) => {
    const fwdProto = String(req.headers['x-forwarded-proto'] || '')
      .split(',')[0]
      .trim()
      .toLowerCase();
    const proto = fwdProto === 'https' || req.protocol === 'https' ? 'wss' : 'ws';
    const host = req.headers.host || `localhost:${PORT}`;
    const state = desktopStore.getState();
    const token = state.authEnabled ? desktopStore.getAuthToken() : null;
    const source = buildCSharpPcAgentSource(`${proto}://${host}/agent-ws`, token);
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="JarvisPcAgent.cs"');
    res.send(source);
  });

  app.get('/api/real-pc-agent-builder.bat', (req, res) => {
    const fwdProto = String(req.headers['x-forwarded-proto'] || '')
      .split(',')[0]
      .trim()
      .toLowerCase();
    const httpProto = fwdProto === 'https' || req.protocol === 'https' ? 'https' : 'http';
    const host = req.headers.host || `localhost:${PORT}`;
    const bat = buildExeBuilderBatchScript(`${httpProto}://${host}`);
    res.setHeader('Content-Type', 'application/x-msdos-program; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="JarvisPcAgent-Setup.bat"');
    res.send(bat);
  });

  app.post('/api/mcp-auth', (req, res) => {
    const enabled = Boolean(req.body?.enabled);
    const updated = desktopStore.setAuthEnabled(enabled);
    res.json({
      authEnabled: updated.authEnabled,
      token: updated.authEnabled ? desktopStore.getAuthToken() : null,
    });
  });

  app.post('/api/jarvis/chat', async (req, res) => {
    const wantsStream =
      req.body?.stream === true ||
      String(req.headers.accept || '').includes('text/event-stream');

    const message = String(req.body?.message || '').trim();
    const history = Array.isArray(req.body?.history)
      ? (req.body.history as JarvisChatMessage[])
      : [];

    if (!message) {
      res.status(400).json({ error: 'Xabar bo‘sh bo‘lmasligi kerak.' });
      return;
    }

    if (wantsStream) {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
      });
      res.flushHeaders?.();
      res.write(': connected\n\n');
      const sendSse = (event: string, data: unknown) => {
        if (!res.writableEnded) {
          res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
        }
      };

      try {
        const result = await runJarvisChat(message, history, (ev) => {
          sendSse(ev.type, ev);
        });
        sendSse('done', result);
      } catch (err) {
        const formatted = formatGeminiError(err);
        sendSse('error', { status: formatted.status, error: formatted.message });
      } finally {
        if (!res.writableEnded) {
          res.end();
        }
      }
      return;
    }

    try {
      const result = await runJarvisChat(message, history);
      res.json(result);
    } catch (err) {
      const formatted = formatGeminiError(err);
      res.status(formatted.status).json({ error: formatted.message });
    }
  });

  app.post('/api/jarvis/transcribe', async (req, res) => {
    try {
      const audioBase64 = String(req.body?.audioBase64 || '');
      const mimeType = String(req.body?.mimeType || 'audio/webm');
      if (!audioBase64) {
        res.status(400).json({ error: 'Audio ma‘lumot topilmadi.' });
        return;
      }
      const text = await transcribeJarvisAudio(audioBase64, mimeType);
      res.json({ text });
    } catch (err) {
      const formatted = formatGeminiError(err);
      res.status(formatted.status).json({ error: formatted.message });
    }
  });

  app.post('/api/jarvis/tts', async (req, res) => {
    try {
      const text = String(req.body?.text || '').trim();
      if (!text) {
        res.status(400).json({ error: 'Ovozga aylantirish uchun matn bo‘sh bo‘lmasligi kerak.' });
        return;
      }
      const result = await synthesizeJarvisSpeech(text);
      res.json(result);
    } catch (err) {
      const formatted = formatGeminiError(err);
      res.status(formatted.status).json({ error: formatted.message });
    }
  });

  app.get('/api/settings/keys', (_req, res) => {
    try {
      const keys = getSettingsKeys();
      res.json(keys);
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  app.post('/api/settings/keys', (req, res) => {
    try {
      const geminiKeys = Array.isArray(req.body?.geminiKeys) ? req.body.geminiKeys : undefined;
      const groqKeys = Array.isArray(req.body?.groqKeys) ? req.body.groqKeys : undefined;
      const openRouterKeys = Array.isArray(req.body?.openRouterKeys) ? req.body.openRouterKeys : undefined;
      saveSettingsKeys({ geminiKeys, groqKeys, openRouterKeys });
      res.json({ ok: true, keys: getSettingsKeys() });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  app.get('/api/screenshot.png', (_req, res) => {
    const base64 = renderDesktopPngBase64(desktopStore.getState());
    const buf = Buffer.from(base64, 'base64');
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'no-store');
    res.send(buf);
  });

  app.get('/api/fs/list', (req, res) => {
    try {
      const winPath = typeof req.query.path === 'string' ? req.query.path : 'C:\\Users\\Claude\\Desktop';
      res.json(desktopStore.fsList(winPath));
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  app.get('/api/fs/read', (req, res) => {
    try {
      const winPath = String(req.query.path || '');
      res.json(desktopStore.fsRead(winPath));
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  app.post('/api/fs/write', (req, res) => {
    try {
      const winPath = String(req.body?.path || '');
      const content = String(req.body?.content ?? '');
      res.json(desktopStore.fsWrite(winPath, content));
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  app.post('/api/fs/mkdir', (req, res) => {
    try {
      const winPath = String(req.body?.path || '');
      res.json(makeWinDir(winPath));
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  app.delete('/api/fs/delete', (req, res) => {
    try {
      const winPath = String(req.query.path || req.body?.path || '');
      res.json(desktopStore.fsDelete(winPath));
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  // Live MCP end-to-end demonstration (executes genuine JSON-RPC MCP tool calls)
  app.post('/api/demo-mcp', async (_req, res) => {
    res.json({ started: true });
    const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));
    try {
      if (realWin10Bridge.getExecutionTarget() === 'linux' && realLinuxDesktop.getStatus().running) {
        await handleJsonRpcMessage({
          jsonrpc: '2.0',
          id: 'demo-linux-1',
          method: 'tools/call',
          params: { name: 'desktop_move', arguments: { x: 460, y: 260 } },
        });
        await delay(300);

        await handleJsonRpcMessage({
          jsonrpc: '2.0',
          id: 'demo-linux-2',
          method: 'tools/call',
          params: {
            name: 'file_write',
            arguments: {
              path: '/root/Desktop/claude_live.mjs',
              content:
                'import os from "node:os";\nconsole.log("Claude AI MCP Live on Real Linux!");\nconsole.log("Kernel:", os.type(), os.release(), os.arch());\nconsole.log("Sum 19 + 23 =", 19 + 23);\n',
              openInNotepad: true,
            },
          },
        });
        await delay(450);

        await handleJsonRpcMessage({
          jsonrpc: '2.0',
          id: 'demo-linux-3',
          method: 'tools/call',
          params: {
            name: 'run_powershell',
            arguments: { command: 'uname -a && node /root/Desktop/claude_live.mjs' },
          },
        });
        await delay(350);

        await handleJsonRpcMessage({
          jsonrpc: '2.0',
          id: 'demo-linux-4',
          method: 'tools/call',
          params: { name: 'open_app', arguments: { app: 'calculator' } },
        });
        await delay(500);

        await handleJsonRpcMessage({
          jsonrpc: '2.0',
          id: 'demo-linux-5',
          method: 'tools/call',
          params: { name: 'desktop_screenshot', arguments: {} },
        });
        return;
      }

      await handleJsonRpcMessage({
        jsonrpc: '2.0',
        id: 'demo-1',
        method: 'tools/call',
        params: { name: 'desktop_move', arguments: { x: 420, y: 240 } },
      });
      await delay(350);

      await handleJsonRpcMessage({
        jsonrpc: '2.0',
        id: 'demo-2',
        method: 'tools/call',
        params: {
          name: 'file_write',
          arguments: {
            path: 'C:\\Users\\Claude\\Projects\\mcp_live_check.js',
            content:
              'console.log("Claude AI MCP Live Verification");\nconsole.log("OS: Windows 10 Pro (Build 19045)");\nconsole.log("Sum 19 + 23 =", 19 + 23);\n',
            openInNotepad: true,
          },
        },
      });
      await delay(450);

      await handleJsonRpcMessage({
        jsonrpc: '2.0',
        id: 'demo-3',
        method: 'tools/call',
        params: {
          name: 'run_powershell',
          arguments: { command: 'node C:\\Users\\Claude\\Projects\\mcp_live_check.js' },
        },
      });
      await delay(450);

      await handleJsonRpcMessage({
        jsonrpc: '2.0',
        id: 'demo-4',
        method: 'tools/call',
        params: {
          name: 'paint_draw',
          arguments: {
            color: '#0078D4',
            width: 5,
            clearFirst: true,
            points: [
              { x: 140, y: 180 },
              { x: 240, y: 90 },
              { x: 340, y: 180 },
              { x: 440, y: 90 },
              { x: 540, y: 180 },
            ],
          },
        },
      });
    } catch {
      // ignore demo interruption
    }
  });

  // Vite dev middleware or production static serving
  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  const server = http.createServer(app);

  // Real-time WebSocket stream on /ws and real Windows 10 Pro agent stream on /agent-ws
  const wss = new WebSocketServer({ noServer: true });
  const wssAgent = new WebSocketServer({ noServer: true });

  server.on('upgrade', (request, socket, head) => {
    const urlPath = (request.url || '/').split('?')[0];
    if (urlPath === '/ws') {
      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit('connection', ws, request);
      });
    } else if (urlPath === '/agent-ws') {
      const state = desktopStore.getState();
      if (state.authEnabled) {
        const parsed = new URL(request.url || '/', 'http://localhost');
        const token = parsed.searchParams.get('token');
        if (token !== desktopStore.getAuthToken()) {
          socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
          socket.destroy();
          return;
        }
      }
      wssAgent.handleUpgrade(request, socket, head, (ws) => {
        wssAgent.emit('connection', ws, request);
      });
    } else {
      socket.destroy();
    }
  });

  wssAgent.on('connection', (ws) => {
    desktopStore.logActivity(
      'system',
      'real_win10_agent',
      'Windows 10 Pro Agent connected',
      'Live stream & MCP hardware bridge active',
      'ok',
      4,
    );
    realWin10Bridge.attachAgent(ws);
  });

  const broadcastAll = (payloadObj: Record<string, unknown>) => {
    const payload = JSON.stringify(payloadObj);
    for (const client of wss.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(payload);
      }
    }
  };

  const broadcastFrame = (payloadObj: Record<string, unknown>) => {
    const payload = JSON.stringify(payloadObj);
    for (const client of wss.clients) {
      if (shouldSendToWsClient(client.readyState, client.bufferedAmount)) {
        client.send(payload);
      }
    }
  };

  const wsAlive = new WeakMap<WebSocket, boolean>();
  const wsHeartbeat = setInterval(() => {
    for (const client of wss.clients) {
      if (wsAlive.get(client) === false) {
        client.terminate();
        continue;
      }
      wsAlive.set(client, false);
      if (client.readyState === WebSocket.OPEN) {
        client.ping();
      }
    }
  }, 15000);
  wsHeartbeat.unref();

  realWin10Bridge.onStatus((status) => {
    broadcastAll({ type: 'real_agent_status', status });
  });

  realWin10Bridge.onDevices((devices, activeDeviceId) => {
    broadcastAll({ type: 'real_devices', devices, activeDeviceId });
  });

  realWin10Bridge.onFrame((frame) => {
    broadcastFrame({ type: 'real_agent_frame', frame });
  });

  realWin10Bridge.onDeviceFrame((deviceId, frame) => {
    broadcastFrame({ type: 'real_agent_frame_for', deviceId, frame });
  });

  realWin10Bridge.onTarget((target) => {
    broadcastAll({ type: 'execution_target', target });
  });

  realLinuxDesktop.onStatus((status) => {
    broadcastAll({ type: 'linux_status', status });
  });

  realLinuxDesktop.onFrame((frame) => {
    broadcastFrame({ type: 'linux_frame', frame });
  });

  const broadcastState = () => {
    broadcastAll({ type: 'state', state: desktopStore.getState() });
  };

  let broadcastScheduled = false;
  desktopStore.subscribe(() => {
    if (broadcastScheduled) return;
    broadcastScheduled = true;
    queueMicrotask(() => {
      broadcastScheduled = false;
      broadcastState();
    });
  });

  wss.on('connection', (ws) => {
    wsAlive.set(ws, true);
    ws.on('pong', () => wsAlive.set(ws, true));
    desktopStore.setViewerCount(wss.clients.size);
    ws.send(JSON.stringify({ type: 'state', state: desktopStore.getState() }));
    ws.send(
      JSON.stringify({
        type: 'real_agent_status',
        status: realWin10Bridge.getStatus(),
      }),
    );
    ws.send(
      JSON.stringify({
        type: 'linux_status',
        status: realLinuxDesktop.getStatus(),
      }),
    );
    ws.send(
      JSON.stringify({
        type: 'execution_target',
        target: realWin10Bridge.getExecutionTarget(),
      }),
    );
    const lastFrame = realWin10Bridge.getLatestFrame();
    if (lastFrame) {
      ws.send(JSON.stringify({ type: 'real_agent_frame', frame: lastFrame }));
    }
    const lastLinuxFrame = realLinuxDesktop.getLatestFrame();
    if (lastLinuxFrame) {
      ws.send(JSON.stringify({ type: 'linux_frame', frame: lastLinuxFrame }));
    }

    ws.on('message', (raw) => {
      void (async () => {
        try {
          const msg = JSON.parse(String(raw)) as { type: string; [k: string]: unknown };
          switch (msg.type) {
            case 'user:open_app':
              desktopStore.openApp(
                String(msg.appId) as AppId,
                msg.payload as Record<string, unknown> | undefined,
                'user',
              );
              break;
            case 'user:focus_window':
              desktopStore.focusWin(String(msg.windowId));
              break;
            case 'user:close_window':
              desktopStore.closeWin(String(msg.windowId));
              break;
            case 'user:minimize_window':
              desktopStore.minimizeWin(String(msg.windowId));
              break;
            case 'user:maximize_window':
              desktopStore.maximizeWin(String(msg.windowId));
              break;
            case 'user:move_window':
              desktopStore.moveWin(String(msg.windowId), Number(msg.x), Number(msg.y));
              break;
            case 'user:resize_window':
              desktopStore.resizeWin(String(msg.windowId), Number(msg.width), Number(msg.height));
              break;
            case 'user:toggle_start':
              desktopStore.toggleStartMenu(
                typeof msg.open === 'boolean' ? msg.open : undefined,
              );
              break;
            case 'user:set_wallpaper':
              desktopStore.setWallpaper(String(msg.wallpaperId));
              break;
            case 'user:click':
              desktopStore.clickAt(
                Number(msg.x),
                Number(msg.y),
                msg.button === 'double' || msg.button === 'right' ? msg.button : 'left',
                'user',
              );
              break;
            case 'user:explorer_cd':
              desktopStore.setExplorerPath(String(msg.windowId), String(msg.path));
              break;
            case 'user:notepad_edit':
              desktopStore.updateNotepadContent(
                String(msg.windowId),
                String(msg.content ?? ''),
                typeof msg.filePath === 'string' ? msg.filePath : undefined,
                true,
              );
              break;
            case 'user:notepad_save':
              desktopStore.saveNotepad(String(msg.windowId));
              break;
            case 'user:powershell_run':
              await desktopStore.runPowerShell(String(msg.command ?? ''), String(msg.windowId));
              break;
            case 'user:edge_navigate':
              await desktopStore.navigateEdge(String(msg.url ?? ''), String(msg.windowId));
              break;
            case 'user:paint_stroke':
              desktopStore.addPaintStroke(
                msg.stroke as { color: string; width: number; points: Array<{ x: number; y: number }> },
                false,
                String(msg.windowId),
              );
              break;
            case 'user:paint_clear':
              desktopStore.clearPaint(String(msg.windowId));
              break;
            case 'user:calculator':
              desktopStore.updateCalculator(
                String(msg.windowId),
                String(msg.display ?? '0'),
                String(msg.expression ?? ''),
              );
              break;
            case 'user:settings_section':
              desktopStore.updateSettingsSection(
                String(msg.windowId),
                msg.section === 'personalization' || msg.section === 'mcp'
                  ? msg.section
                  : 'system',
              );
              break;
            case 'user:real_click':
              if (realWin10Bridge.getDevices().length > 0) {
                await realWin10Bridge.executeOnAgent('desktop_click', {
                  x: Number(msg.x ?? 0),
                  y: Number(msg.y ?? 0),
                  button: msg.button === 'right' || msg.button === 'double' ? msg.button : 'left',
                }, typeof msg.deviceId === 'string' ? msg.deviceId : undefined);
              }
              break;
            case 'user:real_type':
              if (realWin10Bridge.getDevices().length > 0) {
                await realWin10Bridge.executeOnAgent('desktop_type', {
                  text: String(msg.text ?? ''),
                  enter: Boolean(msg.enter),
                }, typeof msg.deviceId === 'string' ? msg.deviceId : undefined);
              }
              break;
            case 'user:real_scroll':
              if (realWin10Bridge.getDevices().length > 0) {
                await realWin10Bridge.executeOnAgent('desktop_scroll', {
                  x: Number(msg.x ?? 640),
                  y: Number(msg.y ?? 360),
                  direction: Number(msg.deltaY ?? 0) > 0 ? 'down' : 'up',
                  clicks: 3,
                }, typeof msg.deviceId === 'string' ? msg.deviceId : undefined);
              }
              break;
            case 'user:real_key':
              if (realWin10Bridge.getDevices().length > 0) {
                await realWin10Bridge.executeOnAgent('desktop_key', {
                  key: String(msg.key ?? 'Enter'),
                }, typeof msg.deviceId === 'string' ? msg.deviceId : undefined);
              }
              break;
            case 'user:linux_move':
              await realLinuxDesktop.moveMouse(Number(msg.x ?? 0), Number(msg.y ?? 0));
              break;
            case 'user:linux_click':
              await realLinuxDesktop.click(
                Number(msg.x ?? 0),
                Number(msg.y ?? 0),
                msg.button === 'right' || msg.button === 'double' ? msg.button : 'left',
              );
              break;
            case 'user:linux_scroll':
              await realLinuxDesktop.scroll(
                Number(msg.x ?? 640),
                Number(msg.y ?? 360),
                Number(msg.deltaY ?? 0),
              );
              break;
            case 'user:linux_type':
              await realLinuxDesktop.typeText(String(msg.text ?? ''), Boolean(msg.enter));
              break;
            case 'user:linux_key':
              await realLinuxDesktop.pressKey(String(msg.key ?? 'Return'));
              break;
            case 'user:linux_open_app':
              await realLinuxDesktop.openApp(
                String(msg.appId || 'powershell') as AppId,
                msg.payload as { filePath?: string; url?: string } | undefined,
              );
              break;
            case 'browser_agent:hello':
              realWin10Bridge.startBrowserShare(ws, msg);
              break;
            case 'browser_agent:frame':
              realWin10Bridge.pushBrowserFrame(ws, msg);
              break;
            case 'browser_agent:stop':
              realWin10Bridge.stopBrowserShare(ws);
              break;
          }
        } catch {
          // ignore malformed WS frames
        }
      })();
    });

    ws.on('close', () => {
      realWin10Bridge.stopBrowserShare(ws);
      desktopStore.setViewerCount(wss.clients.size);
    });
  });

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`ClaudeWin 10 Pro server + MCP running on http://0.0.0.0:${PORT}`);
    // Boot real Debian 12 X11 desktop immediately in background so HTTP server listens right away
    void realLinuxDesktop.ensureStarted().then((st) => {
      if (st.running) {
        if (!realWin10Bridge.getStatus().connected) {
          realWin10Bridge.setExecutionTarget('linux');
        }
        desktopStore.logActivity(
          'system',
          'linux_x11_boot',
          `${st.osName} (${st.display})`,
          `${st.screenWidth}x${st.screenHeight} Xvfb + Openbox + Chromium ishga tushdi`,
          'ok',
          12,
        );
      }
    });
  });
}

void startServer();
