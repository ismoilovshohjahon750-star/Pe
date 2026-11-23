import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  buildCSharpPcAgentSource,
  buildExeBuilderBatchScript,
} from './pcAgentExeBuilder.ts';
import { buildPythonPcAgent } from './pcAgentPython.ts';

test('buildCSharpPcAgentSource produces C# 5 compatible WinExe agent with Win+L fallback and JarvisUnlockService', () => {
  const cs = buildCSharpPcAgentSource('wss://example.com/agent-ws', 'tok123');
  assert.ok(cs.includes('wss://example.com/agent-ws?token=tok123'));
  assert.ok(cs.includes('PC QULFLANGAN (Win+L)'));
  assert.ok(cs.includes('ClientWebSocket'));
  assert.ok(cs.includes('while (true)'));
  assert.ok(cs.includes('JarvisUnlockService'));
  assert.ok(cs.includes('winsta0\\\\winlogon'));
  assert.ok(cs.includes('SendInput'));
  assert.ok(cs.includes('SendKeyOrCombo'));
  assert.ok(cs.includes('LockWorkStation'));
  assert.ok(cs.includes('KEYEVENTF_EXTENDEDKEY'));
  assert.ok(cs.includes('tool == "unlock_pc"'));
  // Ensure no C# 6+ interpolated strings ($"...") that would fail on .NET 4.x csc.exe
  assert.equal(/\$\"/.test(cs), false);
});

test('buildExeBuilderBatchScript targets %USERPROFILE%, installs LocalSystem service, and invokes csc.exe', () => {
  const bat = buildExeBuilderBatchScript('https://example.com');
  assert.ok(bat.includes('https://example.com/api/real-pc-agent.cs'));
  assert.ok(bat.includes('/target:winexe'));
  assert.ok(bat.includes('/r:System.ServiceProcess.dll'));
  assert.ok(bat.includes('JarvisUnlockService'));
  assert.ok(bat.includes('JarvisPcAgent.exe'));
  assert.ok(bat.includes('%USERPROFILE%'));
});

test('buildPythonPcAgent includes Win+L fallback frame, JarvisWinlogonPipe bridge, unlock_pc, Win32 SendInput, and valid Python syntax', () => {
  const py = buildPythonPcAgent('wss://example.com/agent-ws', 'abc');
  assert.ok(py.includes('wss://example.com/agent-ws?token=abc'));
  assert.ok(py.includes('render_locked_frame'));
  assert.ok(py.includes('PC QULFLANGAN (Win+L)'));
  assert.ok(py.includes('JarvisWinlogonPipe'));
  assert.ok(py.includes('r"\\\\.\\pipe\\JarvisWinlogonPipe"'));
  assert.ok(py.includes('send_win32_key_or_combo'));
  assert.ok(py.includes('LockWorkStation'));
  assert.ok(py.includes('tool == "unlock_pc"'));
  assert.ok(py.includes('reconnecting in 3s'));

  const tmpFile = path.join(os.tmpdir(), `pc-agent-check-${Date.now()}.py`);
  fs.writeFileSync(tmpFile, py, 'utf8');
  try {
    execFileSync('python3', ['-m', 'py_compile', tmpFile], { stdio: 'pipe' });
  } finally {
    fs.rmSync(tmpFile, { force: true });
  }
});
