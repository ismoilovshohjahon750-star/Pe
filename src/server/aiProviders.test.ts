import assert from 'node:assert/strict';
import test from 'node:test';
import {
  classifyUpstreamFailure,
  cleanUzbekTranscript,
  collectProviderKeys,
  prepareTextForUzbekTts,
  ProviderKeyPool,
  uzbekCyrillicToLatin,
} from './aiProviders.ts';

test('collectProviderKeys merges single, plural, and numbered keys and skips placeholders', () => {
  const keys = collectProviderKeys(
    {
      GEMINI_API_KEY: 'MY_GEMINI_API_KEY',
      GEMINI_API_KEYS: 'AIzaKeyOne111, AIzaKeyTwo222\nAIzaKeyThree333',
      GEMINI_API_KEY_1: 'AIzaKeyTwo222',
      GEMINI_API_KEY_2: 'AIzaKeyFour444',
      GROQ_API_KEY: 'gsk_alpha123456',
      GROQ_API_KEY_2: 'gsk_beta789012',
    },
    'gemini',
  );

  assert.deepEqual(keys, [
    'AIzaKeyOne111',
    'AIzaKeyTwo222',
    'AIzaKeyThree333',
    'AIzaKeyFour444',
  ]);

  const groqKeys = collectProviderKeys(
    {
      GROQ_API_KEY: 'gsk_alpha123456',
      GROQ_API_KEY_2: 'gsk_beta789012',
    },
    'groq',
  );
  assert.deepEqual(groqKeys, ['gsk_alpha123456', 'gsk_beta789012']);
});

test('collectProviderKeys parses up to 10 numbered keys for gemini, groq, and openrouter', () => {
  const env: Record<string, string> = {};
  for (let i = 1; i <= 10; i += 1) {
    env[`GEMINI_API_KEY_${i}`] = `AIzaKey00${i}`;
    env[`GROQ_API_KEY_${i}`] = `gsk_key00${i}`;
    env[`OPENROUTER_API_KEY_${i}`] = `sk-or-key00${i}`;
  }

  const geminiKeys = collectProviderKeys(env, 'gemini');
  const groqKeys = collectProviderKeys(env, 'groq');
  const openRouterKeys = collectProviderKeys(env, 'openrouter');

  assert.equal(geminiKeys.length, 10);
  assert.equal(groqKeys.length, 10);
  assert.equal(openRouterKeys.length, 10);
  assert.equal(geminiKeys[9], 'AIzaKey0010');
  assert.equal(groqKeys[9], 'gsk_key0010');
  assert.equal(openRouterKeys[9], 'sk-or-key0010');
});

test('ProviderKeyPool rotates past cooled-down keys and recovers after cooldown expires', () => {
  const pool = new ProviderKeyPool();
  const env = {
    GEMINI_API_KEY_1: 'AIzaFirstKey111',
    GEMINI_API_KEY_2: 'AIzaSecondKey222',
  };

  assert.deepEqual(pool.getAvailableKeys('gemini', env, 1000), [
    'AIzaFirstKey111',
    'AIzaSecondKey222',
  ]);

  pool.markFailed('gemini', 'AIzaFirstKey111', 60_000, 1000);
  assert.deepEqual(pool.getAvailableKeys('gemini', env, 2000), ['AIzaSecondKey222']);
  assert.deepEqual(pool.getAvailableKeys('gemini', env, 62_000), [
    'AIzaFirstKey111',
    'AIzaSecondKey222',
  ]);
});

test('ProviderKeyPool isolates rate-limit cooldowns per model without blocking sibling models', () => {
  const pool = new ProviderKeyPool();
  const env = {
    GEMINI_API_KEY_1: 'AIzaFirstKey111',
    GEMINI_API_KEY_2: 'AIzaSecondKey222',
  };

  pool.markModelFailed('gemini', 'gemini-4-hydrogen', 'AIzaFirstKey111', 45_000, 1000);
  assert.deepEqual(
    pool.getAvailableKeysForModel('gemini', 'gemini-4-hydrogen', env, 2000),
    ['AIzaSecondKey222'],
  );
  assert.deepEqual(
    pool.getAvailableKeysForModel('gemini', 'gemini-3.1-flash-lite', env, 2000),
    ['AIzaFirstKey111', 'AIzaSecondKey222'],
  );
});

test('classifyUpstreamFailure identifies 429/402 quota and 503/403 key rotation cases', () => {
  assert.equal(classifyUpstreamFailure({ status: 429, message: 'RESOURCE_EXHAUSTED' }).shouldRotateKey, true);
  assert.equal(classifyUpstreamFailure({ status: 402, message: 'Insufficient credits' }).shouldRotateKey, true);
  assert.equal(classifyUpstreamFailure({ status: 503, message: 'UNAVAILABLE' }).shouldRotateKey, true);
  assert.equal(classifyUpstreamFailure({ status: 403, message: 'API_KEY_INVALID' }).shouldRotateKey, true);
  assert.equal(classifyUpstreamFailure({ status: 400, message: 'Bad user audio payload' }).shouldRotateKey, false);
});

test('cleanUzbekTranscript rejects Chinese/Arabic/Hindi hallucinations and normalizes Uzbek Cyrillic/Latin', () => {
  assert.equal(cleanUzbekTranscript('你好，世界'), '');
  assert.equal(cleanUzbekTranscript('سلام، جارویس'), '');
  assert.equal(cleanUzbekTranscript('सलाम, जार्विस।'), '');
  assert.equal(cleanUzbekTranscript('[silence]'), '');
  assert.equal(cleanUzbekTranscript('Салом Жарвис, терминални оч'), 'Salom Jarvis, terminalni och');
  assert.equal(cleanUzbekTranscript('Seni kim yarattı?'), 'Seni kim yaratti?');
  assert.equal(cleanUzbekTranscript('Kalkulyatorni ishga tushir.'), 'Kalkulyatorni ishga tushir.');
});

test('uzbekCyrillicToLatin transliterates Uzbek-specific Cyrillic letters accurately', () => {
  assert.equal(uzbekCyrillicToLatin('Ўзбекистон ғолиб, қўл ҳаракати'), 'O‘zbekiston g‘olib, qo‘l harakati');
});

test('prepareTextForUzbekTts cleans symbols for pure Uzbek TTS pronunciation', () => {
  assert.equal(
    prepareTextForUzbekTts('Albatta, Janob! **J.A.R.V.I.S.** — shoh_tech tizimi tayyor.'),
    'Albatta, Janob! Jarvis — shoh tex tizimi tayyor.',
  );
});
