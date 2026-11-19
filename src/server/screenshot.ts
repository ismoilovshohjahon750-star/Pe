import zlib from 'node:zlib';
import { DESKTOP_ICONS, START_MENU_APPS, getWindowBounds } from '../desktop/engine.ts';
import type { DesktopState, DesktopWindow } from '../desktop/types.ts';

// Minimal 5x7 uppercase/ASCII bitmap glyphs for crisp readable PNG screenshots
const FONT_5X7: Record<string, string[]> = {
  A: ['01110', '10001', '10001', '11111', '10001', '10001', '10001'],
  B: ['11110', '10001', '10001', '11110', '10001', '10001', '11110'],
  C: ['01111', '10000', '10000', '10000', '10000', '10000', '01111'],
  D: ['11110', '10001', '10001', '10001', '10001', '10001', '11110'],
  E: ['11111', '10000', '10000', '11110', '10000', '10000', '11111'],
  F: ['11111', '10000', '10000', '11110', '10000', '10000', '10000'],
  G: ['01111', '10000', '10000', '10111', '10001', '10001', '01110'],
  H: ['10001', '10001', '10001', '11111', '10001', '10001', '10001'],
  I: ['01110', '00100', '00100', '00100', '00100', '00100', '01110'],
  J: ['00111', '00010', '00010', '00010', '10010', '10010', '01100'],
  K: ['10001', '10010', '10100', '11000', '10100', '10010', '10001'],
  L: ['10000', '10000', '10000', '10000', '10000', '10000', '11111'],
  M: ['10001', '11011', '10101', '10101', '10001', '10001', '10001'],
  N: ['10001', '11001', '10101', '10011', '10001', '10001', '10001'],
  O: ['01110', '10001', '10001', '10001', '10001', '10001', '01110'],
  P: ['11110', '10001', '10001', '11110', '10000', '10000', '10000'],
  Q: ['01110', '10001', '10001', '10001', '10101', '10010', '01101'],
  R: ['11110', '10001', '10001', '11110', '10100', '10010', '10001'],
  S: ['01111', '10000', '10000', '01110', '00001', '00001', '11110'],
  T: ['11111', '00100', '00100', '00100', '00100', '00100', '00100'],
  U: ['10001', '10001', '10001', '10001', '10001', '10001', '01110'],
  V: ['10001', '10001', '10001', '10001', '10001', '01010', '00100'],
  W: ['10001', '10001', '10001', '10101', '10101', '11011', '10001'],
  X: ['10001', '10001', '01010', '00100', '01010', '10001', '10001'],
  Y: ['10001', '10001', '01010', '00100', '00100', '00100', '00100'],
  Z: ['11111', '00001', '00010', '00100', '01000', '10000', '11111'],
  '0': ['01110', '10011', '10101', '10101', '11001', '10001', '01110'],
  '1': ['00100', '01100', '00100', '00100', '00100', '00100', '01110'],
  '2': ['01110', '10001', '00001', '00110', '01000', '10000', '11111'],
  '3': ['11110', '00001', '00001', '01110', '00001', '00001', '11110'],
  '4': ['00010', '00110', '01010', '10010', '11111', '00010', '00010'],
  '5': ['11111', '10000', '11110', '00001', '00001', '10001', '01110'],
  '6': ['01110', '10000', '11110', '10001', '10001', '10001', '01110'],
  '7': ['11111', '00001', '00010', '00100', '01000', '01000', '01000'],
  '8': ['01110', '10001', '10001', '01110', '10001', '10001', '01110'],
  '9': ['01110', '10001', '10001', '01111', '00001', '00001', '01110'],
  '.': ['00000', '00000', '00000', '00000', '00000', '01100', '01100'],
  ':': ['00000', '01100', '01100', '00000', '01100', '01100', '00000'],
  '-': ['00000', '00000', '00000', '11111', '00000', '00000', '00000'],
  '_': ['00000', '00000', '00000', '00000', '00000', '00000', '11111'],
  '/': ['00001', '00010', '00010', '00100', '01000', '01000', '10000'],
  '\\': ['10000', '01000', '01000', '00100', '00010', '00010', '00001'],
  '>': ['10000', '01000', '00100', '00010', '00100', '01000', '10000'],
  '=': ['00000', '00000', '11111', '00000', '11111', '00000', '00000'],
  '+': ['00000', '00100', '00100', '11111', '00100', '00100', '00000'],
  '(': ['00010', '00100', '01000', '01000', '01000', '00100', '00010'],
  ')': ['01000', '00100', '00010', '00010', '00010', '00100', '01000'],
  ' ': ['00000', '00000', '00000', '00000', '00000', '00000', '00000'],
};

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Uint8Array): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcInput = Buffer.concat([typeBuf, data]);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(crcInput), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function hexToRgb(hex: string): [number, number, number] {
  const clean = hex.replace('#', '');
  if (clean.length !== 6) return [0, 120, 212];
  return [
    parseInt(clean.slice(0, 2), 16) || 0,
    parseInt(clean.slice(2, 4), 16) || 0,
    parseInt(clean.slice(4, 6), 16) || 0,
  ];
}

