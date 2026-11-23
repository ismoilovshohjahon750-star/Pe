import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildNonInteractiveAptInstallCmd,
  createInitialLinuxStatus,
  createInitialRealAgentStatus,
  createReconnectingAgentStatus,
  isWinLockShortcut,
  mapClientPointToScreen,
  pickNewerFrame,
  resolveMcpExecutionMode,
  shouldBroadcastFrame,
  shouldSendToWsClient,
} from './bridge.ts';

test('initial real agent and linux statuses start cleanly', () => {
  const status = createInitialRealAgentStatus();
  assert.equal(status.connected, false);
  assert.equal(status.reconnecting, false);
  assert.equal(status.locked, false);
  assert.equal(status.hostname, null);

  const linux = createInitialLinuxStatus();
  assert.equal(linux.running, false);
  assert.equal(linux.display, ':99');
});

test('createReconnectingAgentStatus preserves connection and frame metadata while clearing fps', () => {
  const connected = {
    ...createInitialRealAgentStatus(),
    connected: true,
    locked: true,
    desktopName: 'Winlogon',
    hostname: 'WORKSTATION',
    fps: 2.8,
  };
  const next = createReconnectingAgentStatus(connected);
  assert.equal(next.connected, true);
  assert.equal(next.reconnecting, true);
  assert.equal(next.locked, true);
  assert.equal(next.desktopName, 'Winlogon');
  assert.equal(next.fps, 0);
});

test('isWinLockShortcut matches Meta+L and Ctrl+Alt+L without false positives', () => {
  assert.equal(isWinLockShortcut('l', true, false, false), true);
  assert.equal(isWinLockShortcut('L', true, false, false), true);
  assert.equal(isWinLockShortcut('l', false, true, true), true);
  assert.equal(isWinLockShortcut('l', false, true, false), false);
  assert.equal(isWinLockShortcut('k', true, false, false), false);
});

test('resolveMcpExecutionMode routes tools to linux, real-win10, or sandbox accurately', () => {
  assert.equal(resolveMcpExecutionMode('real-win10', false, true, 'desktop_screenshot'), 'sandbox');
  assert.equal(resolveMcpExecutionMode('real-win10', true, true, 'desktop_screenshot'), 'real-win10');
  assert.equal(resolveMcpExecutionMode('linux', false, true, 'desktop_screenshot'), 'linux');
  assert.equal(resolveMcpExecutionMode('linux', false, true, 'open_app'), 'linux');
  assert.equal(resolveMcpExecutionMode('linux', false, true, 'window_control'), 'linux');
  assert.equal(resolveMcpExecutionMode('linux', false, true, 'window_list'), 'linux');
  assert.equal(resolveMcpExecutionMode('linux', false, true, 'desktop_drag'), 'linux');
  assert.equal(resolveMcpExecutionMode('linux', false, true, 'desktop_scroll'), 'linux');
  assert.equal(resolveMcpExecutionMode('linux', false, true, 'run_bash'), 'linux');
  assert.equal(resolveMcpExecutionMode('linux', false, true, 'wait'), 'linux');
  assert.equal(resolveMcpExecutionMode('linux', false, true, 'browser_navigate'), 'linux');
  assert.equal(resolveMcpExecutionMode('linux', false, false, 'desktop_screenshot'), 'sandbox');
  assert.equal(resolveMcpExecutionMode('sandbox', true, true, 'desktop_screenshot'), 'sandbox');
  assert.equal(resolveMcpExecutionMode('linux', false, true, 'paint_draw'), 'sandbox');
});

test('mapClientPointToScreen maps landscape and 90deg rotated portrait coordinates accurately', () => {
  const normal = mapClientPointToScreen(
    640,
    360,
    { left: 0, top: 0, right: 1280, width: 1280, height: 720 },
    1280,
    720,
    false,
  );
  assert.deepEqual(normal, { x: 640, y: 360 });

  // When rotated 90deg CW inside a 390x693 visual box, top-right is Linux (0, 0) and bottom-left is (1279, 719)
  const rotatedTopRight = mapClientPointToScreen(
    390,
    0,
    { left: 0, top: 0, right: 390, width: 390, height: 693 },
    1280,
    720,
    true,
  );
  assert.deepEqual(rotatedTopRight, { x: 0, y: 0 });

  const rotatedBottomLeft = mapClientPointToScreen(
    0,
    693,
    { left: 0, top: 0, right: 390, width: 390, height: 693 },
    1280,
    720,
    true,
  );
  assert.deepEqual(rotatedBottomLeft, { x: 1279, y: 719 });
});

test('buildNonInteractiveAptInstallCmd enforces noninteractive dpkg flags and sanitizes packages', () => {
  assert.equal(buildNonInteractiveAptInstallCmd([]), 'true');
  const cmd = buildNonInteractiveAptInstallCmd([
    'xvfb',
    'xvfb',
    'openbox',
    'invalid;rm -rf /',
    'xfce4-terminal',
  ]);
  assert.ok(cmd.includes('DEBIAN_FRONTEND=noninteractive'));
  assert.ok(cmd.includes('--force-confdef'));
  assert.ok(cmd.includes('--force-confold'));
  assert.ok(cmd.includes('--no-install-recommends'));
  assert.ok(cmd.includes('</dev/null'));
  assert.ok(cmd.includes('xvfb openbox xfce4-terminal'));
  assert.ok(!cmd.includes('rm -rf'));
});

test('shouldBroadcastFrame deduplicates identical idle frames until keepalive interval', () => {
  const a = new Uint8Array([1, 2, 3, 4]);
  const b = new Uint8Array([1, 2, 3, 4]);
  const c = new Uint8Array([1, 2, 9, 4]);
  assert.equal(shouldBroadcastFrame(null, a, 0), true);
  assert.equal(shouldBroadcastFrame(a, b, 500), false);
  assert.equal(shouldBroadcastFrame(a, b, 4500), true);
  assert.equal(shouldBroadcastFrame(a, c, 100), true);
});

test('shouldSendToWsClient drops slow backed-up clients before latency queue builds up', () => {
  assert.equal(shouldSendToWsClient(1, 0), true);
  assert.equal(shouldSendToWsClient(1, 100_000), true);
  assert.equal(shouldSendToWsClient(1, 300_000), false);
  assert.equal(shouldSendToWsClient(3, 0), false);
});

test('pickNewerFrame keeps monotonic newest frame timestamp', () => {
  const f1 = { mimeType: 'image/jpeg', width: 1280, height: 720, data: 'a', cursorX: 0, cursorY: 0, timestamp: 1000 };
  const f2 = { mimeType: 'image/jpeg', width: 1280, height: 720, data: 'b', cursorX: 0, cursorY: 0, timestamp: 2000 };
  assert.equal(pickNewerFrame(null, f1), f1);
  assert.equal(pickNewerFrame(f2, f1), f2);
  assert.equal(pickNewerFrame(f1, f2), f2);
});
