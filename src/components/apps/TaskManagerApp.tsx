import type { DesktopState, DesktopWindow } from '../../desktop/types.ts';

interface TaskManagerAppProps {
  win: DesktopWindow;
  desktopState: DesktopState;
  onCloseTargetWindow: (windowId: string) => void;
}

export function TaskManagerApp({ desktopState, onCloseTargetWindow }: TaskManagerAppProps) {
  const processes = [
    { name: 'Windows Explorer (explorer.exe)', pid: 1824, cpu: '1.2%', mem: '94.2 MB', windowId: null },
    { name: 'MCP Bridge Service (mcp-server)', pid: 2410, cpu: '0.8%', mem: '68.5 MB', windowId: null },
    ...desktopState.windows.map((w, idx) => ({
      name: `${w.title} (${w.appId}.exe)`,
      pid: 3100 + idx * 112,
      cpu: w.focused ? '2.4%' : '0.3%',
      mem: `${42 + idx * 14}.8 MB`,
      windowId: w.id,
    })),
  ];

  return (
    <div className="flex flex-col h-full bg-white text-slate-900 text-xs">
      <div className="px-3 py-2 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
        <span className="font-semibold text-slate-800">Processes ({processes.length})</span>
        <span className="text-slate-500 font-mono-tabular">
          Active Viewers: {desktopState.viewerCount} · MCP Sessions: {desktopState.mcpSessionCount}
        </span>
      </div>

      <div className="flex-1 overflow-y-auto win10-scroll">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50/70 text-[11px] text-slate-500">
              <th className="py-1.5 px-3 font-medium">Name</th>
              <th className="py-1.5 px-3 font-medium text-right">PID</th>
              <th className="py-1.5 px-3 font-medium text-right">CPU</th>
              <th className="py-1.5 px-3 font-medium text-right">Memory</th>
              <th className="py-1.5 px-3 font-medium text-right">Action</th>
            </tr>
          </thead>
          <tbody>
            {processes.map((proc) => (
              <tr key={`${proc.pid}-${proc.name}`} className="border-b border-slate-100 hover:bg-slate-50">
                <td className="py-1.5 px-3 font-medium text-slate-800">{proc.name}</td>
                <td className="py-1.5 px-3 text-right font-mono-tabular text-slate-500">{proc.pid}</td>
                <td className="py-1.5 px-3 text-right font-mono-tabular text-slate-700">{proc.cpu}</td>
                <td className="py-1.5 px-3 text-right font-mono-tabular text-slate-700">{proc.mem}</td>
                <td className="py-1.5 px-3 text-right">
                  {proc.windowId ? (
                    <button
                      type="button"
                      onClick={() => onCloseTargetWindow(proc.windowId!)}
                      className="px-2 py-0.5 border border-slate-300 rounded hover:bg-red-50 hover:text-red-700 hover:border-red-200"
                    >
                      End task
                    </button>
                  ) : (
                    <span className="text-slate-400">System</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
