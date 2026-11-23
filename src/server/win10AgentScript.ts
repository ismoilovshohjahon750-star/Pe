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

    [DllImport("user32.dll")]
    public static extern bool LockWorkStation();

    public const uint MOUSEEVENTF_LEFTDOWN = 0x0002;
    public const uint MOUSEEVENTF_LEFTUP = 0x0004;
    public const uint MOUSEEVENTF_RIGHTDOWN = 0x0008;
    public const uint MOUSEEVENTF_RIGHTUP = 0x0010;
    public const uint MOUSEEVENTF_WHEEL = 0x0800;
}
"@
}

function Get-ScreenFrameJson {
    $bounds = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
    $bmp = New-Object System.Drawing.Bitmap($bounds.Width, $bounds.Height)
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
    $pos = [System.Windows.Forms.Cursor]::Position

    return @{
        type = "agent:frame"
        mimeType = "image/jpeg"
        width = $bounds.Width
        height = $bounds.Height
        data = $b64
        cursorX = $pos.X
        cursorY = $pos.Y
        timestamp = [long]([DateTime]::UtcNow - [datetime]'1970-01-01').TotalMilliseconds
    } | ConvertTo-Json -Compress
}

function Invoke-AgentTool($msg) {
    $tool = $msg.tool
    $a = $msg.args
    switch ($tool) {
        "desktop_screenshot" {
            $bounds = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
            return @{ width = $bounds.Width; height = $bounds.Height; note = "Captured live real Windows PC frame" }
        }
        "desktop_move" {
            [Win32Input]::SetCursorPos([int]$a.x, [int]$a.y) | Out-Null
            return "Moved real cursor to ($($a.x), $($a.y))"
        }
        "desktop_click" {
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
            $escaped = $txt -replace '([+^%~(){}\\[\\]])', '{$1}'
            [System.Windows.Forms.SendKeys]::SendWait($escaped)
            if ($a.enter) { [System.Windows.Forms.SendKeys]::SendWait("{ENTER}") }
            return "Typed $($txt.Length) chars"
        }
        "desktop_key" {
            $k = [string]$a.key
            if ($k -ieq "Win+L") {
                [Win32Input]::LockWorkStation() | Out-Null
                return "Locked workstation (Win+L)"
            }
            $map = @{ "Enter" = "{ENTER}"; "Return" = "{ENTER}"; "Space" = " "; "Tab" = "{TAB}"; "Escape" = "{ESC}"; "Backspace" = "{BACKSPACE}"; "Ctrl+S" = "^s"; "Ctrl+C" = "^c"; "Ctrl+V" = "^v"; "Alt+F4" = "%{F4}"; "Win" = "^{ESC}" }
            $send = if ($map.ContainsKey($k)) { $map[$k] } else { $k }
            [System.Windows.Forms.SendKeys]::SendWait($send)
            return "Sent key $k"
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
