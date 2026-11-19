import fs from 'node:fs';
import path from 'node:path';
import type { FileEntry } from '../desktop/types.ts';

const DRIVE_ROOT = path.resolve(process.cwd(), 'win10-drive');

const SEED_FILES: Array<{ rel: string; content: string }> = [
  {
    rel: 'Users/Claude/Desktop/Welcome_Claude.txt',
    content: [
      'ClaudeWin 10 Pro — Dedicated AI Workstation',
      '==========================================',
      '',
      'Status: Ready for Claude AI via Model Context Protocol (MCP)',
      'Drive:  C:\\Users\\Claude (Persistent Sandbox)',
      '',
      'Available capabilities for Claude AI:',
      '  - Mouse & keyboard control (desktop_click, desktop_type, desktop_key)',
      '  - Live PNG screen inspection (desktop_screenshot)',
      '  - PowerShell / Node / Python execution (run_powershell)',
      '  - Real file system read/write (file_list, file_read, file_write)',
      '  - Microsoft Edge web browsing (browser_navigate)',
      '  - Paint drawing & Notepad editing',
    ].join('\n'),
  },
  {
    rel: 'Users/Claude/Desktop/MCP_Guide.md',
    content: [
      '# ClaudeWin 10 Pro MCP Guide',
      '',
      'Claude AI connects to this Windows 10 Pro workstation over MCP.',
      'All files created under C:\\Users\\Claude are persisted on disk.',
      '',
      'Try asking Claude:',
      '1. "Take a screenshot of my Windows 10 desktop and inspect what is open."',
      '2. "Write a Node.js script in C:\\Users\\Claude\\Projects\\demo.js and run it in PowerShell."',
      '3. "Open Paint and draw an architecture diagram while I watch."',
    ].join('\n'),
  },
  {
    rel: 'Users/Claude/Documents/notes.txt',
    content: 'Project workspace notes for Claude AI.\n',
  },
  {
    rel: 'Users/Claude/Projects/hello.js',
    content: [
      'import os from "node:os";',
      'console.log("Hello from ClaudeWin 10 Pro!");',
      'console.log("Host architecture:", os.arch(), "| Node:", process.version);',
      'console.log("Working directory:", process.cwd());',
    ].join('\n'),
  },
];

export function ensureDriveSeeded(): void {
  const dirs = [
    'Users/Claude/Desktop',
    'Users/Claude/Documents',
    'Users/Claude/Downloads',
    'Users/Claude/Pictures',
    'Users/Claude/Projects',
    'Windows/System32',
  ];
  for (const dir of dirs) {
    fs.mkdirSync(path.join(DRIVE_ROOT, dir), { recursive: true });
  }
  for (const file of SEED_FILES) {
    const abs = path.join(DRIVE_ROOT, file.rel);
    if (!fs.existsSync(abs)) {
      fs.writeFileSync(abs, file.content, 'utf8');
    }
  }
}

export function normalizeWinPath(inputPath?: string): string {
  const raw = (inputPath || 'C:\\Users\\Claude\\Desktop').trim();
  let cleaned = raw.replace(/\//g, '\\');
  if (/^[a-zA-Z]:/.test(cleaned)) {
    cleaned = 'C:' + cleaned.slice(2);
  } else if (cleaned.startsWith('\\')) {
    cleaned = 'C:' + cleaned;
  } else {
    cleaned = 'C:\\Users\\Claude\\' + cleaned;
  }
  const parts = cleaned.slice(2).split('\\').filter(Boolean);
  const stack: string[] = [];
  for (const p of parts) {
    if (p === '.') continue;
    if (p === '..') {
      stack.pop();
    } else {
      stack.push(p);
    }
  }
  return stack.length === 0 ? 'C:\\' : `C:\\${stack.join('\\')}`;
}

export function resolveHostPath(winPath?: string): { winPath: string; hostPath: string } {
  ensureDriveSeeded();
  const normalized = normalizeWinPath(winPath);
  const rel = normalized.slice(3).replace(/\\/g, '/');
  const hostPath = path.resolve(DRIVE_ROOT, rel);
  if (!hostPath.startsWith(DRIVE_ROOT)) {
    throw new Error('Access denied: path escapes C:\\ sandbox');
  }
  return { winPath: normalized, hostPath };
}

export function listWinDir(winPath?: string): { winPath: string; entries: FileEntry[] } {
  const { winPath: norm, hostPath } = resolveHostPath(winPath);
  if (!fs.existsSync(hostPath)) {
    throw new Error(`Directory not found: ${norm}`);
  }
  const stat = fs.statSync(hostPath);
  if (!stat.isDirectory()) {
    throw new Error(`Not a directory: ${norm}`);
  }
  const names = fs.readdirSync(hostPath);
  const entries: FileEntry[] = names
    .map((name) => {
      const full = path.join(hostPath, name);
      const s = fs.statSync(full);
      const childWinPath = norm.endsWith('\\') ? `${norm}${name}` : `${norm}\\${name}`;
      return {
        name,
        winPath: childWinPath,
        isDirectory: s.isDirectory(),
        size: s.isDirectory() ? 0 : s.size,
        modifiedAt: s.mtime.toISOString(),
        extension: s.isDirectory() ? '' : path.extname(name).toLowerCase(),
      };
    })
    .sort((a, b) => {
      if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
  return { winPath: norm, entries };
}

export function readWinFile(winPath: string): { winPath: string; content: string; size: number } {
  const { winPath: norm, hostPath } = resolveHostPath(winPath);
  if (!fs.existsSync(hostPath)) {
    throw new Error(`File not found: ${norm}`);
  }
  const stat = fs.statSync(hostPath);
  if (stat.isDirectory()) {
    throw new Error(`Cannot read directory as file: ${norm}`);
  }
  const content = fs.readFileSync(hostPath, 'utf8');
  return { winPath: norm, content, size: stat.size };
}

export function writeWinFile(winPath: string, content: string): { winPath: string; size: number } {
  const { winPath: norm, hostPath } = resolveHostPath(winPath);
  fs.mkdirSync(path.dirname(hostPath), { recursive: true });
  fs.writeFileSync(hostPath, content, 'utf8');
  const stat = fs.statSync(hostPath);
  return { winPath: norm, size: stat.size };
}

export function makeWinDir(winPath: string): { winPath: string } {
  const { winPath: norm, hostPath } = resolveHostPath(winPath);
  fs.mkdirSync(hostPath, { recursive: true });
  return { winPath: norm };
}

export function deleteWinPath(winPath: string): { winPath: string; deleted: boolean } {
  const { winPath: norm, hostPath } = resolveHostPath(winPath);
  if (norm === 'C:\\' || norm === 'C:\\Users' || norm === 'C:\\Users\\Claude') {
    throw new Error(`Protected system path cannot be deleted: ${norm}`);
  }
  if (!fs.existsSync(hostPath)) {
    return { winPath: norm, deleted: false };
  }
  fs.rmSync(hostPath, { recursive: true, force: true });
  return { winPath: norm, deleted: true };
}

export function getDriveRootPath(): string {
  ensureDriveSeeded();
  return DRIVE_ROOT;
}
