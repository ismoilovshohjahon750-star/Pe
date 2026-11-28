import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildCSharpPcAgentSource,
  buildExeBuilderBatchScript,
} from './pcAgentExeBuilder.ts';
import { buildPythonPcAgent } from './pcAgentPython.ts';

test('buildCSharpPcAgentSource produces C# 5 compatible service+session agent with Winlogon capture and SendInput unlock', () => {
  const cs = buildCSharpPcAgentSource('wss://example.com/agent-ws', 'tok123');
  assert.ok(cs.includes('wss://example.com/agent-ws?token=tok123'));
  assert.ok(cs.includes('PC QULFLANGAN (Win+L)'));
  assert.ok(cs.includes('ClientWebSocket'));
  assert.ok(cs.includes('ServiceBase'));
  assert.ok(cs.includes('OpenInputDesktop'));
  assert.ok(cs.includes('SetThreadDesktop'));
  assert.ok(cs.includes('SendInput'));
  assert.ok(cs.includes('LockWorkStation'));
  assert.ok(cs.includes('SetThreadExecutionState'));
  assert.ok(cs.includes('WTSGetActiveConsoleSessionId'));
  assert.ok(cs.includes('JarvisPcAgentShutdownEvent'));
  assert.ok(cs.includes('agent_disconnect'));
  assert.ok(cs.includes('while (true)'));
  // Ensure no C# 6+ syntax that would fail on .NET 4.x csc.exe
  assert.equal(/\$\"/.test(cs), false);
  assert.equal(/\?\./.test(cs), false);
  assert.equal(/\bout\s+var\b/.test(cs), false);
});

test('buildExeBuilderBatchScript builds with System.ServiceProcess and installs LocalSystem service with fallback', () => {
  const bat = buildExeBuilderBatchScript('https://example.com');
  assert.ok(bat.includes('https://example.com/api/real-pc-agent.cs'));
  assert.ok(bat.includes('/target:winexe'));
  assert.ok(bat.includes('/r:System.ServiceProcess.dll'));
  assert.ok(bat.includes('JarvisPcAgentService'));
  assert.ok(bat.includes('JarvisPcAgent.exe'));
  assert.ok(bat.includes('%ProgramData%'));
});

test('buildPythonPcAgent includes Win+L lock, keepalive, locked flag, disconnect, and fast 1s auto-reconnect loop', () => {
  const py = buildPythonPcAgent('wss://example.com/agent-ws', 'abc');
  assert.ok(py.includes('wss://example.com/agent-ws?token=abc'));
  assert.ok(py.includes('render_locked_frame'));
  assert.ok(py.includes('PC QULFLANGAN (Win+L)'));
  assert.ok(py.includes('SetThreadExecutionState'));
  assert.ok(py.includes('LockWorkStation'));
  assert.ok(py.includes('agent_disconnect'));
  assert.ok(py.includes('ShutdownRequested'));
  assert.ok(py.includes('"locked"'));
  assert.ok(py.includes('reconnecting in 1s'));
});
