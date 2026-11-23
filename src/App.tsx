import { useCallback, useEffect, useRef, useState } from 'react';
import { Cpu, Monitor, Plug, Settings, Smartphone } from 'lucide-react';
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
  type ConnectedDeviceSummary,
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
  const shareWorkerRef = useRef<Worker | null>(null);
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

  const [connectedDevices, setConnectedDevices] = useState<ConnectedDeviceSummary[]>([]);
  const [deviceFrames, setDeviceFrames] = useState<Record<string, RealAgentFrame>>({});
  const [splitView, setSplitView] = useState(false);
  const [activeDeviceId, setActiveDeviceId] = useState<string | null>(null);

  const syncRealDevices = useCallback(() => {
    fetch('/api/real-win10/devices', { cache: 'no-store' })
      .then((r) => r.json())
      .then((data: { devices?: ConnectedDeviceSummary[]; activeDeviceId?: string | null; frames?: Record<string, RealAgentFrame> }) => {
        if (data.devices) {
          setConnectedDevices(data.devices);
          if (data.activeDeviceId !== undefined) setActiveDeviceId(data.activeDeviceId);
          if (data.frames) setDeviceFrames(data.frames);
        }
      })
      .catch(() => {});
  }, []);

  const syncRealAgentFrame = useCallback(() => {
    fetch('/api/real-win10/frame', { cache: 'no-store' })
      .then((r) => r.json())
      .then((data: { status?: RealAgentStatus; frame?: RealAgentFrame | null; target?: ExecutionTarget; devices?: ConnectedDeviceSummary[]; activeDeviceId?: string | null }) => {
        if (data.status) setRealAgentStatus(data.status);
        if (data.frame) {
          setRealAgentFrame((prev) => pickNewerFrame(prev, data.frame ?? null));
        }
        if (data.devices) setConnectedDevices(data.devices);
        if (data.activeDeviceId !== undefined) setActiveDeviceId(data.activeDeviceId);
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
              const st = msg.status as RealAgentStatus;
              setRealAgentStatus(st);
              if (st.connected) {
                setExecutionTarget('real-win10');
              }
            } else if (msg.type === 'real_devices') {
              const devList = (msg as { devices?: ConnectedDeviceSummary[]; activeDeviceId?: string | null }).devices;
              const actId = (msg as { devices?: ConnectedDeviceSummary[]; activeDeviceId?: string | null }).activeDeviceId;
              if (devList) {
                setConnectedDevices(devList);
                if (devList.length > 0) {
                  setExecutionTarget('real-win10');
                }
              }
              if (actId !== undefined) setActiveDeviceId(actId);
            } else if (msg.type === 'real_agent_frame' && msg.frame) {
              lastWsFrameAtRef.current = Date.now();
              setRealAgentFrame((prev) => pickNewerFrame(prev, msg.frame ?? null));
              setExecutionTarget('real-win10');
            } else if (msg.type === 'real_agent_frame_for') {
              const dId = (msg as { deviceId?: string; frame?: RealAgentFrame }).deviceId;
              const f = (msg as { deviceId?: string; frame?: RealAgentFrame }).frame;
              if (dId && f) {
                lastWsFrameAtRef.current = Date.now();
                setDeviceFrames((prev) => ({ ...prev, [dId]: f }));
                setExecutionTarget('real-win10');
              }
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
      if (shareWorkerRef.current) {
        try {
          shareWorkerRef.current.postMessage('stop');
          shareWorkerRef.current.terminate();
        } catch {}
        shareWorkerRef.current = null;
      }
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
    if (shareWorkerRef.current) {
      try {
        shareWorkerRef.current.postMessage('stop');
        shareWorkerRef.current.terminate();
      } catch {}
      shareWorkerRef.current = null;
    }
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
      setShareError('Bu brauzer ekran ulashishni qo‘llab-quvvatlamaydi. Chrome yoki Firefox tavsiya etiladi.');
      return;
    }
    try {
      const isAndroid = typeof navigator !== 'undefined' && /android/i.test(navigator.userAgent);
      const isMobile = typeof navigator !== 'undefined' && /android|iphone|ipad|ipod|mobile/i.test(navigator.userAgent);

      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          frameRate: { ideal: isMobile ? 6 : 8, max: 12 },
        },
        audio: false,
      });
      stopBrowserShare();
      shareStreamRef.current = stream;

      const video = document.createElement('video');
      video.srcObject = stream;
      video.muted = true;
      video.playsInline = true;
      await video.play();

      const srcW = video.videoWidth || (isMobile ? 720 : 1280);
      const srcH = video.videoHeight || (isMobile ? 1280 : 720);
      const maxDim = Math.max(srcW, srcH);
      const targetMax = isMobile ? 960 : 1280;
      const scale = maxDim > targetMax ? targetMax / maxDim : 1;
      const w = Math.max(240, Math.round(srcW * scale));
      const h = Math.max(240, Math.round(srcH * scale));

      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');

      sendWs({
        type: 'browser_agent:hello',
        hostname: isAndroid ? 'Android Telefon' : isMobile ? 'Mobil Telefon' : 'Brauzer Ekran Ulashish',
        osVersion: isAndroid ? 'Android 10+ (Chrome Cast)' : (navigator.platform || 'Browser'),
        username: isAndroid ? 'Telefon' : 'PC',
        screenWidth: w,
        screenHeight: h,
      });

      const sendFrame = () => {
        if (!ctx || video.readyState < 2) return;
        try {
          ctx.drawImage(video, 0, 0, w, h);
          const dataUrl = canvas.toDataURL('image/jpeg', isMobile ? 0.58 : 0.65);
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
        } catch {
          // ignore frame drawing error
        }
      };

      sendFrame();

      // Inline Blob Web Worker ensures frame ticks continue when user switches to Termux on mobile
      try {
        const workerBlob = new Blob([
          `
          let intervalId = null;
          self.onmessage = function(e) {
            if (e.data === 'start') {
              if (intervalId) clearInterval(intervalId);
              intervalId = setInterval(function() {
                self.postMessage('tick');
              }, 320);
            } else if (e.data === 'stop') {
              if (intervalId) clearInterval(intervalId);
              intervalId = null;
            }
          };
          `
        ], { type: 'application/javascript' });
        const workerUrl = URL.createObjectURL(workerBlob);
        const worker = new Worker(workerUrl);
        worker.onmessage = (e) => {
          if (e.data === 'tick') {
            sendFrame();
          }
        };
        worker.postMessage('start');
        shareWorkerRef.current = worker;
      } catch {
        shareTimerRef.current = setInterval(sendFrame, 320);
      }

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

  const hasRealDevice = realAgentStatus.connected || connectedDevices.length > 0;
  const showingRealPc =
    (executionTarget === 'real-win10' && hasRealDevice) ||
    (hasRealDevice && executionTarget !== 'linux');

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

          {/* Quick Phone Screen switch if user is on Linux while phone is connected */}
          {hasRealDevice && executionTarget === 'linux' && (
            <button
              type="button"
              onClick={() => {
                switchTarget('real-win10');
                if (connectedDevices[0]) setActiveDeviceId(connectedDevices[0].id);
              }}
              className={`${LIQUID_PILL_BTN} bg-emerald-500/30 border-emerald-300 text-white animate-pulse`}
              title="Telefoningiz ekrani tayyor! Ochish uchun bosing"
            >
              <Smartphone className="w-3.5 h-3.5 text-emerald-300 relative z-10" />
              <span className="relative z-10 font-bold">📲 Telefon Ekrani (Ochish)</span>
            </button>
          )}

          {/* Connected Device Pills */}
          <button
            type="button"
            onClick={() => {
              switchTarget('linux');
              setSplitView(false);
            }}
            className={`${LIQUID_PILL_BTN} ${
              !showingRealPc && !splitView ? 'bg-cyan-500/25 border-cyan-300/60 text-white' : ''
            }`}
          >
            <Monitor className="w-3.5 h-3.5 text-white/95 relative z-10" strokeWidth={1.75} />
            <span className="relative z-10">Linux</span>
          </button>

          {connectedDevices.map((d) => {
            const isActive = showingRealPc && (activeDeviceId === d.id || connectedDevices.length === 1);
            return (
              <button
                key={d.id}
                type="button"
                onClick={() => {
                  setActiveDeviceId(d.id);
                  switchTarget('real-win10');
                  setSplitView(false);
                  void fetch('/api/real-win10/active-device', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ deviceId: d.id }),
                  }).catch(() => {});
                }}
                className={`${LIQUID_PILL_BTN} ${
                  isActive && !splitView ? 'bg-emerald-500/25 border-emerald-300/60 text-white' : ''
                }`}
              >
                <span className="w-2 h-2 rounded-full bg-emerald-400 relative z-10 animate-pulse" aria-hidden="true" />
                <span className="relative z-10">{d.hostname.slice(0, 14)} ({d.kind})</span>
              </button>
            );
          })}

          {connectedDevices.length >= 2 && (
            <button
              type="button"
              onClick={() => {
                setSplitView((prev) => !prev);
                if (!splitView) switchTarget('real-win10');
              }}
              className={`${LIQUID_PILL_BTN} ${
                splitView ? 'bg-purple-500/30 border-purple-300/70 text-white' : ''
              }`}
            >
              <span className="relative z-10">⚡ 2-Ekran Split</span>
            </button>
          )}

          {browserSharing ? (
            <button
              type="button"
              onClick={stopBrowserShare}
              className={`${LIQUID_PILL_BTN} bg-rose-500/25 border-rose-300/60 text-white animate-pulse`}
              title="Translatsiyani to'xtatish"
            >
              <span className="w-2 h-2 rounded-full bg-rose-400 relative z-10" aria-hidden="true" />
              <span className="relative z-10 font-medium">🔴 Translatsiya faol (To'xtatish)</span>
            </button>
          ) : (
            <button
              type="button"
              onClick={startBrowserShare}
              className={`${LIQUID_PILL_BTN} bg-emerald-500/15 border-emerald-400/40 text-emerald-200 hover:bg-emerald-500/25`}
              title="Telefonda ekranni ulashish (100% ADB-siz)"
            >
              <Smartphone className="w-3.5 h-3.5 text-emerald-400 relative z-10" strokeWidth={1.75} />
              <span className="relative z-10">📲 1-usul: Ekran Ulash</span>
            </button>
          )}

          <button type="button" onClick={() => setPcModalOpen(true)} className={LIQUID_PILL_BTN}>
            {realAgentStatus.connected ? (
              <span className="w-2 h-2 rounded-full bg-emerald-400 relative z-10" aria-hidden="true" />
            ) : (
              <Monitor className="w-3.5 h-3.5 text-white/95 relative z-10" strokeWidth={1.75} />
            )}
            <span className="relative z-10">Qurilma Qo'shish</span>
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
        {splitView && connectedDevices.length >= 2 ? (
          <div className="flex-1 min-h-0 w-full grid grid-cols-1 md:grid-cols-2 gap-2 p-2 bg-[#03060C]">
            {connectedDevices.slice(0, 2).map((dev) => {
              const devFrame = deviceFrames[dev.id] || realAgentFrame;
              const devStatus: RealAgentStatus = {
                connected: true,
                hostname: dev.hostname,
                osVersion: dev.osVersion,
                username: dev.username,
                screenWidth: dev.screenWidth,
                screenHeight: dev.screenHeight,
                connectedAt: dev.connectedAt,
                lastFrameAt: dev.lastFrameAt,
                fps: dev.fps,
              };
              return (
                <div key={dev.id} className="relative flex-1 min-h-0 flex flex-col rounded-2xl overflow-hidden border border-white/15 bg-[#070B14]">
                  <div className="px-3 py-1.5 bg-black/40 border-b border-white/10 flex items-center justify-between text-xs text-white/90">
                    <span className="font-medium flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full bg-emerald-400" />
                      {dev.hostname} ({dev.kind})
                    </span>
                    <span className="text-[10px] text-white/60">{dev.screenWidth}×{dev.screenHeight}</span>
                  </div>
                  <div className="flex-1 min-h-0 relative">
                    <RealWin10View
                      status={devStatus}
                      frame={devFrame}
                      allowRotate={!jarvisOpen}
                      onClickAt={(x, y, button) =>
                        sendWs({ type: 'user:real_click', x, y, button, deviceId: dev.id })
                      }
                      onScrollAt={(x, y, deltaY) =>
                        sendWs({ type: 'user:real_scroll', x, y, deltaY, deviceId: dev.id })
                      }
                      onTypeText={(text, enter) =>
                        sendWs({ type: 'user:real_type', text, enter, deviceId: dev.id })
                      }
                      onPressKey={(key) =>
                        sendWs({ type: 'user:real_key', key, deviceId: dev.id })
                      }
                    />
                  </div>
                </div>
              );
            })}
          </div>
        ) : showingRealPc ? (
          <RealWin10View
            status={realAgentStatus}
            frame={
              activeDeviceId && deviceFrames[activeDeviceId]
                ? deviceFrames[activeDeviceId]
                : realAgentFrame
            }
            allowRotate={!jarvisOpen}
            onClickAt={(x, y, button) =>
              sendWs({ type: 'user:real_click', x, y, button, deviceId: activeDeviceId })
            }
            onScrollAt={(x, y, deltaY) =>
              sendWs({ type: 'user:real_scroll', x, y, deltaY, deviceId: activeDeviceId })
            }
            onTypeText={(text, enter) =>
              sendWs({ type: 'user:real_type', text, enter, deviceId: activeDeviceId })
            }
            onPressKey={(key) =>
              sendWs({ type: 'user:real_key', key, deviceId: activeDeviceId })
            }
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
