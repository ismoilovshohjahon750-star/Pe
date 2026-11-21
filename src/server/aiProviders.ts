import { prepareTextForSpeech } from '../utils/voiceSession.ts';

export type AiProvider = 'gemini' | 'groq' | 'openrouter';

const PROVIDER_ENV_PREFIX: Record<AiProvider, string> = {
  gemini: 'GEMINI_API_KEY',
  groq: 'GROQ_API_KEY',
  openrouter: 'OPENROUTER_API_KEY',
};

const PLACEHOLDER_KEYS = new Set([
  'MY_GEMINI_API_KEY',
  'MY_GROQ_API_KEY',
  'MY_OPENROUTER_API_KEY',
  'YOUR_GEMINI_API_KEY',
  'YOUR_GROQ_API_KEY',
  'YOUR_OPENROUTER_API_KEY',
]);

function isValidApiKeyToken(token: string): boolean {
  const trimmed = token.trim().replace(/^["']+|["']+$/g, '').trim();
  if (!trimmed || trimmed.length < 8) return false;
  if (PLACEHOLDER_KEYS.has(trimmed)) return false;
  if (/^MY_[A-Z0-9_]+$/i.test(trimmed)) return false;
  if (/^YOUR_[A-Z0-9_]+$/i.test(trimmed)) return false;
  return true;
}

export function collectProviderKeys(
  env: Record<string, string | undefined>,
  provider: AiProvider,
): string[] {
  const prefix = PROVIDER_ENV_PREFIX[provider];
  const pluralKey = `${prefix}S`;

  const candidateVarNames = Object.keys(env)
    .filter((name) => {
      if (name === prefix || name === pluralKey) return true;
      return name.startsWith(`${prefix}_`);
    })
    .sort((a, b) => {
      if (a === prefix) return -1;
      if (b === prefix) return 1;
      if (a === pluralKey) return -1;
      if (b === pluralKey) return 1;
      return a.localeCompare(b, undefined, { numeric: true });
    });

  const keys: string[] = [];
  const seen = new Set<string>();

  for (const varName of candidateVarNames) {
    const raw = env[varName];
    if (!raw) continue;
    const parts = raw.split(/[\s,;]+/);
    for (const part of parts) {
      const cleaned = part.trim().replace(/^["']+|["']+$/g, '').trim();
      if (!isValidApiKeyToken(cleaned)) continue;
      if (!seen.has(cleaned)) {
        seen.add(cleaned);
        keys.push(cleaned);
      }
    }
  }

  return keys;
}

export function classifyUpstreamFailure(err: unknown): {
  status: number;
  message: string;
  shouldRotateKey: boolean;
  keyInvalid: boolean;
  cooldownMs: number;
} {
  const rawMsg = err instanceof Error ? err.message : String(err || 'Upstream AI error');
  const lower = rawMsg.toLowerCase();
  const statusProp =
    typeof err === 'object' && err !== null && 'status' in err
      ? Number((err as { status?: unknown }).status)
      : NaN;

  const status = Number.isFinite(statusProp) && statusProp >= 400 ? statusProp : 500;

  if (
    status === 401 ||
    status === 403 ||
    lower.includes('permission_denied') ||
    lower.includes('api_key_invalid') ||
    lower.includes('api key not valid') ||
    lower.includes('invalid_api_key') ||
    lower.includes('incorrect api key')
  ) {
    return {
      status,
      message: rawMsg,
      shouldRotateKey: true,
      keyInvalid: true,
      cooldownMs: 30 * 60_000,
    };
  }

  if (
    status === 429 ||
    status === 402 ||
    lower.includes('resource_exhausted') ||
    lower.includes('rate_limit') ||
    lower.includes('rate limit') ||
    lower.includes('insufficient_quota') ||
    lower.includes('quota') ||
    lower.includes('credits')
  ) {
    return {
      status: status === 402 ? 402 : 429,
      message: rawMsg,
      shouldRotateKey: true,
      keyInvalid: false,
      cooldownMs: 45_000,
    };
  }

  if (
    status === 503 ||
    status === 504 ||
    status >= 500 ||
    lower.includes('unavailable') ||
    lower.includes('overloaded') ||
    lower.includes('aborted') ||
    lower.includes('timeout')
  ) {
    return {
      status,
      message: rawMsg,
      shouldRotateKey: true,
      keyInvalid: false,
      cooldownMs: 25_000,
    };
  }

  return {
    status,
    message: rawMsg,
    shouldRotateKey: false,
    keyInvalid: false,
    cooldownMs: 0,
  };
}

export class ProviderKeyPool {
  private readonly cooldowns = new Map<string, number>();
  private readonly modelCooldowns = new Map<string, number>();

  private keyId(provider: AiProvider, key: string): string {
    return `${provider}:${key}`;
  }

  private modelKeyId(provider: AiProvider, model: string, key: string): string {
    return `${provider}:${model}:${key}`;
  }

  markFailed(provider: AiProvider, key: string, cooldownMs: number, nowMs = Date.now()): void {
    if (cooldownMs <= 0) return;
    this.cooldowns.set(this.keyId(provider, key), nowMs + cooldownMs);
  }

  markHealthy(provider: AiProvider, key: string): void {
    this.cooldowns.delete(this.keyId(provider, key));
  }

  markModelFailed(
    provider: AiProvider,
    model: string,
    key: string,
    cooldownMs: number,
    nowMs = Date.now(),
  ): void {
    if (cooldownMs <= 0) return;
    this.modelCooldowns.set(this.modelKeyId(provider, model, key), nowMs + cooldownMs);
  }

  markModelHealthy(provider: AiProvider, model: string, key: string): void {
    this.cooldowns.delete(this.keyId(provider, key));
    this.modelCooldowns.delete(this.modelKeyId(provider, model, key));
  }

  getAvailableKeys(
    provider: AiProvider,
    env: Record<string, string | undefined> = process.env,
    nowMs = Date.now(),
  ): string[] {
    const all = collectProviderKeys(env, provider);
    const ready: string[] = [];
    for (const key of all) {
      const until = this.cooldowns.get(this.keyId(provider, key)) ?? 0;
      if (until <= nowMs) {
        ready.push(key);
      }
    }
    return ready;
  }

  getAvailableKeysForModel(
    provider: AiProvider,
    model: string,
    env: Record<string, string | undefined> = process.env,
    nowMs = Date.now(),
    allowCooledFallback = false,
  ): string[] {
    const keyReady = this.getAvailableKeys(provider, env, nowMs);
    const modelReady: string[] = [];
    const modelCooled: Array<{ key: string; until: number }> = [];

    for (const key of keyReady) {
      const until = this.modelCooldowns.get(this.modelKeyId(provider, model, key)) ?? 0;
      if (until <= nowMs) {
        modelReady.push(key);
      } else {
        modelCooled.push({ key, until });
      }
    }

    if (modelReady.length > 0) return modelReady;
    if (!allowCooledFallback) return [];
    return modelCooled.sort((a, b) => a.until - b.until).map((item) => item.key);
  }

  getAllKeys(
    provider: AiProvider,
    env: Record<string, string | undefined> = process.env,
  ): string[] {
    return collectProviderKeys(env, provider);
  }

  clear(): void {
    this.cooldowns.clear();
    this.modelCooldowns.clear();
  }
}

export const sharedKeyPool = new ProviderKeyPool();

const CYRILLIC_TO_LATIN: Record<string, string> = {
  А: 'A', а: 'a',
  Б: 'B', б: 'b',
  В: 'V', в: 'v',
  Г: 'G', г: 'g',
  Д: 'D', д: 'd',
  Е: 'E', е: 'e',
  Ё: 'Yo', ё: 'yo',
  Ж: 'J', ж: 'j',
  З: 'Z', з: 'z',
  И: 'I', и: 'i',
  Й: 'Y', й: 'y',
  К: 'K', к: 'k',
  Л: 'L', л: 'l',
  М: 'M', м: 'm',
  Н: 'N', н: 'n',
  О: 'O', о: 'o',
  П: 'P', п: 'p',
  Р: 'R', р: 'r',
  С: 'S', с: 's',
  Т: 'T', т: 't',
  У: 'U', у: 'u',
  Ф: 'F', ф: 'f',
  Х: 'X', х: 'x',
  Ц: 'Ts', ц: 'ts',
  Ч: 'Ch', ч: 'ch',
  Ш: 'Sh', ш: 'sh',
  Щ: 'Sh', щ: 'sh',
  Ъ: '’', ъ: '’',
  Ы: 'I', ы: 'i',
  Ь: '', ь: '',
  Э: 'E', э: 'e',
  Ю: 'Yu', ю: 'yu',
  Я: 'Ya', я: 'ya',
  Ў: 'O‘', ў: 'o‘',
  Қ: 'Q', қ: 'q',
  Ғ: 'G‘', ғ: 'g‘',
  Ҳ: 'H', ҳ: 'h',
};

export function uzbekCyrillicToLatin(input: string): string {
  let out = '';
  for (let i = 0; i < input.length; i += 1) {
    const ch = input[i];
    out += CYRILLIC_TO_LATIN[ch] ?? ch;
  }
  return out;
}

const FOREIGN_SCRIPT_RE =
  /[\u0600-\u06FF\u0900-\u097F\u0980-\u09FF\u0E00-\u0E7F\u3040-\u30FF\u3400-\u4DBF\u4E00-\u9FFF\uAC00-\uD7AF]/;

export function hasForeignNonUzbekScript(text: string): boolean {
  return FOREIGN_SCRIPT_RE.test(text);
}

export function cleanUzbekTranscript(raw: string): string {
  const trimmed = String(raw || '')
    .trim()
    .replace(/^["'«»“”]+|["'«»“”]+$/g, '')
    .trim();
  if (
    !trimmed ||
    /^\[?(?:silence|no speech|inaudible|jimlik|empty|music|musiqa|shovqin|noise|thank you\.?|thanks for watching\.?)\]?$/i.test(
      trimmed,
    )
  ) {
    return '';
  }

  if (hasForeignNonUzbekScript(trimmed)) {
    return '';
  }

  let normalized = /[\u0400-\u04FF]/.test(trimmed) ? uzbekCyrillicToLatin(trimmed) : trimmed;

  // Normalize stray Turkish/Azerbaijani diacritics if Whisper/model slipped one into an Uzbek word
  normalized = normalized
    .replace(/ı/g, 'i')
    .replace(/İ/g, 'I')
    .replace(/ş/g, 'sh')
    .replace(/Ş/g, 'Sh')
    .replace(/ç/g, 'ch')
    .replace(/Ç/g, 'Ch')
    .replace(/ğ/g, 'g‘')
    .replace(/Ğ/g, 'G‘')
    .replace(/ö/g, 'o‘')
    .replace(/Ö/g, 'O‘')
    .replace(/ü/g, 'u')
    .replace(/Ü/g, 'U')
    .replace(/ë/g, 'e')
    .replace(/Ë/g, 'E');

  return normalized.replace(/\s+/g, ' ').trim();
}

export function prepareTextForUzbekTts(text: string): string {
  return prepareTextForSpeech(text)
    .replace(/J\.A\.R\.V\.I\.S\.?/gi, 'Jarvis')
    .replace(/shoh_tech/gi, 'shoh tex')
    .replace(/_/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
