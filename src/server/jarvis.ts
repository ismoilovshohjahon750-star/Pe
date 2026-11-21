import {
  GoogleGenAI,
  ThinkingLevel,
  Type,
  type Content,
  type FunctionDeclaration,
  type Part,
  type Schema,
} from '@google/genai';
import { prepareTextForSpeech } from '../utils/voiceSession.ts';
import { getMcpToolManifest, handleJsonRpcMessage } from './mcp.ts';
import { realLinuxDesktop } from './realLinuxDesktop.ts';
import { realWin10Bridge } from './realWin10Bridge.ts';

const GEMINI_CHAT_MODEL = 'gemini-3.1-flash-lite';
const GEMINI_FALLBACK_MODEL = 'gemini-4-hydrogen';
const GEMINI_TRANSCRIBE_MODEL = 'gemini-3.5-transcribe';
const GEMINI_TTS_PRIMARY_MODEL = 'gemini-3.8-flash-lite-tts';
const GEMINI_TTS_FALLBACK_MODEL = 'gemini-3.8-flash-tts';
const MAX_TOOL_STEPS = 8;

function getGeminiClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') {
    throw new Error(
      'GEMINI_API_KEY sozlanmagan. Iltimos, Settings > Secrets bo‘limidan GEMINI_API_KEY kiriting.',
    );
  }
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

  if (cleanMsg.includes('GEMINI_API_KEY')) {
    return { status: 503, message: cleanMsg };
  }
  if (
    statusProp === 403 ||
    rawMsg.includes('PERMISSION_DENIED') ||
    rawMsg.includes('API_KEY_INVALID') ||
    cleanMsg.toLowerCase().includes('api key not valid') ||
    (statusProp === 400 && cleanMsg.toLowerCase().includes('api key'))
  ) {
    return {
      status: statusProp === 400 ? 400 : 403,
      message:
        'Gemini API kaliti yaroqsiz yoki ruxsat berilmagan. Iltimos, Settings > Secrets bo‘limidan GEMINI_API_KEY ni tekshiring.',
    };
  }
  if (statusProp === 429 || rawMsg.includes('RESOURCE_EXHAUSTED')) {
    return {
      status: 429,
      message: 'Gemini API so‘rov limiti tugadi (429). Biroz kutib qayta urinib ko‘ring.',
    };
  }
  if (statusProp === 503 || rawMsg.includes('UNAVAILABLE')) {
    return {
      status: 503,
      message:
        'Gemini serveri hozir band (503). Iltimos, bir necha soniyadan keyin qayta yuboring.',
    };
  }
  if (statusProp === 404 || rawMsg.includes('NOT_FOUND')) {
    return {
      status: 404,
      message: `Gemini modeli topilmadi: ${cleanMsg}`,
    };
  }
  if (
    cleanMsg.toLowerCase().includes('aborted') ||
    cleanMsg.toLowerCase().includes('timeout') ||
    statusProp === 504
  ) {
    return {
      status: 504,
      message: 'Gemini javob berishi biroz cho‘zildi. Iltimos, qayta urinib ko‘ring.',
    };
  }
  return {
    status: Number.isFinite(statusProp) && statusProp >= 400 ? statusProp : 500,
    message: cleanMsg,
  };
}

let primaryCooldownUntil = 0;

