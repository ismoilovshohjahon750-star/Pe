import type { WebSocket } from 'ws';
import {
  createInitialRealAgentStatus,
  type ExecutionTarget,
  type RealAgentFrame,
  type RealAgentStatus,
} from '../desktop/bridge.ts';

type StatusListener = (status: RealAgentStatus) => void;
type FrameListener = (frame: RealAgentFrame) => void;
type TargetListener = (target: ExecutionTarget) => void;

class RealWin10Bridge {
  private agentSocket: WebSocket | null = null;
  private browserPublisher: WebSocket | null = null;
  private status: RealAgentStatus = createInitialRealAgentStatus();
  private latestFrame: RealAgentFrame | null = null;
  private target: ExecutionTarget = 'linux';
  private frameTimes: number[] = [];

  private pending = new Map<
    string,
    { resolve: (data: unknown) => void; reject: (err: Error) => void; timer: ReturnType<typeof setTimeout> }
  >();

  private statusListeners = new Set<StatusListener>();
  private frameListeners = new Set<FrameListener>();
  private targetListeners = new Set<TargetListener>();

  getStatus(): RealAgentStatus {
    return this.status;
  }

  getLatestFrame(): RealAgentFrame | null {
    return this.latestFrame;
  }

  getExecutionTarget(): ExecutionTarget {
    return this.target;
  }

  setExecutionTarget(next: ExecutionTarget): ExecutionTarget {
    this.target = next;
    for (const fn of this.targetListeners) fn(this.target);
    return this.target;
  }

  onStatus(fn: StatusListener): () => void {
    this.statusListeners.add(fn);
    return () => this.statusListeners.delete(fn);
  }

  onFrame(fn: FrameListener): () => void {
    this.frameListeners.add(fn);
    return () => this.frameListeners.delete(fn);
  }

  onTarget(fn: TargetListener): () => void {
    this.targetListeners.add(fn);
    return () => this.targetListeners.delete(fn);
  }

  private emitStatus() {
    for (const fn of this.statusListeners) fn(this.status);
  }

  startBrowserShare(ws: WebSocket, info: Record<string, unknown>): void {
    if (this.agentSocket) {
      try {
        this.agentSocket.close();
      } catch {
        // ignore
      }
      this.agentSocket = null;
    }
    this.browserPublisher = ws;
    this.status = {
      connected: true,
      connectedAt: new Date().toISOString(),
      hostname: String(info.hostname || 'Browser Screen Share'),
      osVersion: String(info.osVersion || 'Browser Display'),
      username: String(info.username || 'User'),
      screenWidth: Number(info.screenWidth || 1280),
      screenHeight: Number(info.screenHeight || 720),
      fps: 0,
      lastFrameAt: null,
    };
    this.emitStatus();
    this.setExecutionTarget('real-win10');
  }

  pushBrowserFrame(ws: WebSocket, msg: Record<string, unknown>): void {
    if (this.browserPublisher !== ws) return;
    const now = Date.now();
    this.frameTimes = [...this.frameTimes.filter((t) => now - t < 2000), now];
    const fps = Math.round((this.frameTimes.length / 2) * 10) / 10;
    const width = Number(msg.width || this.status.screenWidth || 1280);
    const height = Number(msg.height || this.status.screenHeight || 720);
    const frame: RealAgentFrame = {
      mimeType: String(msg.mimeType || 'image/jpeg'),
      width,
      height,
      data: String(msg.data || ''),
      cursorX: 0,
      cursorY: 0,
      timestamp: now,
    };
    this.latestFrame = frame;
    this.status = {
      ...this.status,
      screenWidth: width,
      screenHeight: height,
      lastFrameAt: now,
      fps,
    };
    for (const fn of this.frameListeners) fn(frame);
  }

  stopBrowserShare(ws: WebSocket): void {
    if (this.browserPublisher !== ws) return;
    this.browserPublisher = null;
    if (!this.agentSocket) {
      this.latestFrame = null;
      this.status = createInitialRealAgentStatus();
      this.emitStatus();
      this.setExecutionTarget('linux');
    }
  }

  attachAgent(ws: WebSocket): void {
    this.browserPublisher = null;
    if (this.agentSocket && this.agentSocket !== ws) {
      try {
        this.agentSocket.close();
      } catch {
        // ignore
      }
    }
    this.agentSocket = ws;
    this.status = {
      ...this.status,
      connected: true,
      connectedAt: new Date().toISOString(),
    };
    this.emitStatus();
    this.setExecutionTarget('real-win10');

    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(String(raw)) as Record<string, unknown>;
        if (msg.type === 'agent:hello') {
          this.status = {
            ...this.status,
            connected: true,
            hostname: String(msg.hostname || 'WIN10-PRO'),
            osVersion: String(msg.osVersion || 'Microsoft Windows 10 Pro'),
            username: String(msg.username || 'User'),
            screenWidth: Number(msg.screenWidth || 1920),
            screenHeight: Number(msg.screenHeight || 1080),
          };
          this.emitStatus();
        } else if (msg.type === 'agent:frame') {
          const now = Date.now();
          this.frameTimes = [...this.frameTimes.filter((t) => now - t < 2000), now];
          const fps = Math.round((this.frameTimes.length / 2) * 10) / 10;
          const frame: RealAgentFrame = {
            mimeType: String(msg.mimeType || 'image/jpeg'),
            width: Number(msg.width || this.status.screenWidth),
            height: Number(msg.height || this.status.screenHeight),
            data: String(msg.data || ''),
            cursorX: Number(msg.cursorX || 0),
            cursorY: Number(msg.cursorY || 0),
            timestamp: now,
          };
          this.latestFrame = frame;
          this.status = {
            ...this.status,
            screenWidth: frame.width,
            screenHeight: frame.height,
            lastFrameAt: now,
            fps,
          };
          for (const fn of this.frameListeners) fn(frame);
        } else if (msg.type === 'agent:result') {
          const requestId = String(msg.requestId || '');
          const waiter = this.pending.get(requestId);
          if (waiter) {
            clearTimeout(waiter.timer);
            this.pending.delete(requestId);
            if (msg.ok) {
              waiter.resolve(msg.data);
            } else {
              waiter.reject(new Error(String(msg.error || 'Real Windows agent command failed')));
            }
          }
        }
      } catch {
        // ignore malformed frames
      }
    });

    ws.on('close', () => {
      if (this.agentSocket === ws) {
        this.agentSocket = null;
        this.latestFrame = null;
        this.status = createInitialRealAgentStatus();
        this.emitStatus();
        this.setExecutionTarget('linux');
        for (const [reqId, waiter] of this.pending.entries()) {
          clearTimeout(waiter.timer);
          waiter.reject(new Error('Real Windows 10 Pro agent disconnected'));
          this.pending.delete(reqId);
        }
      }
    });
  }

  async executeOnAgent(tool: string, args: Record<string, unknown>): Promise<unknown> {
    if (!this.agentSocket || !this.status.connected) {
      if (this.browserPublisher && this.status.connected) {
        throw new Error(
          `Browser screen share supports viewing/desktop_screenshot only. Start real-pc-agent.py for ${tool}.`,
        );
      }
      throw new Error('Real Windows 10 Pro agent is not connected');
    }
    const requestId = `cmd-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        reject(new Error(`Timeout waiting for real Windows 10 agent on ${tool}`));
      }, 15000);
      this.pending.set(requestId, { resolve, reject, timer });
      this.agentSocket!.send(
        JSON.stringify({
          type: 'cmd:exec',
          requestId,
          tool,
          args,
        }),
      );
    });
  }
}

export const realWin10Bridge = new RealWin10Bridge();
