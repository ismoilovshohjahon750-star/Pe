import type { DesktopWindow } from '../../desktop/types.ts';

interface CalculatorAppProps {
  win: DesktopWindow;
  interactive: boolean;
  onUpdate: (windowId: string, display: string, expression: string) => void;
}

const KEYS = [
  ['C', 'CE', '⌫', '/'],
  ['7', '8', '9', '*'],
  ['4', '5', '6', '-'],
  ['1', '2', '3', '+'],
  ['+/-', '0', '.', '='],
];

export function CalculatorApp({ win, interactive, onUpdate }: CalculatorAppProps) {
  const calc = win.calculator || { display: '0', expression: '' };

  const handlePress = (key: string) => {
    if (!interactive) return;
    if (key === 'C') {
      onUpdate(win.id, '0', '');
      return;
    }
    if (key === 'CE') {
      onUpdate(win.id, '0', calc.expression);
      return;
    }
    if (key === '⌫') {
      const next = calc.display.length > 1 ? calc.display.slice(0, -1) : '0';
      onUpdate(win.id, next, calc.expression);
      return;
    }
    if (key === '+/-') {
      if (calc.display === '0') return;
      onUpdate(
        win.id,
        calc.display.startsWith('-') ? calc.display.slice(1) : `-${calc.display}`,
        calc.expression,
      );
      return;
    }
    if (['+', '-', '*', '/'].includes(key)) {
      onUpdate(win.id, '0', `${calc.expression}${calc.display} ${key} `);
      return;
    }
    if (key === '=') {
      try {
        const expr = `${calc.expression}${calc.display}`.replace(/[^0-9+\-*/.() ]/g, '');
        const fn = new Function(`return (${expr})`) as () => unknown;
        const result = Number(fn());
        const formatted = Number.isFinite(result) ? String(Number(result.toFixed(8))) : 'Error';
        onUpdate(win.id, formatted, '');
      } catch {
        onUpdate(win.id, 'Error', '');
      }
      return;
    }
    if (key === '.') {
      if (calc.display.includes('.')) return;
      onUpdate(win.id, `${calc.display}.`, calc.expression);
      return;
    }
    const next = calc.display === '0' || calc.display === 'Error' ? key : `${calc.display}${key}`;
    onUpdate(win.id, next, calc.expression);
  };

  return (
    <div className="flex flex-col h-full bg-[#F3F3F3] text-slate-900 p-2 select-none">
      <div className="px-2 py-3 text-right">
        <div className="text-[11px] text-slate-500 font-mono-tabular h-4 truncate">
          {calc.expression}
        </div>
        <div className="text-3xl font-semibold font-mono-tabular truncate">{calc.display}</div>
      </div>

      <div className="grid grid-rows-5 gap-1 flex-1">
        {KEYS.map((row, rIdx) => (
          <div key={rIdx} className="grid grid-cols-4 gap-1">
            {row.map((k) => {
              const isEq = k === '=';
              return (
                <button
                  key={k}
                  type="button"
                  onClick={() => handlePress(k)}
                  className={`rounded-sm text-sm font-medium transition-colors ${
                    isEq
                      ? 'bg-[#0078D4] text-white hover:bg-[#0063B1]'
                      : 'bg-white border border-slate-200 hover:bg-slate-100'
                  }`}
                >
                  {k}
                </button>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
