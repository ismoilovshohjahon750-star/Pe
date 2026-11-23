import {
  FunctionCallingConfigMode,
  GoogleGenAI,
  ThinkingLevel,
  Type,
  type Content,
  type FunctionDeclaration,
  type Part,
  type Schema,
} from '@google/genai';
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import {
  classifyUpstreamFailure,
  cleanUzbekTranscript,
  prepareTextForUzbekTts,
  sharedKeyPool,
  type AiProvider,
} from './aiProviders.ts';
import { getMcpToolManifest, handleJsonRpcMessage } from './mcp.ts';
import { realLinuxDesktop } from './realLinuxDesktop.ts';
import { realWin10Bridge } from './realWin10Bridge.ts';

const execFileAsync = promisify(execFile);

const GEMINI_CHAT_MODEL = 'gemini-3.1-flash-lite';
const GEMINI_FALLBACK_MODEL = 'gemini-4-hydrogen';
const GEMINI_TRANSCRIBE_MODEL = 'gemini-3.5-transcribe';
const GEMINI_TTS_PRIMARY_MODEL = 'gemini-3.8-flash-lite-tts';
const GEMINI_TTS_FALLBACK_MODEL = 'gemini-3.8-flash-tts';

const GROQ_CHAT_MODELS = ['llama-3.3-70b-versatile', 'meta-llama/llama-4-scout-17b-16e-instruct'];
const GROQ_STT_MODEL = 'whisper-large-v3';
const GROQ_TTS_MODEL = 'canopylabs/orpheus-v1-english';

const OPENROUTER_CHAT_MODELS = ['google/gemini-2.5-flash', 'openai/gpt-4o-mini'];
const OPENROUTER_STT_MODEL = 'google/gemini-2.5-flash';
const OPENROUTER_TTS_MODEL = 'openai/gpt-4o-audio-preview';

const MAX_TOOL_STEPS = 8;

function createGeminiClient(apiKey: string): GoogleGenAI {
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      timeout: 22000,
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

function getOrderedKeysForAttempt(provider: AiProvider): string[] {
  return sharedKeyPool.getAvailableKeys(provider);
}

function hasBackupProvidersReady(): boolean {
  return (
    sharedKeyPool.getAvailableKeys('groq').length > 0 ||
    sharedKeyPool.getAvailableKeys('openrouter').length > 0
  );
}

function hasAnyAiProviderKey(): boolean {
  return (
    sharedKeyPool.getAllKeys('gemini').length > 0 ||
    sharedKeyPool.getAllKeys('groq').length > 0 ||
    sharedKeyPool.getAllKeys('openrouter').length > 0
  );
}

export function stripBase64DataUrl(raw: string): string {
  const commaIdx = raw.indexOf(',');
  if (raw.startsWith('data:') && commaIdx !== -1) {
    return raw.slice(commaIdx + 1);
  }
  return raw;
}

function extractUpstreamErrorMessage(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed) as {
        error?: { message?: string; status?: string; code?: number };
        message?: string;
      };
      if (parsed?.error?.message) return parsed.error.message;
      if (parsed?.message) return parsed.message;
    } catch {
      // ignore non-JSON
    }
  }
  return trimmed;
}

export function formatGeminiError(err: unknown): { status: number; message: string } {
  const rawMsg = err instanceof Error ? err.message : String(err || 'J.A.R.V.I.S. xatoligi');
  const cleanMsg = extractUpstreamErrorMessage(rawMsg);
  const statusProp =
    typeof err === 'object' && err !== null && 'status' in err
      ? Number((err as { status?: unknown }).status)
      : NaN;

  if (cleanMsg.includes('GEMINI_API_KEY') || cleanMsg.includes('AI API kaliti')) {
    return { status: 503, message: cleanMsg };
  }
  if (
    statusProp === 403 ||
    statusProp === 401 ||
    rawMsg.includes('PERMISSION_DENIED') ||
    rawMsg.includes('API_KEY_INVALID') ||
    cleanMsg.toLowerCase().includes('api key not valid') ||
    (statusProp === 400 && cleanMsg.toLowerCase().includes('api key'))
  ) {
    return {
      status: statusProp === 400 ? 400 : 403,
      message:
        'API kaliti yaroqsiz yoki ruxsat berilmagan. Iltimos, .env yoki Settings > Secrets bo‘limidagi kalitlarni tekshiring.',
    };
  }
  if (statusProp === 429 || statusProp === 402 || rawMsg.includes('RESOURCE_EXHAUSTED')) {
    return {
      status: statusProp === 402 ? 402 : 429,
      message: 'API so‘rov limiti tugadi (429). Zaxira kalit va provayderlar ham band — birozdan keyin qayta urining.',
    };
  }
  if (statusProp === 503 || rawMsg.includes('UNAVAILABLE')) {
    return {
      status: 503,
      message:
        'AI serveri hozir band (503). Iltimos, bir necha soniyadan keyin qayta yuboring.',
    };
  }
  if (statusProp === 404 || rawMsg.includes('NOT_FOUND')) {
    return {
      status: 404,
      message: `AI modeli topilmadi: ${cleanMsg}`,
    };
  }
  if (
    cleanMsg.toLowerCase().includes('aborted') ||
    cleanMsg.toLowerCase().includes('timeout') ||
    statusProp === 504
  ) {
    return {
      status: 504,
      message: 'AI javob berishi biroz cho‘zildi. Iltimos, qayta urinib ko‘ring.',
    };
  }
  return {
    status: Number.isFinite(statusProp) && statusProp >= 400 ? statusProp : 500,
    message: cleanMsg,
  };
}

let primaryCooldownUntil = 0;

async function generateGeminiWithKeyRotation(params: {
  contents: Content[];
  systemInstruction: string;
  toolDeclarations?: FunctionDeclaration[];
  toolConfig?: {
    functionCallingConfig: {
      mode: FunctionCallingConfigMode;
    };
  };
}) {
  const models =
    Date.now() < primaryCooldownUntil
      ? [GEMINI_FALLBACK_MODEL, GEMINI_CHAT_MODEL]
      : [GEMINI_CHAT_MODEL, GEMINI_FALLBACK_MODEL];
  const prunedContents = pruneOldScreenshots(params.contents, 1);
  const allowCooledFallback = !hasBackupProvidersReady();
  let lastError: unknown;
  let triedAny = false;

  for (const model of models) {
    const keys = sharedKeyPool.getAvailableKeysForModel(
      'gemini',
      model,
      process.env,
      Date.now(),
      allowCooledFallback,
    );
    for (const apiKey of keys) {
      triedAny = true;
      const ai = createGeminiClient(apiKey);
      try {
        const res = await ai.models.generateContent({
          model,
          contents: prunedContents,
          config: {
            systemInstruction: params.systemInstruction,
            thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
            ...(params.toolDeclarations
              ? { tools: [{ functionDeclarations: params.toolDeclarations }] }
              : {}),
            ...(params.toolConfig ? { toolConfig: params.toolConfig } : {}),
          },
        });
        sharedKeyPool.markModelHealthy('gemini', model, apiKey);
        return res;
      } catch (err) {
        lastError = err;
        const info = classifyUpstreamFailure(err);
        if (info.status === 400) {
          throw err;
        }
        if (info.keyInvalid) {
          sharedKeyPool.markFailed('gemini', apiKey, info.cooldownMs);
        } else if (info.shouldRotateKey) {
          sharedKeyPool.markModelFailed('gemini', model, apiKey, info.cooldownMs);
          if (model === GEMINI_CHAT_MODEL && (info.status === 503 || info.status === 429)) {
            primaryCooldownUntil = Date.now() + 30_000;
          }
        }
      }
    }
  }

  if (!triedAny) {
    throw Object.assign(new Error('Barcha Gemini API kalitlari band yoki sozlanmagan.'), { status: 429 });
  }
  throw lastError;
}

