import assert from 'node:assert/strict';
import test from 'node:test';
import {
  computeRmsLevel,
  createInitialVadState,
  prepareTextForSpeech,
  stepVadState,
} from './voiceSession.ts';

test('computeRmsLevel measures silence and speech amplitude accurately', () => {
  assert.equal(computeRmsLevel([]), 0);
  assert.equal(computeRmsLevel([0, 0, 0, 0]), 0);
  assert.ok(Math.abs(computeRmsLevel([0.5, -0.5, 0.5, -0.5]) - 0.5) < 1e-6);
});

test('stepVadState detects sustained speech and triggers finish_speech after silence', () => {
  let state = createInitialVadState(0);

  let step = stepVadState(state, 0.005, 500);
  assert.equal(step.action, 'continue');
  assert.equal(step.next.speechStarted, false);
  state = step.next;

  // Speech starts
  step = stepVadState(state, 0.08, 1000);
  assert.equal(step.action, 'continue');
  assert.equal(step.next.speechStarted, false);
  state = step.next;

  step = stepVadState(state, 0.08, 1200);
  assert.equal(step.action, 'continue');
  assert.equal(step.next.speechStarted, true);
  state = step.next;

  // Short pause should keep listening
  step = stepVadState(state, 0.005, 1800);
  assert.equal(step.action, 'continue');
  state = step.next;

  // Silence beyond silenceStopMs finishes utterance
  step = stepVadState(state, 0.005, 2700);
  assert.equal(step.action, 'finish_speech');
});

test('stepVadState restarts idle recorder after prolonged silence without speech', () => {
  const state = createInitialVadState(0);
  const step = stepVadState(state, 0.002, 14500);
  assert.equal(step.action, 'restart_idle');
});

test('stepVadState adapts noise floor and detects soft speech in quiet environment', () => {
  let state = createInitialVadState(0);
  for (let i = 1; i <= 5; i += 1) {
    state = stepVadState(state, 0.003, i * 100).next;
  }
  const s1 = stepVadState(state, 0.016, 600);
  assert.equal(s1.next.speechStarted, false);
  const s2 = stepVadState(s1.next, 0.016, 800);
  assert.equal(s2.next.speechStarted, true);
});

test('prepareTextForSpeech strips markdown formatting cleanly', () => {
  const clean = prepareTextForSpeech('**Albatta, Janob!** `Terminal` ochildi.\n- Bajarildi');
  assert.equal(clean, 'Albatta, Janob! Terminal ochildi. Bajarildi');
});
