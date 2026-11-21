import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';

const ENV_PATH = path.resolve(process.cwd(), '.env');

export function getSettingsKeys(): {
  geminiKeys: string[];
  groqKeys: string[];
  openRouterKeys: string[];
} {
  try {
    if (fs.existsSync(ENV_PATH)) {
      dotenv.config({ path: ENV_PATH, override: true });
    }
  } catch {
    // ignore
  }

  const geminiKeys: string[] = [];
  const groqKeys: string[] = [];
  const openRouterKeys: string[] = [];

  for (let i = 1; i <= 20; i += 1) {
    const g = process.env[`GEMINI_API_KEY_${i}`];
    if (g && g.trim() && !g.includes('MY_') && !g.includes('YOUR_')) geminiKeys.push(g.trim());

    const gr = process.env[`GROQ_API_KEY_${i}`];
    if (gr && gr.trim() && !gr.includes('MY_') && !gr.includes('YOUR_')) groqKeys.push(gr.trim());

    const o = process.env[`OPENROUTER_API_KEY_${i}`];
    if (o && o.trim() && !o.includes('MY_') && !o.includes('YOUR_')) openRouterKeys.push(o.trim());
  }

  const singleGemini = process.env.GEMINI_API_KEY;
  if (singleGemini && singleGemini.trim() && !singleGemini.includes('MY_') && !singleGemini.includes('YOUR_')) {
    if (!geminiKeys.includes(singleGemini.trim())) geminiKeys.push(singleGemini.trim());
  }
  const pluralGemini = process.env.GEMINI_API_KEYS;
  if (pluralGemini) {
    for (const p of pluralGemini.split(/[\s,;]+/)) {
      const c = p.trim().replace(/^["']+|["']+$/g, '');
      if (c && c.length >= 8 && !c.includes('MY_') && !c.includes('YOUR_') && !geminiKeys.includes(c)) {
        geminiKeys.push(c);
      }
    }
  }

  const singleGroq = process.env.GROQ_API_KEY;
  if (singleGroq && singleGroq.trim() && !singleGroq.includes('MY_') && !singleGroq.includes('YOUR_')) {
    if (!groqKeys.includes(singleGroq.trim())) groqKeys.push(singleGroq.trim());
  }
  const pluralGroq = process.env.GROQ_API_KEYS;
  if (pluralGroq) {
    for (const p of pluralGroq.split(/[\s,;]+/)) {
      const c = p.trim().replace(/^["']+|["']+$/g, '');
      if (c && c.length >= 8 && !c.includes('MY_') && !c.includes('YOUR_') && !groqKeys.includes(c)) {
        groqKeys.push(c);
      }
    }
  }

  const singleOpenRouter = process.env.OPENROUTER_API_KEY;
  if (singleOpenRouter && singleOpenRouter.trim() && !singleOpenRouter.includes('MY_') && !singleOpenRouter.includes('YOUR_')) {
    if (!openRouterKeys.includes(singleOpenRouter.trim())) openRouterKeys.push(singleOpenRouter.trim());
  }
  const pluralOpenRouter = process.env.OPENROUTER_API_KEYS;
  if (pluralOpenRouter) {
    for (const p of pluralOpenRouter.split(/[\s,;]+/)) {
      const c = p.trim().replace(/^["']+|["']+$/g, '');
      if (c && c.length >= 8 && !c.includes('MY_') && !c.includes('YOUR_') && !openRouterKeys.includes(c)) {
        openRouterKeys.push(c);
      }
    }
  }

  return { geminiKeys, groqKeys, openRouterKeys };
}

export function saveSettingsKeys(data: {
  geminiKeys?: string[];
  groqKeys?: string[];
  openRouterKeys?: string[];
}): void {
  const envLines: string[] = [];

  const cleanList = (list?: string[]) =>
    (list || []).map((k) => k.trim()).filter((k) => k.length >= 8 && !k.includes('MY_') && !k.includes('YOUR_'));

  const gemini = cleanList(data.geminiKeys);
  const groq = cleanList(data.groqKeys);
  const openRouter = cleanList(data.openRouterKeys);

  if (gemini.length > 0) {
    envLines.push(`GEMINI_API_KEY="${gemini[0]}"`);
    envLines.push(`GEMINI_API_KEYS="${gemini.join(',')}"`);
    gemini.forEach((k, idx) => {
      envLines.push(`GEMINI_API_KEY_${idx + 1}="${k}"`);
      process.env[`GEMINI_API_KEY_${idx + 1}`] = k;
    });
    process.env.GEMINI_API_KEY = gemini[0];
    process.env.GEMINI_API_KEYS = gemini.join(',');
  }

  if (groq.length > 0) {
    envLines.push(`GROQ_API_KEY="${groq[0]}"`);
    envLines.push(`GROQ_API_KEYS="${groq.join(',')}"`);
    groq.forEach((k, idx) => {
      envLines.push(`GROQ_API_KEY_${idx + 1}="${k}"`);
      process.env[`GROQ_API_KEY_${idx + 1}`] = k;
    });
    process.env.GROQ_API_KEY = groq[0];
    process.env.GROQ_API_KEYS = groq.join(',');
  }

  if (openRouter.length > 0) {
    envLines.push(`OPENROUTER_API_KEY="${openRouter[0]}"`);
    envLines.push(`OPENROUTER_API_KEYS="${openRouter.join(',')}"`);
    openRouter.forEach((k, idx) => {
      envLines.push(`OPENROUTER_API_KEY_${idx + 1}="${k}"`);
      process.env[`OPENROUTER_API_KEY_${idx + 1}`] = k;
    });
    process.env.OPENROUTER_API_KEY = openRouter[0];
    process.env.OPENROUTER_API_KEYS = openRouter.join(',');
  }

  if (process.env.APP_URL) {
    envLines.push(`APP_URL="${process.env.APP_URL}"`);
  }

  fs.writeFileSync(ENV_PATH, envLines.join('\n') + '\n', 'utf-8');
  dotenv.config({ path: ENV_PATH, override: true });
}
