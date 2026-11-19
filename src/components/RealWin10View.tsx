import { useState } from 'react';
import { Check, Copy, Download, Monitor, Send, Terminal } from 'lucide-react';
import type { RealAgentFrame, RealAgentStatus } from '../desktop/bridge.ts';

interface RealWin10ViewProps {
  status: RealAgentStatus;
  frame: RealAgentFrame | null;
  interactive: boolean;
  onRealClick: (x: number, y: number, button?: 'left' | 'right' | 'double') => void;
  onRealType: (text: string, enter?: boolean) => void;
  onSwitchToSandbox: () => void;
}

export function RealWin10View({
  status,
  frame,
  interactive,
  onRealClick,
  onRealType,
  onSwitchToSandbox,
}: RealWin10ViewProps) {
  const [copied, setCopied] = useState(false);
  const [typeText, setTypeText] = useState('');

  const origin = typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3000';
  const psCommand = `irm "${origin}/api/real-win10-agent.ps1" | iex`;

  const copyCommand = () => {
    void navigator.clipboard?.writeText(psCommand);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  if (status.connected && frame?.data) {
    const handleImageClick = (e: React.MouseEvent<HTMLImageElement>) => {
      if (!interactive) return;
      const rect = e.currentTarget.getBoundingClientRect();
      const x = Math.round(((e.clientX - rect.left) / rect.width) * frame.width);
      const y = Math.round(((e.clientY - rect.top) / rect.height) * frame.height);
      onRealClick(x, y, 'left');
    };

    const handleImageDoubleClick = (e: React.MouseEvent<HTMLImageElement>) => {
      if (!interactive) return;
      const rect = e.currentTarget.getBoundingClientRect();
      const x = Math.round(((e.clientX - rect.left) / rect.width) * frame.width);
      const y = Math.round(((e.clientY - rect.top) / rect.height) * frame.height);
      onRealClick(x, y, 'double');
    };

    return (
      <div className="flex-1 flex flex-col bg-[#060A12] overflow-hidden p-3 gap-2">
        <div className="flex flex-wrap items-center justify-between gap-3 px-3 py-2 bg-slate-900 border border-slate-800 text-xs">
          <div className="flex items-center gap-2.5 text-slate-200">
            <span className="w-2 h-2 rounded-full bg-emerald-500" aria-hidden="true" />
            <span className="font-semibold">{status.hostname || 'Windows 10 Pro'}</span>
            <span aria-hidden="true" className="text-slate-600">·</span>
            <span className="text-slate-400">{status.osVersion || 'Microsoft Windows 10 Pro'}</span>
            <span aria-hidden="true" className="text-slate-600">·</span>
            <span className="font-mono-tabular text-sky-400">
              {frame.width}×{frame.height} · {status.fps} FPS
            </span>
          </div>

          {interactive && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (!typeText.trim()) return;
                onRealType(typeText, true);
                setTypeText('');
              }}
              className="flex items-center gap-1.5"
            >
              <input
                type="text"
                value={typeText}
                onChange={(e) => setTypeText(e.target.value)}
                placeholder="Haqiqiy Windowsga matn yuborish..."
                className="px-2.5 py-1 bg-slate-950 border border-slate-700 text-slate-100 text-xs w-56 focus:outline-none focus:border-[#0078D4]"
              />
              <button
                type="submit"
                className="px-2.5 py-1 bg-[#0078D4] hover:bg-[#0063B1] text-white flex items-center gap-1"
              >
                <Send className="w-3 h-3" />
                <span>Yuborish</span>
              </button>
            </form>
          )}
        </div>

        <div className="flex-1 min-h-0 flex items-center justify-center overflow-hidden">
          <img
            src={`data:${frame.mimeType};base64,${frame.data}`}
            alt="Real Windows 10 Pro live stream"
            onClick={handleImageClick}
            onDoubleClick={handleImageDoubleClick}
            className={`max-w-full max-h-full border border-slate-800 shadow-2xl object-contain ${
              interactive ? 'cursor-crosshair' : 'cursor-default'
            }`}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto win10-scroll bg-[#060A12] p-4 sm:p-8 flex items-center justify-center">
      <div className="w-full max-w-2xl bg-[#0F172A] border border-slate-800 p-6 space-y-5 text-xs">
        <div className="flex items-start gap-3">
          <div className="p-2.5 bg-[#0078D4]/15 border border-[#0078D4]/30 text-[#38BDF8] shrink-0">
            <Monitor className="w-5 h-5" />
          </div>
          <div className="space-y-1">
            <h2 className="text-base font-semibold text-white">
              Haqiqiy Windows 10 Pro ulanishi (Live Host Bridge)
            </h2>
            <p className="text-slate-400 leading-relaxed">
              Ushbu bulut serveri <span className="font-mono-tabular text-slate-300">Linux gVisor</span>{' '}
              konteynerida ishlaydi va ichida <span className="font-mono-tabular text-slate-300">/dev/kvm</span>{' '}
              apparat virtualizatsiyasi yo‘q — shuning uchun haqiqiy Microsoft Windows 10 Pro VM ni brauzer serverining
              o‘zida ishga tushirib bo‘lmaydi. Lekin istalgan haqiqiy Windows 10 Pro kompyuter yoki VPS ni 1 ta buyruq
              bilan shu yerga ulashingiz mumkin.
            </p>
          </div>
        </div>

        <div className="p-4 bg-[#070B14] border border-slate-800 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 font-medium text-white">
              <Terminal className="w-4 h-4 text-sky-400" />
              <span>1-qadam: Haqiqiy Windows 10 Pro PowerShell’da ishga tushiring</span>
            </div>
            <button
              type="button"
              onClick={copyCommand}
              className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-slate-200 flex items-center gap-1.5 shrink-0"
            >
              {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
              <span>{copied ? 'Nusxalandi' : 'Buyruqni nusxalash'}</span>
            </button>
          </div>

          <pre className="p-3 bg-slate-950 border border-slate-800 text-sky-300 font-mono-tabular overflow-x-auto">
            {psCommand}
          </pre>

          <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-400">
            <span>
              Qo‘shimcha dastur shart emas — Windows 10 Pro ichidagi PowerShell + .NET orqali jonli ekran va MCP ishlaydi.
            </span>
            <a
              href="/api/real-win10-agent.ps1"
              download="win10-claude-agent.ps1"
              className="inline-flex items-center gap-1.5 text-sky-400 hover:text-sky-300 font-medium"
            >
              <Download className="w-3.5 h-3.5" />
              <span>.ps1 skriptni yuklab olish</span>
            </a>
          </div>
        </div>

        <div className="p-4 bg-slate-900/70 border border-slate-800 space-y-2 text-slate-300">
          <div className="font-semibold text-white">Ulangandan keyin nima bo‘ladi?</div>
          <ul className="space-y-1 text-slate-400 list-disc list-inside">
            <li>Haqiqiy Windows 10 Pro ekraningiz real vaqtda shu saytda jonli ko‘rinadi.</li>
            <li>Claude AI MCP vositalari (`desktop_screenshot`, `desktop_click`, `desktop_type`, `run_powershell`, `file_*`) avtomatik ravishda haqiqiy Windows 10 Pro’da bajariladi.</li>
          </ul>
        </div>

        <div className="flex items-center justify-between pt-1">
          <span className="text-slate-400">
            Agent holati: <strong className="text-amber-400">Kutilmoqda (ulanmagan)</strong>
          </span>
          <button
            type="button"
            onClick={onSwitchToSandbox}
            className="px-4 py-2 bg-[#0078D4] hover:bg-[#0063B1] text-white font-medium"
          >
            Brauzer Sandbox Desktopga qaytish
          </button>
        </div>
      </div>
    </div>
  );
}
