import { useState } from 'react';
import { Check, Copy, Download, Monitor, MonitorUp, Smartphone, Square, Terminal, X } from 'lucide-react';
import type { ExecutionTarget, RealAgentStatus } from '../desktop/bridge.ts';
import { copyTextCrossBrowser } from '../utils/clipboard.ts';
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
  const [deviceTab, setDeviceTab] = useState<'pc' | 'android'>('pc');

  if (!open) return null;

  const origin = typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3000';
  const exeBuildCommand = `cd $HOME; curl.exe -sL "${origin}/api/real-pc-agent-builder.bat" -o JarvisPcAgent-Setup.bat; .\\JarvisPcAgent-Setup.bat`;
  const pipCommand = 'pip install mss pillow pyautogui websockets';
  const pyRunCommand = `cd $HOME; python -c "import urllib.request,runpy; urllib.request.urlretrieve('${origin}/api/real-pc-agent.py','real-pc-agent.py'); runpy.run_path('real-pc-agent.py',run_name='__main__')"`;
  const termuxCommand = `pkg update -y && pkg install -y python && pip install -q websockets && curl -sL "${origin}/api/android-termux-agent.py" -o $HOME/android-termux-agent.py && python $HOME/android-termux-agent.py`;
  const termuxAdbCommand = 'pkg install -y android-tools termux-api && adb connect <TELEFON_IP>:<PORT>';

  const copyText = (key: string, text: string) => {
    void copyTextCrossBrowser(text).then((ok) => {
      if (ok) {
        setCopiedStep(key);
        setTimeout(() => setCopiedStep(null), 1800);
      }
    });
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="PC yoki Android telefonni ulash"
      className={LIQUID_MODAL_BACKDROP}
    >
      <div className={`${LIQUID_MODAL_SHELL} max-w-2xl`}>
        {/* Header */}
        <div className="px-6 py-4 border-b border-white/15 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-full backdrop-blur-xl bg-white/[0.1] border border-white/25 shadow-[inset_1px_1px_1px_rgba(255,255,255,0.5)] flex items-center justify-center shrink-0">
              {deviceTab === 'android' ? (
                <Smartphone className="w-4 h-4 text-cyan-300" strokeWidth={1.75} />
              ) : (
                <Monitor className="w-4 h-4 text-white/95" strokeWidth={1.75} />
              )}
            </div>
            <div>
              <h2 className="text-base font-semibold text-white">Haqiqiy PC yoki Android (Termux) ulash</h2>
              <p className="text-xs text-white/65 mt-0.5">
                Kompyuter yoki Android telefoningizni Termux orqali jonli MCP va J.A.R.V.I.S. boshqaruviga ulang.
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
                    ? `Ulandi: ${status.hostname || 'Qurilma'} (${status.screenWidth}×${status.screenHeight})`
                    : 'Qurilma kutilmoqda (ulanmagan)'}
                </div>
                {status.connected && (
                  <div className="text-white/65 mt-0.5">
                    {status.osVersion || 'Device'} · {status.username || 'User'} · {status.fps} FPS
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
                    <span className="relative z-10">Ulangan qurilma ekranini ochish</span>
                  </button>
                )}
              </div>
            )}
          </div>

          {/* Device Type Switcher */}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setDeviceTab('pc')}
              className={`${LIQUID_PILL_BTN} ${
                deviceTab === 'pc'
                  ? 'bg-cyan-500/25 border-cyan-300/60 text-white'
                  : 'opacity-75 hover:opacity-100'
              }`}
            >
              <Monitor className="w-3.5 h-3.5 relative z-10" strokeWidth={1.75} />
              <span className="relative z-10">Kompyuter (PC)</span>
            </button>
            <button
              type="button"
              onClick={() => setDeviceTab('android')}
              className={`${LIQUID_PILL_BTN} ${
                deviceTab === 'android'
                  ? 'bg-cyan-500/25 border-cyan-300/60 text-white'
                  : 'opacity-75 hover:opacity-100'
              }`}
            >
              <Smartphone className="w-3.5 h-3.5 relative z-10" strokeWidth={1.75} />
              <span className="relative z-10">Android (Termux)</span>
            </button>
          </div>

          {deviceTab === 'android' ? (
            <>
              {/* Android Termux Main Card */}
              <div className={`${LIQUID_CARD} p-4 space-y-3.5`}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2 font-semibold text-white">
                    <Smartphone className="w-4 h-4 text-cyan-300" strokeWidth={1.75} />
                    <span>1-usul: Termux orqali Android telefonni ulash</span>
                  </div>
                  <a
                    href="/api/android-termux-agent.py"
                    download="android-termux-agent.py"
                    className={LIQUID_PILL_BTN}
                  >
                    <Download className="w-3.5 h-3.5 relative z-10" strokeWidth={1.75} />
                    <span className="relative z-10">android-termux-agent.py</span>
                  </a>
                </div>
                <p className="text-white/70 leading-relaxed">
                  Root talab qilinmaydi. Telefoningizdagi <span className="font-mono-tabular text-white/95">Termux</span> ilovasiga
                  quyidagi buyruqni qo‘ysangiz kifoya — <span className="font-mono-tabular text-cyan-200">bash</span>, fayllar va
                  brauzerda URL ochish darhol ishga tushadi, <span className="font-mono-tabular">termux-wake-lock</span> esa fon ulanishini ushlab turadi.
                </p>

                <div className="space-y-2">
                  <div className="flex items-center justify-between text-[11px] text-white/70">
                    <span>Termux da o‘rnatish va ishga tushirish (1 ta buyruq):</span>
                    <button
                      type="button"
                      onClick={() => copyText('termux', termuxCommand)}
                      className={`${LIQUID_PILL_BTN} px-3 py-1`}
                    >
                      {copiedStep === 'termux' ? (
                        <Check className="w-3 h-3 text-emerald-300 relative z-10" strokeWidth={2} />
                      ) : (
                        <Copy className="w-3 h-3 relative z-10" strokeWidth={1.75} />
                      )}
                      <span className="relative z-10">{copiedStep === 'termux' ? 'Nusxalandi' : 'Nusxalash'}</span>
                    </button>
                  </div>
                  <input
                    type="text"
                    readOnly
                    value={termuxCommand}
                    onClick={(e) => e.currentTarget.select()}
                    aria-label="Termux o'rnatish va ulash buyrug'i"
                    className={LIQUID_INPUT}
                  />
                </div>
              </div>

              {/* Android Live Screen + Touch via ADB / Root */}
              <div className={`${LIQUID_CARD} p-4 space-y-3`}>
                <div className="flex items-center gap-2 font-semibold text-white">
                  <Terminal className="w-4 h-4 text-emerald-300" strokeWidth={1.75} />
                  <span>2-usul: Jonli Android ekran + sensorli bosish (ixtiyoriy ADB / Root)</span>
                </div>
                <p className="text-white/70 leading-relaxed">
                  Agar telefoningiz ekranini jonli ko‘rish va ekranga bosib boshqarishni istasangiz:
                  Sozlamalar → Dasturchi parametrlari → <strong>Simsiz nosozliklarni tuzatish (Wireless debugging)</strong> ni yoqing,
                  u yerda ko‘rsatilgan IP-manzil va Portni yozing (masalan: <span className="font-mono-tabular text-cyan-200">adb connect 192.168.1.50:43821</span>).
                  Root qilingan telefonlarda esa <span className="font-mono-tabular">su</span> avtomatik aniqlanadi va ADB shart emas.
                </p>
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-[11px] text-white/70">
                    <span>ADB va Termux:API paketlarini qo‘shish:</span>
                    <button
                      type="button"
                      onClick={() => copyText('adb', termuxAdbCommand)}
                      className={`${LIQUID_PILL_BTN} px-3 py-1`}
                    >
                      {copiedStep === 'adb' ? (
                        <Check className="w-3 h-3 text-emerald-300 relative z-10" strokeWidth={2} />
                      ) : (
                        <Copy className="w-3 h-3 relative z-10" strokeWidth={1.75} />
                      )}
                      <span className="relative z-10">{copiedStep === 'adb' ? 'Nusxalandi' : 'Nusxalash'}</span>
                    </button>
                  </div>
                  <input
                    type="text"
                    readOnly
                    value={termuxAdbCommand}
                    onClick={(e) => e.currentTarget.select()}
                    aria-label="Termux ADB paketlari buyrug'i"
                    className={LIQUID_INPUT}
                  />
                </div>
              </div>
            </>
          ) : (
            <>
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

              {/* Option 2: Native Windows .exe Background Agent */}
              <div className={`${LIQUID_CARD} p-4 space-y-3.5`}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2 font-semibold text-white">
                    <Monitor className="w-4 h-4 text-cyan-300" strokeWidth={1.75} />
                    <span>2-usul: Fonda ishlovchi Windows .exe Agent (Python shart emas)</span>
                  </div>
                  <a
                    href="/api/real-pc-agent-builder.bat"
                    download="JarvisPcAgent-Setup.bat"
                    className={LIQUID_PILL_BTN}
                  >
                    <Download className="w-3.5 h-3.5 relative z-10" strokeWidth={1.75} />
                    <span className="relative z-10">JarvisPcAgent-Setup.bat</span>
                  </a>
                </div>
                <p className="text-white/70 leading-relaxed">
                  Windows ichidagi tayyor <span className="font-mono-tabular text-white/95">.NET csc.exe</span> orqali{' '}
                  <span className="font-mono-tabular text-cyan-200">%USERPROFILE%\JarvisAgent\JarvisPcAgent.exe</span>{' '}
                  faylini tuzib, konsol oynasisiz fonda ishga tushiradi va uzilsa avtomatik qayta ulanadi.
                </p>
                <div className="rounded-2xl bg-cyan-500/10 border border-cyan-300/25 px-3.5 py-2.5 text-cyan-100/90 leading-relaxed">
                  <strong>Win+L (Ekran qulflanganda):</strong> Agent fonda uzilmasdan ishlayveradi — terminal
                  (<span className="font-mono-tabular">run_powershell</span>, <span className="font-mono-tabular">run_bash</span>) va fayl buyruqlari
                  (<span className="font-mono-tabular">file_*</span>) bajariladi. Faqat Windows xavfsizlik qoidasi sababli qulf ochilmaguncha jonli ekran tasviri va sichqoncha/klaviatura bosishlari tizim tomonidan vaqtincha bloklanadi.
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between text-[11px] text-white/70">
                    <span>PowerShell orqali .exe yaratish va fonda yoqish:</span>
                    <button
                      type="button"
                      onClick={() => copyText('exe', exeBuildCommand)}
                      className={`${LIQUID_PILL_BTN} px-3 py-1`}
                    >
                      {copiedStep === 'exe' ? (
                        <Check className="w-3 h-3 text-emerald-300 relative z-10" strokeWidth={2} />
                      ) : (
                        <Copy className="w-3 h-3 relative z-10" strokeWidth={1.75} />
                      )}
                      <span className="relative z-10">{copiedStep === 'exe' ? 'Nusxalandi' : 'Nusxalash'}</span>
                    </button>
                  </div>
                  <input
                    type="text"
                    readOnly
                    value={exeBuildCommand}
                    onClick={(e) => e.currentTarget.select()}
                    aria-label="Windows exe agent yaratish buyrug'i"
                    className={LIQUID_INPUT}
                  />
                </div>
              </div>

              {/* Option 3: Python Agent */}
              <div className={`${LIQUID_CARD} p-4 space-y-3.5`}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2 font-semibold text-white">
                    <Terminal className="w-4 h-4 text-white/90" strokeWidth={1.75} />
                    <span>3-usul: Python Agent (Win+L himoyasi bilan)</span>
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
            </>
          )}
        </div>
      </div>
    </div>
  );
}
