import type { WebSocket } from 'ws';
import {
  createInitialRealAgentStatus,
  detectDeviceKind,
  resolveTargetDeviceIds,
  type ConnectedDeviceSummary,
  type DeviceKind,
  type ExecutionTarget,
  type RealAgentFrame,
  type RealAgentStatus,
} from '../desktop/bridge.ts';

interface ConnectedDeviceRecord {
  id: string;
  ws: WebSocket;
  kind: DeviceKind;
  isBrowserShare: boolean;
  hostname: string;
  osVersion: string;
  username: string;
  screenWidth: number;
  screenHeight: number;
  connectedAt: string;
  lastFrameAt: number | null;
  fps: number;
  mode?: string;
  frameTimes: number[];
  latestFrame: RealAgentFrame | null;
}

interface PendingCommand {
  deviceId: string;
  resolve: (data: unknown) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

type StatusListener = (status: RealAgentStatus) => void;
type FrameListener = (frame: RealAgentFrame) => void;
type TargetListener = (target: ExecutionTarget) => void;
type DevicesListener = (devices: ConnectedDeviceSummary[], activeDeviceId: string | null) => void;
type DeviceFrameListener = (deviceId: string, frame: RealAgentFrame) => void;

class RealWin10Bridge {
  private devices = new Map<string, ConnectedDeviceRecord>();
  private socketToDeviceId = new Map<WebSocket, string>();
  private activeDeviceId: string | null = null;
  private target: ExecutionTarget = 'linux';
  private seq = 0;

  private pending = new Map<string, PendingCommand>();

  private statusListeners = new Set<StatusListener>();
  private frameListeners = new Set<FrameListener>();
  private targetListeners = new Set<TargetListener>();
  private devicesListeners = new Set<DevicesListener>();
  private deviceFrameListeners = new Set<DeviceFrameListener>();

  private buildSummary(rec: ConnectedDeviceRecord): ConnectedDeviceSummary {
    return {
      id: rec.id,
      kind: rec.kind,
      hostname: rec.hostname,
      osVersion: rec.osVersion,
      username: rec.username,
      screenWidth: rec.screenWidth,
      screenHeight: rec.screenHeight,
      fps: rec.fps,
      connectedAt: rec.connectedAt,
      lastFrameAt: rec.lastFrameAt,
      ...(rec.mode ? { mode: rec.mode } : {}),
      active: rec.id === this.activeDeviceId,
    };
  }

  private getActiveRecord(): ConnectedDeviceRecord | null {
    if (this.activeDeviceId) {
      const found = this.devices.get(this.activeDeviceId);
      if (found) return found;
    }
    const first = this.devices.values().next().value as ConnectedDeviceRecord | undefined;
    if (first) {
      this.activeDeviceId = first.id;
      return first;
    }
    return null;
  }

  getDevices(): ConnectedDeviceSummary[] {
    return Array.from(this.devices.values()).map((rec) => this.buildSummary(rec));
  }

  getActiveDeviceId(): string | null {
    return this.getActiveRecord()?.id ?? null;
  }

  setActiveDevice(id: string): ConnectedDeviceSummary | null {
    const rec = this.devices.get(id);
    if (!rec) return null;
    this.activeDeviceId = id;
    this.emitStatus();
    if (rec.latestFrame) {
      for (const fn of this.frameListeners) fn(rec.latestFrame);
    }
    return this.buildSummary(rec);
  }

  getStatus(deviceId?: string | null): RealAgentStatus {
    const rec = deviceId ? this.devices.get(deviceId) ?? null : this.getActiveRecord();
    if (!rec) return createInitialRealAgentStatus();
    return {
      connected: true,
      hostname: rec.hostname,
      osVersion: rec.osVersion,
      username: rec.username,
      screenWidth: rec.screenWidth,
      screenHeight: rec.screenHeight,
      connectedAt: rec.connectedAt,
      lastFrameAt: rec.lastFrameAt,
      fps: rec.fps,
    };
  }

