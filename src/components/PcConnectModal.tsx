import { useState } from 'react';
import { Check, Copy, Download, Monitor, MonitorUp, Square, Terminal, X } from 'lucide-react';
import type { ExecutionTarget, RealAgentStatus } from '../desktop/bridge.ts';
import {
  LIQUID_CARD,
  LIQUID_ICON_BTN,
  LIQUID_INPUT,
  LIQUID_MODAL_BACKDROP,
  LIQUID_MODAL_SHELL,
  LIQUID_PILL_BTN,
} from './liquidGlass.ts';

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
      className={LIQUID_MODAL_BACKDROP}
    >
      <div className={`${LIQUID_MODAL_SHELL} max-w-2xl`}>
        {/* Header */}
        <div className="px-6 py-4 border-b border-white/15 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-full backdrop-blur-xl bg-white/[0.1] border border-white/25 shadow-[inset_1px_1px_1px_rgba(255,255,255,0.5)] flex items-center justify-center shrink-0">
              <Monitor className="w-4 h-4 text-white/95" strokeWidth={1.75} />
            </div>
            <div>
              <h2 className="text-base font-semibold text-white">Haqiqiy PC ni ulash</h2>
              <p className="text-xs text-white/65 mt-0.5">
                Kompyuteringiz ekranini jonli uzating yoki Python agent orqali to‘liq MCP boshqaruviga ulang.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close PC modal"
            className={LIQUID_ICON_BTN}
          >
            <X className="w-4 h-4 relative z-10" strokeWidth={1.75} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto win10-scroll p-5 space-y-4 text-xs">
          {/* Live Status */}
          <div className={`${LIQUID_CARD} p-4 flex flex-wrap items-center justify-between gap-3`}>
            <div className="flex items-center gap-2.5">
              <span
                className={`w-2.5 h-2.5 rounded-full ${
                  status.connected ? 'bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.8)]' : 'bg-amber-400'
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
                  <div className="text-white/65 mt-0.5">
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
                    className={LIQUID_PILL_BTN}
                  >
                    <span className="relative z-10">Linux ekraniga qaytish</span>
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      onSwitchTarget('real-win10');
                      onClose();
                    }}
                    className={LIQUID_PILL_BTN}
                  >
                    <span className="relative z-10">Haqiqiy PC ekranini ochish</span>
                  </button>
                )}
              </div>
            )}
          </div>

          {/* Option 1: Browser Screen Share */}
          <div className={`${LIQUID_CARD} p-4 space-y-3`}>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="font-semibold text-white">
                  1-usul: Brauzer orqali ekran ulashish (Tavsiya etiladi)
                </div>
                <p className="text-white/65 mt-0.5">
                  Hech qanday skript yoki dastursiz — Windows Defender bloklamaydi.
                </p>
              </div>
              {browserSharing ? (
                <button
                  type="button"
                  onClick={onStopBrowserShare}
                  className={`${LIQUID_PILL_BTN} bg-rose-500/20 border-rose-300/40 hover:bg-rose-500/30`}
                >
                  <Square className="w-3.5 h-3.5 relative z-10" strokeWidth={1.75} />
                  <span className="relative z-10">Ulashishni to‘xtatish</span>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={onStartBrowserShare}
                  className={LIQUID_PILL_BTN}
                >
                  <MonitorUp className="w-3.5 h-3.5 relative z-10" strokeWidth={1.75} />
                  <span className="relative z-10">Ekranni ulashish</span>
                </button>
              )}
            </div>
            {shareError && (
              <div className="text-rose-200 rounded-2xl bg-rose-500/15 border border-rose-300/30 px-3.5 py-2">
                {shareError}
              </div>
            )}
          </div>

          {/* Option 2: Python Agent */}
          <div className={`${LIQUID_CARD} p-4 space-y-3.5`}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2 font-semibold text-white">
                <Terminal className="w-4 h-4 text-white/90" strokeWidth={1.75} />
                <span>2-usul: To‘liq boshqaruv uchun Python Agent</span>
              </div>
              <a
                href="/api/real-pc-agent.py"
                download="real-pc-agent.py"
                className={LIQUID_PILL_BTN}
              >
                <Download className="w-3.5 h-3.5 relative z-10" strokeWidth={1.75} />
                <span className="relative z-10">real-pc-agent.py</span>
              </a>
            </div>
            <p className="text-white/65 leading-relaxed">
              PowerShell <span className="font-mono-tabular text-white/90">irm | iex</span> Windows Defender
              AMSI tomonidan bloklanadi. Sichqoncha, klaviatura va terminalni ham boshqarish uchun rasmiy
              Python kutubxonalaridan foydalaning:
            </p>

            <div className="space-y-2">
              <div className="flex items-center justify-between text-[11px] text-white/70">
                <span>1-qadam: Kutubxonalarni o‘rnatish</span>
                <button
                  type="button"
                  onClick={() => copyText('pip', pipCommand)}
                  className={`${LIQUID_PILL_BTN} px-3 py-1`}
                >
                  {copiedStep === 'pip' ? (
                    <Check className="w-3 h-3 text-emerald-300 relative z-10" strokeWidth={2} />
                  ) : (
                    <Copy className="w-3 h-3 relative z-10" strokeWidth={1.75} />
                  )}
                  <span className="relative z-10">{copiedStep === 'pip' ? 'Nusxalandi' : 'Nusxalash'}</span>
                </button>
              </div>
              <input
                type="text"
                readOnly
                value={pipCommand}
                onClick={(e) => e.currentTarget.select()}
                aria-label="Python kutubxonalarini o'rnatish buyrug'i"
                className={LIQUID_INPUT}
              />
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between text-[11px] text-white/70">
                <span>2-qadam: Agentni ishga tushirish</span>
                <button
                  type="button"
                  onClick={() => copyText('run', pyRunCommand)}
                  className={`${LIQUID_PILL_BTN} px-3 py-1`}
                >
                  {copiedStep === 'run' ? (
                    <Check className="w-3 h-3 text-emerald-300 relative z-10" strokeWidth={2} />
                  ) : (
                    <Copy className="w-3 h-3 relative z-10" strokeWidth={1.75} />
                  )}
                  <span className="relative z-10">{copiedStep === 'run' ? 'Nusxalandi' : 'Nusxalash'}</span>
                </button>
              </div>
              <input
                type="text"
                readOnly
                value={pyRunCommand}
                onClick={(e) => e.currentTarget.select()}
                aria-label="Python agentni ishga tushirish buyrug'i"
                className={LIQUID_INPUT}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
