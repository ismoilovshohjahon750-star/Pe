import { useEffect, useRef, useState } from 'react';
import type { DesktopWindow } from '../../desktop/types.ts';

interface PowerShellAppProps {
  win: DesktopWindow;
  interactive: boolean;
  onRunCommand: (windowId: string, command: string) => void;
}

export function PowerShellApp({ win, interactive, onRunCommand }: PowerShellAppProps) {
  const ps = win.powershell;
  const [input, setInput] = useState('');
  const [history, setHistory] = useState<string[]>([]);
  const [histIdx, setHistIdx] = useState(-1);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = scrollContainerRef.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
    }
  }, [ps?.lines.length]);

  if (!ps) return null;

  const submitCommand = (e: React.FormEvent) => {
    e.preventDefault();
    if (!interactive) return;
    const trimmed = input.trim();
    if (!trimmed) return;
    setHistory((prev) => [trimmed, ...prev].slice(0, 30));
    setHistIdx(-1);
    setInput('');
    onRunCommand(win.id, trimmed);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowUp' && history.length > 0) {
      e.preventDefault();
      const next = Math.min(history.length - 1, histIdx + 1);
      setHistIdx(next);
      setInput(history[next] || '');
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (histIdx <= 0) {
        setHistIdx(-1);
        setInput('');
      } else {
        const next = histIdx - 1;
        setHistIdx(next);
        setInput(history[next] || '');
      }
    }
  };

  return (
    <div
      ref={scrollContainerRef}
      className="flex flex-col h-full bg-[#012456] text-slate-100 font-mono-tabular text-[12px] leading-relaxed p-3 overflow-y-auto win10-scroll"
    >
      <div className="space-y-0.5 flex-1">
        {ps.lines.map((line) => (
          <pre
            key={line.id}
            className={`whitespace-pre-wrap break-words font-mono-tabular ${
              line.kind === 'stderr'
                ? 'text-red-300'
                : line.kind === 'prompt'
                  ? 'text-amber-300 font-medium'
                  : line.kind === 'info'
                    ? 'text-sky-200'
                    : 'text-slate-100'
            }`}
          >
            {line.text}
          </pre>
        ))}

        <form onSubmit={submitCommand} className="flex items-center gap-1.5 pt-1">
          <span className="text-amber-300 shrink-0">PS {ps.cwd}&gt;</span>
          <input
            type="text"
            aria-label="PowerShell command input"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={!interactive || ps.running}
            placeholder={interactive ? 'Type dir, systeminfo, node hello.js...' : 'Observer mode'}
            className="flex-1 bg-transparent text-white focus:outline-none placeholder:text-sky-300/40"
          />
        </form>
      </div>
    </div>
  );
}
