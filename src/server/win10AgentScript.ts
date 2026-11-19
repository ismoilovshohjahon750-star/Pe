export function buildWindows10AgentPs1(wsUrl: string, token?: string | null): string {
  const finalWsUrl = token ? `${wsUrl}?token=${encodeURIComponent(token)}` : wsUrl;
  return `# ClaudeWin 10 Pro — Real Windows 10 Pro Live MCP Agent
# Run this script in PowerShell on any real Windows 10 Pro PC or VM.
# Zero external dependencies required (uses built-in .NET + Win32 user32.dll).

$ErrorActionPreference = "Stop"
$WsUri = "${finalWsUrl}"

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

Add-Type @"
using System;
using System.Runtime.InteropServices;

public class Win32Input {
    [DllImport("user32.dll")]
    public static extern bool SetCursorPos(int X, int Y);

    [DllImport("user32.dll")]
    public static extern void mouse_event(uint dwFlags, uint dx, uint dy, uint dwData, UIntPtr dwExtraInfo);

    public const uint MOUSEEVENTF_LEFTDOWN = 0x0002;
    public const uint MOUSEEVENTF_LEFTUP = 0x0004;
    public const uint MOUSEEVENTF_RIGHTDOWN = 0x0008;
    public const uint MOUSEEVENTF_RIGHTUP = 0x0010;
}
"@

function Get-ScreenFrameJson {
    $bounds = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
    $bmp = New-Object System.Drawing.Bitmap($bounds.Width, $bounds.Height)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.CopyFromScreen($bounds.Location, [System.Drawing.Point]::Empty, $bounds.Size)
    $g.Dispose()

    $ms = New-Object System.IO.MemoryStream
    $jpegCodec = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object { $_.MimeType -eq 'image/jpeg' }
    $encParams = New-Object System.Drawing.Imaging.EncoderParameters(1)
    $encParams.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter([System.Drawing.Imaging.Encoder]::Quality, 55L)
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
        timestamp = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
    } | ConvertTo-Json -Compress
}

function Invoke-AgentTool($msg) {
    $tool = $msg.tool
    $a = $msg.args
    switch ($tool) {
        "desktop_screenshot" {
            $bounds = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
            return @{ width = $bounds.Width; height = $bounds.Height; note = "Captured live real Windows 10 Pro frame" }
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
        "desktop_type" {
            $txt = [string]$a.text
            $escaped = $txt -replace '([+^%~(){}\\[\\]])', '{$1}'
            [System.Windows.Forms.SendKeys]::SendWait($escaped)
            if ($a.enter) { [System.Windows.Forms.SendKeys]::SendWait("{ENTER}") }
            return "Typed $($txt.Length) chars"
        }
        "desktop_key" {
            $k = [string]$a.key
            $map = @{ "Enter" = "{ENTER}"; "Tab" = "{TAB}"; "Escape" = "{ESC}"; "Backspace" = "{BACKSPACE}"; "Ctrl+S" = "^s"; "Alt+F4" = "%{F4}"; "Win" = "^{ESC}" }
            $send = if ($map.ContainsKey($k)) { $map[$k] } else { $k }
            [System.Windows.Forms.SendKeys]::SendWait($send)
            return "Sent key $k"
        }
        "run_powershell" {
            $out = Invoke-Expression ([string]$a.command) | Out-String
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
            $rawMsg = [System.Text.Encoding]::UTF8.GetString($recvBuf, 0, $res.Count)
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
