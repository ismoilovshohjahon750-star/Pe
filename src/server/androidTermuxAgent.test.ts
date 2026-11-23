import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildAndroidTermuxAgent } from './androidTermuxAgent.ts';

test('generated Android Termux agent compiles with python3 and renders valid PNG + no-ADB interactive shell & actions', () => {
  const script = buildAndroidTermuxAgent('wss://example.com/agent-ws', 'tok123');
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'termux-agent-test-'));
  const scriptPath = path.join(tmpDir, 'android-termux-agent.py');
  const testScriptPath = path.join(tmpDir, 'test_agent.py');

  try {
    fs.writeFileSync(scriptPath, script, 'utf8');
    execFileSync('python3', ['-m', 'py_compile', scriptPath], { stdio: 'pipe' });

    const pyTestCode = `
import http.server, importlib.util, json, socketserver, sys, threading, time, types
sys.modules["websockets"] = types.ModuleType("websockets")
spec = importlib.util.spec_from_file_location("agent", ${JSON.stringify(scriptPath)})
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)
mod.init_device_info()
w, h, png = mod.render_termux_status_png()
assert w == 540 and h == 960
assert png[:8] == b"\\x89PNG\\r\\n\\x1a\\n"
assert len(png) > 1000
assert mod.run_tool("desktop_type", {"text": "TERMUX_OK", "enter": True}) is not None
res_focus = mod.run_tool("desktop_click", {"x": 200, "y": 600, "button": "left"})
assert isinstance(res_focus, str)
bat = mod.run_tool("android_action", {"action": "battery"})
assert isinstance(bat, str)
st = json.loads(mod.run_tool("android_action", {"action": "status"}))
assert st["screen_mode"] == "TERMUX-PRO"

# Test pure-Python JPEG SOF0 dimension parsing (e.g., 720x1600)
fake_jpeg = (
    b"\\xff\\xd8"
    + b"\\xff\\xc0\\x00\\x11\\x08\\x06\\x40\\x02\\xd0\\x03\\x01\\x11\\x00\\x02\\x11\\x01\\x03\\x11\\x01"
    + (b"\\x00" * 1050)
    + b"\\xff\\xd9"
)
jw, jh = mod.parse_jpeg_dimensions(fake_jpeg)
assert (jw, jh) == (720, 1600), f"Expected (720, 1600), got {(jw, jh)}"

# Spin up a local mock Screen Stream over HTTP server with HTML root -> /stream.mjpeg
class MockStreamHandler(http.server.BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        pass
    def do_GET(self):
        if self.path == "/":
            html = b'<html><body><img src="/stream.mjpeg" /></body></html>'
            self.send_response(200)
            self.send_header("Content-Type", "text/html")
            self.send_header("Content-Length", str(len(html)))
            self.end_headers()
            self.wfile.write(html)
        elif self.path.startswith("/stream.mjpeg"):
            self.send_response(200)
            self.send_header("Content-Type", "multipart/x-mixed-replace; boundary=frame")
            self.end_headers()
            part = (
                b"--frame\\r\\n"
                b"Content-Type: image/jpeg\\r\\n"
                + f"Content-Length: {len(fake_jpeg)}\\r\\n\\r\\n".encode("ascii")
                + fake_jpeg
                + b"\\r\\n"
            )
            self.wfile.write(part)
            self.wfile.flush()
            time.sleep(0.6)
        else:
            self.send_response(404)
            self.end_headers()

with socketserver.TCPServer(("127.0.0.1", 0), MockStreamHandler) as srv:
    port = srv.server_address[1]
    t = threading.Thread(target=srv.serve_forever, daemon=True)
    t.start()
    mod.run_tool("android_action", {"action": "set_stream_url", "url": f"http://127.0.0.1:{port}/"})
    got = None
    for _ in range(25):
        frame = mod.capture_frame_payload()
        if frame.get("mode") == "HTTP-STREAM":
            got = frame
            break
        time.sleep(0.1)
    srv.shutdown()
    assert got is not None, "Expected HTTP-STREAM frame from mock Screen Stream server"
    assert got["width"] == 720 and got["height"] == 1600
    assert got["mimeType"] == "image/jpeg"

    # In HTTP-STREAM mode without ADB/Root, GUI tap must fail explicitly rather than fake ok:True
    click_failed = False
    try:
        mod.run_tool("desktop_click", {"x": 200, "y": 400, "button": "left"})
    except RuntimeError:
        click_failed = True
    assert click_failed, "Expected RuntimeError for desktop_click in HTTP-STREAM mode without ADB/Root"

print("OK")
`;
    fs.writeFileSync(testScriptPath, pyTestCode, 'utf8');
    const stdout = execFileSync('python3', [testScriptPath], { encoding: 'utf8' });
    const lines = stdout.trim().split(/\r?\n/);
    assert.ok(stdout.includes('[HTTP-STREAM] MJPEG oqim ulandi'));
    assert.equal(lines[lines.length - 1], 'OK');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
