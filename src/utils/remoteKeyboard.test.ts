import assert from 'node:assert/strict';
import test from 'node:test';
import {
  extractKeyboardDelta,
  KEYBOARD_SENTINEL,
  resolveKeyboardLockedPortrait,
} from './remoteKeyboard.ts';

test('extractKeyboardDelta detects Backspace when sentinel is deleted', () => {
  assert.deepEqual(extractKeyboardDelta(''), {
    text: '',
    enter: false,
    backspaceCount: 1,
  });
});

test('extractKeyboardDelta ignores unchanged sentinel', () => {
  assert.deepEqual(extractKeyboardDelta(KEYBOARD_SENTINEL), {
    text: '',
    enter: false,
    backspaceCount: 0,
  });
});

test('extractKeyboardDelta extracts typed URL or word after leading sentinel', () => {
  assert.deepEqual(extractKeyboardDelta(`${KEYBOARD_SENTINEL}https://google.com`), {
    text: 'https://google.com',
    enter: false,
    backspaceCount: 0,
  });
});

test('extractKeyboardDelta extracts single typed space cleanly', () => {
  assert.deepEqual(extractKeyboardDelta(`${KEYBOARD_SENTINEL} `), {
    text: ' ',
    enter: false,
    backspaceCount: 0,
  });
});

test('extractKeyboardDelta handles text inserted before trailing sentinel (cursor at 0)', () => {
  assert.deepEqual(extractKeyboardDelta(`salom${KEYBOARD_SENTINEL}`), {
    text: 'salom',
    enter: false,
    backspaceCount: 0,
  });
});

test('extractKeyboardDelta detects trailing newline from mobile keyboard submit', () => {
  assert.deepEqual(extractKeyboardDelta(`${KEYBOARD_SENTINEL}youtube.com\n`), {
    text: 'youtube.com',
    enter: true,
    backspaceCount: 0,
  });
  assert.deepEqual(extractKeyboardDelta(`${KEYBOARD_SENTINEL}\r\n`), {
    text: '',
    enter: true,
    backspaceCount: 0,
  });
});

test('resolveKeyboardLockedPortrait freezes portrait rotation while keyboard is focused', () => {
  // Normal portrait phone before keyboard
  assert.equal(resolveKeyboardLockedPortrait(true, 360, 752, false, false), true);
  // Keyboard opens: container height shrinks below width (360x290), stays portrait
  assert.equal(resolveKeyboardLockedPortrait(true, 360, 290, true, true), true);
  // Keyboard closes on landscape screen: unfreezes and switches to landscape
  assert.equal(resolveKeyboardLockedPortrait(true, 800, 360, false, true), false);
  // When rotation is disallowed (e.g. J.A.R.V.I.S. open), always false
  assert.equal(resolveKeyboardLockedPortrait(false, 360, 752, true, true), false);
});
