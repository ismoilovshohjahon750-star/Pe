export function buildWindows10AgentPs1(wsUrl: string, token?: string | null): string {
  const finalWsUrl = token ? `${wsUrl}?token=${encodeURIComponent(token)}` : wsUrl;
  return `# ClaudeWin 10 Pro — Real Windows 10 Pro Live MCP Agent
# Run this script in PowerShell on any real Windows 10 Pro PC or VM.
# Zero external dependencies required (uses built-in .NET + Win32 user32.dll).

$ErrorActionPreference = "Stop"
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$WsUri = "${finalWsUrl}"

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

if (-not ([System.Management.Automation.PSTypeName]'Win32Input').Type) {
Add-Type @"
using System;
using System.Runtime.InteropServices;

public class Win32Input {
    [DllImport("user32.dll")]
    public static extern bool SetCursorPos(int X, int Y);

    [DllImport("user32.dll")]
    public static extern void mouse_event(uint dwFlags, uint dx, uint dy, uint dwData, UIntPtr dwExtraInfo);

    [DllImport("user32.dll", SetLastError = true)]
    public static extern IntPtr OpenInputDesktop(uint dwFlags, bool fInherit, uint dwDesiredAccess);

    [DllImport("user32.dll", SetLastError = true)]
    public static extern bool CloseDesktop(IntPtr hDesktop);

    [DllImport("user32.dll", SetLastError = true)]
    public static extern bool LockWorkStation();

    [DllImport("user32.dll")]
    public static extern short VkKeyScan(char ch);

    [DllImport("user32.dll")]
    public static extern uint MapVirtualKey(uint uCode, uint uMapType);

    [DllImport("user32.dll", SetLastError = true)]
    public static extern uint SendInput(uint nInputs, INPUT[] pInputs, int cbSize);

    [StructLayout(LayoutKind.Sequential)]
    public struct MOUSEINPUT {
        public int dx; public int dy; public uint mouseData; public uint dwFlags; public uint time; public IntPtr dwExtraInfo;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct KEYBDINPUT {
        public ushort wVk; public ushort wScan; public uint dwFlags; public uint time; public IntPtr dwExtraInfo;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct HARDWAREINPUT {
        public uint uMsg; public ushort wParamL; public ushort wParamH;
    }

    [StructLayout(LayoutKind.Explicit)]
    public struct InputUnion {
        [FieldOffset(0)] public MOUSEINPUT mi;
        [FieldOffset(0)] public KEYBDINPUT ki;
        [FieldOffset(0)] public HARDWAREINPUT hi;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct INPUT {
        public uint type;
        public InputUnion U;
    }

    public const uint MOUSEEVENTF_LEFTDOWN = 0x0002;
    public const uint MOUSEEVENTF_LEFTUP = 0x0004;
    public const uint MOUSEEVENTF_RIGHTDOWN = 0x0008;
    public const uint MOUSEEVENTF_RIGHTUP = 0x0010;
    public const uint MOUSEEVENTF_WHEEL = 0x0800;

    public const uint INPUT_KEYBOARD = 1;
    public const uint KEYEVENTF_EXTENDEDKEY = 0x0001;
    public const uint KEYEVENTF_KEYUP = 0x0002;
    public const uint KEYEVENTF_UNICODE = 0x0004;

    private static bool ResolveVk(string raw, out ushort vk, out bool ext) {
        vk = 0; ext = false;
        if (string.IsNullOrEmpty(raw)) return false;
        string t = raw.Trim().ToLowerInvariant();
        if (t == "win" || t == "lwin" || t == "super" || t == "super_l" || t == "meta" || t == "windows") { vk = 0x5B; ext = true; return true; }
        if (t == "rwin" || t == "super_r") { vk = 0x5C; ext = true; return true; }
        if (t == "ctrl" || t == "control" || t == "lctrl" || t == "rctrl") { vk = 0x11; return true; }
        if (t == "alt" || t == "menu" || t == "lalt" || t == "ralt") { vk = 0x12; return true; }
        if (t == "shift" || t == "lshift" || t == "rshift") { vk = 0x10; return true; }
        if (t == "enter" || t == "return") { vk = 0x0D; return true; }
        if (t == "tab") { vk = 0x09; return true; }
        if (t == "esc" || t == "escape") { vk = 0x1B; return true; }
        if (t == "space" || t == " ") { vk = 0x20; return true; }
        if (t == "backspace" || t == "back") { vk = 0x08; return true; }
        if (t == "delete" || t == "del") { vk = 0x2E; ext = true; return true; }
        if (t == "home") { vk = 0x24; ext = true; return true; }
        if (t == "end") { vk = 0x23; ext = true; return true; }
        if (t == "pageup" || t == "pgup") { vk = 0x21; ext = true; return true; }
        if (t == "pagedown" || t == "pgdn") { vk = 0x22; ext = true; return true; }
        if (t == "left" || t == "arrowleft") { vk = 0x25; ext = true; return true; }
        if (t == "up" || t == "arrowup") { vk = 0x26; ext = true; return true; }
        if (t == "right" || t == "arrowright") { vk = 0x27; ext = true; return true; }
        if (t == "down" || t == "arrowdown") { vk = 0x28; ext = true; return true; }
        if (t.StartsWith("f") && t.Length >= 2 && t.Length <= 3) {
            int fn; if (int.TryParse(t.Substring(1), out fn) && fn >= 1 && fn <= 24) { vk = (ushort)(0x70 + fn - 1); return true; }
        }
        if (t.Length == 1) {
            char c = t[0];
            if (c >= 'a' && c <= 'z') { vk = (ushort)('A' + (c - 'a')); return true; }
            if (c >= '0' && c <= '9') { vk = (ushort)c; return true; }
            short sc = VkKeyScan(raw.Trim()[0]);
            if (sc != -1) { vk = (ushort)(sc & 0xFF); return true; }
        }
        return false;
    }

    private static uint SendVk(ushort vk, bool up, bool ext) {
        INPUT[] inp = new INPUT[1];
        inp[0].type = INPUT_KEYBOARD;
        inp[0].U.ki.wVk = vk;
        inp[0].U.ki.wScan = (ushort)MapVirtualKey(vk, 0);
        inp[0].U.ki.dwFlags = (ext ? KEYEVENTF_EXTENDEDKEY : 0) | (up ? KEYEVENTF_KEYUP : 0);
        return SendInput(1, inp, Marshal.SizeOf(typeof(INPUT)));
    }

    public static string SendKeyOrCombo(string keySpec) {
        string[] parts = keySpec.Split(new char[] { '+' }, StringSplitOptions.RemoveEmptyEntries);
        if (parts.Length == 0) throw new InvalidOperationException("Empty keySpec");
        ushort[] vks = new ushort[parts.Length];
        bool[] exts = new bool[parts.Length];
        for (int i = 0; i < parts.Length; i++) {
            if (!ResolveVk(parts[i], out vks[i], out exts[i])) throw new InvalidOperationException("Unknown key: " + parts[i]);
        }
        if (vks.Length == 2 && (vks[0] == 0x5B || vks[0] == 0x5C) && vks[1] == 0x4C) {
            if (!LockWorkStation()) throw new InvalidOperationException("LockWorkStation failed");
            return "Locked workstation (Win+L)";
        }
        for (int i = 0; i < vks.Length; i++) {
            if (SendVk(vks[i], false, exts[i]) == 0) {
                for (int j = i - 1; j >= 0; j--) SendVk(vks[j], true, exts[j]);
                throw new InvalidOperationException("SendInput=0 for " + keySpec);
            }
            System.Threading.Thread.Sleep(25);
        }
        System.Threading.Thread.Sleep(35);
        for (int i = vks.Length - 1; i >= 0; i--) {
            SendVk(vks[i], true, exts[i]);
            System.Threading.Thread.Sleep(15);
        }
        return "Sent real Win32 key " + keySpec;
    }

    public static void TypeText(string txt, bool enter) {
        if (!string.IsNullOrEmpty(txt)) {
            for (int i = 0; i < txt.Length; i++) {
                INPUT[] inp = new INPUT[2];
                inp[0].type = INPUT_KEYBOARD; inp[0].U.ki.wScan = (ushort)txt[i]; inp[0].U.ki.dwFlags = KEYEVENTF_UNICODE;
                inp[1].type = INPUT_KEYBOARD; inp[1].U.ki.wScan = (ushort)txt[i]; inp[1].U.ki.dwFlags = KEYEVENTF_UNICODE | KEYEVENTF_KEYUP;
                if (SendInput(2, inp, Marshal.SizeOf(typeof(INPUT))) == 0) throw new InvalidOperationException("SendInput=0 while typing");
                System.Threading.Thread.Sleep(15);
            }
        }
        if (enter) SendKeyOrCombo("Enter");
    }
}
"@
}

function Test-WorkstationLocked {
    try {
        $h = [Win32Input]::OpenInputDesktop(0, $false, 0x0001)
        if ($h -eq [IntPtr]::Zero) { return $true }
        [Win32Input]::CloseDesktop($h) | Out-Null
        return $false
    } catch {
        return $false
    }
}

function Invoke-WinlogonPipe([hashtable]$payload) {
    try {
        $client = New-Object System.IO.Pipes.NamedPipeClientStream(".", "JarvisWinlogonPipe", [System.IO.Pipes.PipeDirection]::InOut)
        $client.Connect(1200)
        $json = ($payload | ConvertTo-Json -Compress) + [char]10
        $bytes = [System.Text.Encoding]::UTF8.GetBytes($json)
        $client.Write($bytes, 0, $bytes.Length)
        $client.Flush()
        $reader = New-Object System.IO.StreamReader($client, [System.Text.Encoding]::UTF8)
        $line = $reader.ReadLine()
        $client.Dispose()
        if ($line) { return ($line | ConvertFrom-Json) }
    } catch {}
    return $null
}

function Invoke-LockedPipeOrThrow([hashtable]$payload) {
    $resp = Invoke-WinlogonPipe $payload
    if ($null -eq $resp) {
        throw "Kompyuter Win+L bilan qulflangan. Kodni yozib ochish uchun JarvisPcAgent-Setup.bat ni bir marta Administrator sifatida ishga tushiring (JarvisUnlockService)."
    }
    if ($resp.ok) { return [string]$resp.data }
    throw ([string]$resp.error)
}

function Get-ScreenFrameJson {
    $lockedNow = Test-WorkstationLocked
    $lockServiceReady = $false
    $w = 960
    $h = 540
    $b64 = ""

    if (-not $lockedNow) {
        try {
            $bounds = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
            $w = $bounds.Width
            $h = $bounds.Height
            $bmp = New-Object System.Drawing.Bitmap($w, $h)
            $g = [System.Drawing.Graphics]::FromImage($bmp)
            $g.CopyFromScreen($bounds.Location, [System.Drawing.Point]::Empty, $bounds.Size)
            $g.Dispose()
            $ms = New-Object System.IO.MemoryStream
            $jpegCodec = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object { $_.MimeType -eq 'image/jpeg' }
            $encParams = New-Object System.Drawing.Imaging.EncoderParameters(1)
            $encParams.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter([System.Drawing.Imaging.Encoder]::Quality, [int64]55)
            $bmp.Save($ms, $jpegCodec, $encParams)
            $bmp.Dispose()
            $b64 = [Convert]::ToBase64String($ms.ToArray())
            $ms.Dispose()
        } catch {
            $lockedNow = $true
        }
    }

    if ($lockedNow) {
        $pipeResp = Invoke-WinlogonPipe @{ cmd = "capture" }
        if ($pipeResp -and $pipeResp.ok -and $pipeResp.data) {
            $lockServiceReady = $true
            $w = [int]$pipeResp.width
            $h = [int]$pipeResp.height
            $b64 = [string]$pipeResp.data
        } else {
            $w = 960
            $h = 540
            $bmp = New-Object System.Drawing.Bitmap($w, $h)
            $g = [System.Drawing.Graphics]::FromImage($bmp)
            $g.Clear([System.Drawing.Color]::FromArgb(7, 11, 20))
            $font = New-Object System.Drawing.Font("Segoe UI", 16, [System.Drawing.FontStyle]::Bold)
            $brush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(56, 189, 248))
            $g.DrawString("PC QULFLANGAN (Win+L)", $font, $brush, 60, 200)
            $g.Dispose()
            $ms = New-Object System.IO.MemoryStream
            $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Jpeg)
            $bmp.Dispose()
            $b64 = [Convert]::ToBase64String($ms.ToArray())
            $ms.Dispose()
        }
    }

    $pos = [System.Windows.Forms.Cursor]::Position
    return @{
        type = "agent:frame"
        mimeType = "image/jpeg"
        width = $w
        height = $h
        data = $b64
        cursorX = $pos.X
        cursorY = $pos.Y
        locked = $lockedNow
        lockServiceReady = $lockServiceReady
        timestamp = [long]([DateTime]::UtcNow - [datetime]'1970-01-01').TotalMilliseconds
    } | ConvertTo-Json -Compress
}

function Invoke-AgentTool($msg) {
    $tool = $msg.tool
    $a = $msg.args
    switch ($tool) {
        "desktop_screenshot" {
            $bounds = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
            return @{ width = $bounds.Width; height = $bounds.Height; locked = (Test-WorkstationLocked); note = "Captured live real Windows PC frame" }
        }
        "unlock_pc" {
            if ($a.sas) { return (Invoke-LockedPipeOrThrow @{ cmd = "sas" }) }
            if (-not (Test-WorkstationLocked)) { return "Kompyuter allaqachon ochiq (qulflanmagan)." }
            $wake = if ($null -ne $a.wake) { [bool]$a.wake } else { $true }
            return (Invoke-LockedPipeOrThrow @{ cmd = "unlock"; pin = [string]$a.pin; wake = $wake })
        }
        "desktop_move" {
            if (Test-WorkstationLocked) { return (Invoke-LockedPipeOrThrow @{ cmd = "move"; x = [int]$a.x; y = [int]$a.y }) }
            [Win32Input]::SetCursorPos([int]$a.x, [int]$a.y) | Out-Null
            return "Moved real cursor to ($($a.x), $($a.y))"
        }
        "desktop_click" {
            if (Test-WorkstationLocked) { return (Invoke-LockedPipeOrThrow @{ cmd = "click"; x = [int]$a.x; y = [int]$a.y; button = [string]$a.button }) }
            [Win32Input]::SetCursorPos([int]$a.x, [int]$a.y) | Out-Null
            Start-Sleep -Milliseconds 40
            if ($a.button -eq "right") {
                [Win32Input]::mouse_event([Win32Input]::MOUSEEVENTF_RIGHTDOWN, 0, 0, 0, [UIntPtr]::Zero)
                [Win32Input]::mouse_event([Win32Input]::MOUSEEVENTF_RIGHTUP, 0, 0, 0, [UIntPtr]::Zero)
            } elseif ($a.button -eq "double") {
                [Win32Input]::mouse_event([Win32Input]::MOUSEEVENTF_LEFTDOWN, 0, 0, 0, [UIntPtr]::Zero)
                [Win32Input]::mouse_event([Win32Input]::MOUSEEVENTF_LEFTUP, 0, 0, 0, [UIntPtr]::Zero)
                Start-Sleep -Milliseconds 60
                [Win32Input]::mouse_event([Win32Input]::MOUSEEVENTF_LEFTDOWN, 0, 0, 0, [UIntPtr]::Zero)
                [Win32Input]::mouse_event([Win32Input]::MOUSEEVENTF_LEFTUP, 0, 0, 0, [UIntPtr]::Zero)
            } else {
                [Win32Input]::mouse_event([Win32Input]::MOUSEEVENTF_LEFTDOWN, 0, 0, 0, [UIntPtr]::Zero)
                [Win32Input]::mouse_event([Win32Input]::MOUSEEVENTF_LEFTUP, 0, 0, 0, [UIntPtr]::Zero)
            }
            return "Clicked $($a.button) at ($($a.x), $($a.y))"
        }
        "desktop_scroll" {
            if (Test-WorkstationLocked) { return "Ignored scroll on lock screen" }
            $sx = if ($null -ne $a.x) { [int]$a.x } else { 640 }
            $sy = if ($null -ne $a.y) { [int]$a.y } else { 360 }
            [Win32Input]::SetCursorPos($sx, $sy) | Out-Null
            $clicks = if ($null -ne $a.clicks) { [int]$a.clicks } else { 3 }
            $delta = if ($a.direction -eq "up") { 120 * $clicks } else { -120 * $clicks }
            [Win32Input]::mouse_event([Win32Input]::MOUSEEVENTF_WHEEL, 0, 0, [uint32]([BitConverter]::ToUInt32([BitConverter]::GetBytes([int]$delta), 0)), [UIntPtr]::Zero)
            return "Scrolled $($a.direction) at ($sx, $sy)"
        }
        "desktop_type" {
            $txt = [string]$a.text
            if (Test-WorkstationLocked) { return (Invoke-LockedPipeOrThrow @{ cmd = "type"; text = $txt; enter = [bool]$a.enter }) }
            [Win32Input]::TypeText($txt, [bool]$a.enter)
            return "Typed $($txt.Length) chars"
        }
        "desktop_key" {
            $k = [string]$a.key
            if (Test-WorkstationLocked) { return (Invoke-LockedPipeOrThrow @{ cmd = "key"; key = $k }) }
            return [Win32Input]::SendKeyOrCombo($k)
        }
        "open_app" {
            $app = ([string]$a.app).ToLower()
            if ($a.command) {
                Start-Process powershell -ArgumentList "-NoExit", "-Command", ([string]$a.command)
                return "Started $($a.command)"
            }
            switch ($app) {
                { $_ -in @("edge", "chromium", "chrome", "browser") } {
                    $targetUrl = if ($a.url) { [string]$a.url } else { "https://modelcontextprotocol.io" }
                    Start-Process $targetUrl
                    return "Opened browser"
                }
                { $_ -in @("notepad", "mousepad", "editor") } { Start-Process notepad ([string]$a.filePath); return "Opened Notepad" }
                { $_ -in @("explorer", "files") } { Start-Process explorer ([string]$a.filePath); return "Opened Explorer" }
                { $_ -in @("calculator", "calc") } { Start-Process calc; return "Opened Calculator" }
                default { Start-Process powershell; return "Opened PowerShell" }
            }
        }
        "browser_navigate" {
            Start-Process ([string]$a.url)
            return "Navigated to $($a.url)"
        }
        "run_bash" {
            $out = (& cmd.exe /c ([string]$a.command) 2>&1) | Out-String
            return $out
        }
        "run_powershell" {
            $out = (& powershell.exe -NoProfile -NonInteractive -Command ([string]$a.command) 2>&1) | Out-String
            return $out
        }
        "file_list" {
            $p = if ($a.path) { [string]$a.path } else { "$env:USERPROFILE\\Desktop" }
            return (Get-ChildItem -Path $p | Select-Object Name, FullName, Length, PSIsContainer, LastWriteTime | ConvertTo-Json -Compress)
        }
        "file_read" {
            return (Get-Content -Path ([string]$a.path) -Raw)
        }
        "file_write" {
            $dir = Split-Path -Parent ([string]$a.path)
            if ($dir -and !(Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
            Set-Content -Path ([string]$a.path) -Value ([string]$a.content) -Encoding UTF8
            return "Wrote $([string]$a.path)"
        }
        "file_delete" {
            Remove-Item -Path ([string]$a.path) -Recurse -Force
            return "Deleted $([string]$a.path)"
        }
        default {
            throw "Unsupported tool on real Windows agent: $tool"
        }
    }
}

Write-Host "Connecting real Windows 10 Pro desktop to $WsUri ..."
$ws = New-Object System.Net.WebSockets.ClientWebSocket
$ws.Options.KeepAliveInterval = [TimeSpan]::FromSeconds(15)
$cts = New-Object System.Threading.CancellationTokenSource
$ws.ConnectAsync([Uri]$WsUri, $cts.Token).GetAwaiter().GetResult()

function Send-WsText([string]$text) {
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($text)
    $seg = New-Object System.ArraySegment[byte]($bytes, 0, $bytes.Length)
    $ws.SendAsync($seg, [System.Net.WebSockets.WebSocketMessageType]::Text, $true, $cts.Token).GetAwaiter().GetResult()
}

$bounds = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
$os = (Get-CimInstance Win32_OperatingSystem).Caption
$hello = @{
    type = "agent:hello"
    hostname = $env:COMPUTERNAME
    osVersion = $os
    username = $env:USERNAME
    screenWidth = $bounds.Width
    screenHeight = $bounds.Height
} | ConvertTo-Json -Compress
Send-WsText $hello
Write-Host "Connected! Streaming live screen & listening for Claude MCP commands..."

$recvBuf = New-Object byte[] 65536
$recvTask = $null

while ($ws.State -eq [System.Net.WebSockets.WebSocketState]::Open) {
    $frameJson = Get-ScreenFrameJson
    Send-WsText $frameJson

    if ($null -eq $recvTask) {
        $seg = New-Object System.ArraySegment[byte]($recvBuf, 0, $recvBuf.Length)
        $recvTask = $ws.ReceiveAsync($seg, $cts.Token)
    }

    if ($recvTask.IsCompleted) {
        $res = $recvTask.GetAwaiter().GetResult()
        $recvTask = $null
        if ($res.Count -gt 0) {
            $msgStream = New-Object System.IO.MemoryStream
            $msgStream.Write($recvBuf, 0, $res.Count)
            while (-not $res.EndOfMessage) {
                $segMore = New-Object System.ArraySegment[byte]($recvBuf, 0, $recvBuf.Length)
                $res = $ws.ReceiveAsync($segMore, $cts.Token).GetAwaiter().GetResult()
                if ($res.Count -gt 0) { $msgStream.Write($recvBuf, 0, $res.Count) }
            }
            $rawMsg = [System.Text.Encoding]::UTF8.GetString($msgStream.ToArray())
            $msgStream.Dispose()
            $cmdMsg = $rawMsg | ConvertFrom-Json
            if ($cmdMsg.type -eq "cmd:exec") {
                try {
                    $output = Invoke-AgentTool $cmdMsg
                    $reply = @{ type = "agent:result"; requestId = $cmdMsg.requestId; ok = $true; data = $output } | ConvertTo-Json -Compress
                    Send-WsText $reply
                } catch {
                    $reply = @{ type = "agent:result"; requestId = $cmdMsg.requestId; ok = $false; error = $_.Exception.Message } | ConvertTo-Json -Compress
                    Send-WsText $reply
                }
            }
        }
    }
    Start-Sleep -Milliseconds 350
}
`;
}
