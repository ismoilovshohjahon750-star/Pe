import { useEffect, useState } from 'react';
import { Check, Copy, Shield, Terminal, X } from 'lucide-react';

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
      className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
    >
      <div className="bg-[#0F172A] border border-slate-700 text-slate-100 w-full max-w-3xl max-h-[90vh] flex flex-col shadow-2xl">
        {/* Header */}
        <div className="px-5 py-4 border-b border-slate-800 flex items-center justify-between">
          <div>
            <h2 className="text-base font-semibold text-white">Claude AI ga MCP orqali ulash</h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Claude Desktop yoki Claude.ai Custom Connector orqali ushbu Linux desktopni boshqaring.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close MCP modal"
            className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-800"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto win10-scroll p-5 space-y-5 text-xs">
          {/* Endpoints */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="p-3 bg-slate-900 border border-slate-800 space-y-1.5">
              <div className="text-slate-400 font-medium">Streamable HTTP MCP URL (Claude.ai)</div>
              <div className="flex items-center justify-between gap-2">
                <code className="font-mono-tabular text-sky-300 truncate">{mcpUrl}</code>
                <button
                  type="button"
                  onClick={() => copyText('mcp', mcpUrl)}
                  className="px-2 py-1 bg-slate-800 hover:bg-slate-700 text-slate-200 flex items-center gap-1 shrink-0"
                >
                  {copiedKey === 'mcp' ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                  <span>{copiedKey === 'mcp' ? 'Nusxalandi' : 'Nusxalash'}</span>
                </button>
              </div>
            </div>

            <div className="p-3 bg-slate-900 border border-slate-800 space-y-1.5">
              <div className="text-slate-400 font-medium">Legacy SSE Transport URL</div>
              <div className="flex items-center justify-between gap-2">
                <code className="font-mono-tabular text-sky-300 truncate">{sseUrl}</code>
                <button
                  type="button"
                  onClick={() => copyText('sse', sseUrl)}
                  className="px-2 py-1 bg-slate-800 hover:bg-slate-700 text-slate-200 flex items-center gap-1 shrink-0"
                >
                  {copiedKey === 'sse' ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                  <span>{copiedKey === 'sse' ? 'Nusxalandi' : 'Nusxalash'}</span>
                </button>
              </div>
            </div>
          </div>

          {/* Auth Toggle */}
          <div className="p-3 bg-slate-900 border border-slate-800 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <Shield className="w-4 h-4 text-sky-400 shrink-0" />
              <div>
                <div className="font-medium text-white">Bearer Token himoyasi</div>
                <div className="text-slate-400">
                  {authEnabled && token
                    ? `Faol · Token: ${token}`
                    : 'Ochiq ulanish (Claude bilan tez ulash uchun qulay)'}
                </div>
              </div>
            </div>
            <button
              type="button"
              onClick={() => void toggleAuth()}
              className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 font-medium"
            >
              {authEnabled ? 'Himoyani oʻchirish' : 'Token yoqish'}
            </button>
          </div>

          {/* Claude Desktop Config */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-white">claude_desktop_config.json</span>
              <button
                type="button"
                onClick={() => copyText('json', claudeDesktopConfig)}
                className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-slate-200 flex items-center gap-1.5"
              >
                {copiedKey === 'json' ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                <span>{copiedKey === 'json' ? 'Nusxalandi' : 'JSON nusxalash'}</span>
              </button>
            </div>
            <pre className="p-3 bg-[#070B14] border border-slate-800 text-sky-200 font-mono-tabular overflow-x-auto">
              {claudeDesktopConfig}
            </pre>
          </div>

          {/* Live MCP Protocol Test */}
          <div className="p-3 bg-slate-900 border border-slate-800 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Terminal className="w-4 h-4 text-sky-400" />
                <span className="font-semibold text-white">
                  MCP JSON-RPC Jonli Tekshiruv (`desktop_screenshot`)
                </span>
              </div>
              <button
                type="button"
                onClick={() => void runLiveMcpPing()}
                disabled={testing}
                className="px-3 py-1.5 bg-[#0078D4] hover:bg-[#0063B1] text-white font-medium disabled:opacity-50"
              >
                {testing ? 'Tekshirilmoqda...' : 'MCP Screenshot Test'}
              </button>
            </div>

            {testImage && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-1">
                <img
                  src={testImage}
                  alt="MCP server PNG screenshot output"
                  className="border border-slate-700 w-full h-auto"
                />
                <pre className="p-2 bg-[#070B14] border border-slate-800 text-[11px] font-mono-tabular text-slate-300 max-h-44 overflow-auto">
                  {testOutput}
                </pre>
              </div>
            )}
          </div>

          {/* Tool Manifest */}
          <div className="space-y-2">
            <div className="font-semibold text-white">
              Claude AI uchun mavjud MCP vositalari ({tools.length})
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {tools.map((tool) => (
                <div key={tool.name} className="p-2.5 bg-slate-900/80 border border-slate-800">
                  <div className="font-mono-tabular font-semibold text-sky-400">{tool.name}</div>
                  <div className="text-[11px] text-slate-400 mt-0.5 leading-snug">
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
