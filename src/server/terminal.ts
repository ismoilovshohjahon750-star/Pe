import { exec } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import {
  deleteWinPath,
  getDriveRootPath,
  listWinDir,
  makeWinDir,
  normalizeWinPath,
  readWinFile,
  resolveHostPath,
  writeWinFile,
} from './filesystem.ts';

const execAsync = promisify(exec);

export interface TerminalExecResult {
  cwd: string;
  stdout: string;
  stderr: string;
  exitCode: number;
  clear?: boolean;
}

function resolveArgPath(cwd: string, arg?: string): string {
  if (!arg || !arg.trim()) return cwd;
  const cleaned = arg.trim().replace(/^["']|["']$/g, '');
  if (/^[a-zA-Z]:/.test(cleaned) || cleaned.startsWith('\\')) {
    return normalizeWinPath(cleaned);
  }
  return normalizeWinPath(`${cwd}\\${cleaned}`);
}

export async function executeWindowsCommand(
  commandInput: string,
  currentCwd = 'C:\\Users\\Claude',
): Promise<TerminalExecResult> {
  const raw = commandInput.trim();
  let cwd = normalizeWinPath(currentCwd);
  if (!raw) {
    return { cwd, stdout: '', stderr: '', exitCode: 0 };
  }

  const parts = raw.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) ?? [];
  const cmd = (parts[0] || '').toLowerCase();
  const arg1 = parts[1]?.replace(/^["']|["']$/g, '');

  // Built-in Windows PowerShell / CMD emulation + real C:\ drive operations
  if (cmd === 'cls' || cmd === 'clear') {
    return { cwd, stdout: '', stderr: '', exitCode: 0, clear: true };
  }

  if (cmd === 'pwd' || (cmd === 'cd' && !arg1)) {
    return { cwd, stdout: `${cwd}\n`, stderr: '', exitCode: 0 };
  }

  if (cmd === 'cd' || cmd === 'chdir' || cmd === 'set-location') {
    const target = resolveArgPath(cwd, arg1 || 'C:\\Users\\Claude');
    try {
      const { hostPath } = resolveHostPath(target);
      if (fs.existsSync(hostPath) && fs.statSync(hostPath).isDirectory()) {
        cwd = target;
        return { cwd, stdout: '', stderr: '', exitCode: 0 };
      }
      return { cwd, stdout: '', stderr: `cd: Cannot find path '${target}' because it does not exist.\n`, exitCode: 1 };
    } catch (err) {
      return { cwd, stdout: '', stderr: `${(err as Error).message}\n`, exitCode: 1 };
    }
  }

  if (cmd === 'dir' || cmd === 'ls' || cmd === 'get-childitem' || cmd === 'gci') {
    const target = resolveArgPath(cwd, arg1);
    try {
      const { winPath, entries } = listWinDir(target);
      const lines = [
        `    Directory: ${winPath}`,
        '',
        'Mode                 LastWriteTime         Length Name',
        '----                 -------------         ------ ----',
        ...entries.map((e) => {
          const mode = e.isDirectory ? 'd-----' : '-a----';
          const dt = e.modifiedAt.slice(0, 16).replace('T', ' ');
          const len = e.isDirectory ? '' : String(e.size);
          return `${mode.padEnd(20)} ${dt.padEnd(21)} ${len.padStart(6)} ${e.name}`;
        }),
      ];
      return { cwd, stdout: `${lines.join('\n')}\n`, stderr: '', exitCode: 0 };
    } catch (err) {
      return { cwd, stdout: '', stderr: `${(err as Error).message}\n`, exitCode: 1 };
    }
  }

  if (cmd === 'type' || cmd === 'cat' || cmd === 'get-content') {
    if (!arg1) {
      return { cwd, stdout: '', stderr: 'Missing file path.\n', exitCode: 1 };
    }
    const target = resolveArgPath(cwd, arg1);
    try {
      const { content } = readWinFile(target);
      return { cwd, stdout: `${content}\n`, stderr: '', exitCode: 0 };
    } catch (err) {
      return { cwd, stdout: '', stderr: `${(err as Error).message}\n`, exitCode: 1 };
    }
  }

  if (cmd === 'mkdir' || cmd === 'md' || cmd === 'new-item') {
    if (!arg1) {
      return { cwd, stdout: '', stderr: 'Missing directory name.\n', exitCode: 1 };
    }
    const target = resolveArgPath(cwd, arg1);
    try {
      makeWinDir(target);
      return { cwd, stdout: `Created directory ${target}\n`, stderr: '', exitCode: 0 };
    } catch (err) {
      return { cwd, stdout: '', stderr: `${(err as Error).message}\n`, exitCode: 1 };
    }
  }

  if (cmd === 'del' || cmd === 'rm' || cmd === 'remove-item' || cmd === 'rmdir') {
    if (!arg1) {
      return { cwd, stdout: '', stderr: 'Missing target path.\n', exitCode: 1 };
    }
    const target = resolveArgPath(cwd, arg1);
    try {
      const res = deleteWinPath(target);
      return {
        cwd,
        stdout: res.deleted ? `Deleted ${res.winPath}\n` : `Not found: ${res.winPath}\n`,
        stderr: '',
        exitCode: res.deleted ? 0 : 1,
      };
    } catch (err) {
      return { cwd, stdout: '', stderr: `${(err as Error).message}\n`, exitCode: 1 };
    }
  }

  if (cmd === 'echo' || cmd === 'write-output') {
    const rest = raw.replace(/^(echo|write-output)\s+/i, '');
    // Support basic redirection: echo "hello" > file.txt
    const redirMatch = rest.match(/^(.*?)\s*>\s*([^\s>]+)$/);
    if (redirMatch) {
      const body = redirMatch[1].replace(/^["']|["']$/g, '');
      const target = resolveArgPath(cwd, redirMatch[2]);
      writeWinFile(target, body + '\n');
      return { cwd, stdout: `Wrote ${target}\n`, stderr: '', exitCode: 0 };
    }
    return { cwd, stdout: `${rest.replace(/^["']|["']$/g, '')}\n`, stderr: '', exitCode: 0 };
  }

  if (cmd === 'whoami') {
    return { cwd, stdout: 'claudewin10\\claude\n', stderr: '', exitCode: 0 };
  }

  if (cmd === 'hostname') {
    return { cwd, stdout: 'CLAUDEWIN10-PRO\n', stderr: '', exitCode: 0 };
  }

  if (cmd === 'ver') {
    return { cwd, stdout: 'Microsoft Windows [Version 10.0.19045.4651]\n', stderr: '', exitCode: 0 };
  }

  if (cmd === 'systeminfo') {
    return {
      cwd,
      stdout: [
        'Host Name:                 CLAUDEWIN10-PRO',
        'OS Name:                   Microsoft Windows 10 Pro',
        'OS Version:                10.0.19045 N/A Build 19045',
        'OS Configuration:          Standalone Workstation (MCP Dedicated)',
        'System Type:               x64-based PC',
        'Registered Owner:          Claude AI',
        'System Directory:          C:\\Windows\\system32',
        'MCP Runtime:               Active (Streamable HTTP + SSE + WebSocket)',
      ].join('\n') + '\n',
      stderr: '',
      exitCode: 0,
    };
  }

  if (cmd === 'ipconfig') {
    return {
      cwd,
      stdout: [
        'Windows IP Configuration',
        '',
        'Ethernet adapter MCP-VirtualSwitch:',
        '   Connection-specific DNS Suffix  . : claudewin.local',
        '   IPv4 Address. . . . . . . . . . . : 10.10.0.42',
        '   Subnet Mask . . . . . . . . . . . : 255.255.255.0',
        '   Default Gateway . . . . . . . . . : 10.10.0.1',
      ].join('\n') + '\n',
      stderr: '',
      exitCode: 0,
    };
  }

  if (cmd === 'tasklist') {
    return {
      cwd,
      stdout: [
        'Image Name                     PID Session Name        Mem Usage',
        '========================= ======== ================ ============',
        'System                           4 Services              4,120 K',
        'wininit.exe                    512 Services              6,400 K',
        'explorer.exe                  1824 Console              94,200 K',
        'mcp-bridge.exe                2410 Services             68,512 K',
        'powershell.exe                3104 Console              52,180 K',
      ].join('\n') + '\n',
      stderr: '',
      exitCode: 0,
    };
  }

  if (cmd === 'help') {
    return {
      cwd,
      stdout: [
        'ClaudeWin 10 Pro PowerShell Commands:',
        '  dir / ls, cd, pwd, type / cat, echo, mkdir, del / rm, cls',
        '  whoami, hostname, ver, systeminfo, ipconfig, tasklist',
        '  node <script.js>, python3 <script.py>, git <cmd>, curl <url>',
      ].join('\n') + '\n',
      stderr: '',
      exitCode: 0,
    };
  }

  // Real sandboxed execution inside ./win10-drive for node, python3, git, etc.
  const allowedRealCommands = new Set(['node', 'python3', 'python', 'git', 'curl', 'npm', 'npx']);
  if (allowedRealCommands.has(cmd)) {
    const { hostPath } = resolveHostPath(cwd);
    const driveRoot = getDriveRootPath();
    const safeCwd = hostPath.startsWith(driveRoot) ? hostPath : driveRoot;
    const translatedCommand = raw.replace(/[a-zA-Z]:\\[^\s"']+/g, (winToken) => {
      try {
        return JSON.stringify(resolveHostPath(winToken).hostPath);
      } catch {
        return winToken;
      }
    });
    try {
      const { stdout, stderr } = await execAsync(translatedCommand, {
        cwd: safeCwd,
        timeout: 12000,
        maxBuffer: 512 * 1024,
        env: {
          ...process.env,
          HOME: path.join(driveRoot, 'Users', 'Claude'),
        },
      });
      return { cwd, stdout, stderr, exitCode: 0 };
    } catch (err) {
      const execErr = err as { stdout?: string; stderr?: string; message?: string; code?: number };
      return {
        cwd,
        stdout: execErr.stdout || '',
        stderr: execErr.stderr || execErr.message || 'Command failed',
        exitCode: typeof execErr.code === 'number' ? execErr.code : 1,
      };
    }
  }

  return {
    cwd,
    stdout: '',
    stderr: `${parts[0]} : The term '${parts[0]}' is not recognized. Type 'help' for built-in Windows & runtime commands.\n`,
    exitCode: 1,
  };
}
