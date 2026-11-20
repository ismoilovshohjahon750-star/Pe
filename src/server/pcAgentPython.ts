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
from PIL import Image
import websockets

WS_URI = ${JSON.stringify(finalWsUrl)}
pyautogui.FAILSAFE = False


def capture_frame_payload() -> dict:
    with mss.mss() as sct:
        monitor = sct.monitors[1] if len(sct.monitors) > 1 else sct.monitors[0]
        raw = sct.grab(monitor)
        img = Image.frombytes("RGB", raw.size, raw.bgra, "raw", "BGRX")
        buf = io.BytesIO()
        img.save(buf, format="JPEG", quality=55)
        b64 = base64.b64encode(buf.getvalue()).decode("ascii")
        cx, cy = pyautogui.position()
        return {
            "type": "agent:frame",
            "mimeType": "image/jpeg",
            "width": raw.width,
            "height": raw.height,
            "data": b64,
            "cursorX": int(cx),
            "cursorY": int(cy),
            "timestamp": int(time.time() * 1000),
        }


def run_tool(tool: str, args: dict):
    if tool == "desktop_screenshot":
        w, h = pyautogui.size()
        return {"width": w, "height": h, "note": "Captured live real PC frame"}

    if tool == "desktop_move":
        pyautogui.moveTo(int(args.get("x", 0)), int(args.get("y", 0)))
        return f"Moved cursor to ({args.get('x', 0)}, {args.get('y', 0)})"

    if tool == "desktop_click":
        x = int(args.get("x", 0))
        y = int(args.get("y", 0))
        btn = str(args.get("button", "left"))
        if btn == "right":
            pyautogui.click(x=x, y=y, button="right")
        elif btn == "double":
            pyautogui.doubleClick(x=x, y=y)
        else:
            pyautogui.click(x=x, y=y, button="left")
        return f"Clicked {btn} at ({x}, {y})"

    if tool == "desktop_scroll":
        x = int(args.get("x", 640))
        y = int(args.get("y", 360))
        clicks = int(args.get("clicks", 3))
        direction = str(args.get("direction", "down"))
        amount = 120 * clicks if direction == "up" else -120 * clicks
        pyautogui.scroll(amount, x=x, y=y)
        return f"Scrolled {direction} at ({x}, {y})"

    if tool == "desktop_type":
        text = str(args.get("text", ""))
        pyautogui.write(text, interval=0.01)
        if args.get("enter"):
            pyautogui.press("enter")
        return f"Typed {len(text)} chars"

    if tool == "desktop_key":
        key = str(args.get("key", "enter"))
        key_map = {
            "Enter": "enter",
            "Return": "enter",
            "Tab": "tab",
            "Escape": "esc",
            "Backspace": "backspace",
            "Win": "win",
        }
        if "+" in key:
            parts = [p.strip().lower() for p in key.split("+") if p.strip()]
            pyautogui.hotkey(*parts)
        else:
            pyautogui.press(key_map.get(key, key.lower()))
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


async def main():
    print(f"Connecting real PC to {WS_URI} ...")
    async with websockets.connect(WS_URI, max_size=16 * 1024 * 1024, ping_interval=15) as ws:
        w, h = pyautogui.size()
        hello = {
            "type": "agent:hello",
            "hostname": socket.gethostname(),
            "osVersion": f"{platform.system()} {platform.release()}",
            "username": getpass.getuser(),
            "screenWidth": int(w),
            "screenHeight": int(h),
        }
        await ws.send(json.dumps(hello))
        print("Connected! Streaming live screen & listening for Claude MCP commands...")

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


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("Stopped.")
        sys.exit(0)
`;
}
