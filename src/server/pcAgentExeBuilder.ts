export function buildCSharpPcAgentSource(wsUrl: string, token?: string | null): string {
  const finalWsUrl = token ? `${wsUrl}?token=${encodeURIComponent(token)}` : wsUrl;
  const escapedWsUrl = JSON.stringify(finalWsUrl);

  return `// ClaudeWin 10 Pro / J.A.R.V.I.S. — Native Windows Background PC Agent (.NET 4.5+)
// Compiled automatically to JarvisPcAgent.exe via built-in Windows csc.exe (C# 5 compatible)

using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Imaging;
using System.IO;
using System.Net;
using System.Net.WebSockets;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;
using System.Windows.Forms;

namespace JarvisPcAgent
{
    internal static class NativeWin32
    {
        [DllImport("user32.dll")]
        public static extern bool SetCursorPos(int X, int Y);

        [DllImport("user32.dll")]
        public static extern void mouse_event(uint dwFlags, uint dx, uint dy, uint dwData, UIntPtr dwExtraInfo);

        [DllImport("user32.dll")]
        public static extern bool SetProcessDPIAware();

        public const uint MOUSEEVENTF_LEFTDOWN = 0x0002;
        public const uint MOUSEEVENTF_LEFTUP = 0x0004;
        public const uint MOUSEEVENTF_RIGHTDOWN = 0x0008;
        public const uint MOUSEEVENTF_RIGHTUP = 0x0010;
        public const uint MOUSEEVENTF_WHEEL = 0x0800;
    }

    internal static class Program
    {
        private static readonly string WsUri = ${escapedWsUrl};
        private static readonly SemaphoreSlim SendLock = new SemaphoreSlim(1, 1);
        private static Mutex _singleInstanceMutex;

        [STAThread]
        private static void Main(string[] args)
        {
            bool createdNew;
            _singleInstanceMutex = new Mutex(true, "Local\\\\JarvisPcAgentSingleInstance", out createdNew);
            if (!createdNew)
            {
                return;
            }

            try
            {
                NativeWin32.SetProcessDPIAware();
            }
            catch
            {
            }

            ServicePointManager.SecurityProtocol = (SecurityProtocolType)3072;

            while (true)
            {
                try
                {
                    RunSessionLoop();
                }
                catch
                {
                }
                Thread.Sleep(3000);
            }
        }

        private static void RunSessionLoop()
        {
            using (ClientWebSocket ws = new ClientWebSocket())
            {
                ws.Options.KeepAliveInterval = TimeSpan.FromSeconds(15);
                CancellationTokenSource cts = new CancellationTokenSource();
                ws.ConnectAsync(new Uri(WsUri), cts.Token).GetAwaiter().GetResult();

                JavaScriptSerializer json = new JavaScriptSerializer();
                json.MaxJsonLength = 32 * 1024 * 1024;

                Rectangle bounds = GetScreenBoundsSafe();
                Dictionary<string, object> hello = new Dictionary<string, object>();
                hello["type"] = "agent:hello";
                hello["hostname"] = Environment.MachineName;
                hello["osVersion"] = Environment.OSVersion.VersionString;
                hello["username"] = Environment.UserName;
                hello["screenWidth"] = bounds.Width;
                hello["screenHeight"] = bounds.Height;
                SendText(ws, json.Serialize(hello), cts.Token);

                Thread frameThread = new Thread(delegate()
                {
                    while (!cts.IsCancellationRequested && ws.State == WebSocketState.Open)
                    {
                        try
                        {
                            string payload = BuildFrameJson(json);
                            SendText(ws, payload, cts.Token);
                        }
                        catch
                        {
                            break;
                        }
                        Thread.Sleep(350);
                    }
                });
                frameThread.IsBackground = true;
                frameThread.Start();

                byte[] buffer = new byte[65536];
                while (ws.State == WebSocketState.Open)
                {
                    using (MemoryStream ms = new MemoryStream())
                    {
                        WebSocketReceiveResult res;
                        do
                        {
                            ArraySegment<byte> seg = new ArraySegment<byte>(buffer);
                            res = ws.ReceiveAsync(seg, cts.Token).GetAwaiter().GetResult();
                            if (res.MessageType == WebSocketMessageType.Close)
                            {
                                cts.Cancel();
                                return;
                            }
                            if (res.Count > 0)
                            {
                                ms.Write(buffer, 0, res.Count);
                            }
                        }
                        while (!res.EndOfMessage);

                        string rawMsg = Encoding.UTF8.GetString(ms.ToArray());
                        HandleIncomingMessage(ws, json, rawMsg, cts.Token);
                    }
                }

                cts.Cancel();
            }
        }

        private static void HandleIncomingMessage(ClientWebSocket ws, JavaScriptSerializer json, string rawMsg, CancellationToken token)
        {
            Dictionary<string, object> msg = json.Deserialize<Dictionary<string, object>>(rawMsg);
            if (msg == null) return;
            object typeObj;
            if (!msg.TryGetValue("type", out typeObj) || Convert.ToString(typeObj) != "cmd:exec") return;

            string reqId = msg.ContainsKey("requestId") ? Convert.ToString(msg["requestId"]) : "";
            string tool = msg.ContainsKey("tool") ? Convert.ToString(msg["tool"]) : "";
            Dictionary<string, object> args = new Dictionary<string, object>();
            if (msg.ContainsKey("args") && msg["args"] is Dictionary<string, object>)
            {
                args = (Dictionary<string, object>)msg["args"];
            }

            ThreadPool.QueueUserWorkItem(delegate
            {
                Dictionary<string, object> reply = new Dictionary<string, object>();
                reply["type"] = "agent:result";
                reply["requestId"] = reqId;
                try
                {
                    object result = ExecuteTool(tool, args, json);
                    reply["ok"] = true;
                    reply["data"] = result;
                }
                catch (Exception ex)
                {
                    reply["ok"] = false;
                    reply["error"] = ex.Message;
                }

                try
                {
                    SendText(ws, json.Serialize(reply), token);
                }
                catch
                {
                }
            });
        }

        private static void SendText(ClientWebSocket ws, string text, CancellationToken token)
        {
            byte[] bytes = Encoding.UTF8.GetBytes(text);
            ArraySegment<byte> seg = new ArraySegment<byte>(bytes);
            SendLock.Wait(token);
            try
            {
                if (ws.State == WebSocketState.Open)
                {
                    ws.SendAsync(seg, WebSocketMessageType.Text, true, token).GetAwaiter().GetResult();
                }
            }
            finally
            {
                SendLock.Release();
            }
        }

        private static Rectangle GetScreenBoundsSafe()
        {
            try
            {
                return Screen.PrimaryScreen.Bounds;
            }
            catch
            {
                return new Rectangle(0, 0, 1280, 720);
            }
        }

        private static ImageCodecInfo GetJpegEncoder()
        {
            ImageCodecInfo[] codecs = ImageCodecInfo.GetImageEncoders();
            for (int i = 0; i < codecs.Length; i++)
            {
                if (codecs[i].MimeType == "image/jpeg") return codecs[i];
            }
            return null;
        }

        private static string BuildFrameJson(JavaScriptSerializer json)
        {
            Rectangle bounds = GetScreenBoundsSafe();
            int w = bounds.Width > 0 ? bounds.Width : 1280;
            int h = bounds.Height > 0 ? bounds.Height : 720;
            byte[] jpegBytes;

            try
            {
                using (Bitmap bmp = new Bitmap(w, h))
                using (Graphics g = Graphics.FromImage(bmp))
                {
                    g.CopyFromScreen(bounds.Location, Point.Empty, bounds.Size);
                    jpegBytes = EncodeJpeg(bmp, 55L);
                }
            }
            catch
            {
                w = 960;
                h = 540;
                using (Bitmap lockedBmp = new Bitmap(w, h))
                using (Graphics g = Graphics.FromImage(lockedBmp))
                using (SolidBrush bg = new SolidBrush(Color.FromArgb(7, 11, 20)))
                using (SolidBrush fg = new SolidBrush(Color.FromArgb(203, 213, 225)))
                using (SolidBrush accent = new SolidBrush(Color.FromArgb(56, 189, 248)))
                using (Font titleFont = new Font("Segoe UI", 20, FontStyle.Bold))
                using (Font subFont = new Font("Segoe UI", 12, FontStyle.Regular))
                {
                    g.FillRectangle(bg, 0, 0, w, h);
                    g.DrawString("PC QULFLANGAN (Win+L)", titleFont, accent, 60, 200);
                    g.DrawString("Fonda aloqa faol: run_powershell, run_bash va file_* buyruqlari ishlayapti.", subFont, fg, 60, 250);
                    g.DrawString("Jonli ekran va sichqoncha uchun kompyuter qulfini oching.", subFont, fg, 60, 285);
                    jpegBytes = EncodeJpeg(lockedBmp, 55L);
                }
            }

            Point cursor = Point.Empty;
            try
            {
                cursor = Cursor.Position;
            }
            catch
            {
            }

            long ts = (long)(DateTime.UtcNow - new DateTime(1970, 1, 1)).TotalMilliseconds;
            Dictionary<string, object> frame = new Dictionary<string, object>();
            frame["type"] = "agent:frame";
            frame["mimeType"] = "image/jpeg";
            frame["width"] = w;
            frame["height"] = h;
            frame["data"] = Convert.ToBase64String(jpegBytes);
            frame["cursorX"] = cursor.X;
            frame["cursorY"] = cursor.Y;
            frame["timestamp"] = ts;
            return json.Serialize(frame);
        }

        private static byte[] EncodeJpeg(Bitmap bmp, long quality)
        {
            using (MemoryStream ms = new MemoryStream())
            {
                ImageCodecInfo codec = GetJpegEncoder();
                if (codec != null)
                {
                    using (EncoderParameters encParams = new EncoderParameters(1))
                    {
                        encParams.Param[0] = new EncoderParameter(System.Drawing.Imaging.Encoder.Quality, quality);
                        bmp.Save(ms, codec, encParams);
                    }
                }
                else
                {
                    bmp.Save(ms, ImageFormat.Jpeg);
                }
                return ms.ToArray();
            }
        }

        private static int GetInt(Dictionary<string, object> args, string key, int fallback)
        {
            object val;
            if (args != null && args.TryGetValue(key, out val) && val != null)
            {
                int parsed;
                if (int.TryParse(Convert.ToString(val), out parsed)) return parsed;
            }
            return fallback;
        }

        private static string GetStr(Dictionary<string, object> args, string key, string fallback)
        {
            object val;
            if (args != null && args.TryGetValue(key, out val) && val != null)
            {
                return Convert.ToString(val);
            }
            return fallback;
        }

        private static bool GetBool(Dictionary<string, object> args, string key)
        {
            object val;
            if (args != null && args.TryGetValue(key, out val) && val != null)
            {
                bool parsed;
                if (bool.TryParse(Convert.ToString(val), out parsed)) return parsed;
            }
            return false;
        }

        private static string RunProcess(string exe, string arguments, string cwd)
        {
            ProcessStartInfo psi = new ProcessStartInfo();
            psi.FileName = exe;
            psi.Arguments = arguments;
            psi.UseShellExecute = false;
            psi.CreateNoWindow = true;
            psi.RedirectStandardOutput = true;
            psi.RedirectStandardError = true;
            if (!string.IsNullOrEmpty(cwd) && Directory.Exists(cwd))
            {
                psi.WorkingDirectory = cwd;
            }
            using (Process proc = Process.Start(psi))
            {
                string stdout = proc.StandardOutput.ReadToEnd();
                string stderr = proc.StandardError.ReadToEnd();
                proc.WaitForExit(30000);
                return stdout + stderr;
            }
        }

        private static string EscapeSendKeys(string text)
        {
            StringBuilder sb = new StringBuilder();
            for (int i = 0; i < text.Length; i++)
            {
                char ch = text[i];
                if (ch == '+' || ch == '^' || ch == '%' || ch == '~' || ch == '(' || ch == ')' || ch == '{' || ch == '}' || ch == '[' || ch == ']')
                {
                    sb.Append('{').Append(ch).Append('}');
                }
                else
                {
                    sb.Append(ch);
                }
            }
            return sb.ToString();
        }

        private static object ExecuteTool(string tool, Dictionary<string, object> args, JavaScriptSerializer json)
        {
            if (tool == "desktop_screenshot")
            {
                Rectangle bounds = GetScreenBoundsSafe();
                Dictionary<string, object> res = new Dictionary<string, object>();
                res["width"] = bounds.Width;
                res["height"] = bounds.Height;
                res["note"] = "Captured live real Windows PC frame (.exe)";
                return res;
            }

            if (tool == "desktop_move")
            {
                int x = GetInt(args, "x", 0);
                int y = GetInt(args, "y", 0);
                NativeWin32.SetCursorPos(x, y);
                return "Moved cursor to (" + x + ", " + y + ")";
            }

            if (tool == "desktop_click")
            {
                int x = GetInt(args, "x", 0);
                int y = GetInt(args, "y", 0);
                string btn = GetStr(args, "button", "left");
                NativeWin32.SetCursorPos(x, y);
                Thread.Sleep(40);
                if (btn == "right")
                {
                    NativeWin32.mouse_event(NativeWin32.MOUSEEVENTF_RIGHTDOWN, 0, 0, 0, UIntPtr.Zero);
                    NativeWin32.mouse_event(NativeWin32.MOUSEEVENTF_RIGHTUP, 0, 0, 0, UIntPtr.Zero);
                }
                else if (btn == "double")
                {
                    NativeWin32.mouse_event(NativeWin32.MOUSEEVENTF_LEFTDOWN, 0, 0, 0, UIntPtr.Zero);
                    NativeWin32.mouse_event(NativeWin32.MOUSEEVENTF_LEFTUP, 0, 0, 0, UIntPtr.Zero);
                    Thread.Sleep(60);
                    NativeWin32.mouse_event(NativeWin32.MOUSEEVENTF_LEFTDOWN, 0, 0, 0, UIntPtr.Zero);
                    NativeWin32.mouse_event(NativeWin32.MOUSEEVENTF_LEFTUP, 0, 0, 0, UIntPtr.Zero);
                }
                else
                {
                    NativeWin32.mouse_event(NativeWin32.MOUSEEVENTF_LEFTDOWN, 0, 0, 0, UIntPtr.Zero);
                    NativeWin32.mouse_event(NativeWin32.MOUSEEVENTF_LEFTUP, 0, 0, 0, UIntPtr.Zero);
                }
                return "Clicked " + btn + " at (" + x + ", " + y + ")";
            }

            if (tool == "desktop_scroll")
            {
                int x = GetInt(args, "x", 640);
                int y = GetInt(args, "y", 360);
                int clicks = GetInt(args, "clicks", 3);
                string dir = GetStr(args, "direction", "down");
                int delta = (dir == "up") ? (120 * clicks) : (-120 * clicks);
                NativeWin32.SetCursorPos(x, y);
                NativeWin32.mouse_event(NativeWin32.MOUSEEVENTF_WHEEL, 0, 0, unchecked((uint)delta), UIntPtr.Zero);
                return "Scrolled " + dir + " at (" + x + ", " + y + ")";
            }

            if (tool == "desktop_type")
            {
                string txt = GetStr(args, "text", "");
                SendKeys.SendWait(EscapeSendKeys(txt));
                if (GetBool(args, "enter"))
                {
                    SendKeys.SendWait("{ENTER}");
                }
                return "Typed " + txt.Length + " chars";
            }

            if (tool == "desktop_key")
            {
                string k = GetStr(args, "key", "Enter");
                string mapped = k;
                if (k == "Enter" || k == "Return") mapped = "{ENTER}";
                else if (k == "Tab") mapped = "{TAB}";
                else if (k == "Escape") mapped = "{ESC}";
                else if (k == "Backspace") mapped = "{BACKSPACE}";
                else if (k == "Ctrl+S") mapped = "^s";
                else if (k == "Ctrl+C") mapped = "^c";
                else if (k == "Ctrl+V") mapped = "^v";
                else if (k == "Alt+F4") mapped = "%{F4}";
                else if (k == "Win") mapped = "^{ESC}";
                SendKeys.SendWait(mapped);
                return "Sent key " + k;
            }

            if (tool == "browser_navigate")
            {
                string url = GetStr(args, "url", "https://modelcontextprotocol.io");
                Process.Start(url);
                return "Opened " + url;
            }

            if (tool == "open_app")
            {
                string cmd = GetStr(args, "command", "");
                if (!string.IsNullOrEmpty(cmd))
                {
                    Process.Start("powershell.exe", "-NoExit -Command " + cmd);
                    return "Started " + cmd;
                }
                string app = GetStr(args, "app", "").ToLowerInvariant();
                if (app == "edge" || app == "chromium" || app == "chrome" || app == "browser")
                {
                    string url = GetStr(args, "url", "https://modelcontextprotocol.io");
                    Process.Start(url);
                    return "Opened browser";
                }
                if (app == "notepad" || app == "mousepad" || app == "editor")
                {
                    string filePath = GetStr(args, "filePath", "");
                    if (!string.IsNullOrEmpty(filePath)) Process.Start("notepad.exe", filePath);
                    else Process.Start("notepad.exe");
                    return "Opened Notepad";
                }
                if (app == "explorer" || app == "files")
                {
                    string filePath = GetStr(args, "filePath", Environment.GetFolderPath(Environment.SpecialFolder.Desktop));
                    Process.Start("explorer.exe", filePath);
                    return "Opened Explorer";
                }
                if (app == "calculator" || app == "calc")
                {
                    Process.Start("calc.exe");
                    return "Opened Calculator";
                }
                Process.Start("powershell.exe");
                return "Opened PowerShell";
            }

            if (tool == "run_bash")
            {
                string cmd = GetStr(args, "command", "");
                string cwd = GetStr(args, "cwd", Environment.GetFolderPath(Environment.SpecialFolder.UserProfile));
                return RunProcess("cmd.exe", "/c " + cmd, cwd);
            }

            if (tool == "run_powershell")
            {
                string cmd = GetStr(args, "command", "");
                string cwd = GetStr(args, "cwd", Environment.GetFolderPath(Environment.SpecialFolder.UserProfile));
                return RunProcess("powershell.exe", "-NoProfile -NonInteractive -Command " + cmd, cwd);
            }

            if (tool == "file_list")
            {
                string dirPath = GetStr(args, "path", Environment.GetFolderPath(Environment.SpecialFolder.Desktop));
                List<Dictionary<string, object>> list = new List<Dictionary<string, object>>();
                DirectoryInfo di = new DirectoryInfo(dirPath);
                FileSystemInfo[] items = di.GetFileSystemInfos();
                for (int i = 0; i < items.Length; i++)
                {
                    FileSystemInfo item = items[i];
                    Dictionary<string, object> row = new Dictionary<string, object>();
                    row["Name"] = item.Name;
                    row["FullName"] = item.FullName;
                    row["PSIsContainer"] = (item.Attributes & FileAttributes.Directory) == FileAttributes.Directory;
                    if (item is FileInfo) row["Length"] = ((FileInfo)item).Length;
                    else row["Length"] = 0;
                    list.Add(row);
                }
                return json.Serialize(list);
            }

            if (tool == "file_read")
            {
                string path = GetStr(args, "path", "");
                return File.ReadAllText(path, Encoding.UTF8);
            }

            if (tool == "file_write")
            {
                string path = GetStr(args, "path", "");
                string content = GetStr(args, "content", "");
                string dir = Path.GetDirectoryName(path);
                if (!string.IsNullOrEmpty(dir) && !Directory.Exists(dir)) Directory.CreateDirectory(dir);
                File.WriteAllText(path, content, Encoding.UTF8);
                return "Wrote " + path;
            }

            if (tool == "file_delete")
            {
                string path = GetStr(args, "path", "");
                if (Directory.Exists(path)) Directory.Delete(path, true);
                else if (File.Exists(path)) File.Delete(path);
                return "Deleted " + path;
            }

            throw new InvalidOperationException("Unsupported tool on JarvisPcAgent.exe: " + tool);
        }
    }
}
`;
}

