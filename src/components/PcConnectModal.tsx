import { useState } from 'react';
import { Check, Copy, Download, Monitor, MonitorUp, Square, Terminal, X } from 'lucide-react';
import type { ExecutionTarget, RealAgentStatus } from '../desktop/bridge.ts';

interface PcConnectModalProps {
  open: boolean;
  status: RealAgentStatus;
  executionTarget: ExecutionTarget;
  browserSharing: boolean;
  shareError: string | null;
  onStartBrowserShare: () => void;
  onStopBrowserShare: () => void;
  onSwitchTarget: (target: ExecutionTarget) => void;
  onClose: () => void;
}

export function PcConnectModal({
  open,
  status,
  executionTarget,
  browserSharing,
  shareError,
  onStartBrowserShare,
  onStopBrowserShare,
  onSwitchTarget,
  onClose,
}: PcConnectModalProps) {
  const [copiedStep, setCopiedStep] = useState<string | null>(null);

  if (!open) return null;

  const origin = typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3000';
  const pipCommand = 'pip install mss pillow pyautogui websockets';
  const pyRunCommand = `python -c "import urllib.request,runpy; urllib.request.urlretrieve('${origin}/api/real-pc-agent.py','real-pc-agent.py'); runpy.run_path('real-pc-agent.py',run_name='__main__')"`;

  const copyText = (key: string, text: string) => {
    void navigator.clipboard?.writeText(text);
    setCopiedStep(key);
    setTimeout(() => setCopiedStep(null), 1800);
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
                Kompyuteringiz ekranini jonli uzating yoki Python agent orqali to‘liq MCP boshqaruviga ulang.
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
                    ? `Ulandi: ${status.hostname || 'Real PC'} (${status.screenWidth}×${status.screenHeight})`
                    : 'Haqiqiy PC kutilmoqda (ulanmagan)'}
                </div>
                {status.connected && (
                  <div className="text-slate-400 mt-0.5">
                    {status.osVersion || 'PC'} · {status.username || 'User'} · {status.fps} FPS
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

          {/* Option 1: Browser Screen Share (No scripts, no antivirus blocks) */}
          <div className="p-4 bg-[#070B14] border border-sky-900/60 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="font-semibold text-white">
                  1-usul: Brauzer orqali ekran ulashish (Tavsiya etiladi)
                </div>
                <p className="text-slate-400 mt-0.5">
                  Hech qanday skript yoki dastursiz — Windows Defender bloklamaydi.
                </p>
              </div>
              {browserSharing ? (
                <button
                  type="button"
                  onClick={onStopBrowserShare}
                  className="px-3.5 py-2 bg-rose-600 hover:bg-rose-500 text-white font-semibold flex items-center gap-1.5 shrink-0"
                >
                  <Square className="w-3.5 h-3.5" />
                  <span>Ulashishni to‘xtatish</span>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={onStartBrowserShare}
                  className="px-3.5 py-2 bg-[#0078D4] hover:bg-[#0063B1] text-white font-semibold flex items-center gap-1.5 shrink-0"
                >
                  <MonitorUp className="w-3.5 h-3.5" />
                  <span>Ekranni ulashish</span>
                </button>
              )}
            </div>
            {shareError && (
              <div className="text-rose-400 bg-rose-950/40 border border-rose-900/50 px-3 py-2">
                {shareError}
              </div>
            )}
          </div>

          {/* Option 2: Python Agent for Full Control */}
          <div className="p-4 bg-[#070B14] border border-slate-800 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 font-semibold text-white">
                <Terminal className="w-4 h-4 text-sky-400" />
                <span>2-usul: To‘liq boshqaruv uchun Python Agent</span>
              </div>
              <a
                href="/api/real-pc-agent.py"
                download="real-pc-agent.py"
                className="inline-flex items-center gap-1.5 text-sky-400 hover:text-sky-300 font-medium"
              >
                <Download className="w-3.5 h-3.5" />
                <span>real-pc-agent.py yuklab olish</span>
              </a>
            </div>
            <p className="text-slate-400">
              PowerShell <span className="font-mono-tabular text-slate-300">irm | iex</span> Windows Defender
              AMSI tomonidan bloklanadi. Sichqoncha, klaviatura va terminalni ham boshqarish uchun rasmiy
              Python kutubxonalaridan foydalaning:
            </p>

            <div className="space-y-2">
              <div className="flex items-center justify-between text-[11px] text-slate-400">
                <span>1-qadam: Kutubxonalarni o‘rnatish</span>
                <button
                  type="button"
                  onClick={() => copyText('pip', pipCommand)}
                  className="px-2 py-0.5 bg-slate-800 hover:bg-slate-700 text-slate-200 flex items-center gap-1"
                >
                  {copiedStep === 'pip' ? (
                    <Check className="w-3 h-3 text-emerald-400" />
                  ) : (
                    <Copy className="w-3 h-3" />
                  )}
                  <span>{copiedStep === 'pip' ? 'Nusxalandi' : 'Nusxalash'}</span>
                </button>
              </div>
              <input
                type="text"
                readOnly
                value={pipCommand}
                onClick={(e) => e.currentTarget.select()}
                aria-label="Python kutubxonalarini o'rnatish buyrug'i"
                className="w-full p-2.5 bg-slate-950 border border-slate-800 text-sky-300 font-mono-tabular text-xs focus:outline-none focus:border-sky-500"
              />
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between text-[11px] text-slate-400">
                <span>2-qadam: Agentni ishga tushirish</span>
                <button
                  type="button"
                  onClick={() => copyText('run', pyRunCommand)}
                  className="px-2 py-0.5 bg-slate-800 hover:bg-slate-700 text-slate-200 flex items-center gap-1"
                >
                  {copiedStep === 'run' ? (
                    <Check className="w-3 h-3 text-emerald-400" />
                  ) : (
                    <Copy className="w-3 h-3" />
                  )}
                  <span>{copiedStep === 'run' ? 'Nusxalandi' : 'Nusxalash'}</span>
                </button>
              </div>
              <input
                type="text"
                readOnly
                value={pyRunCommand}
                onClick={(e) => e.currentTarget.select()}
                aria-label="Python agentni ishga tushirish buyrug'i"
                className="w-full p-2.5 bg-slate-950 border border-slate-800 text-sky-300 font-mono-tabular text-xs focus:outline-none focus:border-sky-500"
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
