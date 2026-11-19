import { useEffect, useState } from 'react';
import { Globe, Lock, RotateCw } from 'lucide-react';
import type { DesktopWindow } from '../../desktop/types.ts';

interface EdgeAppProps {
  win: DesktopWindow;
  interactive: boolean;
  onNavigate: (windowId: string, url: string) => void;
}

const BOOKMARKS = [
  { label: 'MCP Docs', url: 'https://modelcontextprotocol.io' },
  { label: 'Example.com', url: 'https://example.com' },
  { label: 'Local Guide', url: 'C:\\Users\\Claude\\Desktop\\MCP_Guide.md' },
];

export function EdgeApp({ win, interactive, onNavigate }: EdgeAppProps) {
  const edge = win.edge;
  const activeTab = edge?.tabs.find((t) => t.id === edge.activeTabId) || edge?.tabs[0];
  const [urlInput, setUrlInput] = useState(activeTab?.url || '');

  useEffect(() => {
    setUrlInput(activeTab?.url || '');
  }, [activeTab?.url]);

  if (!edge || !activeTab) return null;

  return (
    <div className="flex flex-col h-full bg-white text-slate-900 text-xs">
      {/* Tab strip */}
      <div className="flex items-center gap-1 px-2 pt-1.5 bg-slate-200 border-b border-slate-300">
        {edge.tabs.map((tab) => (
          <div
            key={tab.id}
            className="flex items-center gap-2 px-3 py-1.5 bg-white rounded-t border-t border-x border-slate-300 max-w-[220px]"
          >
            <Globe className="w-3.5 h-3.5 text-[#0078D4] shrink-0" />
            <span className="truncate font-medium text-slate-800">{tab.title}</span>
          </div>
        ))}
      </div>

      {/* Address bar */}
      <div className="flex items-center gap-2 px-2.5 py-1.5 bg-white border-b border-slate-200">
        <button
          type="button"
          disabled={!interactive}
          onClick={() => onNavigate(win.id, activeTab.url)}
          aria-label="Reload page"
          className="p-1.5 rounded hover:bg-slate-100 disabled:opacity-50"
        >
          <RotateCw className={`w-3.5 h-3.5 ${activeTab.loading ? 'animate-spin text-[#0078D4]' : ''}`} />
        </button>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (interactive && urlInput.trim()) onNavigate(win.id, urlInput.trim());
          }}
          className="flex-1 flex items-center gap-2 px-2.5 py-1 bg-slate-100 rounded border border-slate-200 focus-within:border-[#0078D4] focus-within:bg-white"
        >
          <Lock className="w-3 h-3 text-slate-500 shrink-0" />
          <input
            type="text"
            aria-label="Edge address bar"
            value={urlInput}
            onChange={(e) => setUrlInput(e.target.value)}
            readOnly={!interactive}
            className="flex-1 bg-transparent text-xs font-mono-tabular focus:outline-none"
          />
        </form>

        <div className="flex items-center gap-1">
          {BOOKMARKS.map((bm) => (
            <button
              key={bm.url}
              type="button"
              disabled={!interactive}
              onClick={() => onNavigate(win.id, bm.url)}
              className="px-2 py-1 rounded text-[11px] text-slate-600 hover:bg-slate-100 hover:text-slate-900 whitespace-nowrap"
            >
              {bm.label}
            </button>
          ))}
        </div>
      </div>

      {/* Page Body */}
      <div className="flex-1 overflow-y-auto win10-scroll p-5 bg-slate-50">
        <div className="max-w-2xl mx-auto bg-white border border-slate-200 p-5 space-y-4">
          <div className="border-b border-slate-200 pb-3">
            <h2 className="text-base font-semibold text-slate-900">{activeTab.title}</h2>
            <p className="text-[11px] text-slate-500 font-mono-tabular truncate mt-0.5">
              {activeTab.url}
            </p>
          </div>

          {activeTab.error ? (
            <div className="p-3 bg-red-50 border border-red-200 text-red-700 text-xs">
              {activeTab.error}
            </div>
          ) : (
            <div className="text-xs leading-relaxed text-slate-700 whitespace-pre-wrap">
              {activeTab.contentText}
            </div>
          )}

          {activeTab.links.length > 0 && (
            <div className="pt-3 border-t border-slate-200">
              <div className="text-[11px] font-semibold text-slate-500 mb-2">Extracted Links</div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                {activeTab.links.map((lnk, idx) => (
                  <button
                    key={`${lnk.href}-${idx}`}
                    type="button"
                    disabled={!interactive}
                    onClick={() => onNavigate(win.id, lnk.href)}
                    className="text-left px-2.5 py-1.5 rounded border border-slate-200 hover:border-[#0078D4] hover:bg-blue-50/40 truncate text-[#0078D4]"
                  >
                    {lnk.text}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
