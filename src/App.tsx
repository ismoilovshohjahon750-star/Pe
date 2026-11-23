import { useCallback, useEffect, useRef, useState } from 'react';
import { Cpu, Monitor, Plug, Settings } from 'lucide-react';
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
  const [browserSharing, setBrowserSharing] = useState(false);
  const [shareError, setShareError] = useState<string | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const shareStreamRef = useRef<MediaStream | null>(null);
  const shareTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastWsFrameAtRef = useRef<number>(0);
  const jarvisSyncTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const syncLinuxFrame = useCallback(() => {
    fetch('/api/linux/frame', { cache: 'no-store' })
      .then((r) => r.json())
      .then((data: { status?: LinuxDesktopStatus; frame?: RealAgentFrame | null }) => {
        if (data.status) setLinuxStatus(data.status);
        if (data.frame) {
          setLinuxFrame((prev) => pickNewerFrame(prev, data.frame ?? null));
        }
      })
      .catch(() => {});
  }, []);

  const syncRealAgentFrame = useCallback(() => {
    fetch('/api/real-win10/frame', { cache: 'no-store' })
      .then((r) => r.json())
      .then((data: { status?: RealAgentStatus; frame?: RealAgentFrame | null; target?: ExecutionTarget }) => {
        if (data.status) setRealAgentStatus(data.status);
        if (data.frame) {
          setRealAgentFrame((prev) => pickNewerFrame(prev, data.frame ?? null));
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
    let attempt = 0;

    fetch('/api/linux/status', { cache: 'no-store' })
      .then((r) => r.json())
      .then((data: { status?: LinuxDesktopStatus; frame?: RealAgentFrame | null }) => {
        if (!active) return;
        if (data.status) setLinuxStatus(data.status);
        if (data.frame) {
          setLinuxFrame((prev) => pickNewerFrame(prev, data.frame ?? null));
        }
      })
      .catch(() => {});

    fetch('/api/real-win10/status', { cache: 'no-store' })
      .then((r) => r.json())
      .then((data: { target?: ExecutionTarget; agent?: RealAgentStatus }) => {
        if (!active) return;
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
          attempt = 0;
          syncLinuxFrame();
        };

        socket.onmessage = (evt) => {
          if (!active) return;
          try {
            const msg = JSON.parse(String(evt.data)) as {
              type: string;
              status?: LinuxDesktopStatus | RealAgentStatus;
              frame?: RealAgentFrame;
              target?: ExecutionTarget;
            };
            if (msg.type === 'linux_status' && msg.status) {
              setLinuxStatus(msg.status as LinuxDesktopStatus);
            } else if (msg.type === 'linux_frame' && msg.frame) {
              lastWsFrameAtRef.current = Date.now();
              setLinuxFrame((prev) => pickNewerFrame(prev, msg.frame ?? null));
            } else if (msg.type === 'real_agent_status' && msg.status) {
              setRealAgentStatus(msg.status as RealAgentStatus);
            } else if (msg.type === 'real_agent_frame' && msg.frame) {
              lastWsFrameAtRef.current = Date.now();
              setRealAgentFrame((prev) => pickNewerFrame(prev, msg.frame ?? null));
            } else if (msg.type === 'execution_target' && msg.target) {
              setExecutionTarget(msg.target);
            }
          } catch {
            // ignore malformed messages
          }
        };

        socket.onclose = () => {
          if (!active) return;
          if (wsRef.current === socket) wsRef.current = null;
          const waitMs = Math.min(5000, 600 * Math.pow(1.5, attempt));
          attempt += 1;
          reconnectTimer = setTimeout(connect, waitMs);
        };

        socket.onerror = () => {
          socket.close();
        };
      } catch {
        wsRef.current = null;
      }
    };

    const handleWakeup = () => {
      if (!active) return;
      if (document.visibilityState === 'visible') {
        syncLinuxFrame();
        syncRealAgentFrame();
        if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
          if (reconnectTimer) clearTimeout(reconnectTimer);
          attempt = 0;
          connect();
        }
      }
    };

    connect();
    document.addEventListener('visibilitychange', handleWakeup);
    window.addEventListener('online', handleWakeup);

    const wsWatchdog = setInterval(() => {
      if (!active || document.visibilityState !== 'visible') return;
      if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
        syncLinuxFrame();
        syncRealAgentFrame();
        connect();
      } else if (Date.now() - lastWsFrameAtRef.current > 5500) {
        syncLinuxFrame();
      }
    }, 1500);

    return () => {
      active = false;
      clearInterval(wsWatchdog);
      document.removeEventListener('visibilitychange', handleWakeup);
      window.removeEventListener('online', handleWakeup);
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (shareTimerRef.current) clearInterval(shareTimerRef.current);
      if (jarvisSyncTimerRef.current) clearInterval(jarvisSyncTimerRef.current);
      shareStreamRef.current?.getTracks().forEach((t) => t.stop());
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

  const stopBrowserShare = useCallback(() => {
    if (shareTimerRef.current) {
      clearInterval(shareTimerRef.current);
      shareTimerRef.current = null;
    }
    if (shareStreamRef.current) {
      shareStreamRef.current.getTracks().forEach((t) => t.stop());
      shareStreamRef.current = null;
    }
    setBrowserSharing(false);
    sendWs({ type: 'browser_agent:stop' });
  }, [sendWs]);

  const startBrowserShare = useCallback(async () => {
    setShareError(null);
    if (!navigator.mediaDevices?.getDisplayMedia) {
      setShareError('Bu brauzer ekran ulashishni qo‘llab-quvvatlamaydi.');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: { ideal: 5, max: 10 } },
        audio: false,
      });
      stopBrowserShare();
      shareStreamRef.current = stream;

      const video = document.createElement('video');
      video.srcObject = stream;
      video.muted = true;
      await video.play();

      const srcW = video.videoWidth || 1280;
      const srcH = video.videoHeight || 720;
      const scale = Math.min(1, 1280 / srcW);
      const w = Math.max(320, Math.round(srcW * scale));
      const h = Math.max(180, Math.round(srcH * scale));

      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');

      sendWs({
        type: 'browser_agent:hello',
        hostname: 'Brauzer Ekran Ulashish',
        osVersion: navigator.platform || 'Windows',
        username: 'PC',
        screenWidth: w,
        screenHeight: h,
      });

      const sendFrame = () => {
        if (!ctx || video.readyState < 2) return;
        ctx.drawImage(video, 0, 0, w, h);
        const dataUrl = canvas.toDataURL('image/jpeg', 0.65);
        const base64 = dataUrl.split(',')[1] || '';
        if (base64) {
          sendWs({
            type: 'browser_agent:frame',
            mimeType: 'image/jpeg',
            width: w,
            height: h,
            data: base64,
          });
        }
      };

      sendFrame();
      shareTimerRef.current = setInterval(sendFrame, 350);
      setBrowserSharing(true);
      setPcModalOpen(false);

      const [track] = stream.getVideoTracks();
      if (track) {
        track.onended = () => {
          stopBrowserShare();
        };
      }
    } catch (err) {
      const msg = (err as Error).message || 'Ekran ulashish bekor qilindi';
      setShareError(msg);
    }
  }, [sendWs, stopBrowserShare]);

  const switchTarget = async (next: ExecutionTarget) => {
    setExecutionTarget(next);
    await fetch('/api/real-win10/target', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ target: next }),
    }).catch(() => {});
  };

  const showingRealPc = executionTarget === 'real-win10' && realAgentStatus.connected;

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
          <button type="button" onClick={() => setPcModalOpen(true)} className={LIQUID_PILL_BTN}>
            {realAgentStatus.connected ? (
              <span className="w-2 h-2 rounded-full bg-emerald-400 relative z-10" aria-hidden="true" />
            ) : (
              <Monitor className="w-3.5 h-3.5 text-white/95 relative z-10" strokeWidth={1.75} />
            )}
            <span className="relative z-10">Haqiqiy PC Ulash</span>
          </button>
          <button type="button" onClick={() => setMcpModalOpen(true)} className={LIQUID_PILL_BTN}>
            <Plug className="w-3.5 h-3.5 text-white/95 relative z-10" strokeWidth={1.75} />
            <span className="relative z-10">MCP Ulash</span>
          </button>
          <button type="button" onClick={() => setSettingsModalOpen(true)} className={LIQUID_PILL_BTN}>
            <Settings className="w-3.5 h-3.5 text-white/95 relative z-10" strokeWidth={1.75} />
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
            onClickAt={(x, y, button) => sendWs({ type: 'user:real_click', x, y, button })}
            onScrollAt={(x, y, deltaY) => sendWs({ type: 'user:real_scroll', x, y, deltaY })}
            onTypeText={(text, enter) => sendWs({ type: 'user:real_type', text, enter })}
            onPressKey={(key) => sendWs({ type: 'user:real_key', key })}
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
                .then((r) => r.json())
                .then((data: { status?: LinuxDesktopStatus }) => {
                  if (data.status) setLinuxStatus(data.status);
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
        browserSharing={browserSharing}
        shareError={shareError}
        onStartBrowserShare={() => void startBrowserShare()}
        onStopBrowserShare={stopBrowserShare}
        onSwitchTarget={(t) => void switchTarget(t)}
        onClose={() => setPcModalOpen(false)}
      />

      <McpConnectModal
        open={mcpModalOpen}
        onClose={() => setMcpModalOpen(false)}
      />

      <SettingsModal
        open={settingsModalOpen}
        onClose={() => setSettingsModalOpen(false)}
      />
    </div>
  );
}
