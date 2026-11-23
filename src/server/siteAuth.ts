import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

const DEFAULT_PIN_SALT = 'shohos-site-gate-v1';
const DEFAULT_PIN_HASH_HEX =
  '48b53e95aab02834f82b304a66b37dbcdab9fff92f1a73405a277fced26762b55c6d34fdbcc39a6d9e251c8d74649b2838673022b7b98c1ca249dfc5266d9c07';

const SESSION_SIGNING_SECRET =
  (process.env.SITE_AUTH_SECRET || '').trim() || randomBytes(32).toString('hex');

const DEFAULT_SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX_ATTEMPTS = 8;

const activeSessionIds = new Set<string>();
const failedAttempts = new Map<string, { count: number; resetAt: number }>();

function scryptDigest(input: string, salt: string): Buffer {
  return scryptSync(input, salt, 64);
}

export function verifySitePin(candidate: string): boolean {
  const normalized = String(candidate ?? '').trim();
  if (!normalized || normalized.length > 64) {
    return false;
  }

  const configuredPin = (process.env.SITE_ACCESS_PIN || '').trim();
  if (configuredPin) {
    const salt = `env-${DEFAULT_PIN_SALT}`;
    const candidateBuf = scryptDigest(normalized, salt);
    const expectedBuf = scryptDigest(configuredPin, salt);
    return (
      candidateBuf.length === expectedBuf.length &&
      timingSafeEqual(candidateBuf, expectedBuf)
    );
  }

  const candidateBuf = scryptDigest(normalized, DEFAULT_PIN_SALT);
  const expectedBuf = Buffer.from(DEFAULT_PIN_HASH_HEX, 'hex');
  return (
    candidateBuf.length === expectedBuf.length &&
    timingSafeEqual(candidateBuf, expectedBuf)
  );
}

interface SiteSessionPayload {
  jti: string;
  iat: number;
  exp: number;
}

function signPayload(encodedPayload: string): string {
  return createHmac('sha256', SESSION_SIGNING_SECRET)
    .update(encodedPayload)
    .digest('base64url');
}

export function issueSiteSessionToken(ttlMs = DEFAULT_SESSION_TTL_MS): {
  token: string;
  expiresAt: number;
} {
  const now = Date.now();
  const expiresAt = now + Math.max(1000, ttlMs);
  const jti = randomBytes(16).toString('hex');
  const payload: SiteSessionPayload = { jti, iat: now, exp: expiresAt };
  const encodedPayload = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const sig = signPayload(encodedPayload);
  activeSessionIds.add(jti);
  return {
    token: `${encodedPayload}.${sig}`,
    expiresAt,
  };
}

function parseVerifiedToken(token?: string | null): SiteSessionPayload | null {
  const raw = String(token || '').trim();
  const dotIdx = raw.indexOf('.');
  if (!raw || dotIdx <= 0 || dotIdx === raw.length - 1) {
    return null;
  }

  const encodedPayload = raw.slice(0, dotIdx);
  const providedSig = raw.slice(dotIdx + 1);
  const expectedSig = signPayload(encodedPayload);

  const providedBuf = Buffer.from(providedSig, 'utf8');
  const expectedBuf = Buffer.from(expectedSig, 'utf8');
  if (
    providedBuf.length !== expectedBuf.length ||
    !timingSafeEqual(providedBuf, expectedBuf)
  ) {
    return null;
  }

  try {
    const parsed = JSON.parse(
      Buffer.from(encodedPayload, 'base64url').toString('utf8'),
    ) as Partial<SiteSessionPayload>;
    if (
      !parsed ||
      typeof parsed.jti !== 'string' ||
      typeof parsed.exp !== 'number' ||
      Date.now() > parsed.exp
    ) {
      return null;
    }
    if (!activeSessionIds.has(parsed.jti)) {
      return null;
    }
    return {
      jti: parsed.jti,
      iat: typeof parsed.iat === 'number' ? parsed.iat : 0,
      exp: parsed.exp,
    };
  } catch {
    return null;
  }
}

export function verifySiteSessionToken(token?: string | null): boolean {
  return parseVerifiedToken(token) !== null;
}

export function revokeSiteSessionToken(token?: string | null): boolean {
  const parsed = parseVerifiedToken(token);
  if (!parsed) return false;
  return activeSessionIds.delete(parsed.jti);
}

export function extractBearerToken(authHeader?: string | null): string | null {
  const raw = String(authHeader || '').trim();
  if (!raw.toLowerCase().startsWith('bearer ')) {
    return null;
  }
  const token = raw.slice(7).trim();
  return token || null;
}

export function checkUnlockRateLimit(
  clientKey: string,
  now = Date.now(),
): { allowed: boolean; retryAfterSec: number } {
  const key = clientKey || 'unknown';
  const entry = failedAttempts.get(key);
  if (!entry || now >= entry.resetAt) {
    return { allowed: true, retryAfterSec: 0 };
  }
  if (entry.count >= RATE_LIMIT_MAX_ATTEMPTS) {
    const retryAfterSec = Math.max(1, Math.ceil((entry.resetAt - now) / 1000));
    return { allowed: false, retryAfterSec };
  }
  return { allowed: true, retryAfterSec: 0 };
}

export function recordUnlockFailure(clientKey: string, now = Date.now()): void {
  const key = clientKey || 'unknown';
  const existing = failedAttempts.get(key);
  if (!existing || now >= existing.resetAt) {
    failedAttempts.set(key, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return;
  }
  existing.count += 1;
}

export function clearUnlockFailures(clientKey: string): void {
  failedAttempts.delete(clientKey || 'unknown');
}
