import { useEffect, useState } from 'react';
import { Check, Copy, Download, Monitor, MonitorUp, Smartphone, Square, Terminal, X } from 'lucide-react';
import type { ExecutionTarget, RealAgentStatus } from '../desktop/bridge.ts';
import { copyTextCrossBrowser } from '../utils/clipboard.ts';
import { authFetch } from '../utils/siteAuthClient.ts';
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
  initialTab?: 'pc' | 'android';
  activeDeviceId?: string | null;
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
  initialTab,
  activeDeviceId,
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
  const [deviceTab, setDeviceTab] = useState<'pc' | 'android'>(initialTab || 'pc');
  const [streamUrl, setStreamUrl] = useState('http://10.180.218.4:8080/');
  const [streamPin, setStreamPin] = useState('');
  const [streamBusy, setStreamBusy] = useState(false);
  const [streamFeedback, setStreamFeedback] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    if (open && initialTab) {
      setDeviceTab(initialTab);
    }
  }, [open, initialTab]);

  if (!open) return null;

  const canBrowserShare =
    typeof navigator !== 'undefined' && Boolean(navigator.mediaDevices?.getDisplayMedia);
  const safeStreamUrl = (streamUrl.trim() || 'http://10.180.218.4:8080/').replace(/["\\$`]/g, '');
  const cleanStreamPin = streamPin.trim().replace(/["\\$`]/g, '');
  const origin = typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3000';
  const exeBuildCommand = `cd $HOME; curl.exe -sL "${origin}/api/real-pc-agent-builder.bat" -o JarvisPcAgent-Setup.bat; .\\JarvisPcAgent-Setup.bat`;
  const pipCommand = 'pip install mss pillow pyautogui websockets';
  const pyRunCommand = `cd $HOME; python -c "import urllib.request,runpy; urllib.request.urlretrieve('${origin}/api/real-pc-agent.py','real-pc-agent.py'); runpy.run_path('real-pc-agent.py',run_name='__main__')"`;
  const ensureTermuxAgent = `((command -v python >/dev/null 2>&1 && command -v curl >/dev/null 2>&1) || (pkg update -y && pkg install -y python curl)) && (python -c "import websockets" 2>/dev/null || pip install -q websockets) && curl -fsSL "${origin}/api/android-termux-agent.py" -o "$HOME/android-termux-agent.py"`;
  const termuxCommand = `${ensureTermuxAgent} && python "$HOME/android-termux-agent.py"`;
  const streamLaunchCommand = cleanStreamPin
    ? `${ensureTermuxAgent} && SCREEN_STREAM_PIN="${cleanStreamPin}" python "$HOME/android-termux-agent.py" "${safeStreamUrl}"`
    : `${ensureTermuxAgent} && python "$HOME/android-termux-agent.py" "${safeStreamUrl}"`;

  const applyStreamUrl = async () => {
    const trimmed = streamUrl.trim();
    if (!trimmed) {
      setStreamFeedback({ ok: false, text: 'Iltimos, Screen Stream URL manzilini kiriting.' });
      return;
    }
    setStreamBusy(true);
    setStreamFeedback(null);
    try {
      const resp = await authFetch('/api/real-win10/stream-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: trimmed,
          ...(cleanStreamPin ? { pin: cleanStreamPin } : {}),
          ...(activeDeviceId ? { deviceId: activeDeviceId } : {}),
        }),
      });
      const data = (await resp.json()) as { ok?: boolean; error?: string };
      if (!resp.ok || !data.ok) {
        setStreamFeedback({
          ok: false,
          text:
            data.error ||
            'Termux agenti hozircha ulanmagan. Pastdagi buyruqni Termux ichida ishga tushiring.',
        });
      } else {
        setStreamFeedback({
          ok: true,
          text: `Oqim manzili (${trimmed}) Termux agentiga jonli yuborildi!`,
        });
      }
    } catch {
      setStreamFeedback({
        ok: false,
        text: 'Server bilan bog‘lanib bo‘lmadi. Pastdagi buyruqni Termux ichida ishga tushiring.',
      });
    } finally {
      setStreamBusy(false);
    }
  };

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
              {/* Android No-ADB Browser Screen Share Card */}
              <div className={`${LIQUID_CARD} p-4 space-y-3.5 border-emerald-500/30 bg-emerald-950/20`}>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2 font-semibold text-emerald-300">
                      <MonitorUp className="w-4 h-4 text-emerald-400" strokeWidth={1.75} />
                      <span>1-usul: Telefonda Brauzer orqali Ekran Ulashish (100% ADB siz, No-Cable)</span>
                    </div>
                    <p className="text-white/80 mt-1 leading-relaxed">
                      Android 10+ telefoningizda Chrome orqali hech qanday simsiz yoki simli ADB kerak emas! Ekranni to‘g‘ridan-to‘g‘ri brauzer orqali uzatish:
                    </p>
                  </div>
                  {browserSharing ? (
                    <button
                      type="button"
                      onClick={onStopBrowserShare}
                      className={`${LIQUID_PILL_BTN} bg-rose-500/25 border-rose-300/50 hover:bg-rose-500/35 text-rose-200 animate-pulse`}
                    >
                      <Square className="w-3.5 h-3.5 relative z-10" strokeWidth={1.75} />
                      <span className="relative z-10">Translatsiyani to‘xtatish</span>
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={onStartBrowserShare}
                      className={`${LIQUID_PILL_BTN} bg-emerald-500/25 border-emerald-300/60 hover:bg-emerald-500/35 text-white`}
                    >
                      <MonitorUp className="w-3.5 h-3.5 relative z-10" strokeWidth={1.75} />
                      <span className="relative z-10 font-medium">📲 Telefonda Ekranni Ulashish</span>
                    </button>
                  )}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 pt-1 text-[11px]">
                  <div className="rounded-xl p-2.5 bg-white/[0.04] border border-white/10 space-y-1">
                    <div className="font-semibold text-emerald-300">1-qadam: Saytni oching</div>
                    <div className="text-white/70">Telefondagi Chrome brauzerida ushbu saytni oching.</div>
                  </div>
                  <div className="rounded-xl p-2.5 bg-white/[0.04] border border-white/10 space-y-1">
                    <div className="font-semibold text-emerald-300">2-qadam: Ruxsat bering</div>
                    <div className="text-white/70">"📲 Telefonda Ekranni Ulashish" tugmasini bosib Android so‘roviga "Boshlash" deb bosing.</div>
                  </div>
                  <div className="rounded-xl p-2.5 bg-white/[0.04] border border-white/10 space-y-1">
                    <div className="font-semibold text-emerald-300">3-qadam: Termux'ga o‘ting</div>
                    <div className="text-white/70">Brauzerni fonda qoldirib, Termux'da quyidagi agent buyrug‘ini bering.</div>
                  </div>
                </div>

                {!canBrowserShare && (
                  <div className="text-amber-200 rounded-2xl bg-amber-500/15 border border-amber-300/30 px-3.5 py-2 leading-relaxed">
                    <strong>Eslatma:</strong> Ushbu mobil brauzerda tizim ekran yozish API (
                    <span className="font-mono-tabular">getDisplayMedia</span>) cheklangan. Telefon ekranini uzatish uchun pastdagi{' '}
                    <strong>4-usul (Screen Stream over HTTP)</strong> yoki <strong>3-usul (Simsiz ADB)</strong> dan foydalaning.
                  </div>
                )}

                {shareError && (
                  <div className="text-rose-200 rounded-2xl bg-rose-500/15 border border-rose-300/30 px-3.5 py-2">
                    {shareError}
                  </div>
                )}
              </div>

              {/* Android Termux Main Card */}
              <div className={`${LIQUID_CARD} p-4 space-y-3.5`}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2 font-semibold text-white">
                    <Smartphone className="w-4 h-4 text-cyan-300" strokeWidth={1.75} />
                    <span>2-usul: Termux Agent (Bash + Fayllar + Termux:API Boshqaruv)</span>
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
                  interaktiv boshqaruv ekrani ishga tushadi, <span className="font-mono-tabular">termux-wake-lock</span> esa fon ulanishini ushlab turadi.
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

              {/* Android Live Screen + Touch via Termux 2nd Session Wireless ADB */}
              <div className={`${LIQUID_CARD} p-4 space-y-3.5`}>
                <div className="flex items-center gap-2 font-semibold text-white">
                  <Terminal className="w-4 h-4 text-amber-300" strokeWidth={1.75} />
                  <span>3-usul: Termux 2-sessiya orqali Kompyutersiz ADB (Android 11+)</span>
                </div>
                <p className="text-white/70 leading-relaxed">
                  <strong>Kompyuter kerak emas!</strong> Android 11, 12, 13, 14, 15 da telefonning o‘zida Termux o‘ziga-o‘zi ADB ulana oladi:
                  <br />
                  1. Sozlamalar → Dasturchi parametrlari → <strong>Simsiz nosozliklarni tuzatish</strong> (Wireless debugging) ga kiring → "Qurilmani ulash kodi bilan ulash" (Pair with pairing code) ni bosing.
                  <br />
                  2. <strong>Termux 2-sessiyasida</strong> (chapdan surib "New session" ochib) quyidagi buyruqni bering:
                </p>
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-[11px] text-white/70">
                    <span>Termux 2-sessiyasida lokal ulash buyrug‘i:</span>
                    <button
                      type="button"
                      onClick={() => copyText('adb-pair', 'pkg install -y android-tools && adb pair 127.0.0.1:<PAIR_PORT> <KOD> && adb connect 127.0.0.1:<CONNECT_PORT>')}
                      className={`${LIQUID_PILL_BTN} px-3 py-1`}
                    >
                      {copiedStep === 'adb-pair' ? (
                        <Check className="w-3 h-3 text-emerald-300 relative z-10" strokeWidth={2} />
                      ) : (
                        <Copy className="w-3 h-3 relative z-10" strokeWidth={1.75} />
                      )}
                      <span className="relative z-10">{copiedStep === 'adb-pair' ? 'Nusxalandi' : 'Nusxalash'}</span>
                    </button>
                  </div>
                  <input
                    type="text"
                    readOnly
                    value="pkg install -y android-tools && adb pair 127.0.0.1:<PAIR_PORT> <KOD> && adb connect 127.0.0.1:<CONNECT_PORT>"
                    onClick={(e) => e.currentTarget.select()}
                    aria-label="Termux 2-sessiya ADB pair va connect buyrug'i"
                    className={LIQUID_INPUT}
                  />
                </div>
                <p className="text-[11px] text-amber-200/90">
                  Ulangach, 1-sessiyadagi <span className="font-mono-tabular">android-termux-agent.py</span> avtomatik to‘liq jonli ekran va sensorli bosishlarga (touch) o‘tadi!
                </p>
              </div>

              {/* Android Local HTTP Screen Stream (No-ADB) */}
              <div className={`${LIQUID_CARD} p-4 space-y-3.5 border-cyan-400/30 bg-cyan-950/15`}>
                <div className="flex items-center gap-2 font-semibold text-white">
                  <Monitor className="w-4 h-4 text-cyan-300" strokeWidth={1.75} />
                  <span>4-usul: "Screen Stream over HTTP" ilovasi (100% ADB siz, No-Root)</span>
                </div>
                <p className="text-white/70 leading-relaxed">
                  Play Market yoki F-Droid dan <strong>"Screen Stream over HTTP"</strong> ilovasini o‘rnatib <em>"Start"</em> tugmasini bosing.
                  Ilova bergan manzilni (masalan, <span className="font-mono-tabular text-cyan-200">http://10.180.218.4:8080/</span>) kiriting — Termux agenti ham lokal{' '}
                  <span className="font-mono-tabular text-cyan-200">127.0.0.1:8080</span> va Wi-Fi IP larni avtomatik topadi:
                </p>

                <div className="grid grid-cols-1 sm:grid-cols-[1fr_140px_auto] gap-2 items-center">
                  <input
                    type="url"
                    value={streamUrl}
                    onChange={(e) => setStreamUrl(e.target.value)}
                    placeholder="http://10.180.218.4:8080/"
                    aria-label="Screen Stream over HTTP manzili"
                    className={LIQUID_INPUT}
                  />
                  <input
                    type="text"
                    value={streamPin}
                    onChange={(e) => setStreamPin(e.target.value)}
                    placeholder="PIN (ixtiyoriy)"
                    aria-label="Screen Stream PIN kodi"
                    className={LIQUID_INPUT}
                  />
                  <button
                    type="button"
                    disabled={streamBusy}
                    onClick={() => void applyStreamUrl()}
                    className={`${LIQUID_PILL_BTN} bg-cyan-500/25 border-cyan-300/60 hover:bg-cyan-500/35 text-white justify-center`}
                  >
                    <span className="relative z-10">{streamBusy ? 'Ulanmoqda...' : 'Oqimni Ulash'}</span>
                  </button>
                </div>

                {streamFeedback && (
                  <div
                    className={`rounded-2xl px-3.5 py-2 border ${
                      streamFeedback.ok
                        ? 'bg-emerald-500/15 border-emerald-300/35 text-emerald-200'
                        : 'bg-amber-500/15 border-amber-300/35 text-amber-100'
                    }`}
                  >
                    {streamFeedback.text}
                  </div>
                )}

                <div className="space-y-2">
                  <div className="flex items-center justify-between text-[11px] text-white/70">
                    <span>Termux'da oqim manzili bilan ishga tushirish:</span>
                    <button
                      type="button"
                      onClick={() => copyText('screen-stream', streamLaunchCommand)}
                      className={`${LIQUID_PILL_BTN} px-3 py-1`}
                    >
                      {copiedStep === 'screen-stream' ? (
                        <Check className="w-3 h-3 text-emerald-300 relative z-10" strokeWidth={2} />
                      ) : (
                        <Copy className="w-3 h-3 relative z-10" strokeWidth={1.75} />
                      )}
                      <span className="relative z-10">{copiedStep === 'screen-stream' ? 'Nusxalandi' : 'Nusxalash'}</span>
                    </button>
                  </div>
                  <input
                    type="text"
                    readOnly
                    value={streamLaunchCommand}
                    onClick={(e) => e.currentTarget.select()}
                    aria-label="Screen Stream manzilini Termux agentiga berish buyrug'i"
                    className={LIQUID_INPUT}
                  />
                </div>
                <p className="text-[11px] text-cyan-200/80">
                  Agar Termux agenti ishlab turgan bo‘lsa, yuqoridagi "Oqimni Ulash" tugmasi qayta ishga tushirmasdan manzilni jonli yangilaydi.
                </p>
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