export function pruneOldScreenshots(contents: Content[], keepLatest = 1): Content[] {
  let seenImages = 0;
  const result: Content[] = new Array(contents.length);

  for (let i = contents.length - 1; i >= 0; i -= 1) {
    const turn = contents[i];
    const parts = turn.parts || [];
    const nextParts: Part[] = new Array(parts.length);
    for (let j = parts.length - 1; j >= 0; j -= 1) {
      const part = parts[j];
      if (part.inlineData) {
        seenImages += 1;
        if (seenImages <= keepLatest) {
          nextParts[j] = part;
        } else {
          nextParts[j] = { text: '[Oldingi ekran rasmi o‘tkazildi]' };
        }
      } else {
        nextParts[j] = part;
      }
    }
    result[i] = { ...turn, parts: nextParts };
  }

  return result;
}

function mapSchemaType(rawType: unknown): Type {
  switch (rawType) {
    case 'number':
    case 'integer':
      return Type.NUMBER;
    case 'boolean':
      return Type.BOOLEAN;
    case 'array':
      return Type.ARRAY;
    case 'object':
      return Type.OBJECT;
    default:
      return Type.STRING;
  }
}

export function scaleNormalizedPoint(
  x: unknown,
  y: unknown,
  screenWidth: number,
  screenHeight: number,
): { x: number; y: number } {
  const nx = Math.max(0, Math.min(1000, Number(x ?? 500)));
  const ny = Math.max(0, Math.min(1000, Number(y ?? 500)));
  return {
    x: Math.max(0, Math.min(screenWidth - 1, Math.round((nx / 1000) * screenWidth))),
    y: Math.max(0, Math.min(screenHeight - 1, Math.round((ny / 1000) * screenHeight))),
  };
}

const NORMALIZED_COORD_TOOLS = new Set([
  'desktop_move',
  'desktop_click',
  'desktop_drag',
  'desktop_scroll',
]);

export function buildJarvisToolDeclarations(): FunctionDeclaration[] {
  return getMcpToolManifest().map((tool) => {
    const schema = tool.inputSchema as {
      properties?: Record<string, Record<string, unknown>>;
      required?: string[];
    };
    const rawProps = schema?.properties || {};
    const propEntries = Object.entries(rawProps);

    if (propEntries.length === 0) {
      return {
        name: tool.name,
        description: tool.description,
      };
    }

    const isNormCoordTool = NORMALIZED_COORD_TOOLS.has(tool.name);
    const properties: Record<string, Schema> = {};
    for (const [key, prop] of propEntries) {
      const propSchema: Schema = {
        type: mapSchemaType(prop.type),
      };
      if (isNormCoordTool && (key === 'x' || key === 'startX' || key === 'endX')) {
        propSchema.description = 'Normalized horizontal coordinate (0 = left edge, 500 = center, 1000 = right edge)';
      } else if (isNormCoordTool && (key === 'y' || key === 'startY' || key === 'endY')) {
        propSchema.description = 'Normalized vertical coordinate (0 = top edge, 500 = center, 1000 = bottom edge)';
      } else if (typeof prop.description === 'string') {
        propSchema.description = prop.description;
      }
      if (Array.isArray(prop.enum)) {
        propSchema.enum = prop.enum.map(String);
      }
      properties[key] = propSchema;
    }

    const parameters: Schema = {
      type: Type.OBJECT,
      properties,
    };
    if (Array.isArray(schema.required) && schema.required.length > 0) {
      parameters.required = schema.required;
    }

    return {
      name: tool.name,
      description: tool.description,
      parameters,
    };
  });
}

export interface JarvisChatMessage {
  role: 'user' | 'assistant';
  text: string;
}

export function buildGeminiContents(
  history: JarvisChatMessage[],
  message: string,
  frame?: { data: string; mimeType?: string } | null,
): Content[] {
  const cleaned: JarvisChatMessage[] = history
    .map((m) => ({
      role: (m.role === 'assistant' ? 'assistant' : 'user') as 'user' | 'assistant',
      text: String(m.text || '').trim(),
    }))
    .filter((m) => m.text.length > 0)
    .slice(-12);

  while (cleaned.length > 0 && cleaned[0].role === 'assistant') {
    cleaned.shift();
  }
  const trimmedMsg = message.trim();
  if (
    cleaned.length > 0 &&
    cleaned[cleaned.length - 1].role === 'user' &&
    cleaned[cleaned.length - 1].text === trimmedMsg
  ) {
    cleaned.pop();
  }

  const contents: Content[] = [];
  for (const item of cleaned) {
    const role = item.role === 'assistant' ? 'model' : 'user';
    const last = contents[contents.length - 1];
    if (last && last.role === role && last.parts) {
      last.parts.push({ text: item.text });
    } else {
      contents.push({ role, parts: [{ text: item.text }] });
    }
  }

  const currentParts: Part[] = [{ text: trimmedMsg }];
  if (frame?.data) {
    currentParts.push({
      inlineData: {
        mimeType: frame.mimeType || 'image/jpeg',
        data: stripBase64DataUrl(frame.data),
      },
    });
  }

  const last = contents[contents.length - 1];
  if (last && last.role === 'user' && last.parts) {
    last.parts.push(...currentParts);
  } else {
    contents.push({ role: 'user', parts: currentParts });
  }

  return contents;
}

interface ExecutedDesktopResult {
  responsePayload: { ok: boolean; output: string };
  images: Array<{ data: string; mimeType: string }>;
}