  getLatestFrame(deviceId?: string | null): RealAgentFrame | null {
    const rec = deviceId ? this.devices.get(deviceId) ?? null : this.getActiveRecord();
    return rec?.latestFrame ?? null;
  }

  getDeviceFrame(deviceId: string): RealAgentFrame | null {
    return this.devices.get(deviceId)?.latestFrame ?? null;
  }

  getAllFrames(): Record<string, RealAgentFrame> {
    const out: Record<string, RealAgentFrame> = {};
    for (const [id, rec] of this.devices.entries()) {
      if (rec.latestFrame) out[id] = rec.latestFrame;
    }
    return out;
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

  onDevices(fn: DevicesListener): () => void {
    this.devicesListeners.add(fn);
    return () => this.devicesListeners.delete(fn);
  }

  onDeviceFrame(fn: DeviceFrameListener): () => void {
    this.deviceFrameListeners.add(fn);
    return () => this.deviceFrameListeners.delete(fn);
  }

  private emitStatus() {
    const activeStatus = this.getStatus();
    const list = this.getDevices();
    const activeId = this.getActiveDeviceId();
    for (const fn of this.statusListeners) fn(activeStatus);
    for (const fn of this.devicesListeners) fn(list, activeId);
  }

  private createDeviceId(kind: DeviceKind): string {
    this.seq += 1;
    return `${kind}-${this.seq}-${Date.now().toString(36).slice(-4)}`;
  }

  private removeDeviceBySocket(ws: WebSocket, reason: string): void {
    const id = this.socketToDeviceId.get(ws);
    if (!id) return;
    this.socketToDeviceId.delete(ws);
    const removed = this.devices.get(id);
    if (!removed || removed.ws !== ws) return;
    this.devices.delete(id);

    for (const [reqId, waiter] of this.pending.entries()) {
      if (waiter.deviceId === id) {
        clearTimeout(waiter.timer);
        waiter.reject(new Error(reason));
        this.pending.delete(reqId);
      }
    }

    if (this.activeDeviceId === id) {
      const next = this.devices.values().next().value as ConnectedDeviceRecord | undefined;
      this.activeDeviceId = next?.id ?? null;
    }

    this.emitStatus();
    const activeRec = this.getActiveRecord();
    if (activeRec?.latestFrame) {
      for (const fn of this.frameListeners) fn(activeRec.latestFrame);
    }

    if (this.devices.size === 0 && this.target === 'real-win10') {
      this.setExecutionTarget('linux');
    }
  }

  startBrowserShare(ws: WebSocket, info: Record<string, unknown>): void {
    // Replace only previous browser share from the same socket or existing browser share
    for (const existing of Array.from(this.devices.values())) {
      if (existing.isBrowserShare) {
        this.removeDeviceBySocket(existing.ws, 'Browser share restarted');
      }
    }

    const host = String(info.hostname || 'Browser Screen Share');
    const osVer = String(info.osVersion || 'Browser Display');
    const kind = detectDeviceKind(osVer, host, true);
    const id = this.createDeviceId(kind);
    const rec: ConnectedDeviceRecord = {
      id,
      ws,
      kind,
      isBrowserShare: true,
      hostname: host,
      osVersion: osVer,
      username: String(info.username || 'User'),
      screenWidth: Number(info.screenWidth || 1280),
      screenHeight: Number(info.screenHeight || 720),
      connectedAt: new Date().toISOString(),
      lastFrameAt: null,
      fps: 0,
      frameTimes: [],
      latestFrame: null,
    };

    this.devices.set(id, rec);
    this.socketToDeviceId.set(ws, id);
    this.activeDeviceId = id;
    this.emitStatus();
    this.setExecutionTarget('real-win10');
  }

  pushBrowserFrame(ws: WebSocket, msg: Record<string, unknown>): void {
    const id = this.socketToDeviceId.get(ws);
    if (!id) return;
    const rec = this.devices.get(id);
    if (!rec || !rec.isBrowserShare) return;

    const now = Date.now();
    rec.frameTimes = [...rec.frameTimes.filter((t) => now - t < 2000), now];
    rec.fps = Math.round((rec.frameTimes.length / 2) * 10) / 10;
    const width = Number(msg.width || rec.screenWidth || 1280);
    const height = Number(msg.height || rec.screenHeight || 720);
    const frame: RealAgentFrame = {
      mimeType: String(msg.mimeType || 'image/jpeg'),
      width,
      height,
      data: String(msg.data || ''),
      cursorX: 0,
      cursorY: 0,
      timestamp: now,
    };
    rec.latestFrame = frame;
    rec.screenWidth = width;
    rec.screenHeight = height;
    rec.lastFrameAt = now;

    for (const fn of this.deviceFrameListeners) fn(rec.id, frame);
    if (this.activeDeviceId === rec.id) {
      for (const fn of this.frameListeners) fn(frame);
    }
  }

  stopBrowserShare(ws: WebSocket): void {
    const id = this.socketToDeviceId.get(ws);
    if (!id) return;
    const rec = this.devices.get(id);
    if (!rec || !rec.isBrowserShare) return;
    this.removeDeviceBySocket(ws, 'Browser screen share stopped');
  }

  attachAgent(ws: WebSocket): void {
    const id = this.createDeviceId('pc');
    const rec: ConnectedDeviceRecord = {
      id,
      ws,
      kind: 'pc',
      isBrowserShare: false,
      hostname: 'Connecting Device...',
      osVersion: 'Agent',
      username: 'User',
      screenWidth: 1920,
      screenHeight: 1080,
      connectedAt: new Date().toISOString(),
      lastFrameAt: null,
      fps: 0,
      frameTimes: [],
      latestFrame: null,
    };

    this.devices.set(id, rec);
    this.socketToDeviceId.set(ws, id);
    if (!this.activeDeviceId) {
      this.activeDeviceId = id;
    } else {
      this.activeDeviceId = id;
    }
    this.emitStatus();
    this.setExecutionTarget('real-win10');

    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(String(raw)) as Record<string, unknown>;
        if (msg.type === 'agent:hello') {
          rec.hostname = String(msg.hostname || 'WIN10-PRO');
          rec.osVersion = String(msg.osVersion || 'Microsoft Windows 10 Pro');
          rec.username = String(msg.username || 'User');
          rec.screenWidth = Number(msg.screenWidth || 1920);
          rec.screenHeight = Number(msg.screenHeight || 1080);
          rec.kind = detectDeviceKind(rec.osVersion, rec.hostname, false);
          if (typeof msg.mode === 'string') {
            rec.mode = msg.mode;
          }

          // Deduplicate stale dead socket with same hostname + kind if already disconnected/stale
          for (const [otherId, other] of this.devices.entries()) {
            if (
              otherId !== rec.id &&
              !other.isBrowserShare &&
              other.kind === rec.kind &&
              other.hostname === rec.hostname &&
              other.ws.readyState !== 1
            ) {
              this.removeDeviceBySocket(other.ws, 'Replaced by reconnecting device');
            }
          }

          this.emitStatus();
        } else if (msg.type === 'agent:frame') {
          const now = Date.now();
          rec.frameTimes = [...rec.frameTimes.filter((t) => now - t < 2000), now];
          rec.fps = Math.round((rec.frameTimes.length / 2) * 10) / 10;
          const frame: RealAgentFrame = {
            mimeType: String(msg.mimeType || 'image/jpeg'),
            width: Number(msg.width || rec.screenWidth),
            height: Number(msg.height || rec.screenHeight),
            data: String(msg.data || ''),
            cursorX: Number(msg.cursorX || 0),
            cursorY: Number(msg.cursorY || 0),
            timestamp: now,
          };
          rec.latestFrame = frame;
          rec.screenWidth = frame.width;
          rec.screenHeight = frame.height;
          rec.lastFrameAt = now;
          if (typeof msg.mode === 'string') {
            rec.mode = msg.mode;
          }
          for (const fn of this.deviceFrameListeners) fn(rec.id, frame);
          if (this.activeDeviceId === rec.id) {
            for (const fn of this.frameListeners) fn(frame);
          }
        } else if (msg.type === 'agent:result') {
          const requestId = String(msg.requestId || '');
          const waiter = this.pending.get(requestId);
          if (waiter) {
            clearTimeout(waiter.timer);
            this.pending.delete(requestId);
            if (msg.ok) {
              waiter.resolve(msg.data);
            } else {
              waiter.reject(new Error(String(msg.error || 'Real device agent command failed')));
            }
          }
        }
      } catch {
        // ignore malformed frames
      }
    });