async function generateWithFallback(
  ai: GoogleGenAI,
  params: {
    contents: Content[];
    systemInstruction: string;
    toolDeclarations?: FunctionDeclaration[];
  },
) {
  const models =
    Date.now() < primaryCooldownUntil
      ? [GEMINI_FALLBACK_MODEL, GEMINI_CHAT_MODEL]
      : [GEMINI_CHAT_MODEL, GEMINI_FALLBACK_MODEL];
  const prunedContents = pruneOldScreenshots(params.contents, 1);
  let lastError: unknown;

  for (const model of models) {
    try {
      return await ai.models.generateContent({
        model,
        contents: prunedContents,
        config: {
          systemInstruction: params.systemInstruction,
          thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
          ...(params.toolDeclarations
            ? { tools: [{ functionDeclarations: params.toolDeclarations }] }
            : {}),
        },
      });
    } catch (err) {
      lastError = err;
      const formatted = formatGeminiError(err);
      if (formatted.status === 400 || formatted.status === 403 || formatted.status === 404) {
        throw err;
      }
      if (model === GEMINI_CHAT_MODEL && (formatted.status === 503 || formatted.status === 429 || formatted.status >= 500)) {
        primaryCooldownUntil = Date.now() + 60_000;
      }
    }
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
      output: textParts || 'Completed',
    },
    images,
  };
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
    'Koordinata qoidasi: desktop_click, desktop_move, desktop_drag, desktop_scroll vositalarida x va y qiymatlarni 0..1000 oralig‘ida ber (0 = chap/yuqori chekka, 500 = markaz, 1000 = o‘ng/pastki chekka); tizim ularni avtomatik ekran piksellariga o‘giradi. ' +
    'Veb-sahifadagi tugmalar/havolalar/oyna tugmalari uchun desktop_click(..., button: "left") ishlat; ish stoli yorliqlari (Desktop icons) uchun button: "double" yoki open_app ishlat. ' +
    'desktop_click bajarilgandan keyin yangilangan ekran rasmi qaytadi — tugma holati o‘zgarganini tekshir; o‘zgarmagan bo‘lsa aniqroq (x, y) ga yana bir marta bos, o‘zgargan bo‘lsa darhol hisobot ber. ' +
    'Agar vosita "Browser screen share supports viewing/desktop_screenshot only" xatosini qaytarsa, boshqa bosishga urinma va real-pc-agent.py ni ishga tushirish kerakligini tushuntir. ' +
    'Ovozli muloqot va matn qoidasi: javoblaring foydalanuvchi tilida (odatda o‘zbek tilida), iloji boricha qisqa va lo‘nda (odatda 1-2 ta tabiiy gap), ovoz chiqarib o‘qishga qulay bo‘lsin; *, **, ` kabi markdown belgilarni ishlatma.'
  );
}

export async function runJarvisChat(
  message: string,
  history: JarvisChatMessage[],
  onEvent?: (event: JarvisStreamEvent) => void,
): Promise<{ reply: string; executedTools: string[] }> {
  const ai = getGeminiClient();
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
    target === 'real-win10' && realStatus.connected ? realStatus.screenWidth || 1280 : 1280;
  const screenH =
    target === 'real-win10' && realStatus.connected ? realStatus.screenHeight || 720 : 720;
  const screenInfo =
    target === 'real-win10' && realStatus.connected
      ? `Haqiqiy PC (${realStatus.hostname}, ${screenW}x${screenH})`
      : `Debian GNU/Linux 12 X11 desktop (${screenW}x${screenH}, DISPLAY=:99, root)`;

  const systemInstruction = buildJarvisSystemInstruction(screenInfo);

  let response = await generateWithFallback(ai, {
    contents,
    systemInstruction,
    toolDeclarations,
  });

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
        onEvent?.({ type: 'tool_done', tool: toolName, ok: execRes.responsePayload.ok });
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
        onEvent?.({ type: 'tool_done', tool: toolName, ok: false });
        responseParts.push({
          functionResponse: {
            ...(call.id ? { id: call.id } : {}),
            name: toolName,
            response: { ok: false, error: (err as Error).message },
          },
        });
      }
    }

    contents.push({ role: 'user', parts: responseParts });
    response = await generateWithFallback(ai, {
      contents,
      systemInstruction,
      toolDeclarations: step === MAX_TOOL_STEPS - 1 ? undefined : toolDeclarations,
    });
  }

  const reply = extractJarvisReplyText(
    response.candidates?.[0]?.content?.parts as Array<{ text?: string; thought?: boolean }> | undefined,
    response.text,
  );

  return {
    reply,
    executedTools,
  };
}

export function extractJarvisReplyText(
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
      return visible.join('\n').replace(/^,\s+/, '').trim() || 'Buyruq bajarildi.';
    }
  }
  const cleanFallback = String(fallbackText || '')
    .replace(/^thought(?:\r?\n|\s)+[^\r\n]*(?:\r?\n)?/i, '')
    .replace(/^,\s+/, '')
    .trim();
  return cleanFallback || 'Buyruq bajarildi.';
}

export function normalizeAudioMimeType(mimeType?: string): string {
  const base = String(mimeType || 'audio/webm').split(';')[0].trim().toLowerCase();
  if (!base || !base.startsWith('audio/')) return 'audio/webm';
  return base;
}