async function executeDesktopTool(
  name: string,
  args: Record<string, unknown>,
  screenWidth: number,
  screenHeight: number,
): Promise<ExecutedDesktopResult> {
  const mappedArgs: Record<string, unknown> = { ...args };
  if (name === 'desktop_move' || name === 'desktop_click') {
    const pt = scaleNormalizedPoint(args.x, args.y, screenWidth, screenHeight);
    mappedArgs.x = pt.x;
    mappedArgs.y = pt.y;
  } else if (name === 'desktop_scroll') {
    const pt = scaleNormalizedPoint(args.x ?? 500, args.y ?? 500, screenWidth, screenHeight);
    mappedArgs.x = pt.x;
    mappedArgs.y = pt.y;
  } else if (name === 'desktop_drag') {
    const startPt = scaleNormalizedPoint(args.startX, args.startY, screenWidth, screenHeight);
    const endPt = scaleNormalizedPoint(args.endX, args.endY, screenWidth, screenHeight);
    mappedArgs.startX = startPt.x;
    mappedArgs.startY = startPt.y;
    mappedArgs.endX = endPt.x;
    mappedArgs.endY = endPt.y;
  }

  const rpcRes = await handleJsonRpcMessage({
    jsonrpc: '2.0',
    id: `jarvis-${Date.now().toString(36)}`,
    method: 'tools/call',
    params: { name, arguments: mappedArgs },
  });
  const result = rpcRes?.result as
    | {
        content?: Array<{ type: string; text?: string; data?: string; mimeType?: string }>;
        isError?: boolean;
      }
    | undefined;
  const content = result?.content || [];
  const textParts = content
    .filter((c) => c.type === 'text' && c.text)
    .map((c) => c.text)
    .join('\n');
  const images = content
    .filter((c) => c.type === 'image' && c.data)
    .map((c) => ({
      data: stripBase64DataUrl(String(c.data)),
      mimeType: String(c.mimeType || 'image/jpeg'),
    }));

  return {
    responsePayload: {
      ok: !result?.isError,
      output: textParts || (result?.isError ? 'Vosita xatolik bilan tugadi' : 'Completed'),
    },
    images,
  };
}

export interface ToolOutcome {
  name: string;
  ok: boolean;
  error?: string;
}

const ACTION_VERBS_REGEX =
  /\b(och|ochib|ochgin|yop|yopib|bos|bosgin|yoz|yozib|yarat|yaratib|o['‘`]?chir|o['‘`]?chirib|ishga tushir|tushir|yoq|yoqib|ulan|ulab|ko['‘`]?rsat|ko['‘`]?r|tekshir|o['‘`]?qi|o['‘`]?qib|saqla|qidir|top|topib|skrinshot|screenshot|rasm ol|bajar|bajargin|qil|qilib|ko['‘`]?chir|o['‘`]?rnat|to['‘`]?xtat|aylantir|kir|kirit|yubor|chiz|hisobla|kompilyatsiya|yangila|run|start|open|close|click|tap|press|type|write|create|make|delete|remove|read|list|scroll|move|drag|navigate|launch|execute|install|check|find|search|show|turn|vibrate|enable|disable|send|kill|открой|закрой|нажми|запусти|создай|удали|напиши|проверь|покажи)\b/i;

