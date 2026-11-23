import assert from 'node:assert/strict';
import test from 'node:test';
import { getMcpToolManifest } from './mcp.ts';
import {
  buildGeminiContents,
  buildJarvisSystemInstruction,
  buildJarvisToolDeclarations,
  extractJarvisReplyText,
  formatGeminiError,
  normalizeAudioMimeType,
  pruneOldScreenshots,
  scaleNormalizedPoint,
  stripBase64DataUrl,
} from './jarvis.ts';

test('J.A.R.V.I.S. exposes every MCP tool with matching schema declarations', () => {
  const mcpTools = getMcpToolManifest();
  const jarvisTools = buildJarvisToolDeclarations();

  assert.equal(jarvisTools.length, mcpTools.length);
  const jarvisNames = jarvisTools.map((t) => t.name);
  for (const mcpTool of mcpTools) {
    assert.ok(jarvisNames.includes(mcpTool.name), `Missing MCP tool in J.A.R.V.I.S.: ${mcpTool.name}`);
  }
  assert.ok(jarvisNames.includes('desktop_drag'));
  assert.ok(jarvisNames.includes('desktop_scroll'));
  assert.ok(jarvisNames.includes('window_list'));
  assert.ok(jarvisNames.includes('window_control'));
  assert.ok(jarvisNames.includes('run_bash'));
  assert.ok(jarvisNames.includes('file_write'));
  assert.ok(jarvisNames.includes('wait'));
});

test('buildGeminiContents normalizes alternating turns and avoids duplicating current user message', () => {
  const contents = buildGeminiContents(
    [
      { role: 'assistant', text: 'Should be dropped when leading' },
      { role: 'user', text: 'Salom' },
      { role: 'assistant', text: 'Salom! Yordam berishga tayyorman.' },
      { role: 'user', text: 'Terminal och' },
    ],
    'Terminal och',
    { data: 'data:image/jpeg;base64,ABC123', mimeType: 'image/jpeg' },
  );

  assert.equal(contents.length, 3);
  assert.equal(contents[0].role, 'user');
  assert.equal(contents[1].role, 'model');
  assert.equal(contents[2].role, 'user');
  assert.equal(contents[2].parts?.[0]?.text, 'Terminal och');
  assert.equal(contents[2].parts?.[1]?.inlineData?.data, 'ABC123');
});

test('pruneOldScreenshots retains only the most recent screenshot to avoid 504 payload bloat', () => {
  const pruned = pruneOldScreenshots(
    [
      { role: 'user', parts: [{ text: 'Step 1' }, { inlineData: { mimeType: 'image/jpeg', data: 'IMG1' } }] },
      { role: 'user', parts: [{ text: 'Step 2' }, { inlineData: { mimeType: 'image/jpeg', data: 'IMG2' } }] },
    ],
    1,
  );
  assert.equal(pruned[0].parts?.[1]?.inlineData, undefined);
  assert.ok(pruned[0].parts?.[1]?.text?.includes('o‘tkazildi'));
  assert.equal(pruned[1].parts?.[1]?.inlineData?.data, 'IMG2');
});

test('scaleNormalizedPoint converts 0..1000 Gemini coordinates to screen pixel coordinates', () => {
  assert.deepEqual(scaleNormalizedPoint(500, 500, 1280, 720), { x: 640, y: 360 });
  assert.deepEqual(scaleNormalizedPoint(430, 555, 1280, 720), { x: 550, y: 400 });
  assert.deepEqual(scaleNormalizedPoint(1000, 1000, 1920, 1080), { x: 1919, y: 1079 });
});

test('stripBase64DataUrl strips data URI headers cleanly', () => {
  assert.equal(stripBase64DataUrl('data:image/png;base64,XYZ'), 'XYZ');
  assert.equal(stripBase64DataUrl('RAWBASE64'), 'RAWBASE64');
});

test('formatGeminiError maps missing key and upstream status codes accurately', () => {
  assert.equal(formatGeminiError(new Error('GEMINI_API_KEY sozlanmagan')).status, 503);
  assert.equal(formatGeminiError({ status: 403, message: 'PERMISSION_DENIED' }).status, 403);
  assert.equal(formatGeminiError({ status: 429, message: 'RESOURCE_EXHAUSTED' }).status, 429);
  assert.equal(formatGeminiError({ status: 404, message: 'NOT_FOUND' }).status, 404);
  const unavailable = formatGeminiError(
    new Error('{"error":{"code":503,"message":"This model is currently experiencing high demand.","status":"UNAVAILABLE"}}'),
  );
  assert.equal(unavailable.status, 503);
  assert.ok(!unavailable.message.startsWith('{'));
  assert.equal(formatGeminiError(new Error('This operation was aborted')).status, 504);
});

test('extractJarvisReplyText excludes thought parts and stray leading punctuation', () => {
  const cleaned = extractJarvisReplyText(
    [
      { thought: true, text: 'Internal thinking...' },
      { text: 'thought\nTerminal terminali muvaffaqiyatli ochildi.' },
      { text: ', terminal ochildi.' },
    ],
    'fallback',
  );
  assert.equal(cleaned, 'terminal ochildi.');
});

test('buildJarvisSystemInstruction credits shoh_tech and establishes J.A.R.V.I.S. persona', () => {
  const prompt = buildJarvisSystemInstruction('Debian GNU/Linux 12 X11 desktop (1280x720)');
  assert.ok(prompt.includes('shoh_tech'));
  assert.ok(prompt.includes('Toni Stark EMAS'));
  assert.ok(prompt.includes('Janob'));
  assert.ok(prompt.includes('1280x720'));
});

test('normalizeAudioMimeType strips codecs parameters cleanly', () => {
  assert.equal(normalizeAudioMimeType('audio/webm;codecs=opus'), 'audio/webm');
  assert.equal(normalizeAudioMimeType('AUDIO/MP4; codecs=mp4a.40.2'), 'audio/mp4');
  assert.equal(normalizeAudioMimeType(''), 'audio/webm');
});
