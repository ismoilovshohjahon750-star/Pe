import { useState } from 'react';
import { Check, Copy, Download, Monitor, Terminal, X } from 'lucide-react';
import type { ExecutionTarget, RealAgentStatus } from '../desktop/bridge.ts';

interface PcConnectModalProps {
  open: boolean;
  status: RealAgentStatus;
  executionTarget: ExecutionTarget;
  onSwitchTarget: (target: ExecutionTarget) => void;
  onClose: () => void;
}

export function PcConnectModal({
  open,
  status,
  executionTarget,
  onSwitchTarget,
  onClose,
}: PcConnectModalProps) {
  const [copied, setCopied] = useState(false);

  if (!open) return null;

  const origin = typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3000';
  const psCommand = `irm "${origin}/api/real-win10-agent.ps1" | iex;`;

  const copyCommand = () => {
    void navigator.clipboard?.writeText(psCommand);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Haqiqiy kompyuterni ulash"
      className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
    >
      <div className="bg-[#0F172A] border border-slate-700 text-slate-100 w-full max-w-2xl max-h-[90vh] flex flex-col shadow-2xl">
        {/* Header */}
        <div className="px-5 py-4 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-[#0078D4]/15 border border-[#0078D4]/30 text-[#38BDF8] shrink-0">
              <Monitor className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-white">Haqiqiy PC ni ulash</h2>
              <p className="text-xs text-slate-400 mt-0.5">
                O‘z kompyuteringiz ekranini jonli ko‘rish va Claude AI MCP orqali boshqarish uchun ulang.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close PC modal"
            className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-800"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4 text-xs">
          {/* Live Status */}
          <div className="p-3 bg-slate-900 border border-slate-800 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <span
                className={`w-2.5 h-2.5 rounded-full ${
                  status.connected ? 'bg-emerald-500' : 'bg-amber-500'
                }`}
                aria-hidden="true"
              />
              <div>
                <div className="font-medium text-white">
                  {status.connected
                    ? `Ulandi: ${status.hostname || 'Windows PC'} (${status.screenWidth}×${status.screenHeight})`
                    : 'Haqiqiy PC kutilmoqda (ulanmagan)'}
                </div>
                {status.connected && (
                  <div className="text-slate-400 mt-0.5">
                    {status.osVersion || 'Windows'} · {status.username || 'User'} · {status.fps} FPS
                  </div>
                )}
              </div>
            </div>

            {status.connected && (
              <div className="flex items-center gap-2">
                {executionTarget === 'real-win10' ? (
                  <button
                    type="button"
                    onClick={() => {
                      onSwitchTarget('linux');
                      onClose();
                    }}
                    className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 font-medium"
                  >
                    Linux ekraniga qaytish
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      onSwitchTarget('real-win10');
                      onClose();
                    }}
                    className="px-3 py-1.5 bg-[#0078D4] hover:bg-[#0063B1] text-white font-medium"
                  >
                    Haqiqiy PC ekranini ochish
                  </button>
                )}
              </div>
            )}
          </div>

          {/* PowerShell Command */}
          <div className="p-4 bg-[#070B14] border border-slate-800 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 font-medium text-white">
                <Terminal className="w-4 h-4 text-sky-400" />
                <span>Windows PowerShell’da ishga tushiring</span>
              </div>
              <button
                type="button"
                onClick={copyCommand}
                className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-slate-200 flex items-center gap-1.5 shrink-0"
              >
                {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                <span>{copied ? 'Nusxalandi! 1 marta Ctrl+V qiling' : 'Buyruqni nusxalash'}</span>
              </button>
            </div>

            <input
              type="text"
              readOnly
              value={psCommand}
              onClick={(e) => e.currentTarget.select()}
              aria-label="PowerShell ulash buyrug'i"
              className="w-full p-3 bg-slate-950 border border-slate-800 text-sky-300 font-mono-tabular text-xs focus:outline-none focus:border-sky-500"
            />

            <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-400">
              <span>PowerShell’ga faqat 1 marta joylang (Ctrl+V) va Enter bosing.</span>
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

          {/* What happens when connected */}
          <div className="p-4 bg-slate-900/70 border border-slate-800 space-y-1.5 text-slate-300">
            <div className="font-semibold text-white">Ulangandan keyin:</div>
            <ul className="space-y-1 text-slate-400 list-disc list-inside">
              <li>Kompyuteringiz ekrani real vaqtda shu saytda gorizontal ko‘rinishda chiqadi.</li>
              <li>Claude AI MCP chaqiruvlari avtomatik ravishda haqiqiy kompyuteringizda bajariladi.</li>
              <li>Agent yopilsa, ekran avtomatik ravishda yana serverdagi Linux desktopga qaytadi.</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
