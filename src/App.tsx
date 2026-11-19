import { useCallback, useEffect, useRef, useState } from 'react';
import { McpConnectModal } from './components/McpConnectModal.tsx';
import { RealLinuxView } from './components/RealLinuxView.tsx';
import {
  createInitialLinuxStatus,
  type LinuxDesktopStatus,
  type RealAgentFrame,
} from './desktop/bridge.ts';

export default function App() {
  const [linuxStatus, setLinuxStatus] = useState<LinuxDesktopStatus>(() =>
    createInitialLinuxStatus(),
  );
  const [linuxFrame, setLinuxFrame] = useState<RealAgentFrame | null>(null);
  const [connectModalOpen, setConnectModalOpen] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);

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
            status?: LinuxDesktopStatus;
            frame?: RealAgentFrame;
          };
          if (msg.type === 'linux_status' && msg.status) {
            setLinuxStatus(msg.status);
          } else if (msg.type === 'linux_frame' && msg.frame) {
            setLinuxFrame(msg.frame);
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
      wsRef.current?.close();
    };
  }, []);

  const sendWs = useCallback((payload: Record<string, unknown>) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(payload));
    }
  }, []);

  return (
    <div className="h-screen w-screen flex flex-col bg-[#03060C] text-slate-100 overflow-hidden">
      <header className="h-11 px-4 bg-[#060A12] border-b border-slate-800/80 flex items-center justify-end shrink-0">
        <button
          type="button"
          onClick={() => setConnectModalOpen(true)}
          className="px-4 py-1.5 text-xs font-semibold bg-[#0078D4] text-white hover:bg-[#0063B1] transition-colors whitespace-nowrap shrink-0"
        >
          MCP Ulash
        </button>
      </header>

      <main className="flex-1 min-h-0 flex overflow-hidden">
        <RealLinuxView
          status={linuxStatus}
          frame={linuxFrame}
          onClickAt={(x, y, button) => sendWs({ type: 'user:linux_click', x, y, button })}
          onScrollAt={(x, y, deltaY) => sendWs({ type: 'user:linux_scroll', x, y, deltaY })}
          onTypeText={(text, enter) => sendWs({ type: 'user:linux_type', text, enter })}
          onPressKey={(key) => sendWs({ type: 'user:linux_key', key })}
        />
      </main>

      <McpConnectModal
        open={connectModalOpen}
        onClose={() => setConnectModalOpen(false)}
      />
    </div>
  );
}
