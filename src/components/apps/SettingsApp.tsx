import { WALLPAPERS } from '../../desktop/engine.ts';
import type { DesktopState, DesktopWindow } from '../../desktop/types.ts';

interface SettingsAppProps {
  win: DesktopWindow;
  desktopState: DesktopState;
  interactive: boolean;
  onChangeSection: (windowId: string, section: 'system' | 'personalization' | 'mcp') => void;
  onChangeWallpaper: (wallpaperId: string) => void;
  onOpenMcpModal: () => void;
}

export function SettingsApp({
  win,
  desktopState,
  interactive,
  onChangeSection,
  onChangeWallpaper,
  onOpenMcpModal,
}: SettingsAppProps) {
  const section = win.settings?.section || 'system';

  return (
    <div className="flex h-full bg-white text-slate-900 text-xs">
      <aside className="w-44 bg-slate-100 border-r border-slate-200 p-2 space-y-1">
        <div className="px-2.5 py-2 text-sm font-semibold text-slate-800">Windows Settings</div>
        {(
          [
            { id: 'system', label: 'System & About' },
            { id: 'personalization', label: 'Personalization' },
            { id: 'mcp', label: 'Claude MCP Bridge' },
          ] as const
        ).map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => onChangeSection(win.id, item.id)}
            className={`w-full text-left px-2.5 py-2 rounded transition-colors ${
              section === item.id
                ? 'bg-[#0078D4] text-white font-medium'
                : 'text-slate-700 hover:bg-slate-200'
            }`}
          >
            {item.label}
          </button>
        ))}
      </aside>

      <div className="flex-1 p-5 overflow-y-auto win10-scroll space-y-4">
        {section === 'system' && (
          <div className="space-y-4">
            <h2 className="text-lg font-semibold text-slate-900">About Windows 10 Pro</h2>
            <div className="border border-slate-200 divide-y divide-slate-200">
              <div className="flex justify-between px-3 py-2">
                <span className="text-slate-500">Edition</span>
                <span className="font-medium">Windows 10 Pro</span>
              </div>
              <div className="flex justify-between px-3 py-2">
                <span className="text-slate-500">Version / OS Build</span>
                <span className="font-mono-tabular">22H2 · 19045.4651</span>
              </div>
              <div className="flex justify-between px-3 py-2">
                <span className="text-slate-500">Device name</span>
                <span className="font-mono-tabular">CLAUDEWIN10-PRO</span>
              </div>
              <div className="flex justify-between px-3 py-2">
                <span className="text-slate-500">Account</span>
                <span>Claude AI (Administrator)</span>
              </div>
              <div className="flex justify-between px-3 py-2">
                <span className="text-slate-500">Sandbox Drive</span>
                <span className="font-mono-tabular">C:\Users\Claude (Persistent)</span>
              </div>
            </div>
          </div>
        )}

        {section === 'personalization' && (
          <div className="space-y-4">
            <h2 className="text-lg font-semibold text-slate-900">Desktop Wallpaper</h2>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {WALLPAPERS.map((wp) => {
                const active = desktopState.wallpaperId === wp.id;
                return (
                  <button
                    key={wp.id}
                    type="button"
                    disabled={!interactive}
                    onClick={() => onChangeWallpaper(wp.id)}
                    className={`text-left border p-2 transition-colors ${
                      active ? 'border-[#0078D4] bg-blue-50' : 'border-slate-200 hover:border-slate-400'
                    }`}
                  >
                    <div
                      className="h-20 mb-2 overflow-hidden bg-slate-900"
                      style={{
                        background: wp.src
                          ? undefined
                          : `linear-gradient(135deg, #071426 0%, ${wp.accentHex} 100%)`,
                      }}
                    >
                      {wp.src && (
                        <img
                          src={wp.src}
                          alt={wp.name}
                          referrerPolicy="no-referrer"
                          className="w-full h-full object-cover"
                        />
                      )}
                    </div>
                    <div className="font-medium text-slate-800">{wp.name}</div>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {section === 'mcp' && (
          <div className="space-y-4">
            <h2 className="text-lg font-semibold text-slate-900">Claude AI MCP Connection</h2>
            <p className="text-slate-600 leading-relaxed">
              This Windows 10 Pro desktop exposes a live Model Context Protocol (MCP) server at{' '}
              <code className="font-mono-tabular bg-slate-100 px-1 py-0.5">/mcp</code> and{' '}
              <code className="font-mono-tabular bg-slate-100 px-1 py-0.5">/sse</code>. Every
              action Claude AI executes is broadcast immediately to all watching browsers.
            </p>
            <button
              type="button"
              onClick={onOpenMcpModal}
              className="px-4 py-2 bg-[#0078D4] text-white font-medium hover:bg-[#0063B1]"
            >
              Open MCP Connection Setup
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
