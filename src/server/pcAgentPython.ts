export function buildPythonPcAgent(wsUrl: string, token?: string | null): string {
  const finalWsUrl = token ? `${wsUrl}?token=${encodeURIComponent(token)}` : wsUrl;
  return `#!/usr/bin/env python3
"""
ClaudeWin 10 Pro — Real PC Live MCP Agent (Python)
Dependencies:
  pip install mss pillow pyautogui websockets
Run:
  python real-pc-agent.py
"""

import asyncio
import base64
import getpass
import io
import json
import os
import platform
import shutil
import socket
import subprocess
import sys
import time
import webbrowser
from pathlib import Path

import mss
import pyautogui
from PIL import Image, ImageDraw
import websockets

WS_URI = ${JSON.stringify(finalWsUrl)}
pyautogui.FAILSAFE = False


def render_locked_frame() -> tuple[int, int, bytes]:
    w, h = 960, 540
    img = Image.new("RGB", (w, h), (7, 11, 20))
    draw = ImageDraw.Draw(img)
    draw.text((60, 175), "PC QULFLANGAN (Win+L)", fill=(56, 189, 248))
    draw.text((60, 215), "Fonda aloqa faol: run_powershell, run_bash va file_* buyruqlari ishlayapti.", fill=(203, 213, 225))
    draw.text((60, 255), "Win+L ekranini ko'rish va kod yozib ochish uchun JarvisPcAgent-Setup.bat ni", fill=(251, 191, 36))
    draw.text((60, 285), "bir marta Administrator sifatida ishga tushiring (JarvisUnlockService).", fill=(251, 191, 36))
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=55)
    return w, h, buf.getvalue()


_screen_locked = False


def winlogon_pipe_request(payload: dict) -> dict | None:
    if os.name != "nt":
        return None
    pipe_path = r"\\\\.\\pipe\\JarvisWinlogonPipe"
    try:
        import ctypes
        k32 = ctypes.windll.kernel32
        if not k32.WaitNamedPipeW(pipe_path, 1200):
            return None
        with open(pipe_path, "r+b", buffering=0) as pipe:
            pipe.write((json.dumps(payload) + "\\n").encode("utf-8"))
            pipe.flush()
            raw_line = pipe.readline().decode("utf-8", errors="replace").strip()
            if raw_line:
                return json.loads(raw_line)
    except Exception:
        return None
    return None


def is_workstation_locked() -> bool:
    if os.name == "nt":
        try:
            import ctypes
            u32 = ctypes.windll.user32
            h = u32.OpenInputDesktop(0, False, 0x0001)
            if not h:
                return True
            try:
                buf = ctypes.create_unicode_buffer(128)
                needed = ctypes.c_uint(0)
                if u32.GetUserObjectInformationW(h, 2, buf, ctypes.sizeof(buf), ctypes.byref(needed)):
                    if buf.value.lower() == "winlogon":
                        return True
                return False
            finally:
                u32.CloseDesktop(h)
        except Exception:
            pass
    return _screen_locked


def forward_locked_winlogon_or_raise(payload: dict) -> str:
    resp = winlogon_pipe_request(payload)
    if not resp:
        raise RuntimeError(
            "Kompyuter Win+L bilan qulflangan. Kodni masofadan yozib ochish uchun JarvisPcAgent-Setup.bat ni bir marta Administrator sifatida ishga tushiring (JarvisUnlockService o'rnatiladi)."
        )
    if resp.get("ok"):
        return str(resp.get("data") or "OK")
    raise RuntimeError(str(resp.get("error") or "Winlogon xizmati buyruqni bajara olmadi"))


def capture_frame_payload() -> dict:
    global _screen_locked
    locked_now = is_workstation_locked()
    if not locked_now:
        try:
            with mss.mss() as sct:
                monitor = sct.monitors[1] if len(sct.monitors) > 1 else sct.monitors[0]
                raw = sct.grab(monitor)
                img = Image.frombytes("RGB", raw.size, raw.bgra, "raw", "BGRX")
                buf = io.BytesIO()
                img.save(buf, format="JPEG", quality=55)
                b64 = base64.b64encode(buf.getvalue()).decode("ascii")
                _screen_locked = False
                try:
                    cx, cy = pyautogui.position()
                except Exception:
                    cx, cy = 0, 0
                return {
                    "type": "agent:frame",
                    "mimeType": "image/jpeg",
                    "width": raw.width,
                    "height": raw.height,
                    "data": b64,
                    "cursorX": int(cx),
                    "cursorY": int(cy),
                    "locked": False,
                    "lockServiceReady": False,
                    "timestamp": int(time.time() * 1000),
                }
        except Exception:
            locked_now = True

    _screen_locked = True
    pipe_resp = winlogon_pipe_request({"cmd": "capture"})
    if pipe_resp and pipe_resp.get("ok") and pipe_resp.get("data"):
        return {
            "type": "agent:frame",
            "mimeType": "image/jpeg",
            "width": int(pipe_resp.get("width") or 1280),
            "height": int(pipe_resp.get("height") or 720),
            "data": str(pipe_resp["data"]),
            "cursorX": 0,
            "cursorY": 0,
            "locked": True,
            "lockServiceReady": True,
            "timestamp": int(time.time() * 1000),
        }

    w, h, jpg = render_locked_frame()
    return {
        "type": "agent:frame",
        "mimeType": "image/jpeg",
        "width": w,
        "height": h,
        "data": base64.b64encode(jpg).decode("ascii"),
        "cursorX": 0,
        "cursorY": 0,
        "locked": True,
        "lockServiceReady": False,
        "timestamp": int(time.time() * 1000),
    }


def send_win32_key_or_combo(key_spec: str) -> str:
    import ctypes
    from ctypes import wintypes

    user32 = ctypes.windll.user32
    KEYEVENTF_EXTENDEDKEY = 0x0001
    KEYEVENTF_KEYUP = 0x0002

    class MOUSEINPUT(ctypes.Structure):
        _fields_ = [
            ("dx", ctypes.c_long),
            ("dy", ctypes.c_long),
            ("mouseData", wintypes.DWORD),
            ("dwFlags", wintypes.DWORD),
            ("time", wintypes.DWORD),
            ("dwExtraInfo", ctypes.POINTER(ctypes.c_ulong)),
        ]

    class KEYBDINPUT(ctypes.Structure):
        _fields_ = [
            ("wVk", wintypes.WORD),
            ("wScan", wintypes.WORD),
            ("dwFlags", wintypes.DWORD),
            ("time", wintypes.DWORD),
            ("dwExtraInfo", ctypes.POINTER(ctypes.c_ulong)),
        ]

    class HARDWAREINPUT(ctypes.Structure):
        _fields_ = [
            ("uMsg", wintypes.DWORD),
            ("wParamL", wintypes.WORD),
            ("wParamH", wintypes.WORD),
        ]

    class _INPUTUNION(ctypes.Union):
        _fields_ = [("mi", MOUSEINPUT), ("ki", KEYBDINPUT), ("hi", HARDWAREINPUT)]

    class INPUT(ctypes.Structure):
        _fields_ = [("type", wintypes.DWORD), ("union", _INPUTUNION)]

    vk_map = {
        "win": (0x5B, True),
        "lwin": (0x5B, True),
        "super": (0x5B, True),
        "super_l": (0x5B, True),
        "meta": (0x5B, True),
        "windows": (0x5B, True),
        "rwin": (0x5C, True),
        "super_r": (0x5C, True),
        "ctrl": (0x11, False),
        "control": (0x11, False),
        "lctrl": (0x11, False),
        "rctrl": (0x11, False),
        "alt": (0x12, False),
        "menu": (0x12, False),
        "lalt": (0x12, False),
        "ralt": (0x12, False),
        "shift": (0x10, False),
        "lshift": (0x10, False),
        "rshift": (0x10, False),
        "enter": (0x0D, False),
        "return": (0x0D, False),
        "tab": (0x09, False),
        "esc": (0x1B, False),
        "escape": (0x1B, False),
        "space": (0x20, False),
        "backspace": (0x08, False),
        "back": (0x08, False),
        "delete": (0x2E, True),
        "del": (0x2E, True),
        "insert": (0x2D, True),
        "ins": (0x2D, True),
        "home": (0x24, True),
        "end": (0x23, True),
        "pageup": (0x21, True),
        "pgup": (0x21, True),
        "prior": (0x21, True),
        "pagedown": (0x22, True),
        "pgdn": (0x22, True),
        "next": (0x22, True),
        "left": (0x25, True),
        "arrowleft": (0x25, True),
        "up": (0x26, True),
        "arrowup": (0x26, True),
        "right": (0x27, True),
        "arrowright": (0x27, True),
        "down": (0x28, True),
        "arrowdown": (0x28, True),
        "printscreen": (0x2C, True),
        "prtsc": (0x2C, True),
        "capslock": (0x14, False),
        "volumeup": (0xAF, True),
        "volumedown": (0xAE, True),
        "volumemute": (0xAD, True),
    }

    parts = [p.strip() for p in key_spec.split("+") if p.strip()]
    if not parts:
        raise ValueError("Klaviatura tugmasi bo'sh")

    resolved = []
    for raw_p in parts:
        pl = raw_p.lower()
        if pl in vk_map:
            resolved.append(vk_map[pl])
        elif pl.startswith("f") and pl[1:].isdigit() and 1 <= int(pl[1:]) <= 24:
            resolved.append((0x70 + int(pl[1:]) - 1, False))
        elif len(pl) == 1 and "a" <= pl <= "z":
            resolved.append((ord("A") + (ord(pl) - ord("a")), False))
        elif len(pl) == 1 and "0" <= pl <= "9":
            resolved.append((ord(pl), False))
        elif len(raw_p) == 1:
            scan = user32.VkKeyScanW(ord(raw_p))
            if scan == -1:
                raise ValueError(f"Noma'lum klaviatura tugmasi: {raw_p}")
            resolved.append((scan & 0xFF, False))
        else:
            raise ValueError(f"Noma'lum klaviatura tugmasi: {raw_p}")

    if len(resolved) == 2 and resolved[0][0] in (0x5B, 0x5C) and resolved[1][0] == 0x4C:
        if not user32.LockWorkStation():
            raise RuntimeError("LockWorkStation bajarilmadi")
        return "Locked workstation (Win+L)"

    def send_vk(vk: int, is_ext: bool, is_up: bool) -> int:
        flags = (KEYEVENTF_EXTENDEDKEY if is_ext else 0) | (KEYEVENTF_KEYUP if is_up else 0)
        inp = INPUT(
            type=1,
            union=_INPUTUNION(
                ki=KEYBDINPUT(wVk=vk, wScan=user32.MapVirtualKeyW(vk, 0), dwFlags=flags, time=0, dwExtraInfo=None)
            ),
        )
        return user32.SendInput(1, ctypes.byref(inp), ctypes.sizeof(INPUT))

    for idx, (vk, is_ext) in enumerate(resolved):
        if send_vk(vk, is_ext, False) == 0:
            for r_vk, r_ext in reversed(resolved[:idx]):
                send_vk(r_vk, r_ext, True)
            raise RuntimeError(f"Windows klaviatura tugmasini blokladi (SendInput=0, key={key_spec})")
        time.sleep(0.025)
    time.sleep(0.035)
    for vk, is_ext in reversed(resolved):
        send_vk(vk, is_ext, True)
        time.sleep(0.015)
    return f"Sent real Win32 key {key_spec}"


def run_tool(tool: str, args: dict):
    if tool == "desktop_screenshot":
        try:
            w, h = pyautogui.size()
        except Exception:
            w, h = 960, 540
        return {"width": w, "height": h, "locked": is_workstation_locked(), "note": "Captured live real PC frame"}

    if tool == "unlock_pc":
        if bool(args.get("sas")):
            return forward_locked_winlogon_or_raise({"cmd": "sas"})
        if not is_workstation_locked():
            return "Kompyuter allaqachon ochiq (qulflanmagan)."
        pin = str(args.get("pin", ""))
        wake = True if "wake" not in args else bool(args.get("wake"))
        return forward_locked_winlogon_or_raise({"cmd": "unlock", "pin": pin, "wake": wake})

    if tool == "desktop_move":
        x = int(args.get("x", 0))
        y = int(args.get("y", 0))
        if is_workstation_locked():
            return forward_locked_winlogon_or_raise({"cmd": "move", "x": x, "y": y})
        pyautogui.moveTo(x, y)
        return f"Moved cursor to ({x}, {y})"

    if tool == "desktop_click":
        x = int(args.get("x", 0))
        y = int(args.get("y", 0))
        btn = str(args.get("button", "left"))
        if is_workstation_locked():
            return forward_locked_winlogon_or_raise({"cmd": "click", "x": x, "y": y, "button": btn})
        if btn == "right":
            pyautogui.click(x=x, y=y, button="right")
        elif btn == "double":
            pyautogui.doubleClick(x=x, y=y)
        else:
            pyautogui.click(x=x, y=y, button="left")
        return f"Clicked {btn} at ({x}, {y})"

    if tool == "desktop_scroll":
        if is_workstation_locked():
            return "Ignored scroll on lock screen"
        x = int(args.get("x", 640))
        y = int(args.get("y", 360))
        clicks = int(args.get("clicks", 3))
        direction = str(args.get("direction", "down"))
        amount = 120 * clicks if direction == "up" else -120 * clicks
        pyautogui.scroll(amount, x=x, y=y)
        return f"Scrolled {direction} at ({x}, {y})"

    if tool == "desktop_type":
        text = str(args.get("text", ""))
        enter = bool(args.get("enter"))
        if is_workstation_locked():
            return forward_locked_winlogon_or_raise({"cmd": "type", "text": text, "enter": enter})
        pyautogui.write(text, interval=0.01)
        if enter:
            pyautogui.press("enter")
        return f"Typed {len(text)} chars"

    if tool == "desktop_key":
        key = str(args.get("key", "enter")).strip()
        if not key:
            raise ValueError("Klaviatura tugmasi ko'rsatilmagan.")
        if is_workstation_locked():
            return forward_locked_winlogon_or_raise({"cmd": "key", "key": key})

        if os.name == "nt":
            return send_win32_key_or_combo(key)

        norm_map = {
            "enter": "enter",
            "return": "enter",
            "tab": "tab",
            "escape": "esc",
            "esc": "esc",
            "backspace": "backspace",
            "back": "backspace",
            "delete": "delete",
            "del": "delete",
            "space": "space",
            "win": "win",
            "lwin": "winleft",
            "super": "win",
            "super_l": "win",
            "meta": "win",
            "windows": "win",
            "ctrl": "ctrl",
            "control": "ctrl",
            "alt": "alt",
            "shift": "shift",
            "arrowup": "up",
            "arrowdown": "down",
            "arrowleft": "left",
            "arrowright": "right",
            "up": "up",
            "down": "down",
            "left": "left",
            "right": "right",
            "pageup": "pageup",
            "pagedown": "pagedown",
            "home": "home",
            "end": "end",
        }
        parts = [p.strip().lower() for p in key.split("+") if p.strip()]
        mapped_parts = [norm_map.get(p, p) for p in parts]
        valid_keys = set(getattr(pyautogui, "KEYBOARD_KEYS", []))
        for mp in mapped_parts:
            if valid_keys and mp not in valid_keys:
                raise ValueError(f"Noma'lum klaviatura tugmasi: {mp}")
        if len(mapped_parts) > 1:
            pyautogui.hotkey(*mapped_parts)
        else:
            pyautogui.press(mapped_parts[0])
        return f"Sent key {key}"

    if tool == "browser_navigate":
        url = str(args.get("url", "https://modelcontextprotocol.io"))
        webbrowser.open(url)
        return f"Opened {url}"

    if tool == "open_app":
        app = str(args.get("app", "")).lower()
        if args.get("command"):
            subprocess.Popen(str(args["command"]), shell=True)
            return f"Started {args['command']}"
        if app in ("edge", "chromium", "chrome", "browser"):
            url = str(args.get("url") or "https://modelcontextprotocol.io")
            webbrowser.open(url)
            return "Opened browser"
        if app in ("notepad", "mousepad", "editor"):
            target = str(args.get("filePath") or "")
            cmd = ["notepad.exe", target] if os.name == "nt" else ["xdg-open", target or "."]
            subprocess.Popen([c for c in cmd if c])
            return "Opened editor"
        if app in ("explorer", "files"):
            target = str(args.get("filePath") or str(Path.home() / "Desktop"))
            if os.name == "nt":
                os.startfile(target)
            else:
                subprocess.Popen(["xdg-open", target])
            return "Opened files"
        if app in ("calculator", "calc"):
            subprocess.Popen("calc.exe" if os.name == "nt" else "galculator", shell=True)
            return "Opened calculator"
        subprocess.Popen("powershell.exe" if os.name == "nt" else "bash", shell=True)
        return "Opened terminal"

    if tool in ("run_bash", "run_powershell"):
        cmd = str(args.get("command", ""))
        cwd = str(args.get("cwd") or Path.home())
        if os.name == "nt" and tool == "run_powershell":
            proc = subprocess.run(
                ["powershell.exe", "-NoProfile", "-NonInteractive", "-Command", cmd],
                cwd=cwd,
                capture_output=True,
                text=True,
                timeout=30,
            )
        else:
            proc = subprocess.run(
                cmd,
                cwd=cwd,
                shell=True,
                capture_output=True,
                text=True,
                timeout=30,
            )
        return (proc.stdout or "") + (proc.stderr or "")

    if tool == "file_list":
        target = Path(str(args.get("path") or (Path.home() / "Desktop")))
        entries = []
        for entry in target.iterdir():
            st = entry.stat()
            entries.append({
                "Name": entry.name,
                "FullName": str(entry),
                "Length": st.st_size,
                "PSIsContainer": entry.is_dir(),
            })
        return json.dumps(entries)

    if tool == "file_read":
        return Path(str(args["path"])).read_text(encoding="utf-8", errors="replace")

    if tool == "file_write":
        p = Path(str(args["path"]))
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(str(args.get("content", "")), encoding="utf-8")
        return f"Wrote {p}"

    if tool == "file_delete":
        p = Path(str(args["path"]))
        if p.is_dir():
            shutil.rmtree(p, ignore_errors=True)
        elif p.exists():
            p.unlink()
        return f"Deleted {p}"

    raise ValueError(f"Unsupported tool: {tool}")


async def connect_once():
    print(f"Connecting real PC to {WS_URI} ...")
    async with websockets.connect(WS_URI, max_size=16 * 1024 * 1024, ping_interval=15) as ws:
        try:
            w, h = pyautogui.size()
        except Exception:
            w, h = 1280, 720
        hello = {
            "type": "agent:hello",
            "hostname": socket.gethostname(),
            "osVersion": f"{platform.system()} {platform.release()}",
            "username": getpass.getuser(),
            "screenWidth": int(w),
            "screenHeight": int(h),
        }
        await ws.send(json.dumps(hello))
        print("Connected! Streaming live screen & listening for MCP commands...")

        async def send_frames():
            while True:
                frame = await asyncio.to_thread(capture_frame_payload)
                await ws.send(json.dumps(frame))
                await asyncio.sleep(0.35)

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
    while True:
        try:
            await connect_once()
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            print(f"Connection interrupted ({exc}), reconnecting in 3s...")
            await asyncio.sleep(3)


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("Stopped.")
        sys.exit(0)
`;
}
