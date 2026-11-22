export function buildAndroidTermuxAgent(wsUrl: string, token?: string | null): string {
  const finalWsUrl = token ? `${wsUrl}?token=${encodeURIComponent(token)}` : wsUrl;
  return `#!/usr/bin/env python3
"""
J.A.R.V.I.S. — Android Termux Live MCP Agent
Works on any Android device via Termux with minimal dependency (websockets).
Optional capabilities:
  - ADB Wireless Debugging (pkg install android-tools + adb connect) or Root (su) for live screen + touch
  - Termux:API (pkg install termux-api) for battery, wake-lock & open-url
  - Termux:X11 (scrot + xdotool) when DISPLAY is active

Run in Termux:
  pkg install -y python && pip install websockets
  python android-termux-agent.py
"""

import asyncio
import base64
import getpass
import io
import json
import os
import platform
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

# Compact 5x7 uppercase/punctuation bitmap font for dependency-free PNG status rendering
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
    "@": [14, 17, 23, 21, 23, 16, 14],
    "'": [4, 4, 8, 0, 0, 0, 0],
    "~": [0, 8, 21, 2, 0, 0, 0],
}

RECENT_LOGS = []
DEVICE_INFO = {
    "model": "Android Phone",
    "android": "Android",
    "screen_mode": "TERMUX-SHELL",
    "battery": "N/A",
    "last_bat_at": 0.0,
    "root_checked": False,
    "has_root": False,
    "screen_w": 540,
    "screen_h": 960,
}


def add_log(msg: str) -> None:
    ts = time.strftime("%H:%M:%S")
    clean = f"[{ts}] {msg}"
    RECENT_LOGS.append(clean)
    if len(RECENT_LOGS) > 10:
        del RECENT_LOGS[:-10]


def getprop(name: str) -> str:
    try:
        out = subprocess.check_output(["getprop", name], stderr=subprocess.DEVNULL, timeout=1.5)
        return out.decode("utf-8", "replace").strip()
    except Exception:
        return ""


def init_device_info() -> None:
    model = getprop("ro.product.model") or getprop("ro.product.device") or socket.gethostname()
    brand = getprop("ro.product.brand")
    rel = getprop("ro.build.version.release")
    if brand and model and not model.lower().startswith(brand.lower()):
        DEVICE_INFO["model"] = f"{brand} {model}".strip()
    else:
        DEVICE_INFO["model"] = model or "Android Phone"
    DEVICE_INFO["android"] = f"Android {rel} (Termux)" if rel else "Android (Termux)"


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


def refresh_battery_status() -> None:
    now = time.time()
    if now - float(DEVICE_INFO["last_bat_at"]) < 15.0:
        return
    DEVICE_INFO["last_bat_at"] = now
    if not shutil.which("termux-battery-status"):
        return
    try:
        proc = subprocess.run(["termux-battery-status"], capture_output=True, text=True, timeout=2.0)
        if proc.returncode == 0 and proc.stdout.strip().startswith("{"):
            data = json.loads(proc.stdout)
            pct = data.get("percentage")
            st = data.get("status", "")
            if pct is not None:
                DEVICE_INFO["battery"] = f"{pct}% ({st})" if st else f"{pct}%"
    except Exception:
        pass


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

    # Top accent bar (#0E7490)
    bar = bytes([14, 116, 144]) * w
    for y in range(44, 48):
        buf[y * w * 3 : (y + 1) * w * 3] = bar

    draw_text_rgb(buf, w, h, 24, 18, "J.A.R.V.I.S. ANDROID (TERMUX)", (56, 189, 248), scale=2)
    draw_text_rgb(buf, w, h, 24, 66, f"DEVICE: {DEVICE_INFO['model'][:30]}", (226, 232, 240), scale=2)
    draw_text_rgb(buf, w, h, 24, 92, f"OS: {DEVICE_INFO['android'][:34]}", (148, 163, 184), scale=2)
    draw_text_rgb(buf, w, h, 24, 118, f"BATTERY: {DEVICE_INFO['battery'][:28]}", (52, 211, 153), scale=2)
    draw_text_rgb(buf, w, h, 24, 144, f"MODE: {DEVICE_INFO['screen_mode']} (ACTIVE)", (34, 211, 238), scale=2)

    draw_text_rgb(buf, w, h, 24, 192, "READY TOOLS:", (248, 250, 252), scale=2)
    draw_text_rgb(buf, w, h, 24, 218, "* BASH / SHELL COMMANDS", (148, 163, 184), scale=2)
    draw_text_rgb(buf, w, h, 24, 244, "* FILE READ / WRITE / LIST", (148, 163, 184), scale=2)
    draw_text_rgb(buf, w, h, 24, 270, "* URL LAUNCH ON PHONE", (148, 163, 184), scale=2)

    draw_text_rgb(buf, w, h, 24, 316, "FOR LIVE SCREEN + TOUCH:", (251, 191, 36), scale=2)
    draw_text_rgb(buf, w, h, 24, 342, "ADB WIRELESS DEBUGGING:", (203, 213, 225), scale=2)
    draw_text_rgb(buf, w, h, 24, 368, "PKG INSTALL ANDROID-TOOLS", (148, 163, 184), scale=2)
    draw_text_rgb(buf, w, h, 24, 394, "ADB CONNECT 127.0.0.1:PORT", (148, 163, 184), scale=2)

    draw_text_rgb(buf, w, h, 24, 444, "RECENT ACTIVITY:", (56, 189, 248), scale=2)
    logs = RECENT_LOGS[-8:] if RECENT_LOGS else ["WAITING FOR J.A.R.V.I.S. / MCP..."]
    y_pos = 474
    for entry in logs:
        draw_text_rgb(buf, w, h, 24, y_pos, entry[:38], (203, 213, 225), scale=2)
        y_pos += 30

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
                "timestamp": int(time.time() * 1000),
            }
        except Exception:
            pass

    DEVICE_INFO["screen_mode"] = "TERMUX-SHELL"
    w, h, png = render_termux_status_png()
    return {
        "type": "agent:frame",
        "mimeType": "image/png",
        "width": w,
        "height": h,
        "data": base64.b64encode(png).decode("ascii"),
        "cursorX": 0,
        "cursorY": 0,
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
    raise RuntimeError("Android ekranga bosish uchun ADB (Wireless Debugging) yoki Root kerak. Shell/fayl buyruqlari to'g'ridan-to'g'ri ishlayveradi.")


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
    subprocess.Popen(["am", "start", "-a", "android.intent.action.VIEW", "-d", url])
    return f"Opened URL via am start: {url}"


def resolve_path(raw_path: str | None) -> Path:
    if not raw_path:
        return Path.home()
    expanded = os.path.expanduser(str(raw_path))
    return Path(expanded)


def run_tool(tool: str, args: dict):
    if tool == "desktop_screenshot":
        return {
            "width": DEVICE_INFO["screen_w"],
            "height": DEVICE_INFO["screen_h"],
            "mode": DEVICE_INFO["screen_mode"],
            "device": DEVICE_INFO["model"],
        }

    if tool == "desktop_move":
        return f"Android cursor moved to ({args.get('x', 0)}, {args.get('y', 0)})"

    if tool == "desktop_click":
        x = int(args.get("x", 0))
        y = int(args.get("y", 0))
        btn = str(args.get("button", "left"))
        if os.environ.get("DISPLAY") and shutil.which("xdotool"):
            bnum = "3" if btn == "right" else "1"
            cmd = ["xdotool", "mousemove", str(x), str(y), "click"]
            if btn == "double":
                cmd += ["--repeat", "2", bnum]
            else:
                cmd += [bnum]
            subprocess.run(cmd, timeout=4.0)
            add_log(f"X11 CLICK {btn} ({x},{y})")
            return f"X11 clicked {btn} at ({x}, {y})"
        if btn == "right":
            out = run_android_input(["input", "swipe", str(x), str(y), str(x), str(y), "650"])
        elif btn == "double":
            run_android_input(["input", "tap", str(x), str(y)])
            out = run_android_input(["input", "tap", str(x), str(y)])
        else:
            out = run_android_input(["input", "tap", str(x), str(y)])
        add_log(f"TAP {btn} ({x},{y})")
        return out

    if tool == "desktop_scroll":
        x = int(args.get("x", DEVICE_INFO["screen_w"] // 2))
        y = int(args.get("y", DEVICE_INFO["screen_h"] // 2))
        direction = str(args.get("direction", "down"))
        dy = 320 if direction == "up" else -320
        y2 = max(20, min(DEVICE_INFO["screen_h"] - 20, y + dy))
        out = run_android_input(["input", "swipe", str(x), str(y), str(x), str(y2), "220"])
        add_log(f"SWIPE {direction}")
        return out

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
        if text:
            escaped = text.replace(" ", "%s")
            run_android_input(["input", "text", escaped])
        if enter:
            run_android_input(["input", "keyevent", "66"])
        add_log(f"TYPE {len(text)}c")
        return f"Typed {len(text)} chars on Android"

    if tool == "desktop_key":
        key = str(args.get("key", "Enter"))
        if os.environ.get("DISPLAY") and shutil.which("xdotool"):
            subprocess.run(["xdotool", "key", key], timeout=4.0)
            add_log(f"X11 KEY {key}")
            return f"Sent X11 key {key}"
        key_map = {
            "Enter": "66",
            "Return": "66",
            "Backspace": "67",
            "BackSpace": "67",
            "Tab": "61",
            "Escape": "4",
            "Back": "4",
            "Home": "3",
            "Win": "3",
            "Delete": "112",
            "ArrowUp": "19",
            "ArrowDown": "20",
            "ArrowLeft": "21",
            "ArrowRight": "22",
            "VolumeUp": "24",
            "VolumeDown": "25",
            "Power": "26",
            "Alt+Tab": "187",
        }
        code = key_map.get(key, "66" if key.lower() == "enter" else key)
        out = run_android_input(["input", "keyevent", code])
        add_log(f"KEY {key}")
        return out

    if tool == "browser_navigate":
        url = str(args.get("url") or "https://google.com")
        add_log(f"URL {url[:28]}")
        return open_android_url(url)

    if tool == "open_app":
        app = str(args.get("app", "")).lower()
        if args.get("command"):
            subprocess.Popen(["bash", "-lc", str(args["command"])])
            add_log(f"RUN {str(args['command'])[:24]}")
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
            else:
                subprocess.Popen(["monkey", "-p", pkg, "-c", "android.intent.category.LAUNCHER", "1"])
            add_log(f"APP {app}")
            return f"Launched {pkg}"
        return f"Termux shell ready for: {app or 'bash'}"

    if tool in ("run_bash", "run_powershell"):
        cmd = str(args.get("command", ""))
        cwd = str(resolve_path(args.get("cwd")))
        add_log(f"$ {cmd[:32]}")
        proc = subprocess.run(
            ["bash", "-lc", cmd],
            cwd=cwd,
            capture_output=True,
            text=True,
            timeout=30,
        )
        out = (proc.stdout or "") + (proc.stderr or "")
        return out or f"(exit {proc.returncode})"

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
        return f"Wrote {p}"

    if tool == "file_delete":
        p = resolve_path(str(args["path"]))
        if p.is_dir():
            shutil.rmtree(p, ignore_errors=True)
        elif p.exists():
            p.unlink()
        add_log(f"DEL {p.name}")
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
        }
        await ws.send(json.dumps(hello))
        add_log("CONNECTED TO SERVER")
        print(f"Ulandi: {DEVICE_INFO['model']} ({DEVICE_INFO['android']})")

        async def send_frames():
            while True:
                frame = await asyncio.to_thread(capture_frame_payload)
                await ws.send(json.dumps(frame))
                await asyncio.sleep(0.5 if DEVICE_INFO["screen_mode"] in ("ADB", "ROOT", "TERMUX-X11") else 1.2)

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