export function buildExeBuilderBatchScript(baseHttpOrigin: string): string {
  const csUrl = `${baseHttpOrigin}/api/real-pc-agent.cs`;
  return `@echo off
setlocal
title JarvisPcAgent.exe — Builder & Background Launcher

set "TARGET_DIR=%USERPROFILE%\\JarvisAgent"
if not exist "%TARGET_DIR%" mkdir "%TARGET_DIR%"
set "CS_FILE=%TARGET_DIR%\\JarvisPcAgent.cs"
set "EXE_FILE=%TARGET_DIR%\\JarvisPcAgent.exe"

echo [1/3] Yuklab olinmoqda: ${csUrl}
curl.exe -fsSL "${csUrl}" -o "%CS_FILE%"
if errorlevel 1 (
  powershell -NoProfile -Command "[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; Invoke-WebRequest -Uri '${csUrl}' -OutFile '%CS_FILE%'"
)
if not exist "%CS_FILE%" (
  echo XATO: Manba fayl yuklab olinmadi.
  pause
  exit /b 1
)

set "CSC=%WINDIR%\\Microsoft.NET\\Framework64\\v4.0.30319\\csc.exe"
if not exist "%CSC%" set "CSC=%WINDIR%\\Microsoft.NET\\Framework\\v4.0.30319\\csc.exe"
if not exist "%CSC%" (
  echo XATO: Windows .NET Framework 4.x csc.exe topilmadi.
  pause
  exit /b 1
)

echo [2/3] Eski jarayon to'xtatilmoqda va JarvisPcAgent.exe tuzilmoqda...
taskkill /F /IM JarvisPcAgent.exe >nul 2>&1
"%CSC%" /nologo /target:winexe /optimize+ /r:System.Drawing.dll /r:System.Windows.Forms.dll /r:System.Web.Extensions.dll /out:"%EXE_FILE%" "%CS_FILE%"
if errorlevel 1 (
  echo XATO: .exe kompilyatsiya qilinmadi.
  pause
  exit /b 1
)

echo [3/3] JarvisPcAgent.exe fonda ishga tushirilmoqda...
start "" "%EXE_FILE%"

echo.
echo TAYYOR! %EXE_FILE% fonda ishlamoqda (konsol oynasisiz).
echo Avto-ishga tushishga (Windows Startup) qo'shish uchun:
echo   copy /Y "%EXE_FILE%" "%APPDATA%\\Microsoft\\Windows\\Start Menu\\Programs\\Startup\\"
echo.
timeout /t 4 >nul
exit /b 0
`;
}
