export type ExecutionTarget = 'linux' | 'sandbox' | 'real-win10';

export interface RealAgentStatus {
  connected: boolean;
  reconnecting?: boolean;
  locked?: boolean;
  desktopName?: string | null;
  hostname: string | null;
  osVersion: string | null;
  username: string | null;
  screenWidth: number;
  screenHeight: number;
  connectedAt: string | null;
  lastFrameAt: number | null;
  fps: number;
}

export interface RealAgentFrame {
  mimeType: string;
  width: number;
  height: number;
  data: string;
  cursorX: number;
  cursorY: number;
  timestamp: number;
  locked?: boolean;
  desktopName?: string | null;
}

export interface LinuxDesktopStatus {
  available: boolean;
  running: boolean;
  display: string;
  osName: string;
  screenWidth: number;
  screenHeight: number;
  fps: number;
  error: string | null;
}

export const REAL_AGENT_RECONNECT_GRACE_MS = 12000;

export function createInitialRealAgentStatus(): RealAgentStatus {
  return {
    connected: false,
    reconnecting: false,
    locked: false,
    desktopName: null,
    hostname: null,
    osVersion: null,
    username: null,
    screenWidth: 1920,
    screenHeight: 1080,
    connectedAt: null,
    lastFrameAt: null,
    fps: 0,
  };
}

export function createReconnectingAgentStatus(prev: RealAgentStatus): RealAgentStatus {
  return {
    ...prev,
    connected: prev.connected,
    reconnecting: true,
    fps: 0,
  };
}

export function isWinLockShortcut(key: string, metaKey: boolean, ctrlKey: boolean, altKey: boolean): boolean {
  const lower = key.toLowerCase();
  if (lower !== 'l') return false;
  return (metaKey && !ctrlKey && !altKey) || (ctrlKey && altKey && !metaKey);
}

export function createInitialLinuxStatus(): LinuxDesktopStatus {
  return {
    available: false,
    running: false,
    display: ':99',
    osName: 'Debian GNU/Linux 12 (X11 Openbox)',
    screenWidth: 1280,
    screenHeight: 720,
    fps: 0,
    error: null,
  };
}

export function resolveMcpExecutionMode(
  requestedTarget: ExecutionTarget,
  agentConnected: boolean,
  linuxRunning: boolean,
  toolName: string,
): ExecutionTarget {
  const realCapableTools = new Set([
    'desktop_screenshot',
    'desktop_move',
    'desktop_click',
    'desktop_scroll',
    'desktop_type',
    'desktop_key',
    'open_app',
    'browser_navigate',
    'run_powershell',
    'run_bash',
    'file_list',
    'file_read',
    'file_write',
    'file_delete',
    'wait',
  ]);

  const linuxCapableTools = new Set([
    ...realCapableTools,
    'desktop_drag',
    'desktop_scroll',
    'open_app',
    'window_list',
    'window_control',
    'run_bash',
    'browser_navigate',
    'wait',
  ]);

  if (requestedTarget === 'real-win10' && agentConnected && realCapableTools.has(toolName)) {
    return 'real-win10';
  }
  if (requestedTarget === 'linux' && linuxRunning && linuxCapableTools.has(toolName)) {
    return 'linux';
  }
  return 'sandbox';
}

export function mapClientPointToScreen(
  clientX: number,
  clientY: number,
  rect: { left: number; top: number; right: number; width: number; height: number },
  screenWidth: number,
  screenHeight: number,
  rotated: boolean,
): { x: number; y: number } {
  if (rect.width <= 0 || rect.height <= 0) {
    return { x: 0, y: 0 };
  }
  const u = rotated
    ? (clientY - rect.top) / rect.height
    : (clientX - rect.left) / rect.width;
  const v = rotated
    ? (rect.right - clientX) / rect.width
    : (clientY - rect.top) / rect.height;

  const x = Math.max(0, Math.min(screenWidth - 1, Math.round(u * screenWidth)));
  const y = Math.max(0, Math.min(screenHeight - 1, Math.round(v * screenHeight)));
  return { x, y };
}

export function buildNonInteractiveAptInstallCmd(packages: string[]): string {
  const clean = Array.from(
    new Set(
      packages
        .map((p) => p.trim())
        .filter((p) => /^[a-z0-9][a-z0-9+.-]+$/i.test(p)),
    ),
  );
  if (clean.length === 0) {
    return 'true';
  }
  const dpkgOpts =
    '-o Dpkg::Options::="--force-confdef" -o Dpkg::Options::="--force-confold"';
  return [
    'export DEBIAN_FRONTEND=noninteractive DEBCONF_NONINTERACTIVE_SEEN=true NEEDRESTART_MODE=a UCF_FORCE_CONFFOLD=1',
    '(dpkg --configure -a --force-confdef --force-confold </dev/null || true)',
    'apt-get update -qq </dev/null',
    `apt-get install -y --no-install-recommends --fix-broken ${dpkgOpts} ${clean.join(' ')} </dev/null`,
  ].join(' && ');
}

export function shouldBroadcastFrame(
  prevBytes: Uint8Array | null,
  nextBytes: Uint8Array,
  elapsedSinceLastBroadcastMs: number,
  keepaliveMs = 4000,
): boolean {
  if (!prevBytes || elapsedSinceLastBroadcastMs >= keepaliveMs) {
    return true;
  }
  if (prevBytes.length !== nextBytes.length) {
    return true;
  }
  for (let i = 0; i < nextBytes.length; i += 1) {
    if (prevBytes[i] !== nextBytes[i]) {
      return true;
    }
  }
  return false;
}

export function shouldSendToWsClient(
  readyState: number,
  bufferedAmount: number,
  maxBufferedBytes = 192 * 1024,
): boolean {
  return readyState === 1 && bufferedAmount < maxBufferedBytes;
}

export function pickNewerFrame(
  current: RealAgentFrame | null,
  candidate: RealAgentFrame | null,
): RealAgentFrame | null {
  if (!candidate) return current;
  if (!current) return candidate;
  return candidate.timestamp >= current.timestamp ? candidate : current;
}