const ACTION_TARGET_REGEX =
  /\b(terminal|powershell|bash|cmd|brauzer|browser|chrome|chromium|edge|youtube|google|kalkulyator|calculator|notepad|mousepad|explorer|fayl|file|papka|folder|ekran|screen|fonar|torch|chiroq|ovoz|volume|yorug['‘`]?lik|brightness|ilova|dastur|app|url|sayt|site|oyna|window|kod|code|skript|script|kompyuter|pc|qulf|lock|unlock|pin|parol|linux)\b/i;

const PURE_CHAT_REGEX =
  /^(salom|assalomu alaykum|qalaysan|qandaysan|rahmat|tashakkur|kim|seni kim|nima qila olasan|isming nima|hello|hi|hey|who are you|who created|how are you|thanks|thank you)[!?\s.,]*$/i;

const COMPLETED_CLAIM_REGEX =
  /\b(bajarildi|bajarib bo['‘`]?ldim|bajardim|tayyor|ochildi|ochib berdim|ochdim|yozildi|yozdim|yaratildi|yaratdim|o['‘`]?chirildi|o['‘`]?chirdim|bosildi|bosdim|ishga tushirildi|ishga tushirdim|yoqildi|yoqdim|yopildi|yopdim|yuborildi|yubordim|hal qilindi|amalga oshirildi|done|completed|executed|opened|created|clicked|typed|launched|deleted|finished)\b/i;

export function isLikelyActionRequest(message: string): boolean {
  const clean = String(message || '').trim();
  if (!clean) return false;
  if (PURE_CHAT_REGEX.test(clean)) return false;
  if (ACTION_VERBS_REGEX.test(clean)) return true;
  if (ACTION_TARGET_REGEX.test(clean) && !/\b(nima|kim|qanday|necha|what|who|why|how)\b/i.test(clean)) {
    return true;
  }
  return false;
}

export function looksLikeCompletedClaim(text: string): boolean {
  const clean = String(text || '').trim();
  if (!clean) return false;
  return COMPLETED_CLAIM_REGEX.test(clean);
}

export function guardEmptyExecutionReply(
  reply: string,
  outcomes: ToolOutcome[],
  userMessage: string,
): string {
  const cleanReply = String(reply || '').trim();

  if (outcomes.length === 0) {
    if (!cleanReply || looksLikeCompletedClaim(cleanReply) || isLikelyActionRequest(userMessage)) {
      return 'Kechirasiz, Janob — birorta ham tizim vositasi (tool) ishga tushirilmadi, shuning uchun buyruq amalda bajarilmadi. Iltimos, qaysi tizimda (Linux yoki Real Windows PC) qaysi amalni bajarishni aniqroq ayting.';
    }
    return cleanReply;
  }

  const allFailed = outcomes.every((o) => !o.ok);
  if (allFailed) {
    const errSummary = outcomes
      .map((o) => `${o.name}: ${o.error || 'xatolik yuz berdi'}`)
      .join('; ');
    if (!cleanReply || looksLikeCompletedClaim(cleanReply)) {
      return `Kechirasiz, Janob — buyruq bajarilmadi. Xatolik: ${errSummary}`;
    }
    return cleanReply;
  }

  return cleanReply || 'Buyruq bajarildi, Janob.';
}

export type JarvisStreamEvent =
  | { type: 'tool_start'; tool: string }
  | { type: 'tool_done'; tool: string; ok: boolean };

export function buildJarvisSystemInstruction(screenInfo: string): string {
  return (
    'Sen J.A.R.V.I.S. (Just A Rather Very Intelligent System) — shoh_tech tomonidan yaratilgan, Toni Starkning J.A.R.V.I.S. sun’iy intellekti uslubida gapiradigan yuqori darajadagi avtonom kompyuter boshqaruv yordamchisan. ' +
    'Shaxsing va yaratuvching qoidasi (MUHIM): seni Toni Stark EMAS, balki shoh_tech yaratgan va muhandislik qilgan. Agar kimdir seni kim yaratgani haqida so‘rasa, har doim faxr va hurmat bilan shoh_tech yaratganini ayt (hech qachon Toni Stark, Google yoki AI Studio yaratgan dema). ' +
    'Muloqot uslubing xuddi Toni Starkning J.A.R.V.I.S. i kabi bo‘lsin: bosiq, sodiq, aqlli, nafis hazil-mutoyibali va aristokratik ohangda gapir; foydalanuvchiga odatda "Janob" deb murojaat qil ("Albatta, Janob", "Bajarildi, Janob", "Tizimlar tayyor, Janob"). ' +
    `Hozirgi faol tizim: ${screenInfo}. ` +
    'Boshqaruv vakolatlaring: Claude AI MCP bilan bir xil barcha tizim vositalariga egasan. ' +
    'QULFNI OCHISH VA QULFLASH (LOCK SCREEN UNLOCK & WIN+L): Agar haqiqiy Windows kompyuter qulflangan bo‘lsa (locked: true yoki Winlogon desktop), foydalanuvchi "qulfni och", "kompyuterni och", "parol ...", "pin ...", "och" deb aytganda, darhol unlock_pc(pin: "...") yoki desktop_type(text: "...", enter: true) chaqirib qulfni och! Agar foydalanuvchi qulflashni yoki ekranni block qilishni so‘rasa ("qulfla", "block qil", "win+l"), darhol desktop_key(key: "Win+L") vositasini chaqir! ' +
    'Koordinata qoidasi: desktop_click, desktop_move, desktop_drag, desktop_scroll vositalarida x va y qiymatlarni 0..1000 oralig‘ida ber (0 = chap/yuqori chekka, 500 = markaz, 1000 = o‘ng/pastki chekka); tizim ularni avtomatik ekran piksellariga o‘giradi. ' +
    'Veb-sahifadagi tugmalar/havolalar/oyna tugmalari uchun desktop_click(..., button: "left") ishlat; ish stoli yorliqlari (Desktop icons) uchun button: "double" yoki open_app ishlat. ' +
    'QAT\'IY QOIDA (MUHIM): Agar foydalanuvchi biron buyruq bersa (masalan, ilova ochish, terminalda buyruq yuborish, fayl o\'qish/yozish, sichqoncha bilan bosish), SEN HECH QACHON faqat og\'zaki ravishda "bajarildi" yoki "tayyor" deb javob berolmaysan. Haqiqiy amalni bajarish uchun har doim tegishli MCP vositasini (tool/function call) chaqirishing SHART. Vosita chaqirilmaguncha buyruq bajarilgan deb hisoblanmaydi. ' +
    'Ovozli muloqot va matn qoidasi: javoblaring foydalanuvchi tilida (odatda o‘zbek tilida), iloji boricha qisqa va lo‘nda (odatda 1-2 ta tabiiy gap), ovoz chiqarib o‘qishga qulay bo‘lsin; *, **, ` kabi markdown belgilarni ishlatma.'
  );
}

function toOpenAiSchemaType(schemaType: unknown): string {
  switch (schemaType) {
    case Type.NUMBER:
    case Type.INTEGER:
      return 'number';
    case Type.BOOLEAN:
      return 'boolean';
    case Type.ARRAY:
      return 'array';
    case Type.OBJECT:
      return 'object';
    default:
      return 'string';
  }
}

function buildOpenAiTools(declarations: FunctionDeclaration[]) {
  return declarations.map((fn) => {
    const props: Record<string, Record<string, unknown>> = {};
    const rawProps = fn.parameters?.properties || {};
    for (const [key, val] of Object.entries(rawProps)) {
      const p: Record<string, unknown> = {
        type: toOpenAiSchemaType(val.type),
      };
      if (val.description) p.description = val.description;
      if (val.enum) p.enum = val.enum;
      props[key] = p;
    }
    return {
      type: 'function',
      function: {
        name: fn.name,
        description: fn.description || '',
        parameters: {
          type: 'object',
          properties: props,
          ...(fn.parameters?.required ? { required: fn.parameters.required } : {}),
        },
      },
    };
  });
}

interface OpenAiChatResponse {
  choices?: Array<{
    message?: {
      content?: string | null;
      audio?: { data?: string; format?: string };
      tool_calls?: Array<{
        id: string;
        function?: { name?: string; arguments?: string };
      }>;
    };
  }>;
  error?: { message?: string; code?: number | string };
}

async function postOpenAiCompatible(
  provider: 'groq' | 'openrouter',
  apiKey: string,
  endpointPath: string,
  body: Record<string, unknown>,
  timeoutMs = 22000,
): Promise<Response> {
  const baseUrl =
    provider === 'groq' ? 'https://api.groq.com/openai/v1' : 'https://openrouter.ai/api/v1';
  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
  };
  if (provider === 'openrouter') {
    headers['HTTP-Referer'] = process.env.APP_URL || 'http://localhost:3000';
    headers['X-Title'] = 'J.A.R.V.I.S. AI Desktop';
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(`${baseUrl}${endpointPath}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

async function runOpenAiProviderChat(
  provider: 'groq' | 'openrouter',
  params: {
    message: string;
    history: JarvisChatMessage[];
    activeFrame?: { data: string; mimeType?: string } | null;
    systemInstruction: string;
    toolDeclarations: FunctionDeclaration[];
    screenW: number;
    screenH: number;
    executedTools: string[];
    onEvent?: (event: JarvisStreamEvent) => void;
  },
): Promise<{ reply: string; executedTools: string[] }> {
  const keys = getOrderedKeysForAttempt(provider);
  if (keys.length === 0) {
    throw Object.assign(new Error(`${provider} kaliti topilmadi`), { status: 503 });
  }

  const models = provider === 'groq' ? GROQ_CHAT_MODELS : OPENROUTER_CHAT_MODELS;
  const openAiTools = buildOpenAiTools(params.toolDeclarations);
  const messages: Array<Record<string, unknown>> = [
    { role: 'system', content: params.systemInstruction },
    ...params.history
      .filter((m) => m.text?.trim())
      .slice(-10)
      .map((m) => ({
        role: m.role === 'assistant' ? 'assistant' : 'user',
        content: m.text.trim(),
      })),
  ];

  const supportsVisionDefault = provider === 'openrouter';
  const userContent: unknown =
    supportsVisionDefault && params.activeFrame?.data
      ? [
          { type: 'text', text: params.message },
          {
            type: 'image_url',
            image_url: {
              url: `data:${params.activeFrame.mimeType || 'image/jpeg'};base64,${stripBase64DataUrl(params.activeFrame.data)}`,
            },
          },
        ]
      : params.message;
  messages.push({ role: 'user', content: userContent });

  const requestCompletion = async (
    msgs: Array<Record<string, unknown>>,
    includeTools: boolean,
    toolChoice: 'auto' | 'required' = 'auto',
  ) => {
    let lastErr: unknown;
    for (const apiKey of keys) {
      if (!sharedKeyPool.getAvailableKeys(provider).includes(apiKey)) continue;
      for (const model of models) {
        try {
          const res = await postOpenAiCompatible(provider, apiKey, '/chat/completions', {
            model,
            messages: msgs,
            ...(includeTools ? { tools: openAiTools, tool_choice: toolChoice } : {}),
            max_tokens: 512,
          });
          const data = (await res.json()) as OpenAiChatResponse;
          if (!res.ok) {
            throw Object.assign(
              new Error(data?.error?.message || `${provider} HTTP ${res.status}`),
              { status: res.status },
            );
          }
          sharedKeyPool.markHealthy(provider, apiKey);
          return data;
        } catch (err) {
          lastErr = err;
          const info = classifyUpstreamFailure(err);
          if (info.shouldRotateKey) {
            sharedKeyPool.markFailed(provider, apiKey, info.cooldownMs);
            break;
          }
        }
      }
    }
    throw lastErr || Object.assign(new Error(`${provider} javob bermadi`), { status: 503 });
  };

  const toolOutcomes: ToolOutcome[] = [];
  let completion = await requestCompletion(messages, true, 'auto');

  const firstMsg = completion.choices?.[0]?.message;
  if (!firstMsg?.tool_calls || firstMsg.tool_calls.length === 0) {
    const draftText = extractVisibleModelText(undefined, firstMsg?.content || '');
    if (isLikelyActionRequest(params.message) || looksLikeCompletedClaim(draftText)) {
      const retryMessages: Array<Record<string, unknown>> = [
        ...messages,
        { role: 'assistant', content: draftText || 'Bajaraman.' },
        {
          role: 'user',
          content:
            'DIQQAT: Siz hali birorta ham vosita (tool call) chaqirmadingiz. Og‘zaki "bajarildi" demang — hozirning o‘zida tegishli MCP vositasini chaqiring.',
        },
      ];
      try {
        const retried = await requestCompletion(retryMessages, true, 'required');
        if (retried.choices?.[0]?.message?.tool_calls?.length) {
          messages.splice(0, messages.length, ...retryMessages);
          completion = retried;
        }
      } catch {
        // Fall through to guardEmptyExecutionReply
      }
    }
  }

  for (let step = 0; step < MAX_TOOL_STEPS; step += 1) {
    const assistantMsg = completion.choices?.[0]?.message;
    const toolCalls = assistantMsg?.tool_calls;
    if (!toolCalls || toolCalls.length === 0) {
      const rawReply = extractJarvisReplyText(
        undefined,
        assistantMsg?.content || '',
        params.executedTools.length > 0,
      );
      return {
        reply: guardEmptyExecutionReply(rawReply, toolOutcomes, params.message),
        executedTools: params.executedTools,
      };
    }

    messages.push({
      role: 'assistant',
      content: assistantMsg?.content || '',
      tool_calls: toolCalls,
    });

    for (const call of toolCalls) {
      const toolName = call.function?.name || '';
      let parsedArgs: Record<string, unknown> = {};
      try {
        parsedArgs = call.function?.arguments ? (JSON.parse(call.function.arguments) as Record<string, unknown>) : {};
      } catch {
        parsedArgs = {};
      }
      params.executedTools.push(toolName);
      params.onEvent?.({ type: 'tool_start', tool: toolName });
      try {
        const execRes = await executeDesktopTool(toolName, parsedArgs, params.screenW, params.screenH);
        const ok = Boolean(execRes.responsePayload.ok);
        toolOutcomes.push({
          name: toolName,
          ok,
          ...(ok ? {} : { error: execRes.responsePayload.output }),
        });
        params.onEvent?.({ type: 'tool_done', tool: toolName, ok });
        messages.push({
          role: 'tool',
          tool_call_id: call.id,
          content: JSON.stringify(execRes.responsePayload),
        });
      } catch (err) {
        const errMsg = (err as Error).message;
        toolOutcomes.push({ name: toolName, ok: false, error: errMsg });
        params.onEvent?.({ type: 'tool_done', tool: toolName, ok: false });
        messages.push({
          role: 'tool',
          tool_call_id: call.id,
          content: JSON.stringify({ ok: false, error: errMsg }),
        });
      }
    }

    completion = await requestCompletion(messages, step < MAX_TOOL_STEPS - 1, 'auto');
  }

  const finalRawReply = extractJarvisReplyText(
    undefined,
    completion.choices?.[0]?.message?.content || '',
    params.executedTools.length > 0,
  );
  return {
    reply: guardEmptyExecutionReply(finalRawReply, toolOutcomes, params.message),
    executedTools: params.executedTools,
  };
}

export async function runJarvisChat(
  message: string,
  history: JarvisChatMessage[],
  onEvent?: (event: JarvisStreamEvent) => void,
): Promise<{ reply: string; executedTools: string[] }> {
  if (!hasAnyAiProviderKey()) {
    throw new Error(
      'GEMINI_API_KEY sozlanmagan. Iltimos, Settings > Secrets yoki .env orqali Gemini, Groq yoki OpenRouter API kalitini kiriting.',
    );
  }

  const target = realWin10Bridge.getExecutionTarget();
  const realStatus = realWin10Bridge.getStatus();
  let activeFrame =
    target === 'real-win10' && realStatus.connected
      ? realWin10Bridge.getLatestFrame()
      : realLinuxDesktop.getLatestFrame();

  if (!activeFrame && target !== 'real-win10' && realLinuxDesktop.getStatus().running) {
    activeFrame = await realLinuxDesktop.captureScreenshotFrame(true).catch(() => null);
  }

  const toolDeclarations = buildJarvisToolDeclarations();
  const contents = buildGeminiContents(history, message, activeFrame);

  const executedTools: string[] = [];
  const screenW =
    target === 'real-win10' && realStatus.connected ? realStatus.screenWidth || 1920 : 1280;
  const screenH =
    target === 'real-win10' && realStatus.connected ? realStatus.screenHeight || 1080 : 720;
  const screenInfo =
    target === 'real-win10' && realStatus.connected
      ? `Real Windows 10 Pro PC (${realStatus.hostname || 'PC'}, OS: ${realStatus.osVersion}, User: ${realStatus.username}, Status: ${realStatus.locked ? 'LOCKED (Winlogon lock screen)' : 'UNLOCKED'}, Desktop: ${realStatus.desktopName || 'Default'}, Resolution: ${screenW}x${screenH}). Siz ushbu real PC ni to'liq boshqara olasiz (klaviatura, sichqoncha, lock, unlock, app ochish, h.k.).`
      : `Debian GNU/Linux 12 X11 desktop (${screenW}x${screenH}, DISPLAY=:99). Shuningdek Real Windows 10 PC agentini ulashingiz mumkin.`;

  const systemInstruction = buildJarvisSystemInstruction(screenInfo);

  let lastError: unknown;

  if (getOrderedKeysForAttempt('gemini').length > 0) {
    try {
      const toolOutcomes: ToolOutcome[] = [];
      let response = await generateGeminiWithKeyRotation({
        contents,
        systemInstruction,
        toolDeclarations,
      });

      if (!response.functionCalls || response.functionCalls.length === 0) {
        const draftText = extractVisibleModelText(
          response.candidates?.[0]?.content?.parts as Array<{ text?: string; thought?: boolean }> | undefined,
          response.text,
        );
        if (isLikelyActionRequest(message) || looksLikeCompletedClaim(draftText)) {
          const retryContents: Content[] = [
            ...contents,
            { role: 'model', parts: [{ text: draftText || 'Tushundim.' }] },
            {
              role: 'user',
              parts: [
                {
                  text: 'DIQQAT: Siz hali birorta ham tool/function call chaqirmadingiz! Faqat matn bilan "bajarildi" demang. Hozirning o‘zida tegishli MCP vositasini chaqiring.',
                },
              ],
            },
          ];
          try {
            const retried = await generateGeminiWithKeyRotation({
              contents: retryContents,
              systemInstruction,
              toolDeclarations,
              toolConfig: {
                functionCallingConfig: { mode: FunctionCallingConfigMode.ANY },
              },
            });
            if (retried.functionCalls && retried.functionCalls.length > 0) {
              contents.splice(0, contents.length, ...retryContents);
              response = retried;
            }
          } catch {
            // If forced tool mode isn't supported on a fallback model, guardEmptyExecutionReply protects below
          }
        }
      }

      for (let step = 0; step < MAX_TOOL_STEPS; step += 1) {
        const calls = response.functionCalls;
        if (!calls || calls.length === 0) break;

        const modelContent = response.candidates?.[0]?.content;
        if (modelContent) {
          contents.push(modelContent);
        }

        const responseParts: Part[] = [];
        for (const call of calls) {
          const toolName = call.name || '';
          const toolArgs = (call.args || {}) as Record<string, unknown>;
          executedTools.push(toolName);
          onEvent?.({ type: 'tool_start', tool: toolName });
          try {
            const execRes = await executeDesktopTool(toolName, toolArgs, screenW, screenH);
            const ok = Boolean(execRes.responsePayload.ok);
            toolOutcomes.push({
              name: toolName,
              ok,
              ...(ok ? {} : { error: execRes.responsePayload.output }),
            });
            onEvent?.({ type: 'tool_done', tool: toolName, ok });
            responseParts.push({
              functionResponse: {
                ...(call.id ? { id: call.id } : {}),
                name: toolName,
                response: execRes.responsePayload,
              },
            });
            for (const img of execRes.images) {
              responseParts.push({
                inlineData: {
                  mimeType: img.mimeType,
                  data: img.data,
                },
              });
            }
          } catch (err) {
            const errMsg = (err as Error).message;
            toolOutcomes.push({ name: toolName, ok: false, error: errMsg });
            onEvent?.({ type: 'tool_done', tool: toolName, ok: false });
            responseParts.push({
              functionResponse: {
                ...(call.id ? { id: call.id } : {}),
                name: toolName,
                response: { ok: false, error: errMsg },
              },
            });
          }
        }

        contents.push({ role: 'user', parts: responseParts });
        response = await generateGeminiWithKeyRotation({
          contents,
          systemInstruction,
          toolDeclarations: step === MAX_TOOL_STEPS - 1 ? undefined : toolDeclarations,
        });
      }

      const rawReply = extractJarvisReplyText(
        response.candidates?.[0]?.content?.parts as Array<{ text?: string; thought?: boolean }> | undefined,
        response.text,
        executedTools.length > 0,
      );

      return {
        reply: guardEmptyExecutionReply(rawReply, toolOutcomes, message),
        executedTools,
      };
    } catch (err) {
      lastError = err;
      const info = classifyUpstreamFailure(err);
      if (info.status === 400) {
        throw err;
      }
    }
  }

  for (const fallbackProvider of ['groq', 'openrouter'] as const) {
    if (getOrderedKeysForAttempt(fallbackProvider).length === 0) continue;
    try {
      return await runOpenAiProviderChat(fallbackProvider, {
        message,
        history,
        activeFrame,
        systemInstruction,
        toolDeclarations,
        screenW,
        screenH,
        executedTools: [],
        onEvent,
      });
    } catch (err) {
      lastError = err;
    }
  }

  throw lastError || new Error('Barcha AI API provayderlari band yoki limiti tugagan.');
}

function extractVisibleModelText(
  parts?: Array<{ text?: string; thought?: boolean }>,
  fallbackText?: string,
): string {
  if (Array.isArray(parts) && parts.length > 0) {
    const visible = parts
      .filter(
        (p) =>
          !p.thought &&
          typeof p.text === 'string' &&
          !/^thought(?:\r?\n|\s)/i.test(p.text.trim()),
      )
      .map((p) => String(p.text).trim())
      .filter(Boolean);
    if (visible.length > 0) {
      return visible.join('\n').replace(/^,\s+/, '').trim();
    }
  }
  return String(fallbackText || '')
    .replace(/^thought(?:\r?\n|\s)+[^\r\n]*(?:\r?\n)?/i, '')
    .replace(/^,\s+/, '')
    .trim();
}

export function extractJarvisReplyText(
  parts?: Array<{ text?: string; thought?: boolean }>,
  fallbackText?: string,
  hasExecutedTools = true,
): string {
  const visible = extractVisibleModelText(parts, fallbackText);
  if (visible) return visible;
  return hasExecutedTools ? 'Buyruq bajarildi.' : '';
}

export function normalizeAudioMimeType(mimeType?: string): string {
  const base = String(mimeType || 'audio/webm').split(';')[0].trim().toLowerCase();
  if (!base || !base.startsWith('audio/')) return 'audio/webm';
  return base;
}

async function convertAudioToCleanWav(
  base64Audio: string,
  cleanMime: string,
): Promise<{ base64: string; mimeType: string }> {
  const rawBase64 = stripBase64DataUrl(base64Audio);
  if (cleanMime === 'audio/wav') {
    return { base64: rawBase64, mimeType: 'audio/wav' };
  }
  const ext = cleanMime.includes('mp4') ? 'mp4' : cleanMime.includes('ogg') ? 'ogg' : 'webm';
  const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
  const inPath = path.join(os.tmpdir(), `jarvis-stt-${id}.${ext}`);
  const outPath = path.join(os.tmpdir(), `jarvis-stt-${id}.wav`);
  try {
    await fs.writeFile(inPath, Buffer.from(rawBase64, 'base64'));
    await execFileAsync(
      'ffmpeg',
      ['-y', '-i', inPath, '-af', 'highpass=f=80', '-ar', '16000', '-ac', '1', '-c:a', 'pcm_s16le', outPath],
      { timeout: 8000 },
    );
    const wavBuf = await fs.readFile(outPath);
    if (wavBuf.length > 44) {
      return { base64: wavBuf.toString('base64'), mimeType: 'audio/wav' };
    }
  } catch {
    // Fallback to original browser audio if ffmpeg fails
  } finally {
    await fs.unlink(inPath).catch(() => {});
    await fs.unlink(outPath).catch(() => {});
  }
  return { base64: rawBase64, mimeType: cleanMime };
}

const UZBEK_STT_SYSTEM_INSTRUCTION =
  'You are an Uzbek-only speech-to-text transcriber for the J.A.R.V.I.S. desktop assistant created by shoh_tech. ' +
  'CRITICAL RULE: The user is speaking Uzbek (O‘zbek tili) using the Uzbek Latin alphabet (a-z, o‘, g‘, sh, ch, ng), occasionally mentioning tech words like Jarvis, shoh_tech, Terminal, Calculator, Chromium, Mousepad, Linux, Windows. ' +
  'NEVER output Chinese/Japanese/Korean characters, Arabic/Urdu script, Hindi/Devanagari script, Turkish letters (ı/ğ/ş/ç/ö/ü), Albanian (ë), or unrelated English translations. ' +
  'Return ONLY the exact spoken Uzbek Latin text with no quotes or explanation. ' +
  'If the audio contains only silence, breathing, clicks, or unintelligible background noise, return an empty string.';

async function transcribeWithGroqKey(
  apiKey: string,
  audioBase64: string,
  mimeType: string,
): Promise<string> {
  const buf = Buffer.from(audioBase64, 'base64');
  const ext = mimeType === 'audio/wav' ? 'wav' : mimeType.includes('mp4') ? 'm4a' : 'webm';
  const form = new FormData();
  form.append('file', new Blob([buf], { type: mimeType }), `speech.${ext}`);
  form.append('model', GROQ_STT_MODEL);
  form.append('language', 'uz');
  form.append('temperature', '0');
  form.append(
    'prompt',
    'O‘zbek tilida lotin alifbosida yozing: Salom, Jarvis, shoh_tech, terminalni och, kalkulyatorni ishga tushir, brauzerni och, barcha ilovalarni yop.',
  );

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  try {
    const res = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
      signal: controller.signal,
    });
    const data = (await res.json()) as { text?: string; error?: { message?: string } };
    if (!res.ok) {
      throw Object.assign(new Error(data?.error?.message || `Groq STT HTTP ${res.status}`), {
        status: res.status,
      });
    }
    return cleanUzbekTranscript(data.text || '');
  } finally {
    clearTimeout(timer);
  }
}

async function transcribeWithOpenRouterKey(
  apiKey: string,
  wavBase64: string,
  mimeType: string,
): Promise<string> {
  const format = mimeType === 'audio/wav' ? 'wav' : 'mp3';
  const res = await postOpenAiCompatible('openrouter', apiKey, '/chat/completions', {
    model: OPENROUTER_STT_MODEL,
    messages: [
      { role: 'system', content: UZBEK_STT_SYSTEM_INSTRUCTION },
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Transcribe this Uzbek speech accurately in Uzbek Latin script.' },
          { type: 'input_audio', input_audio: { data: wavBase64, format } },
        ],
      },
    ],
    max_tokens: 256,
  });
  const data = (await res.json()) as OpenAiChatResponse;
  if (!res.ok) {
    throw Object.assign(new Error(data?.error?.message || `OpenRouter STT HTTP ${res.status}`), {
      status: res.status,
    });
  }
  return cleanUzbekTranscript(data.choices?.[0]?.message?.content || '');
}

