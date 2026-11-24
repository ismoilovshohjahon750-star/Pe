import { useCallback, useEffect, useRef, useState } from 'react';
import { Cpu, Plug, Settings } from 'lucide-react';
import { LIQUID_PILL_BTN } from './components/liquidGlass.ts';
import { JarvisModal } from './components/JarvisModal.tsx';
import { McpConnectModal } from './components/McpConnectModal.tsx';
import { PcConnectModal } from './components/PcConnectModal.tsx';
import { SettingsModal } from './components/SettingsModal.tsx';
import { RealLinuxView } from './components/RealLinuxView.tsx';
import { RealWin10View } from './components/RealWin10View.tsx';
import {
  createInitialLinuxStatus,
  createInitialRealAgentStatus,
  pickNewerFrame,
  type ExecutionTarget,
  type LinuxDesktopStatus,
  type RealAgentFrame,
  type RealAgentStatus,
} from './desktop/bridge.ts';

export default function App() {
  const [linuxStatus, setLinuxStatus] = useState<LinuxDesktopStatus>(() =>
    createInitialLinuxStatus(),
  );
  const [linuxFrame, setLinuxFrame] = useState<RealAgentFrame | null>(null);
  const [realAgentStatus, setRealAgentStatus] = useState<RealAgentStatus>(() =>
    createInitialRealAgentStatus(),
  );
  const [realAgentFrame, setRealAgentFrame] = useState<RealAgentFrame | null>(null);
  const [executionTarget, setExecutionTarget] = useState<ExecutionTarget>('linux');
  const [mcpModalOpen, setMcpModalOpen] = useState(false);
  const [pcModalOpen, setPcModalOpen] = useState(false);
  const [settingsModalOpen, setSettingsModalOpen] = useState(false);
  const [jarvisOpen, setJarvisOpen] = useState(false);

  const wsRef = useRef<WebSocket | null>(null);
  const lastWsFrameAtRef = useRef<number>(0);
  const executionTargetRef = useRef<ExecutionTarget>('linux');
  const jarvisSyncTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  executionTargetRef.current = executionTarget;

  const syncLinuxFrame = useCallback(() => {
    fetch('/api/linux/frame', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { status?: LinuxDesktopStatus; frame?: RealAgentFrame | null } | null) => {
        if (!data) return;
        if (data.status) setLinuxStatus(data.status);
        if (data.frame) {
          setLinuxFrame((prev) => pickNewerFrame(prev, data.frame ?? null));
        }
      })
      .catch(() => {});
  }, []);

  const syncRealAgentFrame = useCallback(() => {
    fetch('/api/real-win10/frame', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: {
        status?: RealAgentStatus;
        frame?: RealAgentFrame | null;
        target?: ExecutionTarget;
      } | null) => {
        if (!data) return;
        if (data.status) setRealAgentStatus(data.status);
        if (data.frame) {
          setRealAgentFrame((prev) => pickNewerFrame(prev, data.frame ?? null));
          lastWsFrameAtRef.current = Date.now();
        }
        if (data.target === 'real-win10' && data.status?.connected) {
          setExecutionTarget('real-win10');
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    let active = true;
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined;

    fetch('/api/linux/status', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { status?: LinuxDesktopStatus; frame?: RealAgentFrame | null } | null) => {
        if (!active || !data) return;
        if (data.status) setLinuxStatus(data.status);
        if (data.frame) {
          setLinuxFrame((prev) => pickNewerFrame(prev, data.frame ?? null));
        }
      })
      .catch(() => {});

    fetch('/api/real-win10/status', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { target?: ExecutionTarget; agent?: RealAgentStatus } | null) => {
        if (!active || !data) return;
        if (data.agent) setRealAgentStatus(data.agent);
        if (data.target === 'real-win10' && data.agent?.connected) {
          setExecutionTarget('real-win10');
        }
      })
      .catch(() => {});

    const connect = () => {
      if (!active || typeof WebSocket === 'undefined') return;
      const existing = wsRef.current;
      if (existing && (existing.readyState === WebSocket.OPEN || existing.readyState === WebSocket.CONNECTING)) {
        return;
      }
      try {
        const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const socket = new WebSocket(`${proto}//${window.location.host}/ws`);
        wsRef.current = socket;

        socket.onopen = () => {
          if (!active) return;
          syncLinuxFrame();
          syncRealAgentFrame();
        };

        socket.onmessage = (event) => {
          if (!active) return;
          try {
            const msg = JSON.parse(event.data) as Record<string, unknown>;
            if (msg.type === 'linux_frame' || msg.type === 'linux:frame') {
              if (msg.frame) {
                setLinuxFrame((prev) => pickNewerFrame(prev, msg.frame as RealAgentFrame));
                lastWsFrameAtRef.current = Date.now();
              }
            } else if (msg.type === 'real_agent_frame' || msg.type === 'real:frame') {
              if (msg.frame) {
                setRealAgentFrame((prev) => pickNewerFrame(prev, msg.frame as RealAgentFrame));
                lastWsFrameAtRef.current = Date.now();
              }
            } else if (msg.type === 'real_agent_status' || msg.type === 'real:status') {
              if (msg.status) {
                setRealAgentStatus(msg.status as RealAgentStatus);
              }
            } else if (msg.type === 'linux_status' || msg.type === 'linux:status') {
              if (msg.status) {
                setLinuxStatus(msg.status as LinuxDesktopStatus);
              }
            } else if (msg.type === 'execution_target' && typeof msg.target === 'string') {
              setExecutionTarget(msg.target as ExecutionTarget);
            }
          } catch {}
        };

        socket.onclose = () => {
          if (!active) return;
          wsRef.current = null;
          reconnectTimer = setTimeout(connect, 3000);
        };

        socket.onerror = () => {
          socket.close();
        };
      } catch {
        reconnectTimer = setTimeout(connect, 3000);
      }
    };

    connect();

    const wsWatchdog = setInterval(() => {
      if (!active || document.visibilityState !== 'visible') return;
      if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
        syncLinuxFrame();
        syncRealAgentFrame();
        connect();
      } else if (Date.now() - lastWsFrameAtRef.current > 3500) {
        syncLinuxFrame();
        if (executionTargetRef.current === 'real-win10') {
          syncRealAgentFrame();
        }
      }
    }, 1500);

    return () => {
      active = false;
      clearInterval(wsWatchdog);
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (jarvisSyncTimerRef.current) clearInterval(jarvisSyncTimerRef.current);
      wsRef.current?.close();
    };
  }, [syncLinuxFrame, syncRealAgentFrame]);

  const sendWs = useCallback((payload: Record<string, unknown>) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(payload));
      return;
    }
    const actionType = String(payload.type || '');
    if (actionType.startsWith('user:linux_') || actionType.startsWith('user:real_')) {
      void fetch('/api/desktop/input', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }).catch(() => {});
    }
  }, []);

  useEffect(() => {
    if (!pcModalOpen && !mcpModalOpen && !settingsModalOpen && !jarvisOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      if (pcModalOpen) setPcModalOpen(false);
      else if (mcpModalOpen) setMcpModalOpen(false);
      else if (settingsModalOpen) setSettingsModalOpen(false);
      else if (jarvisOpen) setJarvisOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [pcModalOpen, mcpModalOpen, settingsModalOpen, jarvisOpen]);

  const switchTarget = async (next: ExecutionTarget) => {
    setExecutionTarget(next);
    await fetch('/api/real-win10/target', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ target: next }),
    }).catch(() => {});
  };

  const unlockRealPc = async (payload: { pin?: string; wake?: boolean; sas?: boolean }) => {
    const res = await fetch('/api/desktop/input', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'user:real_unlock',
        ...payload,
      }),
    });
    const data = (await res.json().catch(() => ({}))) as {
      ok?: boolean;
      result?: unknown;
      error?: string;
    };
    if (!res.ok || !data.ok) {
      return {
        ok: false,
        error: data.error || 'Windows qulfini ochish buyrug‘i bajarilmadi.',
      };
    }
    syncRealAgentFrame();
    return {
      ok: true,
      message:
        typeof data.result === 'string' && data.result
          ? data.result
          : 'PIN/parol yuborildi.',
    };
  };

  const showingRealPc = executionTarget === 'real-win10';

  return (
    <div className="h-screen h-[100dvh] w-screen w-full flex flex-col bg-[#03060C] text-slate-100 overflow-hidden">
      <header
        onWheel={(e) => {
          if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
            e.currentTarget.scrollLeft += e.deltaY;
          }
        }}
        className="h-12 w-full bg-[#070B14]/95 supports-[backdrop-filter]:bg-[#070B14]/90 supports-[backdrop-filter]:backdrop-blur-md border-b border-white/10 overflow-x-auto overflow-y-hidden no-scrollbar touch-pan-x touch-scroll-x shrink-0"
      >
        <div className="h-full min-w-full w-max px-2.5 sm:px-4 flex items-center justify-start sm:justify-end gap-1.5 sm:gap-2.5">
          <button
            type="button"
            onClick={() => setJarvisOpen((prev) => !prev)}
            className={LIQUID_PILL_BTN}
          >
            <Cpu className="w-3.5 h-3.5 text-white/95 relative z-10" strokeWidth={1.75} />
            <span className="relative z-10">J.A.R.V.I.S.</span>
          </button>

          <button type="button" onClick={() => setMcpModalOpen(true)} className={LIQUID_PILL_BTN}>
            <Plug className="w-3.5 h-3.5 text-white/95 relative z-10" strokeWidth={1.75} />
            <span className="relative z-10">MCP Ulash</span>
          </button>
          <button type="button" onClick={() => setSettingsModalOpen(true)} className={LIQUID_PILL_BTN}>
            {realAgentStatus.connected ? (
              <span className="w-2 h-2 rounded-full bg-emerald-400 relative z-10" aria-hidden="true" />
            ) : (
              <Settings className="w-3.5 h-3.5 text-white/95 relative z-10" strokeWidth={1.75} />
            )}
            <span className="relative z-10">Sozlamalar</span>
          </button>
        </div>
      </header>

      <main className="flex-1 min-h-0 flex flex-col overflow-hidden">
        {showingRealPc ? (
          <RealWin10View
            status={realAgentStatus}
            frame={realAgentFrame}
            allowRotate={!jarvisOpen}
            onClickAt={(x, y, button) =>
              sendWs({ type: 'user:real_click', x, y, button })
            }
            onScrollAt={(x, y, deltaY) =>
              sendWs({ type: 'user:real_scroll', x, y, deltaY })
            }
            onTypeText={(text, enter) =>
              sendWs({ type: 'user:real_type', text, enter })
            }
            onPressKey={(key) =>
              sendWs({ type: 'user:real_key', key })
            }
            onUnlockPc={(payload) => unlockRealPc(payload)}
            onOpenPcModal={() => setPcModalOpen(true)}
          />
        ) : (
          <RealLinuxView
            status={linuxStatus}
            frame={linuxFrame}
            allowRotate={!jarvisOpen}
            onClickAt={(x, y, button) => sendWs({ type: 'user:linux_click', x, y, button })}
            onScrollAt={(x, y, deltaY) => sendWs({ type: 'user:linux_scroll', x, y, deltaY })}
            onTypeText={(text, enter) => sendWs({ type: 'user:linux_type', text, enter })}
            onPressKey={(key) => sendWs({ type: 'user:linux_key', key })}
            onRetry={() => {
              setLinuxStatus((prev) => ({ ...prev, error: null }));
              void fetch('/api/linux/restart', { method: 'POST' })
                .then((r) => (r.ok ? r.json() : null))
                .then((data: { status?: LinuxDesktopStatus } | null) => {
                  if (data?.status) setLinuxStatus(data.status);
                })
                .catch(() => {});
            }}
          />
        )}

        <JarvisModal
          open={jarvisOpen}
          onClose={() => setJarvisOpen(false)}
          onToolActivity={(ev) => {
            if (showingRealPc) return;
            if (ev.type === 'tool_start') {
              if (!jarvisSyncTimerRef.current) {
                jarvisSyncTimerRef.current = setInterval(() => {
                  if (Date.now() - lastWsFrameAtRef.current > 550) {
                    syncLinuxFrame();
                  }
                }, 650);
              }
            } else if (ev.type === 'tool_done') {
              if (Date.now() - lastWsFrameAtRef.current > 150) {
                syncLinuxFrame();
              }
            } else if (ev.type === 'done') {
              if (jarvisSyncTimerRef.current) {
                clearInterval(jarvisSyncTimerRef.current);
                jarvisSyncTimerRef.current = null;
              }
              syncLinuxFrame();
            }
          }}
        />
      </main>

      <PcConnectModal
        open={pcModalOpen}
        status={realAgentStatus}
        executionTarget={executionTarget}
        onSwitchTarget={(t) => void switchTarget(t)}
        onClose={() => setPcModalOpen(false)}
      />

      <McpConnectModal
        open={mcpModalOpen}
        onClose={() => setMcpModalOpen(false)}
      />

      <SettingsModal
        open={settingsModalOpen}
        executionTarget={executionTarget}
        realAgentStatus={realAgentStatus}
        onSwitchTarget={(t) => void switchTarget(t)}
        onOpenPcModal={() => {
          setSettingsModalOpen(false);
          setPcModalOpen(true);
        }}
        onClose={() => setSettingsModalOpen(false)}
      />
    </div>
  );
}
