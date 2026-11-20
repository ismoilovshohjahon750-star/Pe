import { useEffect, useState } from 'react';
import { Check, Copy, Plug, Shield, Terminal, X } from 'lucide-react';
import {
  LIQUID_CARD,
  LIQUID_ICON_BTN,
  LIQUID_INPUT,
  LIQUID_MODAL_BACKDROP,
  LIQUID_MODAL_SHELL,
  LIQUID_PILL_BTN,
} from './liquidGlass.ts';

interface McpToolItem {
  name: string;
  description: string;
}

interface McpConnectModalProps {
  open: boolean;
  onClose: () => void;
}

export function McpConnectModal({ open, onClose }: McpConnectModalProps) {
  const [tools, setTools] = useState<McpToolItem[]>([]);
  const [authEnabled, setAuthEnabled] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [testOutput, setTestOutput] = useState<string | null>(null);
  const [testImage, setTestImage] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);

  const origin = typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3000';
  const mcpUrl = `${origin}/mcp`;
  const sseUrl = `${origin}/sse`;

  useEffect(() => {
    if (!open) return;
    fetch('/api/mcp-info')
      .then((r) => r.json())
      .then((data: { authEnabled: boolean; token: string | null; tools: McpToolItem[] }) => {
        setAuthEnabled(data.authEnabled);
        setToken(data.token);
        setTools(data.tools || []);
      })
      .catch(() => {});
  }, [open]);

  if (!open) return null;

  const claudeDesktopConfig = JSON.stringify(
    {
      mcpServers: {
        'claude-linux': {
          command: 'npx',
          args: [
            '-y',
            'mcp-remote',
            mcpUrl,
            ...(authEnabled && token ? ['--header', `Authorization:Bearer ${token}`] : []),
          ],
        },
      },
    },
    null,
    2,
  );

  const copyText = (key: string, value: string) => {
    void navigator.clipboard?.writeText(value);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 1800);
  };

  const toggleAuth = async () => {
    const res = await fetch('/api/mcp-auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: !authEnabled }),
    });
    const data = (await res.json()) as { authEnabled: boolean; token: string | null };
    setAuthEnabled(data.authEnabled);
    setToken(data.token);
  };

  const runLiveMcpPing = async () => {
    setTesting(true);
    setTestOutput(null);
    setTestImage(null);
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (authEnabled && token) headers.Authorization = `Bearer ${token}`;
      const res = await fetch('/mcp', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 'verify-1',
          method: 'tools/call',
          params: { name: 'desktop_screenshot', arguments: {} },
        }),
      });
      const json = (await res.json()) as {
        result?: { content?: Array<{ type: string; data?: string; mimeType?: string; text?: string }> };
      };
      const imgBlock = json.result?.content?.find((c) => c.type === 'image');
      const txtBlock = json.result?.content?.find((c) => c.type === 'text');
      if (imgBlock?.data) {
        setTestImage(`data:${imgBlock.mimeType || 'image/png'};base64,${imgBlock.data}`);
      }
      setTestOutput(txtBlock?.text || JSON.stringify(json, null, 2));
    } catch (err) {
      setTestOutput((err as Error).message);
    } finally {
      setTesting(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Claude AI MCP ulanish sozlamalari"
      className={LIQUID_MODAL_BACKDROP}
    >
      <div className={`${LIQUID_MODAL_SHELL} max-w-3xl`}>
        {/* Header */}
        <div className="px-6 py-4 border-b border-white/15 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-full backdrop-blur-xl bg-white/[0.1] border border-white/25 shadow-[inset_1px_1px_1px_rgba(255,255,255,0.5)] flex items-center justify-center shrink-0">
              <Plug className="w-4 h-4 text-white/95" strokeWidth={1.75} />
            </div>
            <div>
              <h2 className="text-base font-semibold text-white">Claude AI ga MCP orqali ulash</h2>
              <p className="text-xs text-white/65 mt-0.5">
                Claude Desktop yoki Claude.ai Custom Connector orqali ushbu Linux desktopni boshqaring.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close MCP modal"
            className={LIQUID_ICON_BTN}
          >
            <X className="w-4 h-4 relative z-10" strokeWidth={1.75} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto win10-scroll p-5 space-y-4 text-xs">
          {/* Endpoints */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className={`${LIQUID_CARD} p-3.5 space-y-2`}>
              <div className="flex items-center justify-between gap-2">
                <span className="text-white/70 font-medium">Streamable HTTP MCP URL</span>
                <button
                  type="button"
                  onClick={() => copyText('mcp', mcpUrl)}
                  className={`${LIQUID_PILL_BTN} px-3 py-1`}
                >
                  {copiedKey === 'mcp' ? (
                    <Check className="w-3 h-3 text-emerald-300 relative z-10" strokeWidth={2} />
                  ) : (
                    <Copy className="w-3 h-3 relative z-10" strokeWidth={1.75} />
                  )}
                  <span className="relative z-10">{copiedKey === 'mcp' ? 'Nusxalandi' : 'Nusxalash'}</span>
                </button>
              </div>
              <input
                type="text"
                readOnly
                value={mcpUrl}
                onClick={(e) => e.currentTarget.select()}
                aria-label="Streamable HTTP MCP URL"
                className={LIQUID_INPUT}
              />
            </div>

            <div className={`${LIQUID_CARD} p-3.5 space-y-2`}>
              <div className="flex items-center justify-between gap-2">
                <span className="text-white/70 font-medium">Legacy SSE Transport URL</span>
                <button
                  type="button"
                  onClick={() => copyText('sse', sseUrl)}
                  className={`${LIQUID_PILL_BTN} px-3 py-1`}
                >
                  {copiedKey === 'sse' ? (
                    <Check className="w-3 h-3 text-emerald-300 relative z-10" strokeWidth={2} />
                  ) : (
                    <Copy className="w-3 h-3 relative z-10" strokeWidth={1.75} />
                  )}
                  <span className="relative z-10">{copiedKey === 'sse' ? 'Nusxalandi' : 'Nusxalash'}</span>
                </button>
              </div>
              <input
                type="text"
                readOnly
                value={sseUrl}
                onClick={(e) => e.currentTarget.select()}
                aria-label="Legacy SSE Transport URL"
                className={LIQUID_INPUT}
              />
            </div>
          </div>

          {/* Liquid Glass Auth Toggle */}
          <div className={`${LIQUID_CARD} p-4 flex flex-wrap items-center justify-between gap-3`}>
            <div className="flex items-center gap-3">
              <Shield className="w-4 h-4 text-white/90 shrink-0" strokeWidth={1.75} />
              <div>
                <div className="font-medium text-white">Bearer Token himoyasi</div>
                <div className="text-white/65">
                  {authEnabled && token
                    ? `Faol · Token: ${token}`
                    : 'Ochiq ulanish (Claude bilan tez ulash uchun qulay)'}
                </div>
              </div>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={authEnabled}
              aria-label="Bearer Token himoyasi"
              onClick={() => void toggleAuth()}
              className={`relative w-14 h-8 rounded-full backdrop-blur-xl border transition-all duration-200 cursor-pointer shadow-[inset_1px_1px_1px_rgba(255,255,255,0.45),inset_-1px_-1px_2px_rgba(255,255,255,0.18),0_4px_12px_rgba(0,0,0,0.35)] ${
                authEnabled
                  ? 'bg-emerald-400/25 border-emerald-300/45'
                  : 'bg-white/[0.07] border-white/25'
              }`}
            >
              <span
                className={`block w-6 h-6 rounded-full backdrop-blur-xl bg-white/[0.22] border border-white/45 shadow-[inset_1px_1px_1.5px_rgba(255,255,255,0.8),inset_-1px_-1px_2px_rgba(255,255,255,0.25),0_2px_8px_rgba(0,0,0,0.4)] transition-transform duration-200 ${
                  authEnabled ? 'translate-x-7' : 'translate-x-1'
                }`}
              />
            </button>
          </div>

          {/* Claude Desktop Config */}
          <div className={`${LIQUID_CARD} p-4 space-y-2.5`}>
            <div className="flex items-center justify-between">
              <span className="font-semibold text-white">claude_desktop_config.json</span>
              <button
                type="button"
                onClick={() => copyText('json', claudeDesktopConfig)}
                className={`${LIQUID_PILL_BTN} px-3.5 py-1`}
              >
                {copiedKey === 'json' ? (
                  <Check className="w-3.5 h-3.5 text-emerald-300 relative z-10" strokeWidth={2} />
                ) : (
                  <Copy className="w-3.5 h-3.5 relative z-10" strokeWidth={1.75} />
                )}
                <span className="relative z-10">
                  {copiedKey === 'json' ? 'Nusxalandi' : 'JSON nusxalash'}
                </span>
              </button>
            </div>
            <pre className="p-3.5 rounded-2xl bg-black/35 border border-white/15 shadow-[inset_0_4px_14px_rgba(0,0,0,0.45)] text-white/90 font-mono-tabular overflow-x-auto">
              {claudeDesktopConfig}
            </pre>
          </div>

          {/* Live MCP Protocol Test */}
          <div className={`${LIQUID_CARD} p-4 space-y-3`}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Terminal className="w-4 h-4 text-white/90" strokeWidth={1.75} />
                <span className="font-semibold text-white">
                  MCP JSON-RPC Jonli Tekshiruv (desktop_screenshot)
                </span>
              </div>
              <button
                type="button"
                onClick={() => void runLiveMcpPing()}
                disabled={testing}
                className={LIQUID_PILL_BTN}
              >
                <span className="relative z-10">
                  {testing ? 'Tekshirilmoqda...' : 'MCP Screenshot Test'}
                </span>
              </button>
            </div>

            {testImage && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-1">
                <img
                  src={testImage}
                  alt="MCP server PNG screenshot output"
                  className="rounded-xl border border-white/20 w-full h-auto"
                />
                <pre className="p-2.5 rounded-xl bg-black/35 border border-white/15 text-[11px] font-mono-tabular text-white/80 max-h-44 overflow-auto">
                  {testOutput}
                </pre>
              </div>
            )}
          </div>

          {/* Tool Manifest */}
          <div className="space-y-2.5">
            <div className="font-semibold text-white px-1">
              Claude AI uchun mavjud MCP vositalari ({tools.length})
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              {tools.map((tool) => (
                <div key={tool.name} className={`${LIQUID_CARD} p-3`}>
                  <div className="font-mono-tabular font-semibold text-white">{tool.name}</div>
                  <div className="text-[11px] text-white/65 mt-0.5 leading-snug">
                    {tool.description}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