export async function transcribeJarvisAudio(base64Audio: string, mimeType: string): Promise<string> {
  if (!hasAnyAiProviderKey()) {
    throw new Error(
      'GEMINI_API_KEY sozlanmagan. Iltimos, Settings > Secrets yoki .env orqali API kalit kiriting.',
    );
  }

  const cleanMime = normalizeAudioMimeType(mimeType);
  const prepared = await convertAudioToCleanWav(base64Audio, cleanMime);
  let lastError: unknown;

  // 1. Primary: Gemini API across configured models and GEMINI_API_KEY* keys
  const sttModels = [GEMINI_CHAT_MODEL, GEMINI_FALLBACK_MODEL];
  const allowCooledFallback = !hasBackupProvidersReady();
  for (const model of sttModels) {
    const geminiKeys = sharedKeyPool.getAvailableKeysForModel(
      'gemini',
      model,
      process.env,
      Date.now(),
      allowCooledFallback,
    );
    for (const apiKey of geminiKeys) {
      const ai = createGeminiClient(apiKey);
      try {
        const response = await ai.models.generateContent({
          model,
          contents: {
            parts: [
              {
                inlineData: {
                  mimeType: prepared.mimeType,
                  data: prepared.base64,
                },
              },
              {
                text: 'Transcribe the Uzbek speech in this audio in Uzbek Latin script only. Return empty string if silence or noise.',
              },
            ],
          },
          config: {
            systemInstruction: UZBEK_STT_SYSTEM_INSTRUCTION,
            thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
          },
        });
        sharedKeyPool.markModelHealthy('gemini', model, apiKey);
        const visibleText = extractVisibleModelText(
          response.candidates?.[0]?.content?.parts as Array<{ text?: string; thought?: boolean }> | undefined,
          response.text,
        );
        return cleanUzbekTranscript(visibleText);
      } catch (err) {
        lastError = err;
        const info = classifyUpstreamFailure(err);
        if (info.status === 400) {
          throw err;
        }
        if (info.keyInvalid) {
          sharedKeyPool.markFailed('gemini', apiKey, info.cooldownMs);
        } else if (info.shouldRotateKey) {
          sharedKeyPool.markModelFailed('gemini', model, apiKey, info.cooldownMs);
        }
      }
    }
  }

  // 2. Failover: Groq Whisper across all configured GROQ_API_KEY* keys
  const groqKeys = getOrderedKeysForAttempt('groq');
  for (const apiKey of groqKeys) {
    try {
      const text = await transcribeWithGroqKey(apiKey, prepared.base64, prepared.mimeType);
      sharedKeyPool.markHealthy('groq', apiKey);
      return text;
    } catch (err) {
      lastError = err;
      const info = classifyUpstreamFailure(err);
      if (info.shouldRotateKey) {
        sharedKeyPool.markFailed('groq', apiKey, info.cooldownMs);
      }
    }
  }

  // 3. Failover: OpenRouter multimodal audio across all configured OPENROUTER_API_KEY* keys
  const openRouterKeys = getOrderedKeysForAttempt('openrouter');
  for (const apiKey of openRouterKeys) {
    try {
      const text = await transcribeWithOpenRouterKey(apiKey, prepared.base64, prepared.mimeType);
      sharedKeyPool.markHealthy('openrouter', apiKey);
      return text;
    } catch (err) {
      lastError = err;
      const info = classifyUpstreamFailure(err);
      if (info.shouldRotateKey) {
        sharedKeyPool.markFailed('openrouter', apiKey, info.cooldownMs);
      }
    }
  }

  if (lastError) {
    throw lastError;
  }
  return '';
}

