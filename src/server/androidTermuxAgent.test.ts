import assert from 'node:assert/strict';
import test from 'node:test';
import { buildAndroidTermuxAgent } from './androidTermuxAgent.ts';

test('buildAndroidTermuxAgent injects WebSocket URL, optional token, and Termux wake-lock support', () => {
  const script = buildAndroidTermuxAgent('wss://example.com/agent-ws', 'tok-123');
  assert.ok(script.includes('wss://example.com/agent-ws?token=tok-123'));
  assert.ok(script.includes('termux-wake-lock'));
  assert.ok(script.includes('adb'));
  assert.ok(script.includes('screencap -p'));
  assert.ok(script.includes('render_termux_status_png'));
  assert.ok(script.includes('run_bash'));
  assert.ok(script.includes('file_write'));
});