    ws.on('close', () => {
      this.removeDeviceBySocket(ws, `${rec.hostname} (${rec.kind}) disconnected`);
    });
  }

  resolveDeviceIds(selector?: string | null): string[] {
    return resolveTargetDeviceIds(this.getDevices(), selector, this.getActiveDeviceId());
  }

  private async executeSingleRecord(
    rec: ConnectedDeviceRecord,
    tool: string,
    args: Record<string, unknown>,
  ): Promise<unknown> {
    if (rec.isBrowserShare) {
      throw new Error(
        `Browser screen share (${rec.hostname}) supports viewing/desktop_screenshot only. Start real-pc-agent.py or android-termux-agent.py for ${tool}.`,
      );
    }
    if (rec.ws.readyState !== 1) {
      throw new Error(`Device ${rec.hostname} (${rec.id}) is disconnected`);
    }

    const requestId = `cmd-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        reject(new Error(`Timeout waiting for ${rec.hostname} on ${tool}`));
      }, 20000);
      this.pending.set(requestId, { deviceId: rec.id, resolve, reject, timer });
      rec.ws.send(
        JSON.stringify({
          type: 'cmd:exec',
          requestId,
          tool,
          args,
        }),
      );
    });
  }

  async executeOnAgent(
    tool: string,
    args: Record<string, unknown>,
    deviceSelector?: string | null,
  ): Promise<unknown> {
    if (this.devices.size === 0) {
      throw new Error('No PC or Android device agent is connected');
    }

    const targets = this.resolveDeviceIds(deviceSelector);
    if (targets.length === 0) {
      const available = this.getDevices()
        .map((d) => `${d.hostname} (${d.kind}, id=${d.id})`)
        .join(', ');
      throw new Error(`Device "${deviceSelector}" topilmadi. Ulangan qurilmalar: ${available}`);
    }

    if (targets.length === 1) {
      const rec = this.devices.get(targets[0]);
      if (!rec) throw new Error('Target device not found');
      return this.executeSingleRecord(rec, tool, args);
    }

    return this.executeOnDevices(tool, args, deviceSelector || 'all');
  }

  async executeOnDevices(
    tool: string,
    args: Record<string, unknown>,
    selector = 'all',
  ): Promise<Array<{ deviceId: string; hostname: string; kind: DeviceKind; ok: boolean; data?: unknown; error?: string }>> {
    const ids = this.resolveDeviceIds(selector);
    if (ids.length === 0) {
      throw new Error('No matching devices connected');
    }

    const results = await Promise.all(
      ids.map(async (id) => {
        const rec = this.devices.get(id);
        if (!rec) {
          return {
            deviceId: id,
            hostname: id,
            kind: 'pc' as DeviceKind,
            ok: false,
            error: 'Device disconnected',
          };
        }
        try {
          const data = await this.executeSingleRecord(rec, tool, args);
          return {
            deviceId: rec.id,
            hostname: rec.hostname,
            kind: rec.kind,
            ok: true,
            data,
          };
        } catch (err) {
          return {
            deviceId: rec.id,
            hostname: rec.hostname,
            kind: rec.kind,
            ok: false,
            error: (err as Error).message,
          };
        }
      }),
    );
    return results;
  }
}

export const realWin10Bridge = new RealWin10Bridge();
