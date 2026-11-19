import test from 'node:test';
import assert from 'node:assert/strict';
import {
  closeWindow,
  createInitialDesktopState,
  focusWindow,
  hitTestDesktop,
  moveCursor,
  moveWindow,
  openAppWindow,
  toggleMaximizeWindow,
  toggleMinimizeWindow,
} from './engine.ts';

test('initial desktop state has Windows 10 Pro dimensions and welcome apps', () => {
  const state = createInitialDesktopState();
  assert.equal(state.screenWidth, 1280);
  assert.equal(state.screenHeight, 720);
  assert.equal(state.windows.length, 2);
  assert.equal(state.windows[1].appId, 'powershell');
  assert.equal(state.windows[1].focused, true);
});

test('openAppWindow opens new app and focuses it while unfocusing others', () => {
  const initial = createInitialDesktopState();
  const { state, windowId } = openAppWindow(initial, 'paint');
  assert.equal(state.windows.length, 3);
  const paintWin = state.windows.find((w) => w.id === windowId);
  assert.ok(paintWin);
  assert.equal(paintWin.focused, true);
  assert.equal(state.windows.filter((w) => w.focused).length, 1);
});

test('hitTestDesktop detects taskbar start button and top-most window close button', () => {
  const initial = createInitialDesktopState();
  const startHit = hitTestDesktop(initial, 20, 700);
  assert.deepEqual(startHit, { target: 'start-button' });

  const psWin = initial.windows.find((w) => w.appId === 'powershell');
  assert.ok(psWin);
  const closeHit = hitTestDesktop(initial, psWin.x + psWin.width - 15, psWin.y + 12);
  assert.deepEqual(closeHit, { target: 'window-close', windowId: psWin.id });
});

test('minimize, maximize, move, focus, and close transitions maintain valid focus state', () => {
  let state = createInitialDesktopState();
  const notepad = state.windows.find((w) => w.appId === 'notepad')!;
  const ps = state.windows.find((w) => w.appId === 'powershell')!;

  state = focusWindow(state, notepad.id);
  assert.equal(state.windows.find((w) => w.id === notepad.id)?.focused, true);

  state = toggleMaximizeWindow(state, notepad.id);
  assert.equal(state.windows.find((w) => w.id === notepad.id)?.maximized, true);

  state = moveWindow(state, notepad.id, 100, 50);
  assert.equal(state.windows.find((w) => w.id === notepad.id)?.maximized, false);
  assert.equal(state.windows.find((w) => w.id === notepad.id)?.x, 100);

  state = toggleMinimizeWindow(state, notepad.id);
  assert.equal(state.windows.find((w) => w.id === notepad.id)?.minimized, true);
  assert.equal(state.windows.find((w) => w.id === ps.id)?.focused, true);

  state = closeWindow(state, ps.id);
  assert.equal(state.windows.some((w) => w.id === ps.id), false);
});

test('moveCursor clamps coordinates inside 1280x720 desktop bounds', () => {
  const initial = createInitialDesktopState();
  const clamped = moveCursor(initial, 9999, -50, 'claude', true);
  assert.equal(clamped.cursor.x, 1279);
  assert.equal(clamped.cursor.y, 0);
  assert.equal(clamped.cursor.clicking, true);
  assert.equal(clamped.cursor.actor, 'claude');
});