export function renderDesktopPngBase64(state: DesktopState): string {
  // Render at 640x360 (1:2 crisp scale of 1280x720) for fast, low-latency MCP vision payloads
  const scale = 2;
  const W = Math.floor(state.screenWidth / scale);
  const H = Math.floor(state.screenHeight / scale);
  const stride = W * 3 + 1;
  const raw = Buffer.alloc(stride * H);

  const setPixel = (x: number, y: number, r: number, g: number, b: number) => {
    if (x < 0 || y < 0 || x >= W || y >= H) return;
    const idx = y * stride + 1 + x * 3;
    raw[idx] = r;
    raw[idx + 1] = g;
    raw[idx + 2] = b;
  };

  const fillRect = (x: number, y: number, w: number, h: number, r: number, g: number, b: number) => {
    const x0 = Math.max(0, Math.floor(x));
    const y0 = Math.max(0, Math.floor(y));
    const x1 = Math.min(W, Math.floor(x + w));
    const y1 = Math.min(H, Math.floor(y + h));
    for (let py = y0; py < y1; py++) {
      const rowOffset = py * stride + 1;
      for (let px = x0; px < x1; px++) {
        const idx = rowOffset + px * 3;
        raw[idx] = r;
        raw[idx + 1] = g;
        raw[idx + 2] = b;
      }
    }
  };

  const drawText = (text: string, x: number, y: number, r: number, g: number, b: number, maxChars = 60) => {
    const upper = text.slice(0, maxChars).toUpperCase();
    let cx = Math.floor(x);
    const cy = Math.floor(y);
    for (let i = 0; i < upper.length; i++) {
      const glyph = FONT_5X7[upper[i]] ?? FONT_5X7[' '];
      for (let row = 0; row < 7; row++) {
        for (let col = 0; col < 5; col++) {
          if (glyph[row][col] === '1') {
            setPixel(cx + col, cy + row, r, g, b);
          }
        }
      }
      cx += 6;
    }
  };

  // 1. Windows 10 Hero cobalt gradient + light prism diagonal highlight
  for (let y = 0; y < H; y++) {
    raw[y * stride] = 0; // filter type 0
    for (let x = 0; x < W; x++) {
      const idx = y * stride + 1 + x * 3;
      const dist = Math.hypot((x - W * 0.72) / 140, (y - H * 0.38) / 120);
      const glow = Math.max(0, 1 - dist * 0.55);
      raw[idx] = Math.min(255, Math.floor(8 + glow * 28));
      raw[idx + 1] = Math.min(255, Math.floor(24 + glow * 115));
      raw[idx + 2] = Math.min(255, Math.floor(54 + glow * 165));
    }
  }

  // 2. Desktop Icons
  for (const icon of DESKTOP_ICONS) {
    const ix = Math.floor(icon.x / scale);
    const iy = Math.floor(icon.y / scale);
    fillRect(ix + 10, iy + 2, 18, 18, 0, 120, 212);
    fillRect(ix + 12, iy + 4, 14, 14, 56, 189, 248);
    drawText(icon.label, ix + 2, iy + 24, 240, 245, 255, 10);
  }

  // 3. Windows sorted bottom-to-top
  const visibleWindows = [...state.windows]
    .filter((w) => !w.minimized)
    .sort((a, b) => a.zIndex - b.zIndex);

  for (const win of visibleWindows) {
    drawWindowToBuffer(win, scale, fillRect, drawText, setPixel);
  }

  // 4. Start Menu if open
  if (state.startMenuOpen) {
    const smH = 240;
    const smY = H - Math.floor(state.taskbarHeight / scale) - smH;
    fillRect(0, smY, 210, smH, 24, 24, 27);
    fillRect(0, smY, 24, smH, 18, 18, 22);
    START_MENU_APPS.forEach((item, idx) => {
      const ry = smY + 10 + idx * 20;
      fillRect(30, ry, 12, 12, 0, 120, 212);
      drawText(item.label, 48, ry + 3, 241, 245, 249, 22);
    });
  }

  // 5. Taskbar
  const tbH = Math.floor(state.taskbarHeight / scale);
  const tbY = H - tbH;
  fillRect(0, tbY, W, tbH, 16, 16, 20);
  // Start logo
  fillRect(6, tbY + 4, 5, 5, 0, 164, 239);
  fillRect(12, tbY + 4, 5, 5, 0, 164, 239);
  fillRect(6, tbY + 10, 5, 5, 0, 164, 239);
  fillRect(12, tbY + 10, 5, 5, 0, 164, 239);
  // Search bar
  fillRect(26, tbY + 3, 92, tbH - 6, 240, 242, 245);
  drawText('SEARCH', 32, tbY + 6, 80, 90, 100, 10);
  // Open window buttons
  state.windows.slice(0, 5).forEach((w, idx) => {
    const bx = 130 + idx * 72;
    fillRect(bx, tbY + 2, 68, tbH - 4, w.focused ? 45 : 28, w.focused ? 55 : 32, w.focused ? 72 : 40);
    if (w.focused) {
      fillRect(bx, tbY + tbH - 2, 68, 2, 0, 120, 212);
    }
    drawText(w.title, bx + 4, tbY + 6, 235, 240, 250, 10);
  });

  // 6. Cursor
  const cx = Math.floor(state.cursor.x / scale);
  const cy = Math.floor(state.cursor.y / scale);
  for (let dy = 0; dy < 11; dy++) {
    for (let dx = 0; dx <= Math.min(dy, 6); dx++) {
      const isEdge = dx === 0 || dx === Math.min(dy, 6) || dy === 10;
      setPixel(cx + dx, cy + dy, isEdge ? 15 : 255, isEdge ? 23 : 255, isEdge ? 42 : 255);
    }
  }
  if (state.cursor.clicking) {
    fillRect(cx - 2, cy - 2, 4, 4, 0, 164, 239);
  }

  // Encode PNG
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0);
  ihdr.writeUInt32BE(H, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // RGB
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  const compressed = zlib.deflateSync(raw, { level: 3 });
  const png = Buffer.concat([
    signature,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', compressed),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
  return png.toString('base64');
}

function drawWindowToBuffer(
  win: DesktopWindow,
  scale: number,
  fillRect: (x: number, y: number, w: number, h: number, r: number, g: number, b: number) => void,
  drawText: (text: string, x: number, y: number, r: number, g: number, b: number, maxChars?: number) => void,
  setPixel: (x: number, y: number, r: number, g: number, b: number) => void,
) {
  const b = getWindowBounds(win);
  const x = Math.floor(b.x / scale);
  const y = Math.floor(b.y / scale);
  const w = Math.floor(b.width / scale);
  const h = Math.floor(b.height / scale);
  const th = 16;

  // Frame border + body
  fillRect(x - 1, y - 1, w + 2, h + 2, win.focused ? 0 : 70, win.focused ? 120 : 80, win.focused ? 212 : 95);
  if (win.appId === 'powershell') {
    fillRect(x, y + th, w, h - th, 1, 36, 86);
  } else {
    fillRect(x, y + th, w, h - th, 248, 250, 252);
  }

  // Titlebar
  fillRect(x, y, w, th, win.focused ? 255 : 235, win.focused ? 255 : 238, win.focused ? 255 : 242);
  drawText(win.title, x + 6, y + 5, 15, 23, 42, Math.max(8, Math.floor((w - 50) / 6)));
  // Close button
  fillRect(x + w - 22, y, 22, th, 220, 38, 38);
  drawText('X', x + w - 14, y + 5, 255, 255, 255, 1);

  // Content summary
  if (win.appId === 'powershell' && win.powershell) {
    const lines = win.powershell.lines.slice(-14);
    lines.forEach((line, idx) => {
      drawText(line.text, x + 8, y + th + 8 + idx * 11, 226, 232, 240, Math.floor((w - 16) / 6));
    });
  } else if (win.appId === 'notepad' && win.notepad) {
    const lines = win.notepad.content.split(/\r?\n/).slice(0, 14);
    lines.forEach((line, idx) => {
      drawText(line, x + 8, y + th + 8 + idx * 11, 15, 23, 42, Math.floor((w - 16) / 6));
    });
  } else if (win.appId === 'edge' && win.edge) {
    const tab = win.edge.tabs.find((t) => t.id === win.edge?.activeTabId);
    fillRect(x + 4, y + th + 4, w - 8, 14, 226, 232, 240);
    drawText(tab?.url || '', x + 8, y + th + 8, 15, 23, 42, Math.floor((w - 20) / 6));
    const lines = (tab?.contentText || '').split(/\r?\n/).slice(0, 11);
    lines.forEach((line, idx) => {
      drawText(line, x + 8, y + th + 24 + idx * 11, 30, 41, 59, Math.floor((w - 16) / 6));
    });
  } else if (win.appId === 'paint' && win.paint) {
    for (const stroke of win.paint.strokes) {
      const [r, g, bCol] = hexToRgb(stroke.color);
      for (const pt of stroke.points) {
        const px = x + Math.floor(pt.x / scale);
        const py = y + th + Math.floor(pt.y / scale);
        setPixel(px, py, r, g, bCol);
        setPixel(px + 1, py, r, g, bCol);
        setPixel(px, py + 1, r, g, bCol);
      }
    }
  } else if (win.appId === 'explorer' && win.explorer) {
    fillRect(x + 4, y + th + 4, w - 8, 14, 226, 232, 240);
    drawText(win.explorer.currentPath, x + 8, y + th + 8, 15, 23, 42, Math.floor((w - 20) / 6));
  }
}
