import { useEffect, useState } from 'react';
import { Key, Save, X } from 'lucide-react';
import {
  LIQUID_CARD,
  LIQUID_ICON_BTN,
  LIQUID_INPUT,
  LIQUID_MODAL_BACKDROP,
  LIQUID_MODAL_SHELL,
  LIQUID_PILL_BTN,
} from './liquidGlass';
import { authFetch } from '../utils/siteAuthClient.ts';

interface SettingsModalProps {
  open: boolean;
  onClose: () => void;
}

export function SettingsModal({ open, onClose }: SettingsModalProps) {
  const [geminiText, setGeminiText] = useState('');
  const [groqText, setGroqText] = useState('');
  const [openRouterText, setOpenRouterText] = useState('');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setMessage(null);
      authFetch('/api/settings/keys')
        .then((res) => (res.ok ? res.json() : null))
        .then((data: { geminiKeys?: string[]; groqKeys?: string[]; openRouterKeys?: string[] } | null) => {
          if (!data) return;
          setGeminiText((data.geminiKeys || []).join('\n'));
          setGroqText((data.groqKeys || []).join('\n'));
          setOpenRouterText((data.openRouterKeys || []).join('\n'));
        })
        .catch(() => {});
    }
  }, [open]);

  if (!open) return null;

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setMessage(null);

    const parseKeys = (txt: string) =>
      txt
        .split(/[\n,;]+/)
        .map((k) => k.trim())
        .filter((k) => k.length >= 8 && !k.startsWith('MY_') && !k.startsWith('YOUR_'));

    try {
      const res = await authFetch('/api/settings/keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          geminiKeys: parseKeys(geminiText),
          groqKeys: parseKeys(groqText),
          openRouterKeys: parseKeys(openRouterText),
        }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || data.error) {
        throw new Error(data.error || 'Saqlashda xatolik yuz berdi');
      }
      setMessage('API kalitlari muvaffaqiyatli saqlandi va faollashtirildi!');
      setTimeout(() => {
        onClose();
      }, 1200);
    } catch (err) {
      setMessage((err as Error).message || 'Xatolik yuz berdi');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Sozlamalar va API Kalitlari"
      className={LIQUID_MODAL_BACKDROP}
    >
      <div className={`${LIQUID_MODAL_SHELL} max-w-xl max-h-[90vh] flex flex-col`}>
        {/* Header */}
        <div className="px-6 py-4 border-b border-white/15 flex items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-full backdrop-blur-xl bg-white/[0.1] border border-white/25 shadow-[inset_1px_1px_1px_rgba(255,255,255,0.5)] flex items-center justify-center shrink-0">
              <Key className="w-4 h-4 text-white/95" strokeWidth={1.75} />
            </div>
            <div>
              <h2 className="text-base font-semibold text-white">API Sozlamalari (.env)</h2>
              <p className="text-xs text-white/65 mt-0.5">
                Gemini, Groq va OpenRouter API kalitlarini kiriting (har bir qatorda yoki vergul bilan).
              </p>
            </div>
          </div>
          <button type="button" onClick={onClose} aria-label="Close settings" className={LIQUID_ICON_BTN}>
            <X className="w-4 h-4 relative z-10" strokeWidth={1.75} />
          </button>
        </div>

        {/* Body */}
        <form onSubmit={handleSave} className="flex-1 overflow-y-auto win10-scroll p-5 space-y-4 text-xs">
          {message && (
            <div
              className={`p-3 rounded-xl border text-xs ${
                message.includes('muvaffaqiyatli')
                  ? 'bg-emerald-500/20 border-emerald-300/40 text-emerald-100'
                  : 'bg-rose-500/20 border-rose-300/40 text-rose-100'
              }`}
            >
              {message}
            </div>
          )}

          {/* Gemini Keys */}
          <div className={`${LIQUID_CARD} p-4 space-y-2`}>
            <div className="font-semibold text-white flex items-center justify-between">
              <span>Gemini API Kalitlari (Asosiy)</span>
              <span className="text-[10px] text-white/50">10 tagacha qo‘llab-quvvatlanadi</span>
            </div>
            <p className="text-white/65 text-[11px]">
              AIza... bilan boshlanuvchi Gemini API kalitlari. Limit tugasa avtomatik navbatdagisiga o‘tadi.
            </p>
            <textarea
              rows={4}
              value={geminiText}
              onChange={(e) => setGeminiText(e.target.value)}
              placeholder="AIzaSy...&#10;AIzaSy..."
              className={`${LIQUID_INPUT} w-full font-mono text-[11px] resize-y`}
            />
          </div>

          {/* Groq Keys */}
          <div className={`${LIQUID_CARD} p-4 space-y-2`}>
            <div className="font-semibold text-white flex items-center justify-between">
              <span>Groq API Kalitlari (Zaxira 1)</span>
              <span className="text-[10px] text-white/50">Whisper STT & Chat</span>
            </div>
            <p className="text-white/65 text-[11px]">gsk_... bilan boshlanuvchi Groq API kalitlari.</p>
            <textarea
              rows={3}
              value={groqText}
              onChange={(e) => setGroqText(e.target.value)}
              placeholder="gsk_...&#10;gsk_..."
              className={`${LIQUID_INPUT} w-full font-mono text-[11px] resize-y`}
            />
          </div>

          {/* OpenRouter Keys */}
          <div className={`${LIQUID_CARD} p-4 space-y-2`}>
            <div className="font-semibold text-white flex items-center justify-between">
              <span>OpenRouter API Kalitlari (Zaxira 2)</span>
              <span className="text-[10px] text-white/50">Multimodal & Chat</span>
            </div>
            <p className="text-white/65 text-[11px]">sk-or-... bilan boshlanuvchi OpenRouter API kalitlari.</p>
            <textarea
              rows={3}
              value={openRouterText}
              onChange={(e) => setOpenRouterText(e.target.value)}
              placeholder="sk-or-...&#10;sk-or-..."
              className={`${LIQUID_INPUT} w-full font-mono text-[11px] resize-y`}
            />
          </div>

          {/* Footer Save Button */}
          <div className="flex items-center justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className={LIQUID_PILL_BTN}>
              <span className="relative z-10">Bekor qilish</span>
            </button>
            <button
              type="submit"
              disabled={saving}
              className={`${LIQUID_PILL_BTN} bg-cyan-500/30 border-cyan-300/60 hover:bg-cyan-500/40`}
            >
              <Save className="w-3.5 h-3.5 relative z-10" strokeWidth={1.75} />
              <span className="relative z-10">{saving ? 'Saqlanmoqda...' : 'Saqlash va faollashtirish'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
