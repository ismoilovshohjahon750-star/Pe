import { Save } from 'lucide-react';
import type { DesktopWindow } from '../../desktop/types.ts';

interface NotepadAppProps {
  win: DesktopWindow;
  interactive: boolean;
  onEdit: (windowId: string, content: string) => void;
  onSave: (windowId: string) => void;
}

export function NotepadApp({ win, interactive, onEdit, onSave }: NotepadAppProps) {
  const np = win.notepad;
  if (!np) return null;

  const lines = np.content.split(/\r?\n/);

  return (
    <div className="flex flex-col h-full bg-white text-slate-900 text-xs">
      {/* Menu bar */}
      <div className="flex items-center justify-between px-2.5 py-1 bg-slate-50 border-b border-slate-200">
        <div className="flex items-center gap-3">
          <button
            type="button"
            disabled={!interactive}
            onClick={() => onSave(win.id)}
            className="flex items-center gap-1.5 px-2 py-0.5 rounded hover:bg-slate-200 disabled:opacity-50 font-medium"
          >
            <Save className="w-3.5 h-3.5 text-[#0078D4]" />
            <span>Save</span>
          </button>
          <span className="text-slate-500 font-mono-tabular truncate max-w-[340px]">
            {np.filePath}
          </span>
        </div>
        <span className="text-[11px] text-slate-500">
          {np.dirty ? 'Unsaved changes' : 'Saved'}
        </span>
      </div>

      {/* Text editor */}
      <textarea
        aria-label="Notepad text editor"
        value={np.content}
        readOnly={!interactive}
        onChange={(e) => onEdit(win.id, e.target.value)}
        onKeyDown={(e) => {
          if (interactive && (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
            e.preventDefault();
            onSave(win.id);
          }
        }}
        className="flex-1 w-full p-3 resize-none font-mono-tabular text-[13px] leading-relaxed text-slate-900 focus:outline-none win10-scroll"
      />

      {/* Status bar */}
      <div className="px-3 py-1 bg-slate-50 border-t border-slate-200 text-[11px] text-slate-500 flex justify-end gap-6 font-mono-tabular">
        <span>Ln {lines.length}, Col {(lines[lines.length - 1] || '').length + 1}</span>
        <span>UTF-8</span>
        <span>Windows (CRLF)</span>
      </div>
    </div>
  );
}
