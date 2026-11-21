import { exec, execFile, spawn, type ChildProcess, type SpawnOptions } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import {
  buildNonInteractiveAptInstallCmd,
  createInitialLinuxStatus,
  shouldBroadcastFrame,
  type LinuxDesktopStatus,
  type RealAgentFrame,
} from '../desktop/bridge.ts';
import type { AppId } from '../desktop/types.ts';

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);

const DISPLAY = ':99';
const SCREEN_W = 1280;
const SCREEN_H = 720;
const JPEG_SOI = Buffer.from([0xff, 0xd8]);
const JPEG_EOI = Buffer.from([0xff, 0xd9]);

type StatusListener = (status: LinuxDesktopStatus) => void;
type FrameListener = (frame: RealAgentFrame) => void;

class RealLinuxDesktopManager {
  private status: LinuxDesktopStatus = createInitialLinuxStatus();
  private latestFrame: RealAgentFrame | null = null;
  private statusListeners = new Set<StatusListener>();
  private frameListeners = new Set<FrameListener>();

  private xvfbProc: ChildProcess | null = null;
  private openboxProc: ChildProcess | null = null;
  private tint2Proc: ChildProcess | null = null;
  private pcmanfmProc: ChildProcess | null = null;
  private ffmpegProc: ChildProcess | null = null;
  private frameTimes: number[] = [];
  private lastBroadcastJpeg: Buffer | null = null;
  private lastBroadcastAt = 0;
  private startingPromise: Promise<LinuxDesktopStatus> | null = null;
  private installCorePromise: Promise<boolean> | null = null;
  private installChromiumPromise: Promise<boolean> | null = null;
  private aptQueue: Promise<unknown> = Promise.resolve();

  getStatus(): LinuxDesktopStatus {
    return this.status;
  }

  getLatestFrame(): RealAgentFrame | null {
    return this.latestFrame;
  }

  onStatus(fn: StatusListener): () => void {
    this.statusListeners.add(fn);
    return () => this.statusListeners.delete(fn);
  }

  onFrame(fn: FrameListener): () => void {
    this.frameListeners.add(fn);
    return () => this.frameListeners.delete(fn);
  }

  private emitStatus() {
    for (const fn of this.statusListeners) fn(this.status);
  }

  private emitFrame(jpeg: Buffer, force = false): RealAgentFrame {
    const now = Date.now();
    const frame: RealAgentFrame = {
      mimeType: 'image/jpeg',
      width: SCREEN_W,
      height: SCREEN_H,
      data: jpeg.toString('base64'),
      cursorX: 0,
      cursorY: 0,
      timestamp: now,
    };
    this.latestFrame = frame;

    if (force || shouldBroadcastFrame(this.lastBroadcastJpeg, jpeg, now - this.lastBroadcastAt, 4000)) {
      this.lastBroadcastJpeg = Buffer.from(jpeg);
      this.lastBroadcastAt = now;
      for (const fn of this.frameListeners) fn(frame);
    }
    return frame;
  }

  private async pushLiveFrame(delayMs = 80): Promise<void> {
    try {
      if (delayMs > 0) {
        await new Promise((r) => setTimeout(r, delayMs));
      }
      const tmpSnap = '/tmp/claude_x11_snap.jpg';
      await execFileAsync('scrot', ['-o', '-q', '80', tmpSnap], { env: this.env() });
      const buf = fs.readFileSync(tmpSnap);
      this.emitFrame(buf, true);
    } catch {
      // ignore transient scrot errors
    }
  }