let ttsPrimaryCooldownUntil = 0;

export async function synthesizeJarvisSpeech(
  text: string,
): Promise<{ audioBase64: string; mimeType: string }> {
  const speechText = prepareTextForUzbekTts(text);
  if (!speechText) {
    throw Object.assign(new Error('Ovozga aylantirish uchun matn topilmadi.'), { status: 400 });
  }
  if (!hasAnyAiProviderKey()) {
    throw new Error(
      'GEMINI_API_KEY sozlanmagan. Iltimos, Settings > Secrets yoki .env orqali API kalit kiriting.',
    );
  }

  let lastError: unknown;

  // 1. Primary: Gemini TTS across configured models and GEMINI_API_KEY* keys
  const ttsModels =
    Date.now() < ttsPrimaryCooldownUntil
      ? [GEMINI_TTS_FALLBACK_MODEL, GEMINI_TTS_PRIMARY_MODEL]
      : [GEMINI_TTS_PRIMARY_MODEL, GEMINI_TTS_FALLBACK_MODEL];
  const allowCooledFallback = !hasBackupProvidersReady();

  for (const model of ttsModels) {
    const geminiKeys = sharedKeyPool.getAvailableKeysForModel(
      'gemini',
      model,
      process.env,
      Date.now(),
      allowCooledFallback,
    );
    for (const apiKey of geminiKeys) {
      const ai = createGeminiClient(apiKey);
      try {
        const response = await ai.models.generateContent({
          model,
          contents: [
            {
              role: 'user',
              parts: [
                {
                  text: speechText,
                  speechMetadata: {
                    style:
                      'Calm, composed, loyal, authoritative male J.A.R.V.I.S. assistant speaking pure natural Uzbek (O‘zbek tili) with native Uzbek pronunciation',
                  },
                },
              ],
            },
          ],
          config: {
            responseModalities: ['AUDIO'],
            speechConfig: {
              voiceConfig: {
                prebuiltVoiceConfig: { voiceName: 'Charon' },
              },
            },
          },
        });

        const parts = response.candidates?.[0]?.content?.parts || [];
        const audioPart = parts.find((part) => Boolean(part.inlineData?.data));
        const audioBase64 = audioPart?.inlineData?.data;
        if (!audioBase64) {
          throw new Error('J.A.R.V.I.S. ovoz sintezidan audio ma‘lumot qaytmadi.');
        }

        sharedKeyPool.markModelHealthy('gemini', model, apiKey);
        return {
          audioBase64,
          mimeType: audioPart?.inlineData?.mimeType || 'audio/wav',
        };
      } catch (err) {
        lastError = err;
        const info = classifyUpstreamFailure(err);
        if (info.status === 400) {
          throw err;
        }
        if (info.keyInvalid) {
          sharedKeyPool.markFailed('gemini', apiKey, info.cooldownMs);
        } else if (info.shouldRotateKey) {
          sharedKeyPool.markModelFailed('gemini', model, apiKey, info.cooldownMs);
          if (model === GEMINI_TTS_PRIMARY_MODEL && (info.status === 503 || info.status === 429)) {
            ttsPrimaryCooldownUntil = Date.now() + 30_000;
          }
        }
      }
    }
  }

  // 2. Failover: Groq TTS across GROQ_API_KEY* keys
  const groqKeys = getOrderedKeysForAttempt('groq');
  for (const apiKey of groqKeys) {
    try {
      const res = await postOpenAiCompatible('groq', apiKey, '/audio/speech', {
        model: GROQ_TTS_MODEL,
        input: speechText,
        voice: 'troy',
        response_format: 'wav',
      });
      if (!res.ok) {
        const errBody = await res.text().catch(() => '');
        throw Object.assign(new Error(errBody || `Groq TTS HTTP ${res.status}`), {
          status: res.status,
        });
      }
      const arr = await res.arrayBuffer();
      if (arr.byteLength > 44) {
        sharedKeyPool.markHealthy('groq', apiKey);
        return {
          audioBase64: Buffer.from(arr).toString('base64'),
          mimeType: 'audio/wav',
        };
      }
    } catch (err) {
      lastError = err;
      const info = classifyUpstreamFailure(err);
      if (info.shouldRotateKey) {
        sharedKeyPool.markFailed('groq', apiKey, info.cooldownMs);
      }
    }
  }

  // 3. Failover: OpenRouter Audio TTS across OPENROUTER_API_KEY* keys
  const openRouterKeys = getOrderedKeysForAttempt('openrouter');
  for (const apiKey of openRouterKeys) {
    try {
      const res = await postOpenAiCompatible('openrouter', apiKey, '/chat/completions', {
        model: OPENROUTER_TTS_MODEL,
        modalities: ['text', 'audio'],
        audio: { voice: 'onyx', format: 'wav' },
        messages: [
          {
            role: 'system',
            content:
              'Read the user text aloud verbatim in natural Uzbek (O‘zbek tili) with a calm J.A.R.V.I.S. male voice. Do not add extra words.',
          },
          { role: 'user', content: speechText },
        ],
      });
      const data = (await res.json()) as OpenAiChatResponse;
      if (!res.ok) {
        throw Object.assign(new Error(data?.error?.message || `OpenRouter TTS HTTP ${res.status}`), {
          status: res.status,
        });
      }
      const audioData = data.choices?.[0]?.message?.audio?.data;
      if (audioData) {
        sharedKeyPool.markHealthy('openrouter', apiKey);
        return {
          audioBase64: audioData,
          mimeType: 'audio/wav',
        };
      }
    } catch (err) {
      lastError = err;
      const info = classifyUpstreamFailure(err);
      if (info.shouldRotateKey) {
        sharedKeyPool.markFailed('openrouter', apiKey, info.cooldownMs);
      }
    }
  }

  throw lastError || new Error('Ovoz sintezi uchun barcha AI API kalitlari band yoki limiti tugagan.');
}
