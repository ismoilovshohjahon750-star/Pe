import assert from 'node:assert/strict';
import test from 'node:test';
import {
  checkUnlockRateLimit,
  clearUnlockFailures,
  extractBearerToken,
  issueSiteSessionToken,
  recordUnlockFailure,
  revokeSiteSessionToken,
  verifySitePin,
  verifySiteSessionToken,
} from './siteAuth.ts';

test('verifySitePin accepts configured access PIN and rejects wrong inputs', () => {
  const prev = process.env.SITE_ACCESS_PIN;
  delete process.env.SITE_ACCESS_PIN;
  try {
    assert.equal(verifySitePin('1264'), true);
    assert.equal(verifySitePin(' 1264 '), true);
    assert.equal(verifySitePin('0000'), false);
    assert.equal(verifySitePin('126'), false);
    assert.equal(verifySitePin('12645'), false);
    assert.equal(verifySitePin(''), false);

    process.env.SITE_ACCESS_PIN = '9876';
    assert.equal(verifySitePin('9876'), true);
    assert.equal(verifySitePin('1264'), false);
  } finally {
    if (prev === undefined) {
      delete process.env.SITE_ACCESS_PIN;
    } else {
      process.env.SITE_ACCESS_PIN = prev;
    }
  }
});

test('issueSiteSessionToken, verifySiteSessionToken, and revokeSiteSessionToken enforce valid sessions', () => {
  const { token, expiresAt } = issueSiteSessionToken(60_000);
  assert.ok(expiresAt > Date.now());
  assert.equal(verifySiteSessionToken(token), true);
  assert.equal(verifySiteSessionToken(`${token}tampered`), false);
  assert.equal(verifySiteSessionToken('invalid'), false);
  assert.equal(verifySiteSessionToken(''), false);

  assert.equal(extractBearerToken(`Bearer ${token}`), token);
  assert.equal(extractBearerToken('Basic abc'), null);

  assert.equal(revokeSiteSessionToken(token), true);
  assert.equal(verifySiteSessionToken(token), false);
});

test('unlock rate limiter throttles after repeated failed attempts and clears on success', () => {
  const key = 'test-client-1';
  clearUnlockFailures(key);
  const start = 1_000_000;

  for (let i = 0; i < 8; i += 1) {
    assert.equal(checkUnlockRateLimit(key, start + i * 100).allowed, true);
    recordUnlockFailure(key, start + i * 100);
  }

  const blocked = checkUnlockRateLimit(key, start + 1000);
  assert.equal(blocked.allowed, false);
  assert.ok(blocked.retryAfterSec >= 1);

  clearUnlockFailures(key);
  assert.equal(checkUnlockRateLimit(key, start + 1000).allowed, true);
});
