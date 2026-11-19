import { Play, Terminal } from 'lucide-react';
import type { McpActivityEntry } from '../desktop/types.ts';

interface McpActivityPanelProps {
  activities: McpActivityEntry[];
  wsConnected: boolean;
  viewerCount: number;
  runningDemo: boolean;
  onRunDemo: () => void;
  onOpenConnectModal: () => void;
}

export function McpActivityPanel({
  activities,
  wsConnected,
  viewerCount,
  runningDemo,
  onRunDemo,
  onOpenConnectModal,
}: McpActivityPanelProps) {
  return (
    <aside className="w-full lg:w-[330px] shrink-0 bg-[#0F172A] border-t lg:border-t-0 lg:border-l border-slate-800 flex flex-col h-[280px] lg:h-full">
      <div className="px-4 py-3 border-b border-slate-800 flex items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold text-white">MCP Jonli Jurnali</h2>
          <div className="flex items-center gap-1.5 text-[11px] text-slate-400 mt-0.5 whitespace-nowrap">
            <span className="flex items-center gap-1.5">
              {wsConnected ? (
                <span className="w-2 h-2 rounded-full bg-emerald-500 shrink-0" aria-hidden="true" />
              ) : (
                <span className="w-2 h-2 rounded-full bg-amber-500 shrink-0" aria-hidden="true" />
              )}
              <span>{wsConnected ? 'Jonli' : 'Ulanmoqda'}</span>
            </span>
            <span aria-hidden="true">·</span>
            <span className="font-mono-tabular">{viewerCount} kuzatuvchi</span>
          </div>
        </div>

        <button
          type="button"
          onClick={onRunDemo}
          disabled={runningDemo}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-[#0078D4] text-white hover:bg-[#0063B1] disabled:opacity-50 transition-colors whitespace-nowrap shrink-0"
        >
          <Play className="w-3.5 h-3.5" />
          <span>{runningDemo ? 'Ishlamoqda...' : 'MCP Test'}</span>
        </button>
      </div>

      <div className="flex-1 overflow-y-auto win10-scroll divide-y divide-slate-800/80">
        {activities.length === 0 ? (
          <div className="p-6 text-center text-xs text-slate-400 space-y-3">
            <Terminal className="w-6 h-6 mx-auto text-slate-500" />
            <p>Claude AI MCP orqali buyruq yuborganida bu yerda real vaqtda koʻrinadi.</p>
            <button
              type="button"
              onClick={onOpenConnectModal}
              className="px-3 py-1.5 bg-slate-800 text-slate-200 hover:bg-slate-700 text-xs font-medium"
            >
              Claude AI ga ulash
            </button>
          </div>
        ) : (
          activities.map((entry) => (
            <div key={entry.id} className="px-4 py-2.5 text-xs space-y-1 hover:bg-slate-900/60">
              <div className="flex items-center justify-between gap-2">
                <span className="font-mono-tabular font-semibold text-sky-400 truncate">
                  {entry.tool}
                </span>
                <span className="text-[11px] font-mono-tabular text-slate-500 shrink-0">
                  {entry.timestamp.slice(11, 19)} · {entry.durationMs}ms
                </span>
              </div>
              <div className="text-[11px] font-mono-tabular text-slate-400 truncate">
                {entry.argsSummary}
              </div>
              <div
                className={`text-[11px] ${
                  entry.status === 'error' ? 'text-red-400' : 'text-slate-300'
                }`}
              >
                {entry.resultSummary}
              </div>
            </div>
          ))
        )}
      </div>
    </aside>
  );
}
