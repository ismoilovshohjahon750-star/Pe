export function buildAndroidTermuxAgent(wsUrl: string, token?: string | null): string {
  const finalWsUrl = token ? `${wsUrl}?token=${encodeURIComponent(token)}` : wsUrl;
  return `#!/usr/bin/env python3
"""
J.A.R.V.I.S. — Android Termux Live MCP Agent (No-ADB Control Deck + Termux:API)
Works on any Android device via Termux with minimal dependency (websockets).
No ADB and No Root required for:
  - Interactive Control Deck + Live Mini Terminal PNG screen (540x960)
  - Full Termux bash/shell execution, file management, and URL intents
  - Hardware & Android control via Termux:API (torch, vibrate, volume, brightness,
    toast, notifications, TTS speak, clipboard, camera photo, wifi, battery, media)
Optional:
  - ADB Wireless Debugging (adb connect <IP>:<PORT>) or Root (su) for full Android screen + touch
  - Termux:X11 (scrot + xdotool) when DISPLAY is active

Run in Termux:
  pkg update -y && pkg install -y python termux-api && pip install -q websockets
  python android-termux-agent.py
"""

import asyncio
import base64
import getpass
import io
import json
import os
import shlex
import shutil
import socket
import struct
import subprocess
import sys
import time
import zlib
from pathlib import Path

try:
    import websockets
except ImportError:
    print("Xatolik: 'websockets' kutubxonasi topilmadi. Avval o'rnating:")
    print("  pip install websockets")
    sys.exit(1)

try:
    from PIL import Image
    HAS_PIL = True
except Exception:
    HAS_PIL = False

WS_URI = ${JSON.stringify(finalWsUrl)}

# Compact 5x7 uppercase/punctuation bitmap font for dependency-free PNG rendering
FONT_5X7 = {
    " ": [0, 0, 0, 0, 0, 0, 0],
    "A": [14, 17, 17, 31, 17, 17, 17],
    "B": [30, 17, 17, 30, 17, 17, 30],
    "C": [14, 17, 16, 16, 16, 17, 14],
    "D": [30, 17, 17, 17, 17, 17, 30],
    "E": [31, 16, 16, 30, 16, 16, 31],
    "F": [31, 16, 16, 30, 16, 16, 16],
    "G": [14, 17, 16, 23, 17, 17, 15],
    "H": [17, 17, 17, 31, 17, 17, 17],
    "I": [14, 4, 4, 4, 4, 4, 14],
    "J": [7, 2, 2, 2, 18, 18, 12],
    "K": [17, 18, 20, 24, 20, 18, 17],
    "L": [16, 16, 16, 16, 16, 16, 31],
    "M": [17, 27, 21, 21, 17, 17, 17],
    "N": [17, 25, 21, 19, 17, 17, 17],
    "O": [14, 17, 17, 17, 17, 17, 14],
    "P": [30, 17, 17, 30, 16, 16, 16],
    "Q": [14, 17, 17, 17, 21, 18, 13],
    "R": [30, 17, 17, 30, 20, 18, 17],
    "S": [15, 16, 16, 14, 1, 1, 30],
    "T": [31, 4, 4, 4, 4, 4, 4],
    "U": [17, 17, 17, 17, 17, 17, 14],
    "V": [17, 17, 17, 17, 17, 10, 4],
    "W": [17, 17, 17, 21, 21, 27, 17],
    "X": [17, 17, 10, 4, 10, 17, 17],
    "Y": [17, 17, 10, 4, 4, 4, 4],
    "Z": [31, 1, 2, 4, 8, 16, 31],
    "0": [14, 17, 19, 21, 25, 17, 14],
    "1": [4, 12, 4, 4, 4, 4, 14],
    "2": [14, 17, 1, 6, 8, 16, 31],
    "3": [30, 1, 1, 14, 1, 1, 30],
    "4": [2, 6, 10, 18, 31, 2, 2],
    "5": [31, 16, 30, 1, 1, 17, 14],
    "6": [14, 16, 16, 30, 17, 17, 14],
    "7": [31, 1, 2, 4, 8, 8, 8],
    "8": [14, 17, 17, 14, 17, 17, 14],
    "9": [14, 17, 17, 15, 1, 1, 14],
    ".": [0, 0, 0, 0, 0, 12, 12],
    ",": [0, 0, 0, 0, 0, 6, 4],
    ":": [0, 12, 12, 0, 12, 12, 0],
    ";": [0, 12, 12, 0, 12, 4, 8],
    "-": [0, 0, 0, 31, 0, 0, 0],
    "_": [0, 0, 0, 0, 0, 0, 31],
    "/": [1, 2, 2, 4, 8, 8, 16],
    "(": [2, 4, 8, 8, 8, 4, 2],
    ")": [8, 4, 2, 2, 2, 4, 8],
    "[": [14, 8, 8, 8, 8, 8, 14],
    "]": [14, 2, 2, 2, 2, 2, 14],
    "+": [0, 4, 4, 31, 4, 4, 0],
    "=": [0, 0, 31, 0, 31, 0, 0],
    "!": [4, 4, 4, 4, 4, 0, 4],
    "?": [14, 17, 2, 4, 4, 0, 4],
    "#": [10, 31, 10, 10, 31, 10, 0],
    "*": [0, 21, 14, 31, 14, 21, 0],
    ">": [16, 8, 4, 2, 4, 8, 16],
    "<": [2, 4, 8, 16, 8, 4, 2],
    "$": [15, 20, 20, 14, 5, 5, 30],
    "%": [24, 25, 2, 4, 8, 19, 3],
    "@": [14, 17, 23, 21, 23, 16, 14],
    "'": [4, 4, 8, 0, 0, 0, 0],
    '"': [10, 10, 0, 0, 0, 0, 0],
    "~": [0, 8, 21, 2, 0, 0, 0],
    "|": [4, 4, 4, 4, 4, 4, 4],
}

RECENT_LOGS = []
TERM_LINES = [
    "TERMUX CONTROL DECK READY (NO ADB NEEDED)",
    "TAP ANY BUTTON ABOVE OR TYPE BASH BELOW",
]
TERMINAL_STATE = {
    "cmd": "",
    "scroll": 0,
    "torch_on": False,
    "brightness": 140,
    "volume": 8,
}
DEVICE_INFO = {
    "model": "Android Phone",
    "android": "Android (Termux)",
    "screen_mode": "TERMUX-PRO",
    "battery": "N/A",
    "ip": "127.0.0.1",
    "has_termux_api": False,
    "last_bat_at": 0.0,
    "root_checked": False,
    "has_root": False,
    "screen_w": 540,
    "screen_h": 960,
}

# Clickable Deck Buttons on 540x960 canvas (x1, y1, x2, y2, label, action_id)
DECK_BUTTONS = [
    (20, 184, 180, 238, "TORCH", "torch_toggle"),
    (190, 184, 350, 238, "VIBRATE", "vibrate"),
    (360, 184, 520, 238, "BATTERY", "battery"),
    (20, 248, 180, 302, "VOL -", "vol_down"),
    (190, 248, 350, 302, "VOL +", "vol_up"),
    (360, 248, 520, 302, "TOAST HI", "toast"),
    (20, 312, 180, 366, "BRIGHT -", "bright_down"),
    (190, 312, 350, 366, "BRIGHT +", "bright_up"),
    (360, 312, 520, 366, "CLIPBOARD", "clipboard"),
    (20, 376, 180, 430, "CHROME", "chrome"),
    (190, 376, 350, 430, "YOUTUBE", "youtube"),
    (360, 376, 520, 430, "WIFI INFO", "wifi"),
]


def add_log(msg: str) -> None:
    ts = time.strftime("%H:%M:%S")
    clean = f"[{ts}] {msg}"
    RECENT_LOGS.append(clean)
    if len(RECENT_LOGS) > 12:
        del RECENT_LOGS[:-12]


def add_term_output(text: str) -> None:
    for raw_line in str(text or "").replace("\\r", "").split("\\n"):
        line = raw_line.rstrip()
        if not line:
            continue
        while len(line) > 40:
            TERM_LINES.append(line[:40])
            line = line[40:]
        TERM_LINES.append(line)
    if len(TERM_LINES) > 40:
        del TERM_LINES[:-40]


def getprop(name: str) -> str:
    try:
        out = subprocess.check_output(["getprop", name], stderr=subprocess.DEVNULL, timeout=1.5)
        return out.decode("utf-8", "replace").strip()
    except Exception:
        return ""


def detect_local_ip() -> str:
    try:
        sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        sock.settimeout(0.5)
        sock.connect(("8.8.8.8", 80))
        ip = sock.getsockname()[0]
        sock.close()
        return ip
    except Exception:
        try:
            return socket.gethostbyname(socket.gethostname())
        except Exception:
            return "127.0.0.1"


def init_device_info() -> None:
    model = getprop("ro.product.model") or getprop("ro.product.device") or socket.gethostname()
    brand = getprop("ro.product.brand")
    rel = getprop("ro.build.version.release")
    if brand and model and not model.lower().startswith(brand.lower()):
        DEVICE_INFO["model"] = f"{brand} {model}".strip()
    else:
        DEVICE_INFO["model"] = model or "Android Phone"
    DEVICE_INFO["android"] = f"Android {rel} (Termux)" if rel else "Android (Termux)"
    DEVICE_INFO["has_termux_api"] = bool(shutil.which("termux-toast") or shutil.which("termux-battery-status") or shutil.which("termux-torch"))
    DEVICE_INFO["ip"] = detect_local_ip()


def check_root_available() -> bool:
    if DEVICE_INFO["root_checked"]:
        return bool(DEVICE_INFO["has_root"])
    DEVICE_INFO["root_checked"] = True
    if not shutil.which("su"):
        DEVICE_INFO["has_root"] = False
        return False
    try:
        proc = subprocess.run(["su", "-c", "id"], capture_output=True, text=True, timeout=2.5)
        DEVICE_INFO["has_root"] = proc.returncode == 0 and "uid=0" in (proc.stdout or "")
    except Exception:
        DEVICE_INFO["has_root"] = False
    return bool(DEVICE_INFO["has_root"])


def has_adb_device() -> bool:
    if not shutil.which("adb"):
        return False
    try:
        proc = subprocess.run(["adb", "get-state"], capture_output=True, text=True, timeout=1.5)
        return proc.returncode == 0 and proc.stdout.strip() == "device"
    except Exception:
        return False


def read_sysfs_battery() -> str | None:
    base = Path("/sys/class/power_supply/battery")
    try:
        cap_file = base / "capacity"
        if cap_file.exists():
            cap = cap_file.read_text(encoding="utf-8", errors="replace").strip()
            st_file = base / "status"
            st = st_file.read_text(encoding="utf-8", errors="replace").strip() if st_file.exists() else ""
            if cap:
                return f"{cap}% ({st})" if st else f"{cap}%"
    except Exception:
        pass
    return None


def refresh_battery_status(force: bool = False) -> str:
    now = time.time()
    if not force and now - float(DEVICE_INFO["last_bat_at"]) < 15.0:
        return str(DEVICE_INFO["battery"])
    DEVICE_INFO["last_bat_at"] = now
    DEVICE_INFO["has_termux_api"] = bool(shutil.which("termux-toast") or shutil.which("termux-battery-status") or shutil.which("termux-torch"))
    DEVICE_INFO["ip"] = detect_local_ip()
    if shutil.which("termux-battery-status"):
        try:
            proc = subprocess.run(["termux-battery-status"], capture_output=True, text=True, timeout=2.5)
            if proc.returncode == 0 and proc.stdout.strip().startswith("{"):
                data = json.loads(proc.stdout)
                pct = data.get("percentage")
                st = data.get("status", "")
                temp = data.get("temperature")
                if pct is not None:
                    label = f"{pct}% ({st})" if st else f"{pct}%"
                    if temp is not None:
                        label += f" {temp}C"
                    DEVICE_INFO["battery"] = label
                    return label
        except Exception:
            pass
    sys_bat = read_sysfs_battery()
    if sys_bat:
        DEVICE_INFO["battery"] = sys_bat
    return str(DEVICE_INFO["battery"])


def parse_png_dimensions(png_bytes: bytes) -> tuple[int, int]:
    if len(png_bytes) >= 24 and png_bytes[:8] == b"\\x89PNG\\r\\n\\x1a\\n":
        w, h = struct.unpack(">II", png_bytes[16:24])
        if w > 0 and h > 0:
            return int(w), int(h)
    return int(DEVICE_INFO["screen_w"]), int(DEVICE_INFO["screen_h"])


def encode_png_rgb(width: int, height: int, rgb_bytes: bytes) -> bytes:
    stride = width * 3
    raw = bytearray((stride + 1) * height)
    for y in range(height):
        src_off = y * stride
        dst_off = y * (stride + 1)
        raw[dst_off] = 0
        raw[dst_off + 1 : dst_off + 1 + stride] = rgb_bytes[src_off : src_off + stride]

    def chunk(tag: bytes, data: bytes) -> bytes:
        crc = zlib.crc32(tag + data) & 0xFFFFFFFF
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", crc)

    ihdr = struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)
    idat = zlib.compress(bytes(raw), level=6)
    return b"\\x89PNG\\r\\n\\x1a\\n" + chunk(b"IHDR", ihdr) + chunk(b"IDAT", idat) + chunk(b"IEND", b"")


def fill_rect_rgb(buf: bytearray, width: int, height: int, x1: int, y1: int, x2: int, y2: int, color: tuple[int, int, int]) -> None:
    cx1 = max(0, min(width, x1))
    cx2 = max(0, min(width, x2))
    cy1 = max(0, min(height, y1))
    cy2 = max(0, min(height, y2))
    if cx2 <= cx1 or cy2 <= cy1:
        return
    row = bytes(color) * (cx2 - cx1)
    row_len = (cx2 - cx1) * 3
    for y in range(cy1, cy2):
        off = (y * width + cx1) * 3
        buf[off : off + row_len] = row


def draw_border_rgb(buf: bytearray, width: int, height: int, x1: int, y1: int, x2: int, y2: int, color: tuple[int, int, int]) -> None:
    fill_rect_rgb(buf, width, height, x1, y1, x2, y1 + 2, color)
    fill_rect_rgb(buf, width, height, x1, y2 - 2, x2, y2, color)
    fill_rect_rgb(buf, width, height, x1, y1, x1 + 2, y2, color)
    fill_rect_rgb(buf, width, height, x2 - 2, y1, x2, y2, color)


def draw_text_rgb(buf: bytearray, width: int, height: int, x: int, y: int, text: str, color: tuple[int, int, int], scale: int = 2) -> None:
    r, g, b = color
    cx = x
    for ch in text.upper():
        if cx + 5 * scale >= width:
            break
        glyph = FONT_5X7.get(ch, FONT_5X7[" "])
        for row_idx, bits in enumerate(glyph):
            py_base = y + row_idx * scale
            if py_base < 0 or py_base + scale > height:
                continue
            for col_idx in range(5):
                if bits & (1 << (4 - col_idx)):
                    px_base = cx + col_idx * scale
                    if px_base < 0 or px_base + scale > width:
                        continue
                    for sy in range(scale):
                        row_off = (py_base + sy) * width * 3
                        for sx in range(scale):
                            p = row_off + (px_base + sx) * 3
                            buf[p] = r
                            buf[p + 1] = g
                            buf[p + 2] = b
        cx += 6 * scale


def render_termux_status_png() -> tuple[int, int, bytes]:
    w, h = 540, 960
    # Dark obsidian background (#070B14)
    row_bg = bytes([7, 11, 20]) * w
    buf = bytearray(row_bg * h)

    # Header band
    fill_rect_rgb(buf, w, h, 0, 0, w, 50, (12, 22, 38))
    fill_rect_rgb(buf, w, h, 0, 50, w, 53, (14, 116, 144))
    draw_text_rgb(buf, w, h, 18, 18, "J.A.R.V.I.S. TERMUX CONTROL DECK", (56, 189, 248), scale=2)

    # Device Telemetry Card
    fill_rect_rgb(buf, w, h, 16, 64, 524, 172, (13, 21, 35))
    draw_border_rgb(buf, w, h, 16, 64, 524, 172, (30, 58, 95))
    api_badge = "API: READY" if DEVICE_INFO["has_termux_api"] else "API: PKG TERMUX-API"
    api_color = (52, 211, 153) if DEVICE_INFO["has_termux_api"] else (251, 191, 36)
    draw_text_rgb(buf, w, h, 26, 74, f"DEV: {DEVICE_INFO['model'][:26]}", (241, 245, 249), scale=2)
    draw_text_rgb(buf, w, h, 26, 98, f"OS : {DEVICE_INFO['android'][:28]}", (148, 163, 184), scale=2)
    draw_text_rgb(buf, w, h, 26, 122, f"BAT: {str(DEVICE_INFO['battery'])[:16]}  IP:{DEVICE_INFO['ip'][:15]}", (52, 211, 153), scale=2)
    draw_text_rgb(buf, w, h, 26, 146, f"MODE: NO-ADB DECK  | {api_badge}", api_color, scale=2)

    # Clickable Quick Action Buttons Grid
    for bx1, by1, bx2, by2, label, action_id in DECK_BUTTONS:
        active_torch = action_id == "torch_toggle" and TERMINAL_STATE["torch_on"]
        bg = (180, 120, 20) if active_torch else (17, 30, 52)
        border = (251, 191, 36) if active_torch else (34, 211, 238)
        fill_rect_rgb(buf, w, h, bx1, by1, bx2, by2, bg)
        draw_border_rgb(buf, w, h, bx1, by1, bx2, by2, border)
        tx = bx1 + max(10, ((bx2 - bx1) - len(label) * 12) // 2)
        draw_text_rgb(buf, w, h, tx, by1 + 20, label, (240, 249, 255), scale=2)

    # Interactive Mini Terminal Box
    fill_rect_rgb(buf, w, h, 16, 446, 524, 942, (9, 14, 24))
    draw_border_rgb(buf, w, h, 16, 446, 524, 942, (30, 64, 90))
    draw_text_rgb(buf, w, h, 26, 456, "LIVE TERMUX SHELL (TAP + TYPE COMMAND):", (56, 189, 248), scale=2)

    max_lines = 15
    total = len(TERM_LINES)
    scroll = max(0, min(max(0, total - max_lines), int(TERMINAL_STATE["scroll"])))
    end_idx = total - scroll
    start_idx = max(0, end_idx - max_lines)
    visible = TERM_LINES[start_idx:end_idx]

    y_pos = 486
    for entry in visible:
        color = (125, 211, 252) if entry.startswith("$ ") else (203, 213, 225)
        draw_text_rgb(buf, w, h, 26, y_pos, entry[:40], color, scale=2)
        y_pos += 25

    # Command Input Prompt Bar
    fill_rect_rgb(buf, w, h, 22, 886, 518, 932, (15, 27, 46))
    draw_border_rgb(buf, w, h, 22, 886, 518, 932, (56, 189, 248))
    prompt_txt = f"$ {TERMINAL_STATE['cmd'][-35:]}_"
    draw_text_rgb(buf, w, h, 30, 902, prompt_txt, (248, 250, 252), scale=2)

    return w, h, encode_png_rgb(w, h, bytes(buf))


def compress_png_if_pil(png_bytes: bytes) -> tuple[str, int, int, bytes]:
    w, h = parse_png_dimensions(png_bytes)
    DEVICE_INFO["screen_w"] = w
    DEVICE_INFO["screen_h"] = h
    if HAS_PIL:
        try:
            im = Image.open(io.BytesIO(png_bytes)).convert("RGB")
            max_side = max(im.width, im.height)
            if max_side > 1080:
                ratio = 1080.0 / max_side
                im = im.resize((max(1, int(im.width * ratio)), max(1, int(im.height * ratio))))
            out = io.BytesIO()
            im.save(out, format="JPEG", quality=58)
            return "image/jpeg", w, h, out.getvalue()
        except Exception:
            pass
    return "image/png", w, h, png_bytes


def capture_frame_payload() -> dict:
    refresh_battery_status()

    if has_adb_device():
        try:
            raw = subprocess.check_output(["adb", "exec-out", "screencap", "-p"], stderr=subprocess.DEVNULL, timeout=4.0)
            if raw.startswith(b"\\x89PNG"):
                DEVICE_INFO["screen_mode"] = "ADB"
                mime, w, h, data_bytes = compress_png_if_pil(raw)
                return {
                    "type": "agent:frame",
                    "mimeType": mime,
                    "width": w,
                    "height": h,
                    "data": base64.b64encode(data_bytes).decode("ascii"),
                    "cursorX": 0,
                    "cursorY": 0,
                    "mode": "ADB",
                    "timestamp": int(time.time() * 1000),
                }
        except Exception:
            pass

    if check_root_available():
        try:
            raw = subprocess.check_output(["su", "-c", "screencap -p"], stderr=subprocess.DEVNULL, timeout=4.0)
            if raw.startswith(b"\\x89PNG"):
                DEVICE_INFO["screen_mode"] = "ROOT"
                mime, w, h, data_bytes = compress_png_if_pil(raw)
                return {
                    "type": "agent:frame",
                    "mimeType": mime,
                    "width": w,
                    "height": h,
                    "data": base64.b64encode(data_bytes).decode("ascii"),
                    "cursorX": 0,
                    "cursorY": 0,
                    "mode": "ROOT",
                    "timestamp": int(time.time() * 1000),
                }
        except Exception:
            pass

    if os.environ.get("DISPLAY") and shutil.which("scrot"):
        try:
            tmp = Path(os.environ.get("TMPDIR", "/tmp")) / "termux_x11_snap.jpg"
            subprocess.run(["scrot", "-o", "-q", "65", str(tmp)], check=True, timeout=3.0)
            data_bytes = tmp.read_bytes()
            w, h = 1280, 720
            if HAS_PIL:
                im = Image.open(io.BytesIO(data_bytes))
                w, h = im.size
            DEVICE_INFO["screen_mode"] = "TERMUX-X11"
            DEVICE_INFO["screen_w"] = w
            DEVICE_INFO["screen_h"] = h
            return {
                "type": "agent:frame",
                "mimeType": "image/jpeg",
                "width": w,
                "height": h,
                "data": base64.b64encode(data_bytes).decode("ascii"),
                "cursorX": 0,
                "cursorY": 0,
                "mode": "TERMUX-X11",
                "timestamp": int(time.time() * 1000),
            }
        except Exception:
            pass

    DEVICE_INFO["screen_mode"] = "TERMUX-PRO"
    DEVICE_INFO["screen_w"] = 540
    DEVICE_INFO["screen_h"] = 960
    w, h, png = render_termux_status_png()
    return {
        "type": "agent:frame",
        "mimeType": "image/png",
        "width": w,
        "height": h,
        "data": base64.b64encode(png).decode("ascii"),
        "cursorX": 0,
        "cursorY": 0,
        "mode": "TERMUX-PRO",
        "timestamp": int(time.time() * 1000),
    }


def run_android_input(cmd_args: list[str]) -> str:
    quoted = " ".join(shlex.quote(a) for a in cmd_args)
    if has_adb_device():
        subprocess.run(["adb", "shell", quoted], capture_output=True, text=True, timeout=5.0)
        return "ADB: " + " ".join(cmd_args)
    if check_root_available():
        subprocess.run(["su", "-c", quoted], capture_output=True, text=True, timeout=5.0)
        return "ROOT: " + " ".join(cmd_args)
    raise RuntimeError("No ADB/Root display input")


def open_android_url(url: str) -> str:
    if shutil.which("termux-open-url"):
        subprocess.Popen(["termux-open-url", url])
        return f"Opened URL via termux-open-url: {url}"
    if has_adb_device():
        subprocess.run(
            ["adb", "shell", "am", "start", "-a", "android.intent.action.VIEW", "-d", url],
            capture_output=True,
            timeout=5.0,
        )
        return f"Opened URL via ADB: {url}"
    if shutil.which("am"):
        subprocess.Popen(["am", "start", "-a", "android.intent.action.VIEW", "-d", url])
        return f"Opened URL via am start: {url}"
    return f"URL recorded (install termux-tools/termux-api to launch Chrome): {url}"


def resolve_path(raw_path: str | None) -> Path:
    if not raw_path:
        return Path.home()
    expanded = os.path.expanduser(str(raw_path))
    return Path(expanded)


def run_termux_api_cmd(cmd_args: list[str], stdin_text: str | None = None, timeout: float = 8.0) -> str:
    binary = cmd_args[0]
    if not shutil.which(binary):
        raise RuntimeError(f"'{binary}' topilmadi. Termux da: pkg install -y termux-api (va Termux:API APK o'rnating)")
    proc = subprocess.run(cmd_args, input=stdin_text, capture_output=True, text=True, timeout=timeout)
    out = (proc.stdout or "").strip()
    err = (proc.stderr or "").strip()
    if proc.returncode != 0:
        raise RuntimeError(err or out or f"{binary} failed ({proc.returncode})")
    return out or "OK"


def execute_shell_line(cmd: str, cwd: str | None = None) -> str:
    clean = str(cmd or "").strip()
    if not clean:
        return ""
    add_log(f"$ {clean[:32]}")
    add_term_output(f"$ {clean}")
    TERMINAL_STATE["scroll"] = 0
    proc = subprocess.run(
        ["bash", "-lc", clean],
        cwd=cwd or str(Path.home()),
        capture_output=True,
        text=True,
        timeout=30,
    )
    out = (proc.stdout or "") + (proc.stderr or "")
    out_trimmed = out.strip() or f"(exit {proc.returncode})"
    add_term_output(out_trimmed)
    return out_trimmed


def perform_android_action(args: dict) -> str:
    action = str(args.get("action") or "battery").lower().strip()
    val = str(args.get("value") if args.get("value") is not None else "")
    text = str(args.get("text") or val or "")

    if action == "torch":
        desired = val.lower()
        if desired in ("on", "true", "1"):
            TERMINAL_STATE["torch_on"] = True
        elif desired in ("off", "false", "0"):
            TERMINAL_STATE["torch_on"] = False
        else:
            TERMINAL_STATE["torch_on"] = not TERMINAL_STATE["torch_on"]
        state_str = "on" if TERMINAL_STATE["torch_on"] else "off"
        out = run_termux_api_cmd(["termux-torch", state_str])
        add_log(f"TORCH {state_str.upper()}")
        add_term_output(f"[TORCH] {state_str.upper()}")
        return f"Torch {state_str}: {out}"

    if action == "vibrate":
        ms = max(50, min(5000, int(args.get("durationMs") or (val if val.isdigit() else 400))))
        out = run_termux_api_cmd(["termux-vibrate", "-f", "-d", str(ms)])
        add_log(f"VIBRATE {ms}ms")
        add_term_output(f"[VIBRATE] {ms}ms")
        return f"Vibrated {ms}ms ({out})"

    if action == "volume":
        stream = str(args.get("stream") or "music")
        if val == "up":
            TERMINAL_STATE["volume"] = min(15, int(TERMINAL_STATE["volume"]) + 2)
            level = str(TERMINAL_STATE["volume"])
            out = run_termux_api_cmd(["termux-volume", stream, level])
            add_term_output(f"[VOL {stream}] -> {level}")
            return f"Volume {stream} -> {level} ({out})"
        if val == "down":
            TERMINAL_STATE["volume"] = max(0, int(TERMINAL_STATE["volume"]) - 2)
            level = str(TERMINAL_STATE["volume"])
            out = run_termux_api_cmd(["termux-volume", stream, level])
            add_term_output(f"[VOL {stream}] -> {level}")
            return f"Volume {stream} -> {level} ({out})"
        if val.isdigit():
            TERMINAL_STATE["volume"] = max(0, min(15, int(val)))
            out = run_termux_api_cmd(["termux-volume", stream, str(TERMINAL_STATE["volume"])])
            add_term_output(f"[VOL {stream}] -> {TERMINAL_STATE['volume']}")
            return f"Volume {stream} -> {TERMINAL_STATE['volume']} ({out})"
        out = run_termux_api_cmd(["termux-volume"])
        add_term_output(out[:120])
        return out

    if action == "brightness":
        if val == "up":
            TERMINAL_STATE["brightness"] = min(255, int(TERMINAL_STATE["brightness"]) + 40)
            target_b = str(TERMINAL_STATE["brightness"])
        elif val == "down":
            TERMINAL_STATE["brightness"] = max(10, int(TERMINAL_STATE["brightness"]) - 40)
            target_b = str(TERMINAL_STATE["brightness"])
        elif val.lower() == "auto":
            target_b = "auto"
        else:
            lvl = max(0, min(255, int(val if val.isdigit() else TERMINAL_STATE["brightness"])))
            TERMINAL_STATE["brightness"] = lvl
            target_b = str(lvl)
        out = run_termux_api_cmd(["termux-brightness", target_b])
        add_term_output(f"[BRIGHTNESS] -> {target_b}")
        return f"Brightness -> {target_b} ({out})"

    if action == "toast":
        msg = text or "J.A.R.V.I.S. active on Android!"
        out = run_termux_api_cmd(["termux-toast", "-g", "bottom", msg])
        add_term_output(f"[TOAST] {msg}")
        return f"Toast shown: {msg} ({out})"

    if action == "notify":
        title = str(args.get("title") or "J.A.R.V.I.S.")
        body = text or "Signal received"
        out = run_termux_api_cmd(["termux-notification", "-t", title, "-c", body])
        add_term_output(f"[NOTIFY] {title}: {body}")
        return f"Notification sent: {title}"

    if action == "speak":
        msg = text or "Salom Janob, Jarvis Android tizimida tayyor"
        cmd = ["termux-tts-speak"]
        if args.get("language"):
            cmd += ["-l", str(args["language"])]
        cmd.append(msg)
        out = run_termux_api_cmd(cmd, timeout=15.0)
        add_term_output(f"[TTS] {msg}")
        return f"Spoke via Android TTS: {msg} ({out})"

    if action == "clipboard_get":
        out = run_termux_api_cmd(["termux-clipboard-get"])
        add_term_output(f"[CLIPBOARD] {out[:60]}")
        return out

    if action == "clipboard_set":
        out = run_termux_api_cmd(["termux-clipboard-set"], stdin_text=text)
        add_term_output(f"[CLIPBOARD SET] {len(text)} chars")
        return f"Clipboard updated ({len(text)} chars, {out})"

    if action == "camera":
        cam_id = val if val in ("0", "1") else "0"
        out_path = str(resolve_path(args.get("path") or "~/jarvis_photo.jpg"))
        out = run_termux_api_cmd(["termux-camera-photo", "-c", cam_id, out_path], timeout=12.0)
        size = Path(out_path).stat().st_size if Path(out_path).exists() else 0
        add_term_output(f"[CAMERA] Saved {out_path} ({size}B)")
        return json.dumps({"path": out_path, "size": size, "camera": cam_id, "output": out})

    if action == "battery":
        label = refresh_battery_status(force=True)
        if shutil.which("termux-battery-status"):
            try:
                raw = subprocess.check_output(["termux-battery-status"], text=True, timeout=2.5)
                add_term_output(f"[BATTERY] {label}")
                return raw.strip()
            except Exception:
                pass
        add_term_output(f"[BATTERY] {label}")
        return json.dumps({"battery": label, "source": "sysfs"})

    if action == "wifi":
        ip = detect_local_ip()
        DEVICE_INFO["ip"] = ip
        if shutil.which("termux-wifi-connectioninfo"):
            try:
                raw = subprocess.check_output(["termux-wifi-connectioninfo"], text=True, timeout=3.0)
                add_term_output(f"[WIFI] IP={ip}")
                return raw.strip()
            except Exception:
                pass
        add_term_output(f"[WIFI] IP={ip}")
        return json.dumps({"ip": ip, "hostname": DEVICE_INFO["model"]})

    if action == "media":
        sub = val or "play"
        out = run_termux_api_cmd(["termux-media-player", sub])
        add_term_output(f"[MEDIA] {sub}: {out}")
        return out

    if action == "open_url":
        res = open_android_url(text or str(args.get("url") or "https://google.com"))
        add_term_output(f"[URL] {res}")
        return res

    if action == "share":
        out = run_termux_api_cmd(["termux-share", "-a", "send"], stdin_text=text)
        add_term_output(f"[SHARE] {len(text)} chars")
        return out

    if action == "status":
        refresh_battery_status(force=True)
        return json.dumps({
            "model": DEVICE_INFO["model"],
            "android": DEVICE_INFO["android"],
            "battery": DEVICE_INFO["battery"],
            "ip": DEVICE_INFO["ip"],
            "screen_mode": DEVICE_INFO["screen_mode"],
            "has_termux_api": DEVICE_INFO["has_termux_api"],
            "has_adb": has_adb_device(),
            "has_root": check_root_available(),
        })

    raise ValueError(f"Unsupported android_action: {action}")


def handle_deck_click(x: int, y: int) -> str:
    for bx1, by1, bx2, by2, label, action_id in DECK_BUTTONS:
        if bx1 <= x <= bx2 and by1 <= y <= by2:
            try:
                if action_id == "torch_toggle":
                    return perform_android_action({"action": "torch"})
                if action_id == "vibrate":
                    return perform_android_action({"action": "vibrate", "durationMs": 350})
                if action_id == "battery":
                    return perform_android_action({"action": "battery"})
                if action_id == "vol_down":
                    return perform_android_action({"action": "volume", "value": "down"})
                if action_id == "vol_up":
                    return perform_android_action({"action": "volume", "value": "up"})
                if action_id == "toast":
                    return perform_android_action({"action": "toast", "text": "Salom Janob! J.A.R.V.I.S."})
                if action_id == "bright_down":
                    return perform_android_action({"action": "brightness", "value": "down"})
                if action_id == "bright_up":
                    return perform_android_action({"action": "brightness", "value": "up"})
                if action_id == "clipboard":
                    return perform_android_action({"action": "clipboard_get"})
                if action_id == "chrome":
                    return open_android_url("https://google.com")
                if action_id == "youtube":
                    return open_android_url("https://youtube.com")
                if action_id == "wifi":
                    return perform_android_action({"action": "wifi"})
            except Exception as exc:
                err_msg = str(exc)
                add_term_output(f"[ERR] {err_msg}")
                return err_msg

    if y >= 446:
        add_term_output("[SHELL FOCUS] Ready to type command")
        return "Focused Termux interactive shell"

    return f"Deck tap at ({x}, {y})"


def run_tool(tool: str, args: dict):
    if tool == "desktop_screenshot":
        return {
            "width": DEVICE_INFO["screen_w"],
            "height": DEVICE_INFO["screen_h"],
            "mode": DEVICE_INFO["screen_mode"],
            "device": DEVICE_INFO["model"],
            "battery": DEVICE_INFO["battery"],
            "has_termux_api": DEVICE_INFO["has_termux_api"],
        }

    if tool == "android_action":
        return perform_android_action(args)

    if tool == "desktop_move":
        return f"Android cursor moved to ({args.get('x', 0)}, {args.get('y', 0)})"

    if tool == "desktop_click":
        x = int(args.get("x", 0))
        y = int(args.get("y", 0))
        btn = str(args.get("button", "left"))
        if os.environ.get("DISPLAY") and shutil.which("xdotool"):
            bnum = "3" if btn == "right" else "1"
            cmd = ["xdotool", "mousemove", str(x), str(y), "click"]
            cmd += ["--repeat", "2", bnum] if btn == "double" else [bnum]
            subprocess.run(cmd, timeout=4.0)
            add_log(f"X11 CLICK {btn} ({x},{y})")
            return f"X11 clicked {btn} at ({x}, {y})"
        if has_adb_device() or check_root_available():
            if btn == "right":
                out = run_android_input(["input", "swipe", str(x), str(y), str(x), str(y), "650"])
            elif btn == "double":
                run_android_input(["input", "tap", str(x), str(y)])
                out = run_android_input(["input", "tap", str(x), str(y)])
            else:
                out = run_android_input(["input", "tap", str(x), str(y)])
            add_log(f"TAP {btn} ({x},{y})")
            return out
        return handle_deck_click(x, y)

    if tool == "desktop_scroll":
        x = int(args.get("x", DEVICE_INFO["screen_w"] // 2))
        y = int(args.get("y", DEVICE_INFO["screen_h"] // 2))
        direction = str(args.get("direction", "down"))
        if has_adb_device() or check_root_available():
            dy = 320 if direction == "up" else -320
            y2 = max(20, min(DEVICE_INFO["screen_h"] - 20, y + dy))
            out = run_android_input(["input", "swipe", str(x), str(y), str(x), str(y2), "220"])
            add_log(f"SWIPE {direction}")
            return out
        if direction == "up":
            TERMINAL_STATE["scroll"] = min(max(0, len(TERM_LINES) - 15), int(TERMINAL_STATE["scroll"]) + 3)
        else:
            TERMINAL_STATE["scroll"] = max(0, int(TERMINAL_STATE["scroll"]) - 3)
        return f"Termux shell scroll {direction}"

    if tool == "desktop_type":
        text = str(args.get("text", ""))
        enter = bool(args.get("enter"))
        if os.environ.get("DISPLAY") and shutil.which("xdotool"):
            if text:
                subprocess.run(["xdotool", "type", "--clearmodifiers", "--delay", "10", "--", text], timeout=8.0)
            if enter:
                subprocess.run(["xdotool", "key", "Return"], timeout=4.0)
            add_log(f"X11 TYPE {len(text)}c")
            return f"Typed {len(text)} chars (X11)"
        if has_adb_device() or check_root_available():
            if text:
                escaped = text.replace(" ", "%s")
                run_android_input(["input", "text", escaped])
            if enter:
                run_android_input(["input", "keyevent", "66"])
            add_log(f"TYPE {len(text)}c")
            return f"Typed {len(text)} chars on Android"
        if text:
            TERMINAL_STATE["cmd"] += text
        if enter:
            cmd_to_run = TERMINAL_STATE["cmd"]
            TERMINAL_STATE["cmd"] = ""
            return execute_shell_line(cmd_to_run)
        return f"Buffered in Termux shell: {TERMINAL_STATE['cmd']}"

    if tool == "desktop_key":
        key = str(args.get("key", "Enter"))
        if os.environ.get("DISPLAY") and shutil.which("xdotool"):
            subprocess.run(["xdotool", "key", key], timeout=4.0)
            add_log(f"X11 KEY {key}")
            return f"Sent X11 key {key}"
        if has_adb_device() or check_root_available():
            key_map = {
                "Enter": "66", "Return": "66", "Backspace": "67", "BackSpace": "67",
                "Tab": "61", "Escape": "4", "Back": "4", "Home": "3", "Win": "3",
                "Delete": "112", "ArrowUp": "19", "ArrowDown": "20", "ArrowLeft": "21",
                "ArrowRight": "22", "VolumeUp": "24", "VolumeDown": "25", "Power": "26",
                "Alt+Tab": "187",
            }
            code = key_map.get(key, "66" if key.lower() == "enter" else key)
            out = run_android_input(["input", "keyevent", code])
            add_log(f"KEY {key}")
            return out
        if key in ("Enter", "Return"):
            cmd_to_run = TERMINAL_STATE["cmd"]
            TERMINAL_STATE["cmd"] = ""
            return execute_shell_line(cmd_to_run)
        if key in ("Backspace", "BackSpace", "Delete"):
            TERMINAL_STATE["cmd"] = TERMINAL_STATE["cmd"][:-1]
            return f"Shell buffer: {TERMINAL_STATE['cmd']}"
        if key in ("Escape", "Ctrl+C", "Ctrl+c"):
            TERMINAL_STATE["cmd"] = ""
            add_term_output("^C")
            return "Cleared shell buffer"
        return f"Key {key} handled in Termux shell"

    if tool == "browser_navigate":
        url = str(args.get("url") or "https://google.com")
        add_log(f"URL {url[:28]}")
        add_term_output(f"[URL] {url}")
        return open_android_url(url)

    if tool == "open_app":
        app = str(args.get("app", "")).lower()
        if args.get("command"):
            subprocess.Popen(["bash", "-lc", str(args["command"])])
            add_log(f"RUN {str(args['command'])[:24]}")
            add_term_output(f"[START] {args['command']}")
            return f"Started {args['command']}"
        if app in ("chrome", "chromium", "edge", "browser"):
            return open_android_url(str(args.get("url") or "https://google.com"))
        pkg_map = {
            "youtube": "com.google.android.youtube",
            "settings": "com.android.settings",
            "calculator": "com.google.android.calculator",
            "calc": "com.google.android.calculator",
            "camera": "com.android.camera",
            "files": "com.android.documentsui",
            "explorer": "com.android.documentsui",
            "termux": "com.termux",
        }
        pkg = pkg_map.get(app)
        if pkg:
            if has_adb_device():
                subprocess.run(["adb", "shell", "monkey", "-p", pkg, "-c", "android.intent.category.LAUNCHER", "1"], capture_output=True, timeout=5.0)
            elif shutil.which("monkey"):
                subprocess.Popen(["monkey", "-p", pkg, "-c", "android.intent.category.LAUNCHER", "1"])
            else:
                return open_android_url("https://youtube.com" if app == "youtube" else "https://google.com")
            add_log(f"APP {app}")
            add_term_output(f"[APP] {pkg}")
            return f"Launched {pkg}"
        return f"Termux shell ready for: {app or 'bash'}"

    if tool in ("run_bash", "run_powershell"):
        cmd = str(args.get("command", ""))
        cwd = str(resolve_path(args.get("cwd")))
        return execute_shell_line(cmd, cwd=cwd)

    if tool == "file_list":
        target = resolve_path(args.get("path"))
        entries = []
        for entry in target.iterdir():
            try:
                st = entry.stat()
                size = st.st_size
            except Exception:
                size = 0
            entries.append({
                "Name": entry.name,
                "FullName": str(entry),
                "Length": size,
                "PSIsContainer": entry.is_dir(),
            })
        add_log(f"LS {target.name or '/'}")
        add_term_output(f"[LS] {target} ({len(entries)} items)")
        return json.dumps(entries)

    if tool == "file_read":
        p = resolve_path(str(args["path"]))
        add_log(f"READ {p.name}")
        return p.read_text(encoding="utf-8", errors="replace")

    if tool == "file_write":
        p = resolve_path(str(args["path"]))
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(str(args.get("content", "")), encoding="utf-8")
        add_log(f"WRITE {p.name}")
        add_term_output(f"[WRITE] {p}")
        return f"Wrote {p}"

    if tool == "file_delete":
        p = resolve_path(str(args["path"]))
        if p.is_dir():
            shutil.rmtree(p, ignore_errors=True)
        elif p.exists():
            p.unlink()
        add_log(f"DEL {p.name}")
        add_term_output(f"[DEL] {p}")
        return f"Deleted {p}"

    raise ValueError(f"Unsupported tool on Termux: {tool}")


async def connect_once():
    init_device_info()
    print(f"Android Termux ulanmoqda -> {WS_URI} ...")
    async with websockets.connect(WS_URI, max_size=16 * 1024 * 1024, ping_interval=15) as ws:
        hello = {
            "type": "agent:hello",
            "hostname": DEVICE_INFO["model"],
            "osVersion": DEVICE_INFO["android"],
            "username": getpass.getuser(),
            "screenWidth": int(DEVICE_INFO["screen_w"]),
            "screenHeight": int(DEVICE_INFO["screen_h"]),
            "mode": DEVICE_INFO["screen_mode"],
        }
        await ws.send(json.dumps(hello))
        add_log("CONNECTED TO SERVER")
        print(f"Ulandi: {DEVICE_INFO['model']} ({DEVICE_INFO['android']})")

        async def send_frames():
            while True:
                frame = await asyncio.to_thread(capture_frame_payload)
                await ws.send(json.dumps(frame))
                await asyncio.sleep(0.5 if DEVICE_INFO["screen_mode"] in ("ADB", "ROOT", "TERMUX-X11") else 0.9)

        async def recv_commands():
            async for raw in ws:
                msg = json.loads(raw)
                if msg.get("type") == "cmd:exec":
                    req_id = msg.get("requestId")
                    try:
                        out = await asyncio.to_thread(run_tool, msg.get("tool", ""), msg.get("args") or {})
                        await ws.send(json.dumps({
                            "type": "agent:result",
                            "requestId": req_id,
                            "ok": True,
                            "data": out,
                        }))
                    except Exception as exc:
                        await ws.send(json.dumps({
                            "type": "agent:result",
                            "requestId": req_id,
                            "ok": False,
                            "error": str(exc),
                        }))

        await asyncio.gather(send_frames(), recv_commands())


async def main():
    if shutil.which("termux-wake-lock"):
        try:
            subprocess.run(["termux-wake-lock"], capture_output=True, timeout=2.0)
        except Exception:
            pass
    while True:
        try:
            await connect_once()
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            print(f"Aloqa uzildi ({exc}), 3 soniyadan keyin qayta ulanadi...")
            await asyncio.sleep(3)


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        if shutil.which("termux-wake-unlock"):
            try:
                subprocess.run(["termux-wake-unlock"], capture_output=True, timeout=2.0)
            except Exception:
                pass
        print("To'xtatildi.")
        sys.exit(0)
`;
}
