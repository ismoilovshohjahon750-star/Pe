import { useCallback, useEffect, useRef, useState } from 'react';
import { Monitor } from 'lucide-react';
import { McpConnectModal } from './components/McpConnectModal.tsx';
import { PcConnectModal } from './components/PcConnectModal.tsx';
import { RealLinuxView } from './components/RealLinuxView.tsx';
import { RealWin10View } from './components/RealWin10View.tsx';
import {
  createInitialLinuxStatus,
  createInitialRealAgentStatus,
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
  const [browserSharing, setBrowserSharing] = useState(false);
  const [shareError, setShareError] = useState<string | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const shareStreamRef = useRef<MediaStream | null>(null);
  const shareTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    let active = true;
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
    let attempt = 0;

    fetch('/api/linux/status')
      .then((r) => r.json())
      .then((data: { status?: LinuxDesktopStatus; frame?: RealAgentFrame | null }) => {
        if (!active) return;
        if (data.status) setLinuxStatus(data.status);
        if (data.frame) setLinuxFrame(data.frame);
      })
      .catch(() => {});

    fetch('/api/real-win10/status')
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
      if (!active) return;
      const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const socket = new WebSocket(`${proto}//${window.location.host}/ws`);
      wsRef.current = socket;

      socket.onopen = () => {
        if (!active) return;
        attempt = 0;
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
            setLinuxFrame(msg.frame);
          } else if (msg.type === 'real_agent_status' && msg.status) {
            setRealAgentStatus(msg.status as RealAgentStatus);
          } else if (msg.type === 'real_agent_frame' && msg.frame) {
            setRealAgentFrame(msg.frame);
          } else if (msg.type === 'execution_target' && msg.target) {
            setExecutionTarget(msg.target);
          }
        } catch {
          // ignore malformed messages
        }
      };

      socket.onclose = () => {
        if (!active) return;
        const waitMs = Math.min(5000, 600 * Math.pow(1.5, attempt));
        attempt += 1;
        reconnectTimer = setTimeout(connect, waitMs);
      };

      socket.onerror = () => {
        socket.close();
      };
    };

    connect();

    return () => {
      active = false;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (shareTimerRef.current) clearInterval(shareTimerRef.current);
      shareStreamRef.current?.getTracks().forEach((t) => t.stop());
      wsRef.current?.close();
    };
  }, []);

  const sendWs = useCallback((payload: Record<string, unknown>) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(payload));
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
    <div className="h-screen w-screen flex flex-col bg-[#03060C] text-slate-100 overflow-hidden">
      <header className="h-11 px-4 bg-[#060A12] border-b border-slate-800/80 flex items-center justify-end gap-2 shrink-0">
        <button
          type="button"
          onClick={() => setPcModalOpen(true)}
          className="flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-100 transition-colors whitespace-nowrap shrink-0"
        >
          {realAgentStatus.connected ? (
            <span className="w-2 h-2 rounded-full bg-emerald-500" aria-hidden="true" />
          ) : (
            <Monitor className="w-3.5 h-3.5 text-sky-400" />
          )}
          <span>Haqiqiy PC Ulash</span>
        </button>
        <button
          type="button"
          onClick={() => setMcpModalOpen(true)}
          className="px-4 py-1.5 text-xs font-semibold bg-[#0078D4] text-white hover:bg-[#0063B1] transition-colors whitespace-nowrap shrink-0"
        >
          MCP Ulash
        </button>
      </header>

      <main className="flex-1 min-h-0 flex overflow-hidden">
        {showingRealPc ? (
          <RealWin10View
            status={realAgentStatus}
            frame={realAgentFrame}
            onClickAt={(x, y, button) => sendWs({ type: 'user:real_click', x, y, button })}
            onScrollAt={(x, y, deltaY) => sendWs({ type: 'user:real_scroll', x, y, deltaY })}
            onTypeText={(text, enter) => sendWs({ type: 'user:real_type', text, enter })}
            onPressKey={(key) => sendWs({ type: 'user:real_key', key })}
          />
        ) : (
          <RealLinuxView
            status={linuxStatus}
            frame={linuxFrame}
            onClickAt={(x, y, button) => sendWs({ type: 'user:linux_click', x, y, button })}
            onScrollAt={(x, y, deltaY) => sendWs({ type: 'user:linux_scroll', x, y, deltaY })}
            onTypeText={(text, enter) => sendWs({ type: 'user:linux_type', text, enter })}
            onPressKey={(key) => sendWs({ type: 'user:linux_key', key })}
          />
        )}
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
    </div>
  );
}
