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
      wsRef.current?.close();
    };
  }, []);

  const sendWs = useCallback((payload: Record<string, unknown>) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(payload));
    }
  }, []);

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