const NON_UZBEK_SCRIPT_RE = /[\u0600-\u06FF\u0900-\u097F\u0980-\u09FF\u0400-\u04FF\u4E00-\u9FFF]/;
const NON_UZBEK_LATIN_RE = /[ıİğĞşŞçÇüÜöÖëËäÄ]/;

export async function transcribeJarvisAudio(base64Audio: string, mimeType: string): Promise<string> {
  const ai = getGeminiClient();
  const cleanMime = normalizeAudioMimeType(mimeType);
  const audioContents = {
    parts: [
      {
        inlineData: {
          mimeType: cleanMime,
          data: stripBase64DataUrl(base64Audio),
        },
      },
      {
        text:
          'Listen carefully to the audio. The speaker is speaking Uzbek (O‘zbek tili) commands to a computer assistant named J.A.R.V.I.S. (created by shoh_tech). ' +
          'Common Uzbek phrases include opening/closing apps (terminalni och, kalkulyatorni ishga tushir, brauzerni och, barcha ilovalarni yop), asking questions (seni kim yaratgan, ekranda nima bor), or typing/clicking. ' +
          'Transcribe the EXACT spoken words in standard Uzbek Latin script (using o‘, g‘, sh, ch — NEVER Turkish ı/ş/ğ/ç/ö/ü, NEVER Albanian ë, NEVER Arabic/Urdu/Hindi/Cyrillic). ' +
          'Return ONLY the exact transcribed text with no quotes or extra words. ' +
          'If there is only silence, breathing, or background noise with no clear speech, return an empty string.',
      },
    ],
  };

  const models = [GEMINI_FALLBACK_MODEL, GEMINI_CHAT_MODEL, GEMINI_TRANSCRIBE_MODEL];
  for (let i = 0; i < models.length; i += 1) {
    const model = models[i];
    const isLast = i === models.length - 1;
    try {
      const response = await ai.models.generateContent({
        model,
        contents: audioContents,
        ...(model !== GEMINI_TRANSCRIBE_MODEL
          ? { config: { thinkingConfig: { thinkingLevel: ThinkingLevel.LOW } } }
          : {}),
      });
      const raw = (response.text || '').trim().replace(/^["'«»]+|["'«»]+$/g, '').trim();
      if (!raw || /^\[?(?:silence|no speech|inaudible|jimlik|empty)\]?$/i.test(raw)) {
        return '';
      }
      if (!isLast && (NON_UZBEK_SCRIPT_RE.test(raw) || NON_UZBEK_LATIN_RE.test(raw))) {
        continue;
      }
      return raw;
    } catch (err) {
      const formatted = formatGeminiError(err);
      if (isLast || (formatted.status !== 503 && formatted.status !== 429 && formatted.status < 500)) {
        throw err;
      }
    }
  }

  return '';
}

let ttsPrimaryCooldownUntil = 0;

export async function synthesizeJarvisSpeech(
  text: string,
): Promise<{ audioBase64: string; mimeType: string }> {
  const speechText = prepareTextForSpeech(text);
  if (!speechText) {
    throw Object.assign(new Error('Ovozga aylantirish uchun matn topilmadi.'), { status: 400 });
  }

  const ai = getGeminiClient();
  const models =
    Date.now() < ttsPrimaryCooldownUntil
      ? [GEMINI_TTS_FALLBACK_MODEL, GEMINI_TTS_PRIMARY_MODEL]
      : [GEMINI_TTS_PRIMARY_MODEL, GEMINI_TTS_FALLBACK_MODEL];

  let lastError: unknown;
  for (const model of models) {
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
                    'Calm, composed, loyal, subtly witty British-butler AI assistant voice like J.A.R.V.I.S., clear natural Uzbek articulation',
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

      return {
        audioBase64,
        mimeType: audioPart?.inlineData?.mimeType || 'audio/wav',
      };
    } catch (err) {
      lastError = err;
      const formatted = formatGeminiError(err);
      if (formatted.status === 400 || formatted.status === 403 || formatted.status === 404) {
        throw err;
      }
      if (
        model === GEMINI_TTS_PRIMARY_MODEL &&
        (formatted.status === 503 || formatted.status === 429 || formatted.status >= 500)
      ) {
        ttsPrimaryCooldownUntil = Date.now() + 60_000;
      }
    }
  }

  throw lastError;
}
