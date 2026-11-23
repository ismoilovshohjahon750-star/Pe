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
import importlib.util, json, sys, types
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
print("OK")
`;
    fs.writeFileSync(testScriptPath, pyTestCode, 'utf8');
    const stdout = execFileSync('python3', [testScriptPath], { encoding: 'utf8' });
    assert.equal(stdout.trim(), 'OK');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
