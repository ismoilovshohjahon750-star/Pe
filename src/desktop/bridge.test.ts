import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createInitialLinuxStatus,
  createInitialRealAgentStatus,
  mapClientPointToScreen,
  resolveMcpExecutionMode,
} from './bridge.ts';

test('initial real agent and linux statuses start cleanly', () => {
  const status = createInitialRealAgentStatus();
  assert.equal(status.connected, false);
  assert.equal(status.hostname, null);

  const linux = createInitialLinuxStatus();
  assert.equal(linux.running, false);
  assert.equal(linux.display, ':99');
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
