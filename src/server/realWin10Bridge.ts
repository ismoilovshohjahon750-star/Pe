import type { WebSocket } from 'ws';
import {
  createInitialRealAgentStatus,
  createReconnectingAgentStatus,
  REAL_AGENT_RECONNECT_GRACE_MS,
  type ExecutionTarget,
  type RealAgentFrame,
  type RealAgentStatus,
} from '../desktop/bridge.ts';

type StatusListener = (status: RealAgentStatus) => void;
type FrameListener = (frame: RealAgentFrame) => void;
type TargetListener = (target: ExecutionTarget) => void;

class RealWin10Bridge {
  private agentSocket: WebSocket | null = null;
  private status: RealAgentStatus = createInitialRealAgentStatus();
  private latestFrame: RealAgentFrame | null = null;
  private target: ExecutionTarget = 'linux';
  private frameTimes: number[] = [];
  private disconnectGraceTimer: ReturnType<typeof setTimeout> | null = null;
  private manualDisconnectBlocked = false;

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

  allowReconnect(): void {
    this.manualDisconnectBlocked = false;
  }

  isManuallyDisconnected(): boolean {
    return this.manualDisconnectBlocked;
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

  private clearGraceTimer() {
    if (this.disconnectGraceTimer) {
      clearTimeout(this.disconnectGraceTimer);
      this.disconnectGraceTimer = null;
    }
  }

  attachAgent(ws: WebSocket): void {
    this.manualDisconnectBlocked = false;
    this.clearGraceTimer();
    const previousSocket = this.agentSocket;
    this.agentSocket = ws;
    if (previousSocket && previousSocket !== ws) {
      try {
        previousSocket.close();
      } catch {
        // ignore
      }
    }
    this.status = {
      ...this.status,
      connected: true,
      reconnecting: false,
      connectedAt: this.status.connectedAt || new Date().toISOString(),
    };
    this.emitStatus();
    this.setExecutionTarget('real-win10');

    ws.on('message', (raw) => {
      if (this.agentSocket !== ws) return;
      try {
        const msg = JSON.parse(String(raw)) as Record<string, unknown>;
        if (msg.type === 'agent:hello') {
          this.status = {
            ...this.status,
            connected: true,
            reconnecting: false,
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
          const locked = typeof msg.locked === 'boolean' ? msg.locked : Boolean(this.status.locked);
          const desktopName =
            typeof msg.desktopName === 'string'
              ? msg.desktopName
              : typeof msg.desktop === 'string'
                ? msg.desktop
                : this.status.desktopName ?? null;
          const lockChanged = locked !== Boolean(this.status.locked) || desktopName !== (this.status.desktopName ?? null);
          const wasReconnecting = Boolean(this.status.reconnecting);
          const width = Number(msg.width || this.status.screenWidth);
          const height = Number(msg.height || this.status.screenHeight);
          const screenWidth = Number(msg.screenWidth || this.status.screenWidth || width);
          const screenHeight = Number(msg.screenHeight || this.status.screenHeight || height);
          const frame: RealAgentFrame = {
            mimeType: String(msg.mimeType || 'image/jpeg'),
            width,
            height,
            data: String(msg.data || ''),
            cursorX: Number(msg.cursorX || 0),
            cursorY: Number(msg.cursorY || 0),
            timestamp: now,
            locked,
            desktopName,
          };
          this.latestFrame = frame;
          this.status = {
            ...this.status,
            reconnecting: false,
            locked,
            desktopName,
            screenWidth,
            screenHeight,
            lastFrameAt: now,
            fps,
          };
          if (lockChanged || wasReconnecting) {
            this.emitStatus();
          }
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
        for (const [reqId, waiter] of this.pending.entries()) {
          clearTimeout(waiter.timer);
          waiter.reject(new Error('Real Windows 10 Pro agent reconnecting'));
          this.pending.delete(reqId);
        }
        this.status = createReconnectingAgentStatus(this.status);
        this.emitStatus();
        this.clearGraceTimer();
        this.disconnectGraceTimer = setTimeout(() => {
          this.disconnectGraceTimer = null;
          if (!this.agentSocket) {
            this.latestFrame = null;
            this.status = createInitialRealAgentStatus();
            this.emitStatus();
            this.setExecutionTarget('linux');
          }
        }, REAL_AGENT_RECONNECT_GRACE_MS);
        this.disconnectGraceTimer.unref?.();
      }
    });
  }

  async disconnectAgent(): Promise<{ disconnected: boolean; hadAgent: boolean; requireBatRestart: boolean }> {
    this.clearGraceTimer();
    const socket = this.agentSocket;
    const hadAgent = Boolean(socket || this.status.connected || this.status.reconnecting);
    let agentStoppedSelf = false;

    if (socket && socket.readyState === 1 /* WebSocket.OPEN */) {
      const requestId = `disconnect-${Date.now().toString(36)}`;
      await new Promise<void>((resolve) => {
        const timer = setTimeout(() => {
          this.pending.delete(requestId);
          resolve();
        }, 1200);
        this.pending.set(requestId, {
          resolve: () => {
            clearTimeout(timer);
            agentStoppedSelf = true;
            resolve();
          },
          reject: () => {
            clearTimeout(timer);
            resolve();
          },
          timer,
        });
        try {
          socket.send(
            JSON.stringify({
              type: 'cmd:exec',
              requestId,
              tool: 'agent_disconnect',
              args: {},
            }),
          );
        } catch {
          clearTimeout(timer);
          this.pending.delete(requestId);
          resolve();
        }
      });
    }

    // Always require re-running .bat / downloading agent before reconnecting after manual disconnect
    this.manualDisconnectBlocked = hadAgent;

    this.agentSocket = null;
    for (const [reqId, waiter] of this.pending.entries()) {
      clearTimeout(waiter.timer);
      waiter.reject(new Error('Real Windows PC disconnected by user'));
      this.pending.delete(reqId);
    }

    if (socket) {
      try {
        socket.close(1000, 'Disconnected by user');
      } catch {
        // ignore
      }
      setTimeout(() => {
        try {
          if (socket.readyState !== 3 /* WebSocket.CLOSED */) {
            socket.terminate();
          }
        } catch {
          // ignore
        }
      }, 250).unref?.();
    }

    this.frameTimes = [];
    this.latestFrame = null;
    this.status = createInitialRealAgentStatus();
    this.emitStatus();
    this.setExecutionTarget('linux');

    return {
      disconnected: true,
      hadAgent,
      requireBatRestart: true,
    };
  }

  async executeOnAgent(tool: string, args: Record<string, unknown>): Promise<unknown> {
    if (!this.agentSocket || !this.status.connected) {
      if (this.status.reconnecting) {
        throw new Error('Real Windows 10 Pro agent is reconnecting, please retry in a moment');
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
