import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildCSharpPcAgentSource,
  buildExeBuilderBatchScript,
} from './pcAgentExeBuilder.ts';
import { buildPythonPcAgent } from './pcAgentPython.ts';

test('buildCSharpPcAgentSource produces C# 5 compatible WinExe agent with Win+L fallback', () => {
  const cs = buildCSharpPcAgentSource('wss://example.com/agent-ws', 'tok123');
  assert.ok(cs.includes('wss://example.com/agent-ws?token=tok123'));
  assert.ok(cs.includes('PC QULFLANGAN (Win+L)'));
  assert.ok(cs.includes('ClientWebSocket'));
  assert.ok(cs.includes('while (true)'));
  // Ensure no C# 6+ interpolated strings ($"...") that would fail on .NET 4.x csc.exe
  assert.equal(/\$\"/.test(cs), false);
});

test('buildExeBuilderBatchScript targets %USERPROFILE% and invokes built-in csc.exe with winexe', () => {
  const bat = buildExeBuilderBatchScript('https://example.com');
  assert.ok(bat.includes('https://example.com/api/real-pc-agent.cs'));
  assert.ok(bat.includes('/target:winexe'));
  assert.ok(bat.includes('JarvisPcAgent.exe'));
  assert.ok(bat.includes('%USERPROFILE%'));
});

test('buildPythonPcAgent includes Win+L fallback frame and auto-reconnect loop', () => {
  const py = buildPythonPcAgent('wss://example.com/agent-ws', 'abc');
  assert.ok(py.includes('wss://example.com/agent-ws?token=abc'));
  assert.ok(py.includes('render_locked_frame'));
  assert.ok(py.includes('PC QULFLANGAN (Win+L)'));
  assert.ok(py.includes('reconnecting in 3s'));
});
