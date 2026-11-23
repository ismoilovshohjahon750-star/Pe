import { useEffect, useRef, useState } from 'react';
import { AlertCircle, Delete, Eye, EyeOff, Lock, ShieldCheck } from 'lucide-react';

interface LockScreenProps {
  onUnlocked: (token: string) => void;
}

const KEYPAD_DIGITS = ['1', '2', '3', '4', '5', '6', '7', '8', '9'] as const;

export function LockScreen({ onUnlocked }: LockScreenProps) {
  const [pin, setPin] = useState('');
  const [showPin, setShowPin] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const submitPin = async (candidate: string) => {
    const clean = candidate.trim();
    if (!clean) {
      setError('Iltimos, parolni kiriting.');
      inputRef.current?.focus();
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch('/api/auth/unlock', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin: clean }),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        token?: string;
        error?: string;
      };
      if (!res.ok || !data.ok || !data.token) {
        setError(data.error || 'Parol noto‘g‘ri. Qaytadan urinib ko‘ring.');
        setPin('');
        inputRef.current?.focus();
        return;
      }
      onUnlocked(data.token);
    } catch {
      setError('Server bilan bog‘lanib bo‘lmadi. Qayta urinib ko‘ring.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleFormSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!submitting) {
      void submitPin(pin);
    }
  };

  const handleDigitClick = (digit: string) => {
    if (submitting) return;
    setError(null);
    setPin((prev) => {
      if (prev.length >= 16) return prev;
      return prev + digit;
    });
    inputRef.current?.focus();
  };

  const handleBackspace = () => {
    if (submitting) return;
    setError(null);
    setPin((prev) => prev.slice(0, -1));
    inputRef.current?.focus();
  };

  const handleClear = () => {
    if (submitting) return;
    setError(null);
    setPin('');
    inputRef.current?.focus();
  };

  return (
    <div
      data-testid="site-lock-screen"
      className="min-h-screen min-h-[100dvh] w-full bg-[#03060C] text-slate-100 flex items-center justify-center p-4 sm:p-6"
      style={{
        backgroundImage:
          'linear-gradient(to right, rgba(148, 163, 184, 0.04) 1px, transparent 1px), linear-gradient(to bottom, rgba(148, 163, 184, 0.04) 1px, transparent 1px)',
        backgroundSize: '36px 36px',
      }}
    >
      <main className="w-full max-w-md bg-[#090F1C] border border-slate-800 rounded-2xl p-6 sm:p-8 shadow-2xl">
        <div className="flex items-center gap-3.5 mb-6">
          <div className="w-11 h-11 rounded-xl bg-[#0078D4]/15 border border-[#0078D4]/35 flex items-center justify-center shrink-0">
            <Lock className="w-5 h-5 text-[#38BDF8]" strokeWidth={1.85} />
          </div>
          <div className="min-w-0">
            <h1 className="text-xl font-semibold tracking-tight text-slate-50">
              Tizimga kirish
            </h1>
            <p className="text-xs text-slate-400 mt-0.5">
              ShohOS · J.A.R.V.I.S. boshqaruv paneli
            </p>
          </div>
        </div>

        <p className="text-sm text-slate-300 leading-relaxed mb-5">
          Ish stoli va ulangan qurilmalarga kirish uchun himoya parolini kiriting.
        </p>

        <form onSubmit={handleFormSubmit} className="space-y-4">
          <div>
            <label
              htmlFor="site-pin-input"
              className="block text-xs font-medium text-slate-300 mb-2"
            >
              Kirish paroli
            </label>
            <div className="relative flex items-center">
              <input
                ref={inputRef}
                id="site-pin-input"
                type={showPin ? 'text' : 'password'}
                inputMode="numeric"
                autoComplete="current-password"
                value={pin}
                onChange={(e) => {
                  setError(null);
                  setPin(e.target.value);
                }}
                placeholder="Parolni kiriting"
                disabled={submitting}
                className="w-full h-12 rounded-xl bg-[#040812] border border-slate-700/90 focus:border-[#0078D4] focus:outline-none focus:ring-2 focus:ring-[#0078D4]/30 px-4 pr-12 text-base font-mono-tabular tracking-[0.25em] text-slate-100 placeholder:tracking-normal placeholder:font-sans placeholder:text-slate-500 transition-colors"
              />
              <button
                type="button"
                onClick={() => setShowPin((prev) => !prev)}
                aria-label={showPin ? 'Parolni yashirish' : 'Parolni ko‘rsatish'}
                className="absolute right-1.5 w-10 h-10 rounded-lg flex items-center justify-center text-slate-400 hover:text-slate-100 hover:bg-slate-800/70 transition-colors"
              >
                {showPin ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          {/* 4-step visual entry indicator */}
          <div className="flex items-center justify-center gap-3 py-1" aria-hidden="true">
            {[0, 1, 2, 3].map((slot) => {
              const filled = pin.length > slot;
              return (
                <span
                  key={slot}
                  className={`h-2.5 w-8 rounded-full transition-colors duration-150 ${
                    error
                      ? 'bg-rose-500/75'
                      : filled
                        ? 'bg-[#0078D4]'
                        : 'bg-slate-800 border border-slate-700'
                  }`}
                />
              );
            })}
          </div>

          {error && (
            <div
              role="alert"
              className="flex items-start gap-2.5 rounded-xl bg-rose-950/70 border border-rose-500/40 px-3.5 py-2.5 text-xs text-rose-200"
            >
              <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {/* Numeric keypad for quick touch or mouse entry */}
          <div className="grid grid-cols-3 gap-2 pt-1">
            {KEYPAD_DIGITS.map((digit) => (
              <button
                key={digit}
                type="button"
                disabled={submitting}
                onClick={() => handleDigitClick(digit)}
                className="h-12 rounded-xl bg-[#0F172A] hover:bg-[#1E293B] active:bg-slate-700 border border-slate-800 text-base font-medium font-mono-tabular text-slate-100 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0078D4]"
              >
                {digit}
              </button>
            ))}
            <button
              type="button"
              disabled={submitting}
              onClick={handleClear}
              className="h-12 rounded-xl bg-[#0B1221] hover:bg-[#162036] border border-slate-800 text-xs font-medium text-slate-300 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0078D4]"
            >
              Tozalash
            </button>
            <button
              type="button"
              disabled={submitting}
              onClick={() => handleDigitClick('0')}
              className="h-12 rounded-xl bg-[#0F172A] hover:bg-[#1E293B] active:bg-slate-700 border border-slate-800 text-base font-medium font-mono-tabular text-slate-100 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0078D4]"
            >
              0
            </button>
            <button
              type="button"
              disabled={submitting}
              onClick={handleBackspace}
              aria-label="Oxirgi raqamni o‘chirish"
              className="h-12 rounded-xl bg-[#0B1221] hover:bg-[#162036] border border-slate-800 flex items-center justify-center text-slate-300 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0078D4]"
            >
              <Delete className="w-4 h-4" />
            </button>
          </div>

          <button
            type="submit"
            disabled={submitting}
            className="w-full h-12 rounded-xl bg-[#0078D4] hover:bg-[#1084DD] active:bg-[#006CBE] disabled:opacity-60 text-white text-sm font-semibold flex items-center justify-center gap-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#38BDF8]"
          >
            <ShieldCheck className="w-4 h-4" />
            <span>{submitting ? 'Tekshirilmoqda...' : 'Kirish'}</span>
          </button>
        </form>
      </main>
    </div>
  );
}