  private async waitForWindowChange(prevIds: Set<string>, timeoutMs = 1200): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    await new Promise((r) => setTimeout(r, 250));
    while (Date.now() < deadline) {
      const current = await this.listWindows();
      if (current.some((w) => !prevIds.has(w.windowId))) {
        await new Promise((r) => setTimeout(r, 120));
        return;
      }
      await new Promise((r) => setTimeout(r, 140));
    }
  }

  private env() {
    return {
      ...process.env,
      DISPLAY,
      HOME: '/root',
      XDG_RUNTIME_DIR: '/tmp/xdg-runtime-root',
    };
  }

  private spawnSafe(cmd: string, args: string[], opts: SpawnOptions): ChildProcess {
    const child = spawn(cmd, args, opts);
    child.on('error', (err) => {
      console.error(`[Linux X11] Spawn error (${cmd}):`, (err as Error).message);
    });
    return child;
  }

  private async hasBinary(name: string): Promise<boolean> {
    try {
      await execFileAsync('which', [name], { env: process.env });
      return true;
    } catch {
      return false;
    }
  }

  private runShellNoStdin(
    command: string,
    timeoutMs = 240000,
    customEnv?: NodeJS.ProcessEnv,
  ): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    return new Promise((resolve, reject) => {
      const child = spawn('bash', ['-lc', command], {
        stdio: ['ignore', 'pipe', 'pipe'],
        env: customEnv ?? {
          ...process.env,
          DEBIAN_FRONTEND: 'noninteractive',
          DEBCONF_NONINTERACTIVE_SEEN: 'true',
          NEEDRESTART_MODE: 'a',
          UCF_FORCE_CONFFOLD: '1',
        },
      });

      const maxTail = 16384;
      let stdout = '';
      let stderr = '';
      let timedOut = false;

      const timer = setTimeout(() => {
        timedOut = true;
        child.kill('SIGTERM');
        setTimeout(() => child.kill('SIGKILL'), 2000).unref();
      }, timeoutMs);

      child.stdout?.on('data', (chunk: Buffer) => {
        stdout = (stdout + chunk.toString('utf8')).slice(-maxTail);
      });
      child.stderr?.on('data', (chunk: Buffer) => {
        stderr = (stderr + chunk.toString('utf8')).slice(-maxTail);
      });
      child.on('error', (err) => {
        clearTimeout(timer);
        reject(err);
      });
      child.on('close', (code) => {
        clearTimeout(timer);
        if (timedOut) {
          reject(new Error(`Command timed out after ${timeoutMs}ms: ${stderr.slice(-400)}`));
          return;
        }
        const exitCode = typeof code === 'number' ? code : 1;
        if (exitCode !== 0) {
          reject(new Error(stderr.trim() || stdout.trim() || `Exit code ${exitCode}`));
          return;
        }
        resolve({ stdout, stderr, exitCode: 0 });
      });
    });
  }

  private enqueueApt<T>(task: () => Promise<T>): Promise<T> {
    const run = this.aptQueue.then(task, task);
    this.aptQueue = run.catch(() => {});
    return run;
  }

  private async hasCoreDesktopBinaries(): Promise<boolean> {
    const required = ['Xvfb', 'openbox', 'xdotool', 'scrot', 'xdpyinfo', 'xsetroot', 'ffmpeg'];
    const checks = await Promise.all(required.map((bin) => this.hasBinary(bin)));
    return checks.every(Boolean);
  }

  async checkInstalled(): Promise<boolean> {
    if (await this.hasCoreDesktopBinaries()) {
      this.status = { ...this.status, available: true, error: null };
      return true;
    }

    if (this.installCorePromise) {
      return this.installCorePromise;
    }

    this.installCorePromise = this.enqueueApt(async () => {
      try {
        if (await this.hasCoreDesktopBinaries()) {
          this.status = { ...this.status, available: true, error: null };
          return true;
        }

        const hasFfmpeg = await this.hasBinary('ffmpeg');
        const corePackages = [
          'xvfb',
          'openbox',
          'tint2',
          'pcmanfm',
          'xfce4-terminal',
          'mousepad',
          'galculator',
          'xdotool',
          'scrot',
          'dbus-x11',
          'x11-utils',
          'x11-xserver-utils',
          'fonts-dejavu-core',
          ...(hasFfmpeg ? [] : ['ffmpeg']),
        ];

        console.log('X11 core binaries not found. Installing fast Debian desktop packages...');
        await this.runShellNoStdin(buildNonInteractiveAptInstallCmd(corePackages), 240000);

        if (!(await this.hasCoreDesktopBinaries())) {
          throw new Error('Required X11 binaries (Xvfb, openbox, xdotool, scrot, ffmpeg) still missing after install.');
        }

        this.status = { ...this.status, available: true, error: null };
        this.emitStatus();
        console.log('Successfully installed X11 core desktop packages!');
        return true;
      } catch (installErr) {
        this.status = {
          ...this.status,
          available: false,
          running: false,
          error: `X11 paketlarini o‘rnatib bo‘lmadi: ${(installErr as Error).message.slice(0, 320)}`,
        };
        this.emitStatus();
        return false;
      } finally {
        this.installCorePromise = null;
      }
    });

    return this.installCorePromise;
  }

  private async findChromiumBinary(): Promise<string | null> {
    for (const candidate of ['chromium', 'chromium-browser', 'google-chrome']) {
      if (await this.hasBinary(candidate)) {
        return candidate;
      }
    }
    return null;
  }

  private async ensureChromiumInstalled(): Promise<boolean> {
    if (await this.findChromiumBinary()) return true;
    if (this.installChromiumPromise) return this.installChromiumPromise;

    this.installChromiumPromise = this.enqueueApt(async () => {
      try {
        if (await this.findChromiumBinary()) return true;
        console.log('Installing Chromium + Adwaita icons in background...');
        await this.runShellNoStdin(
          buildNonInteractiveAptInstallCmd(['chromium', 'adwaita-icon-theme']),
          300000,
        );
        const found = await this.findChromiumBinary();
        if (found) {
          console.log(`Background Chromium install finished (${found}).`);
          return true;
        }
        return false;
      } catch (err) {
        console.warn('Background Chromium install skipped/failed:', (err as Error).message.slice(0, 200));
        return false;
      } finally {
        this.installChromiumPromise = null;
      }
    });

    return this.installChromiumPromise;
  }

  private prepareDesktopConfigs(): void {
    fs.mkdirSync('/tmp/xdg-runtime-root', { recursive: true, mode: 0o700 });
    fs.mkdirSync('/root/Desktop', { recursive: true });
    fs.mkdirSync('/root/Projects', { recursive: true });
    fs.mkdirSync('/root/.config/tint2', { recursive: true });
    fs.mkdirSync('/root/.config/openbox', { recursive: true });

    const welcomePath = '/root/Desktop/README_Claude.txt';
    if (!fs.existsSync(welcomePath)) {
      fs.writeFileSync(
        welcomePath,
        [
          'Debian GNU/Linux 12 (Bookworm) — Dedicated Claude AI Desktop',
          '===========================================================',
          '',
          'Display:   :99 (1280x720 X11)',
          'WM/Panel:  Openbox + Tint2 + PCManFM',
          'Apps:      Chromium, XFCE4 Terminal, Mousepad, PCManFM, Galculator',
          '',
          'Connected via MCP (/mcp & /sse) and streamed live over WebSocket.',
        ].join('\n'),
        'utf8',
      );
    }

    const demoJs = '/root/Projects/hello.mjs';
    if (!fs.existsSync(demoJs)) {
      fs.writeFileSync(
        demoJs,
        'import os from "node:os";\nconsole.log("Hello from real Debian Linux!", os.release(), process.version);\n',
        'utf8',
      );
    }

    // Desktop shortcuts
    const shortcuts: Array<{ file: string; name: string; exec: string; icon: string }> = [
      {
        file: 'chromium.desktop',
        name: 'Chromium Browser',
        exec: 'chromium --no-sandbox --disable-dev-shm-usage --disable-gpu',
        icon: 'web-browser',
      },
      {
        file: 'terminal.desktop',
        name: 'Terminal',
        exec: 'xfce4-terminal',
        icon: 'utilities-terminal',
      },
      {
        file: 'files.desktop',
        name: 'File Manager',
        exec: 'pcmanfm /root',
        icon: 'system-file-manager',
      },
      {
        file: 'mousepad.desktop',
        name: 'Mousepad Editor',
        exec: 'mousepad',
        icon: 'accessories-text-editor',
      },
      {
        file: 'galculator.desktop',
        name: 'Calculator',
        exec: 'galculator',
        icon: 'accessories-calculator',
      },
    ];

    for (const s of shortcuts) {
      const p = path.join('/root/Desktop', s.file);
      fs.writeFileSync(
        p,
        `[Desktop Entry]\nType=Application\nName=${s.name}\nExec=${s.exec}\nIcon=${s.icon}\nTerminal=false\n`,
        { mode: 0o755 },
      );
    }

    // Clean modern dark tint2 panel config
    fs.writeFileSync(
      '/root/.config/tint2/tint2rc',
      [
        'rounded = 0',
        'background_color = #0f172a 95',
        'border_width = 1',
        'border_color = #1e293b 100',
        'panel_items = LTSC',
        'panel_size = 100% 38',
        'panel_position = bottom center horizontal',
        'panel_layer = top',
        'taskbar_mode = single_desktop',
        'taskbar_padding = 4 2 4',
        'taskbar_background_id = 0',
        'task_text = 1',
        'task_icon = 1',
        'task_maximum_size = 180 34',
        'task_padding = 6 4 6',
        'task_font = DejaVu Sans 9',
        'task_font_color = #e2e8f0 100',
        'task_active_font_color = #ffffff 100',
        'task_active_background_id = 2',
        'rounded = 0',
        'background_color = #0078d4 90',
        'border_width = 0',
        'launcher_padding = 6 4 6',
        'launcher_icon_size = 22',
        'launcher_item_app = /root/Desktop/terminal.desktop',
        'launcher_item_app = /root/Desktop/files.desktop',
        'launcher_item_app = /root/Desktop/chromium.desktop',
        'launcher_item_app = /root/Desktop/mousepad.desktop',
        'time1_format = %H:%M',
        'time2_format = %Y-%m-%d',
        'time1_font = DejaVu Sans Bold 9',
        'time2_font = DejaVu Sans 8',
        'clock_font_color = #f8fafc 100',
        'clock_padding = 10 2',
      ].join('\n'),
    );

    fs.mkdirSync('/root/.config/pcmanfm/default', { recursive: true });
    const wpPath = path.resolve(
      process.cwd(),
      'src/assets/images/win10_hero_wallpaper_1795102455685.jpg',
    );
    fs.writeFileSync(
      '/root/.config/pcmanfm/default/desktop-items-0.conf',
      [
        '[*]',
        fs.existsSync(wpPath) ? 'wallpaper_mode=stretch' : 'wallpaper_mode=color',
        'wallpaper_common=1',
        ...(fs.existsSync(wpPath) ? [`wallpaper=${wpPath}`] : []),
        'desktop_bg=#0B1D36',
        'desktop_fg=#ffffff',
        'desktop_shadow=#000000',
        'desktop_font=DejaVu Sans 10',
        'show_wm_menu=1',
        'show_documents=0',
        'show_trash=0',
        'show_mounts=0',
      ].join('\n'),
    );

    fs.writeFileSync(
      '/root/.config/openbox/menu.xml',
      `<?xml version="1.0" encoding="UTF-8"?>
<openbox_menu xmlns="http://openbox.org/3.4/menu">
  <menu id="root-menu" label="Linux Applications">
    <item label="Terminal (xfce4-terminal)"><action name="Execute"><command>xfce4-terminal</command></action></item>
    <item label="Chromium Browser"><action name="Execute"><command>chromium --no-sandbox --disable-dev-shm-usage --disable-gpu</command></action></item>
    <item label="File Manager (PCManFM)"><action name="Execute"><command>pcmanfm /root</command></action></item>
    <item label="Mousepad Editor"><action name="Execute"><command>mousepad</command></action></item>
    <item label="Calculator"><action name="Execute"><command>galculator</command></action></item>
  </menu>
</openbox_menu>`,
    );
  }

  async ensureStarted(): Promise<LinuxDesktopStatus> {
    if (this.status.running) return this.status;
    if (this.startingPromise) return this.startingPromise;

    this.startingPromise = (async () => {
      try {
        const ok = await this.checkInstalled();
        if (!ok) {
          this.emitStatus();
          return this.status;
        }

        this.prepareDesktopConfigs();
        // Clean stale X99 lock if previous server crashed
        try {
          fs.rmSync('/tmp/.X99-lock', { force: true });
          fs.rmSync('/tmp/.X11-unix/X99', { force: true });
        } catch {
          // ignore
        }

        // Start Xvfb
        let xvfbExitedEarly: number | null = null;
        this.xvfbProc = this.spawnSafe(
          'Xvfb',
          [DISPLAY, '-screen', '0', `${SCREEN_W}x${SCREEN_H}x24`, '-ac', '+extension', 'GLX', '+render', '-noreset'],
          { stdio: 'ignore', detached: false },
        );
        this.xvfbProc.once('exit', (code) => {
          xvfbExitedEarly = code ?? 1;
        });

        // Wait until Xvfb accepts connections
        let xReady = false;
        for (let i = 0; i < 30; i++) {
          if (xvfbExitedEarly !== null) {
            throw new Error(`Xvfb exited prematurely with code ${xvfbExitedEarly}`);
          }
          try {
            await execFileAsync('xdpyinfo', [], { env: this.env() });
            xReady = true;
            break;
          } catch {
            await new Promise((r) => setTimeout(r, 150));
          }
        }
        if (!xReady) {
          throw new Error('Xvfb timed out waiting to accept X11 connections');
        }

        const env = this.env();
        // Solid slate desktop backdrop fallback before pcmanfm paints wallpaper
        await execFileAsync('xsetroot', ['-solid', '#0B1D36', '-cursor_name', 'left_ptr'], { env }).catch(
          () => {},
        );

        this.openboxProc = this.spawnSafe('openbox', [], { env, stdio: 'ignore' });
        await new Promise((r) => setTimeout(r, 300));

        if (await this.hasBinary('tint2')) {
          this.tint2Proc = this.spawnSafe('tint2', [], { env, stdio: 'ignore' });
        }
        if (await this.hasBinary('pcmanfm')) {
          this.pcmanfmProc = this.spawnSafe('pcmanfm', ['--desktop'], { env, stdio: 'ignore' });
        }

        // Open welcome readme + terminal cleanly without cluttering desktop icons
        if (await this.hasBinary('mousepad')) {
          this.spawnSafe('mousepad', ['/root/Desktop/README_Claude.txt'], { env, stdio: 'ignore' });
          await new Promise((r) => setTimeout(r, 250));
        }
        if (await this.hasBinary('xfce4-terminal')) {
          this.spawnSafe(
            'xfce4-terminal',
            ['--geometry=74x22+580+60', '-e', 'bash -lc "uname -a; echo \'Claude Linux Desktop Ready!\'; exec bash"'],
            { env, stdio: 'ignore' },
          );
        }

        this.startFfmpegGrabber();

        this.status = {
          ...this.status,
          available: true,
          running: true,
          error: null,
        };
        this.emitStatus();

        // Push an immediate frame so UI transitions out of loading state right away
        void this.captureScreenshotFrame(false)
          .then((frame) => {
            for (const fn of this.frameListeners) fn(frame);
          })
          .catch(() => {});

        // Install Chromium + icons asynchronously in background so desktop shows immediately
        void this.ensureChromiumInstalled();

        return this.status;
      } catch (err) {
        this.status = {
          ...this.status,
          running: false,
          error: (err as Error).message,
        };
        this.emitStatus();
        return this.status;
      } finally {
        this.startingPromise = null;
      }
    })();

    return this.startingPromise;
  }

  private startFfmpegGrabber(): void {
    if (this.ffmpegProc) {
      this.ffmpegProc.kill('SIGTERM');
      this.ffmpegProc = null;
    }

    const ff = this.spawnSafe(
      'ffmpeg',
      [
        '-loglevel',
        'error',
        '-f',
        'x11grab',
        '-draw_mouse',
        '1',
        '-framerate',
        '6',
        '-video_size',
        `${SCREEN_W}x${SCREEN_H}`,
        '-i',
        DISPLAY,
        '-q:v',
        '8',
        '-f',
        'image2pipe',
        '-vcodec',
        'mjpeg',
        'pipe:1',
      ],
      { env: this.env(), stdio: ['ignore', 'pipe', 'pipe'] },
    );
    this.ffmpegProc = ff;

    let buffer = Buffer.alloc(0);

    ff.stdout?.on('data', (chunk: Buffer) => {
      buffer = Buffer.concat([buffer, chunk]);
      // Extract complete JPEG frames bounded by FFD8 .. FFD9
      while (true) {
        const start = buffer.indexOf(JPEG_SOI);
        if (start === -1) {
          buffer = Buffer.alloc(0);
          break;
        }
        const end = buffer.indexOf(JPEG_EOI, start + 2);
        if (end === -1) {
          if (start > 0) buffer = buffer.subarray(start);
          break;
        }
        const jpeg = buffer.subarray(start, end + 2);
        buffer = buffer.subarray(end + 2);

        const now = Date.now();
        this.frameTimes = [...this.frameTimes.filter((t) => now - t < 2000), now];
        const fps = Math.round((this.frameTimes.length / 2) * 10) / 10;

        this.emitFrame(jpeg, false);
        if (Math.abs(this.status.fps - fps) >= 0.5) {
          this.status = { ...this.status, fps };
          this.emitStatus();
        }
      }
    });

    ff.on('exit', () => {
      if (this.status.running && this.ffmpegProc === ff) {
        this.ffmpegProc = null;
        setTimeout(() => {
          if (this.status.running) this.startFfmpegGrabber();
        }, 1000);
      }
    });
  }

  async moveMouse(x: number, y: number): Promise<string> {
    await this.ensureStarted();
    const cx = Math.max(0, Math.min(SCREEN_W - 1, Math.round(x)));
    const cy = Math.max(0, Math.min(SCREEN_H - 1, Math.round(y)));
    await execFileAsync('xdotool', ['mousemove', '--sync', String(cx), String(cy)], { env: this.env() });
    await this.pushLiveFrame(40);
    return `Moved X11 cursor to (${cx}, ${cy})`;
  }

  async click(
    x: number,
    y: number,
    button: 'left' | 'right' | 'middle' | 'double' = 'left',
  ): Promise<string> {
    await this.ensureStarted();
    const cx = Math.max(0, Math.min(SCREEN_W - 1, Math.round(x)));
    const cy = Math.max(0, Math.min(SCREEN_H - 1, Math.round(y)));
    await execFileAsync('xdotool', ['mousemove', String(cx), String(cy)], { env: this.env() });
    await new Promise((r) => setTimeout(r, 40));
    const clickArgs =
      button === 'right'
        ? ['click', '3']
        : button === 'middle'
          ? ['click', '2']
          : button === 'double'
            ? ['click', '--repeat', '2', '--delay', '80', '1']
            : ['click', '1'];
    await execFileAsync('xdotool', clickArgs, { env: this.env() });
    void this.pushLiveFrame(80);
    return `${button} click on X11 at (${cx}, ${cy})`;
  }

  async dragMouse(
    startX: number,
    startY: number,
    endX: number,
    endY: number,
    button: 'left' | 'right' | 'middle' = 'left',
  ): Promise<string> {
    await this.ensureStarted();
    const x1 = Math.max(0, Math.min(SCREEN_W - 1, Math.round(startX)));
    const y1 = Math.max(0, Math.min(SCREEN_H - 1, Math.round(startY)));
    const x2 = Math.max(0, Math.min(SCREEN_W - 1, Math.round(endX)));
    const y2 = Math.max(0, Math.min(SCREEN_H - 1, Math.round(endY)));
    const btn = button === 'right' ? '3' : button === 'middle' ? '2' : '1';
    await execFileAsync(
      'xdotool',
      ['mousemove', '--sync', String(x1), String(y1), 'mousedown', btn, 'mousemove', '--sync', String(x2), String(y2), 'mouseup', btn],
      { env: this.env() },
    );
    await this.pushLiveFrame(60);
    return `Dragged ${button} mouse from (${x1}, ${y1}) to (${x2}, ${y2})`;
  }

  async scroll(x: number, y: number, deltaY: number): Promise<void> {
    await this.ensureStarted();
    const cx = Math.max(0, Math.min(SCREEN_W - 1, Math.round(x)));
    const cy = Math.max(0, Math.min(SCREEN_H - 1, Math.round(y)));
    const btn = deltaY > 0 ? '5' : '4';
    await execFileAsync('xdotool', ['mousemove', String(cx), String(cy), 'click', btn], {
      env: this.env(),
    });
    void this.pushLiveFrame(60);
  }

  async scrollDirection(
    x: number,
    y: number,
    direction: 'up' | 'down' | 'left' | 'right' = 'down',
    clicks = 3,
  ): Promise<string> {
    await this.ensureStarted();
    const cx = Math.max(0, Math.min(SCREEN_W - 1, Math.round(x)));
    const cy = Math.max(0, Math.min(SCREEN_H - 1, Math.round(y)));
    const repeat = Math.max(1, Math.min(25, Math.round(clicks)));
    const btnMap: Record<string, string> = { up: '4', down: '5', left: '6', right: '7' };
    const btn = btnMap[direction] || '5';
    await execFileAsync(
      'xdotool',
      ['mousemove', '--sync', String(cx), String(cy), 'click', '--repeat', String(repeat), btn],
      { env: this.env() },
    );
    await this.pushLiveFrame(80);
    return `Scrolled ${direction} (${repeat} clicks) at (${cx}, ${cy})`;
  }

  async typeText(text: string, enter = false): Promise<string> {
    await this.ensureStarted();
    const lines = text.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].length > 0) {
        await execFileAsync('xdotool', ['type', '--delay', '10', '--', lines[i]], {
          env: this.env(),
        });
      }
      if (i < lines.length - 1 || enter) {
        await execFileAsync('xdotool', ['key', 'Return'], { env: this.env() });
      }
    }
    await this.pushLiveFrame(80);
    return `Typed ${text.length} chars into active Linux window`;
  }

  async pressKey(key: string): Promise<string> {
    await this.ensureStarted();
    const keyMap: Record<string, string> = {
      enter: 'Return',
      return: 'Return',
      tab: 'Tab',
      escape: 'Escape',
      esc: 'Escape',
      backspace: 'BackSpace',
      delete: 'Delete',
      del: 'Delete',
      space: 'space',
      win: 'Super_L',
      super: 'Super_L',
      up: 'Up',
      down: 'Down',
      left: 'Left',
      right: 'Right',
      home: 'Home',
      end: 'End',
      pageup: 'Prior',
      pagedown: 'Next',
      'alt+f4': 'alt+F4',
      'alt+tab': 'alt+Tab',
    };
    const raw = key.trim();
    const lower = raw.toLowerCase();
    let mapped = keyMap[lower];
    if (!mapped) {
      // Normalize combos like Ctrl+Shift+T, Ctrl+S, Alt+Left
      const parts = raw.split('+').map((p) => p.trim());
      if (parts.length > 1) {
        mapped = parts
          .map((p, idx) => {
            const pl = p.toLowerCase();
            if (idx < parts.length - 1) {
              if (pl === 'control' || pl === 'ctrl') return 'ctrl';
              if (pl === 'shift') return 'shift';
              if (pl === 'alt') return 'alt';
              if (pl === 'win' || pl === 'super' || pl === 'meta') return 'super';
              return pl;
            }
            return keyMap[pl] || (p.length === 1 ? p.toLowerCase() : p);
          })
          .join('+');
      } else {
        mapped = /^f\d{1,2}$/i.test(raw) ? raw.toUpperCase() : raw;
      }
    }
    await execFileAsync('xdotool', ['key', mapped], { env: this.env() });
    await this.pushLiveFrame(80);
    return `Pressed X11 key ${mapped}`;
  }

  async openApp(
    app: AppId | string,
    payload?: { filePath?: string; url?: string; command?: string },
  ): Promise<string> {
    await this.ensureStarted();
    const env = this.env();
    const norm = String(app).trim().toLowerCase();
    const prevIds = new Set((await this.listWindows()).map((w) => w.windowId));

    if (payload?.command) {
      this.spawnSafe('bash', ['-lc', payload.command], { env, stdio: 'ignore', detached: true }).unref();
      await this.waitForWindowChange(prevIds, 1000);
      await this.pushLiveFrame(40);
      return `Launched Linux command: ${payload.command}`;
    }

    let message = '';
    switch (norm) {
      case 'edge':
      case 'chromium':
      case 'chrome':
      case 'browser': {
        const url = payload?.url || 'https://modelcontextprotocol.io';
        let chromeBin = await this.findChromiumBinary();
        if (!chromeBin) {
          await this.ensureChromiumInstalled();
          chromeBin = await this.findChromiumBinary();
        }
        if (!chromeBin) {
          throw new Error('Chromium binary is not available on this Linux container.');
        }
        this.spawnSafe(
          chromeBin,
          ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--window-size=1080,630', url],
          { env, stdio: 'ignore', detached: true },
        ).unref();
        message = `Launched Chromium (${url})`;
        break;
      }
      case 'powershell':
      case 'terminal':
      case 'bash':
      case 'xfce4-terminal':
        this.spawnSafe('xfce4-terminal', ['--geometry=88x24+120+80'], {
          env,
          stdio: 'ignore',
          detached: true,
        }).unref();
        message = 'Launched XFCE4 Terminal';
        break;
      case 'explorer':
      case 'files':
      case 'pcmanfm': {
        const dir = payload?.filePath ? this.resolveLinuxPath(payload.filePath) : '/root';
        this.spawnSafe('pcmanfm', [dir], { env, stdio: 'ignore', detached: true }).unref();
        message = `Launched PCManFM (${dir})`;
        break;
      }
      case 'notepad':
      case 'mousepad':
      case 'editor': {
        const target = payload?.filePath
          ? this.resolveLinuxPath(payload.filePath)
          : '/root/Desktop/README_Claude.txt';
        this.spawnSafe('mousepad', [target], { env, stdio: 'ignore', detached: true }).unref();
        message = `Launched Mousepad (${target})`;
        break;
      }
      case 'calculator':
      case 'galculator':
        this.spawnSafe('galculator', [], { env, stdio: 'ignore', detached: true }).unref();
        message = 'Launched Galculator';
        break;
      case 'taskmgr':
        this.spawnSafe('xfce4-terminal', ['--geometry=92x26+100+70', '-e', 'top'], {
          env,
          stdio: 'ignore',
          detached: true,
        }).unref();
        message = 'Launched System Monitor (top)';
        break;
      case 'settings':
        this.spawnSafe('pcmanfm', ['/root/.config'], { env, stdio: 'ignore', detached: true }).unref();
        message = 'Launched Config Directory (/root/.config)';
        break;
      default:
        this.spawnSafe('bash', ['-lc', norm], { env, stdio: 'ignore', detached: true }).unref();
        message = `Launched ${norm}`;
        break;
    }

    await this.waitForWindowChange(prevIds, 1400);
    await this.pushLiveFrame(40);
    return message;
  }

  resolveLinuxPath(inputPath?: string): string {
    const raw = (inputPath || '/root').trim();
    if (/^[a-zA-Z]:\\/.test(raw)) {
      const rel = raw
        .slice(3)
        .replace(/\\/g, '/')
        .replace(/^Users\/Claude\//i, '');
      return path.resolve('/root', rel);
    }
    return raw.startsWith('/') ? raw : path.resolve('/root', raw);
  }

  async runBash(
    command: string,
    opts?: { cwd?: string; timeoutMs?: number; background?: boolean },
  ): Promise<{ cwd: string; stdout: string; stderr: string; exitCode: number; pid?: number }> {
    await this.ensureStarted();
    const cwd = opts?.cwd ? this.resolveLinuxPath(opts.cwd) : '/root';
    if (opts?.background) {
      const child = spawn('bash', ['-lc', command], {
        cwd,
        env: this.env(),
        stdio: 'ignore',
        detached: true,
      });
      child.unref();
      return {
        cwd,
        stdout: `Started background process (pid ${child.pid ?? 'unknown'})`,
        stderr: '',
        exitCode: 0,
        pid: child.pid,
      };
    }

    const timeout = Math.max(1000, Math.min(120000, Number(opts?.timeoutMs || 30000)));
    try {
      const { stdout, stderr } = await execAsync(command, {
        cwd,
        timeout,
        maxBuffer: 2 * 1024 * 1024,
        env: this.env(),
      });
      return { cwd, stdout, stderr, exitCode: 0 };
    } catch (err) {
      const e = err as { stdout?: string; stderr?: string; message?: string; code?: number };
      return {
        cwd,
        stdout: e.stdout || '',
        stderr: e.stderr || e.message || 'Command failed',
        exitCode: typeof e.code === 'number' ? e.code : 1,
      };
    }
  }

  async listWindows(): Promise<
    Array<{
      windowId: string;
      title: string;
      pid: number;
      x: number;
      y: number;
      width: number;
      height: number;
      active: boolean;
    }>
  > {
    await this.ensureStarted();
    const env = this.env();
    try {
      const { stdout } = await execAsync(
        `DISPLAY=${DISPLAY} xprop -root _NET_CLIENT_LIST _NET_ACTIVE_WINDOW 2>/dev/null || true`,
        { env },
      );
      const activeMatch = stdout.match(/_NET_ACTIVE_WINDOW\(WINDOW\): window id # (0x[0-9a-fA-F]+)/);
      const activeDec = activeMatch ? String(parseInt(activeMatch[1], 16)) : '';
      const listMatch = stdout.match(/_NET_CLIENT_LIST\(WINDOW\): window id # ([^\n]+)/);
      const hexIds = listMatch
        ? listMatch[1]
            .split(',')
            .map((s) => s.trim())
            .filter((s) => /^0x[0-9a-fA-F]+$/.test(s) && s !== '0x0')
        : [];

      const windows: Array<{
        windowId: string;
        title: string;
        pid: number;
        x: number;
        y: number;
        width: number;
        height: number;
        active: boolean;
      }> = [];

      for (const hex of hexIds) {
        const decId = String(parseInt(hex, 16));
        try {
          const { stdout: titleOut } = await execFileAsync('xdotool', ['getwindowname', decId], {
            env,
          });
          const title = titleOut.trim();
          if (title === 'tint2' || title === 'pcmanfm') continue;

          const { stdout: pidOut } = await execFileAsync('xdotool', ['getwindowpid', decId], {
            env,
          }).catch(() => ({ stdout: '0' }));
          const { stdout: geomOut } = await execFileAsync(
            'xdotool',
            ['getwindowgeometry', '--shell', decId],
            { env },
          ).catch(() => ({ stdout: '' }));

          const x = Number(geomOut.match(/X=(-?\d+)/)?.[1] ?? 0);
          const y = Number(geomOut.match(/Y=(-?\d+)/)?.[1] ?? 0);
          const width = Number(geomOut.match(/WIDTH=(\d+)/)?.[1] ?? 0);
          const height = Number(geomOut.match(/HEIGHT=(\d+)/)?.[1] ?? 0);

          windows.push({
            windowId: decId,
            title,
            pid: Number(pidOut.trim()) || 0,
            x,
            y,
            width,
            height,
            active: decId === activeDec,
          });
        } catch {
          // ignore transient closed windows
        }
      }
      return windows;
    } catch {
      return [];
    }
  }

  async controlWindow(
    windowIdOrTitle: string,
    action: 'focus' | 'minimize' | 'maximize' | 'close' | 'move' | 'resize',
    opts?: { x?: number; y?: number; width?: number; height?: number },
  ): Promise<string> {
    await this.ensureStarted();
    const env = this.env();
    const windows = await this.listWindows();
    const query = windowIdOrTitle.trim();
    const target =
      windows.find((w) => w.windowId === query) ||
      windows.find((w) => w.title.toLowerCase().includes(query.toLowerCase())) ||
      (query === 'active' ? windows.find((w) => w.active) : undefined);

    if (!target) {
      throw new Error(`No matching X11 window found for "${windowIdOrTitle}"`);
    }

    const id = target.windowId;
    let message = '';
    switch (action) {
      case 'focus':
        await execFileAsync('xdotool', ['windowactivate', '--sync', id], { env });
        message = `Focused "${target.title}" (${id})`;
        break;
      case 'minimize':
        await execFileAsync('xdotool', ['windowminimize', id], { env });
        message = `Minimized "${target.title}" (${id})`;
        break;
      case 'maximize':
        await execFileAsync(
          'xdotool',
          ['windowactivate', id, 'windowmove', id, '0', '0', 'windowsize', id, '1280', '682'],
          { env },
        );
        message = `Maximized "${target.title}" (${id}) to 1280x682`;
        break;
      case 'move': {
        const x = Math.max(0, Math.min(SCREEN_W - 40, Math.round(opts?.x ?? target.x)));
        const y = Math.max(0, Math.min(SCREEN_H - 40, Math.round(opts?.y ?? target.y)));
        await execFileAsync('xdotool', ['windowmove', id, String(x), String(y)], { env });
        message = `Moved "${target.title}" (${id}) to (${x}, ${y})`;
        break;
      }
      case 'resize': {
        const w = Math.max(120, Math.min(SCREEN_W, Math.round(opts?.width ?? target.width)));
        const h = Math.max(100, Math.min(SCREEN_H, Math.round(opts?.height ?? target.height)));
        await execFileAsync('xdotool', ['windowsize', id, String(w), String(h)], { env });
        message = `Resized "${target.title}" (${id}) to ${w}x${h}`;
        break;
      }
      case 'close':
        await execFileAsync('xdotool', ['windowclose', id], { env }).catch(() =>
          execFileAsync('xdotool', ['windowkill', id], { env }),
        );
        message = `Closed "${target.title}" (${id})`;
        break;
    }

    await this.pushLiveFrame(160);
    return message;
  }

  async getSnapshotMeta() {
    let activeWindow = '';
    let cursor = { x: 0, y: 0 };
    try {
      const { stdout: winTitle } = await execAsync(
        `DISPLAY=${DISPLAY} xdotool getactivewindow getwindowname 2>/dev/null || true`,
      );
      activeWindow = winTitle.trim();
      const { stdout: pos } = await execAsync(`DISPLAY=${DISPLAY} xdotool getmouselocation --shell`);
      const xMatch = pos.match(/X=(\d+)/);
      const yMatch = pos.match(/Y=(\d+)/);
      if (xMatch && yMatch) {
        cursor = { x: Number(xMatch[1]), y: Number(yMatch[1]) };
      }
    } catch {
      // ignore
    }
    const windows = await this.listWindows();
    return {
      os: 'Debian GNU/Linux 12 (bookworm)',
      display: DISPLAY,
      screen: { width: SCREEN_W, height: SCREEN_H },
      activeWindow,
      cursor,
      windows,
    };
  }

  async captureScreenshotFrame(fresh = false): Promise<RealAgentFrame> {
    await this.ensureStarted();
    if (!fresh && this.latestFrame?.data && Date.now() - this.latestFrame.timestamp < 500) {
      return this.latestFrame;
    }
    if (fresh) {
      await new Promise((r) => setTimeout(r, 140));
    }
    try {
      const tmpSnap = '/tmp/claude_x11_snap.jpg';
      await execFileAsync('scrot', ['-o', '-q', '80', tmpSnap], { env: this.env() });
      const buf = fs.readFileSync(tmpSnap);
      return this.emitFrame(buf, true);
    } catch {
      if (this.latestFrame?.data) {
        return this.latestFrame;
      }
      const tmpSnap = '/tmp/claude_x11_snap.png';
      await execFileAsync('scrot', ['-o', tmpSnap], { env: this.env() });
      const pngBase64 = fs.readFileSync(tmpSnap).toString('base64');
      return {
        mimeType: 'image/png',
        width: SCREEN_W,
        height: SCREEN_H,
        data: pngBase64,
        cursorX: 0,
        cursorY: 0,
        timestamp: Date.now(),
      };
    }
  }

  async restart(): Promise<LinuxDesktopStatus> {
    this.shutdown();
    await new Promise((r) => setTimeout(r, 250));
    return this.ensureStarted();
  }

  shutdown(): void {
    this.status = { ...this.status, running: false, fps: 0 };
    this.ffmpegProc?.kill('SIGTERM');
    this.pcmanfmProc?.kill('SIGTERM');
    this.tint2Proc?.kill('SIGTERM');
    this.openboxProc?.kill('SIGTERM');
    this.xvfbProc?.kill('SIGTERM');
    this.ffmpegProc = null;
    this.pcmanfmProc = null;
    this.tint2Proc = null;
    this.openboxProc = null;
    this.xvfbProc = null;
    this.emitStatus();
  }
}

export const realLinuxDesktop = new RealLinuxDesktopManager();
