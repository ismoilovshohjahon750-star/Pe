import { useCallback, useEffect, useState } from 'react';
import {
  ArrowUp,
  FilePlus,
  FileText,
  Folder,
  FolderPlus,
  HardDrive,
  RefreshCw,
  Trash2,
} from 'lucide-react';
import type { DesktopWindow, FileEntry } from '../../desktop/types.ts';

interface ExplorerAppProps {
  win: DesktopWindow;
  interactive: boolean;
  onChangePath: (windowId: string, path: string) => void;
  onOpenFileInNotepad: (filePath: string, content: string) => void;
}

const QUICK_ACCESS = [
  { label: 'Desktop', path: 'C:\\Users\\Claude\\Desktop' },
  { label: 'Documents', path: 'C:\\Users\\Claude\\Documents' },
  { label: 'Projects', path: 'C:\\Users\\Claude\\Projects' },
  { label: 'Downloads', path: 'C:\\Users\\Claude\\Downloads' },
  { label: 'Pictures', path: 'C:\\Users\\Claude\\Pictures' },
  { label: 'Local Disk (C:)', path: 'C:\\' },
];

export function ExplorerApp({
  win,
  interactive,
  onChangePath,
  onOpenFileInNotepad,
}: ExplorerAppProps) {
  const currentPath = win.explorer?.currentPath || 'C:\\Users\\Claude\\Desktop';
  const [addressInput, setAddressInput] = useState(currentPath);
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [creatingType, setCreatingType] = useState<'file' | 'folder' | null>(null);
  const [newName, setNewName] = useState('');

  useEffect(() => {
    setAddressInput(currentPath);
  }, [currentPath]);

  const loadDirectory = useCallback(async (dirPath: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/fs/list?path=${encodeURIComponent(dirPath)}`);
      const data = (await res.json()) as { winPath?: string; entries?: FileEntry[]; error?: string };
      if (!res.ok) throw new Error(data.error || 'Failed to read directory');
      setEntries(data.entries || []);
    } catch (err) {
      setError((err as Error).message);
      setEntries([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadDirectory(currentPath);
  }, [currentPath, loadDirectory, win.zIndex]);

  const goUp = () => {
    if (currentPath === 'C:\\') return;
    const parts = currentPath.split('\\').filter(Boolean);
    if (parts.length <= 1) {
      onChangePath(win.id, 'C:\\');
    } else {
      parts.pop();
      onChangePath(win.id, parts.length === 1 ? `${parts[0]}\\` : parts.join('\\'));
    }
  };

  const handleOpenEntry = async (entry: FileEntry) => {
    if (entry.isDirectory) {
      onChangePath(win.id, entry.winPath);
      return;
    }
    try {
      const res = await fetch(`/api/fs/read?path=${encodeURIComponent(entry.winPath)}`);
      const data = (await res.json()) as { content?: string; error?: string };
      if (!res.ok) throw new Error(data.error || 'Failed to read file');
      onOpenFileInNotepad(entry.winPath, data.content ?? '');
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = newName.trim();
    if (!trimmed || !creatingType) return;
    const targetPath = currentPath.endsWith('\\')
      ? `${currentPath}${trimmed}`
      : `${currentPath}\\${trimmed}`;
    try {
      if (creatingType === 'folder') {
        await fetch('/api/fs/mkdir', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path: targetPath }),
        });
      } else {
        await fetch('/api/fs/write', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path: targetPath, content: '' }),
        });
      }
      setCreatingType(null);
      setNewName('');
      await loadDirectory(currentPath);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const handleDeleteSelected = async () => {
    if (!selectedPath) return;
    await fetch(`/api/fs/delete?path=${encodeURIComponent(selectedPath)}`, {
      method: 'DELETE',
    });
    setSelectedPath(null);
    await loadDirectory(currentPath);
  };

  return (
    <div className="flex flex-col h-full bg-white text-slate-900 text-xs select-none">
      {/* Toolbar */}
      <div className="flex items-center gap-1.5 px-2.5 py-1.5 bg-slate-50 border-b border-slate-200">
        <button
          type="button"
          onClick={goUp}
          disabled={!interactive || currentPath === 'C:\\'}
          aria-label="Up one folder"
          className="p-1.5 rounded hover:bg-slate-200 disabled:opacity-40"
        >
          <ArrowUp className="w-3.5 h-3.5" />
        </button>
        <button
          type="button"
          onClick={() => void loadDirectory(currentPath)}
          aria-label="Refresh folder"
          className="p-1.5 rounded hover:bg-slate-200"
        >
          <RefreshCw className="w-3.5 h-3.5" />
        </button>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (interactive) onChangePath(win.id, addressInput);
          }}
          className="flex-1"
        >
          <input
            type="text"
            aria-label="Explorer address path"
            value={addressInput}
            onChange={(e) => setAddressInput(e.target.value)}
            readOnly={!interactive}
            className="w-full px-2.5 py-1 bg-white border border-slate-300 text-xs font-mono-tabular focus:outline-none focus:border-[#0078D4]"
          />
        </form>

        {interactive && (
          <>
            <button
              type="button"
              onClick={() => {
                setCreatingType('folder');
                setNewName('NewFolder');
              }}
              className="flex items-center gap-1 px-2 py-1 rounded border border-slate-300 bg-white hover:bg-slate-100 whitespace-nowrap"
            >
              <FolderPlus className="w-3.5 h-3.5 text-amber-600" />
              <span>Folder</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setCreatingType('file');
                setNewName('note.txt');
              }}
              className="flex items-center gap-1 px-2 py-1 rounded border border-slate-300 bg-white hover:bg-slate-100 whitespace-nowrap"
            >
              <FilePlus className="w-3.5 h-3.5 text-[#0078D4]" />
              <span>File</span>
            </button>
            {selectedPath && (
              <button
                type="button"
                onClick={() => void handleDeleteSelected()}
                aria-label="Delete selected item"
                className="p-1.5 rounded border border-red-200 text-red-600 hover:bg-red-50"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            )}
          </>
        )}
      </div>

      {/* Inline create prompt */}
      {creatingType && (
        <form
          onSubmit={(e) => void handleCreate(e)}
          className="flex items-center gap-2 px-3 py-1.5 bg-blue-50 border-b border-blue-200"
        >
          <span className="font-medium text-slate-700">
            New {creatingType === 'folder' ? 'Folder' : 'File'}:
          </span>
          <input
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            autoFocus
            className="px-2 py-0.5 border border-slate-300 bg-white text-xs"
          />
          <button
            type="submit"
            className="px-2.5 py-0.5 bg-[#0078D4] text-white font-medium hover:bg-[#0063B1]"
          >
            Create
          </button>
          <button
            type="button"
            onClick={() => setCreatingType(null)}
            className="px-2 py-0.5 text-slate-600 hover:text-slate-900"
          >
            Cancel
          </button>
        </form>
      )}

      {/* Main Split Body */}
      <div className="flex flex-1 min-h-0">
        <aside className="w-40 shrink-0 bg-slate-50 border-r border-slate-200 p-2 space-y-0.5 overflow-y-auto">
          <div className="px-2 py-1 text-[11px] font-semibold text-slate-500">Quick access</div>
          {QUICK_ACCESS.map((item) => {
            const active = currentPath.toLowerCase() === item.path.toLowerCase();
            return (
              <button
                key={item.path}
                type="button"
                disabled={!interactive}
                onClick={() => onChangePath(win.id, item.path)}
                className={`w-full flex items-center gap-2 px-2 py-1.5 text-left rounded transition-colors ${
                  active ? 'bg-[#CCE8FF] text-slate-900 font-medium' : 'hover:bg-slate-200/70 text-slate-700'
                }`}
              >
                {item.path === 'C:\\' ? (
                  <HardDrive className="w-3.5 h-3.5 text-slate-600 shrink-0" />
                ) : (
                  <Folder className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                )}
                <span className="truncate">{item.label}</span>
              </button>
            );
          })}
        </aside>

        <div className="flex-1 overflow-y-auto win10-scroll p-2">
          {error && (
            <div className="p-2 mb-2 bg-red-50 border border-red-200 text-red-700">{error}</div>
          )}
          {loading ? (
            <div className="p-4 text-slate-500">Loading directory...</div>
          ) : entries.length === 0 ? (
            <div className="p-6 text-center text-slate-500">This folder is empty.</div>
          ) : (
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 text-[11px] text-slate-500">
                  <th className="py-1 px-2 font-medium">Name</th>
                  <th className="py-1 px-2 font-medium">Date modified</th>
                  <th className="py-1 px-2 font-medium text-right">Size</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((entry) => {
                  const selected = selectedPath === entry.winPath;
                  return (
                    <tr
                      key={entry.winPath}
                      onClick={() => setSelectedPath(entry.winPath)}
                      onDoubleClick={() => {
                        if (interactive) void handleOpenEntry(entry);
                      }}
                      className={`cursor-pointer border-b border-slate-100 ${
                        selected ? 'bg-[#CCE8FF]' : 'hover:bg-slate-50'
                      }`}
                    >
                      <td className="py-1.5 px-2 flex items-center gap-2">
                        {entry.isDirectory ? (
                          <Folder className="w-4 h-4 text-amber-500 shrink-0" />
                        ) : (
                          <FileText className="w-4 h-4 text-[#0078D4] shrink-0" />
                        )}
                        <span className="truncate font-medium text-slate-800">{entry.name}</span>
                      </td>
                      <td className="py-1.5 px-2 text-slate-500 font-mono-tabular">
                        {entry.modifiedAt.slice(0, 16).replace('T', ' ')}
                      </td>
                      <td className="py-1.5 px-2 text-right text-slate-500 font-mono-tabular">
                        {entry.isDirectory ? 'Folder' : `${entry.size} B`}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* Status bar */}
      <div className="px-3 py-1 bg-slate-50 border-t border-slate-200 text-[11px] text-slate-500 flex justify-between font-mono-tabular">
        <span>{entries.length} items</span>
        <span>Double-click to open</span>
      </div>
    </div>
  );
}
