export function buildCSharpPcAgentSource(wsUrl: string, token?: string | null): string {
  const finalWsUrl = token ? `${wsUrl}?token=${encodeURIComponent(token)}` : wsUrl;
  const escapedWsUrl = JSON.stringify(finalWsUrl);

  return `// ClaudeWin 10 Pro / J.A.R.V.I.S. — Native Windows Background PC Agent (.NET 4.5+)
// Compiled automatically to JarvisPcAgent.exe via built-in Windows csc.exe (C# 5 compatible)
// Supports:
//   1) User-session desktop agent (default)
//   2) LocalSystem Windows Service (--service) for live Win+L (winsta0\\winlogon) view & PIN unlock
//   3) Session Winlogon worker (--winlogon-worker <pipeName>) spawned into active console session

using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Imaging;
using System.IO;
using System.IO.Pipes;
using System.Net;
using System.Net.WebSockets;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Security.AccessControl;
using System.Security.Principal;
using System.ServiceProcess;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;
using System.Windows.Forms;

namespace JarvisPcAgent
{
    [StructLayout(LayoutKind.Sequential)]
    internal struct MOUSEINPUT
    {
        public int dx;
        public int dy;
        public uint mouseData;
        public uint dwFlags;
        public uint time;
        public IntPtr dwExtraInfo;
    }

    [StructLayout(LayoutKind.Sequential)]
    internal struct KEYBDINPUT
    {
        public ushort wVk;
        public ushort wScan;
        public uint dwFlags;
        public uint time;
        public IntPtr dwExtraInfo;
    }

    [StructLayout(LayoutKind.Sequential)]
    internal struct HARDWAREINPUT
    {
        public uint uMsg;
        public ushort wParamL;
        public ushort wParamH;
    }

    [StructLayout(LayoutKind.Explicit)]
    internal struct InputUnion
    {
        [FieldOffset(0)]
        public MOUSEINPUT mi;
        [FieldOffset(0)]
        public KEYBDINPUT ki;
        [FieldOffset(0)]
        public HARDWAREINPUT hi;
    }

    [StructLayout(LayoutKind.Sequential)]
    internal struct INPUT
    {
        public uint type;
        public InputUnion U;
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    internal struct STARTUPINFO
    {
        public int cb;
        public string lpReserved;
        public string lpDesktop;
        public string lpTitle;
        public int dwX;
        public int dwY;
        public int dwXSize;
        public int dwYSize;
        public int dwXCountChars;
        public int dwYCountChars;
        public int dwFillAttribute;
        public int dwFlags;
        public short wShowWindow;
        public short cbReserved2;
        public IntPtr lpReserved2;
        public IntPtr hStdInput;
        public IntPtr hStdOutput;
        public IntPtr hStdError;
    }

    [StructLayout(LayoutKind.Sequential)]
    internal struct PROCESS_INFORMATION
    {
        public IntPtr hProcess;
        public IntPtr hThread;
        public int dwProcessId;
        public int dwThreadId;
    }

    internal static class NativeWin32
    {
        [DllImport("user32.dll")]
        public static extern bool SetCursorPos(int X, int Y);

        [DllImport("user32.dll")]
        public static extern void mouse_event(uint dwFlags, uint dx, uint dy, uint dwData, UIntPtr dwExtraInfo);

        [DllImport("user32.dll")]
        public static extern bool SetProcessDPIAware();

        [DllImport("user32.dll", SetLastError = true)]
        public static extern IntPtr OpenInputDesktop(uint dwFlags, bool fInherit, uint dwDesiredAccess);

        [DllImport("user32.dll", SetLastError = true)]
        public static extern bool CloseDesktop(IntPtr hDesktop);

        [DllImport("user32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
        public static extern bool GetUserObjectInformation(IntPtr hObj, int nIndex, byte[] pvInfo, int nLength, out int lpnLengthNeeded);

        [DllImport("user32.dll", SetLastError = true)]
        public static extern uint SendInput(uint nInputs, INPUT[] pInputs, int cbSize);

        [DllImport("user32.dll")]
        public static extern uint MapVirtualKey(uint uCode, uint uMapType);

        [DllImport("user32.dll")]
        public static extern int GetSystemMetrics(int nIndex);

        [DllImport("user32.dll")]
        public static extern IntPtr GetDC(IntPtr hWnd);

        [DllImport("user32.dll")]
        public static extern int ReleaseDC(IntPtr hWnd, IntPtr hDC);

        [DllImport("gdi32.dll")]
        public static extern IntPtr CreateCompatibleDC(IntPtr hdc);

        [DllImport("gdi32.dll")]
        public static extern bool DeleteDC(IntPtr hdc);

        [DllImport("gdi32.dll")]
        public static extern IntPtr CreateCompatibleBitmap(IntPtr hdc, int nWidth, int nHeight);

        [DllImport("gdi32.dll")]
        public static extern IntPtr SelectObject(IntPtr hdc, IntPtr hgdiobj);

        [DllImport("gdi32.dll")]
        public static extern bool DeleteObject(IntPtr hObject);

        [DllImport("gdi32.dll")]
        public static extern bool BitBlt(IntPtr hdcDest, int nXDest, int nYDest, int nWidth, int nHeight, IntPtr hdcSrc, int nXSrc, int nYSrc, uint dwRop);

        [DllImport("gdi32.dll")]
        public static extern int GetDeviceCaps(IntPtr hdc, int nIndex);

        [DllImport("kernel32.dll")]
        public static extern uint WTSGetActiveConsoleSessionId();

        [DllImport("kernel32.dll")]
        public static extern IntPtr GetCurrentProcess();

        [DllImport("kernel32.dll", SetLastError = true)]
        public static extern bool CloseHandle(IntPtr hObject);

        [DllImport("advapi32.dll", SetLastError = true)]
        public static extern bool OpenProcessToken(IntPtr ProcessHandle, uint DesiredAccess, out IntPtr TokenHandle);

        [DllImport("advapi32.dll", CharSet = CharSet.Auto, SetLastError = true)]
        public static extern bool DuplicateTokenEx(IntPtr hExistingToken, uint dwDesiredAccess, IntPtr lpTokenAttributes, int ImpersonationLevel, int TokenType, out IntPtr phNewToken);

        [DllImport("advapi32.dll", SetLastError = true)]
        public static extern bool SetTokenInformation(IntPtr TokenHandle, int TokenInformationClass, ref uint TokenInformation, uint TokenInformationLength);

        [DllImport("advapi32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
        public static extern bool CreateProcessAsUser(IntPtr hToken, string lpApplicationName, string lpCommandLine, IntPtr lpProcessAttributes, IntPtr lpThreadAttributes, bool bInheritHandles, uint dwCreationFlags, IntPtr lpEnvironment, string lpCurrentDirectory, ref STARTUPINFO lpStartupInfo, out PROCESS_INFORMATION lpProcessInformation);

        [DllImport("sas.dll")]
        public static extern void SendSAS(bool asUser);

        [DllImport("user32.dll", SetLastError = true)]
        public static extern bool LockWorkStation();

        [DllImport("user32.dll")]
        public static extern short VkKeyScan(char ch);

        public const uint INPUT_MOUSE = 0;
        public const uint INPUT_KEYBOARD = 1;

        public const uint KEYEVENTF_EXTENDEDKEY = 0x0001;
        public const uint KEYEVENTF_KEYUP = 0x0002;
        public const uint KEYEVENTF_UNICODE = 0x0004;

        public const uint MOUSEEVENTF_MOVE = 0x0001;
        public const uint MOUSEEVENTF_LEFTDOWN = 0x0002;
        public const uint MOUSEEVENTF_LEFTUP = 0x0004;
        public const uint MOUSEEVENTF_RIGHTDOWN = 0x0008;
        public const uint MOUSEEVENTF_RIGHTUP = 0x0010;
        public const uint MOUSEEVENTF_WHEEL = 0x0800;
        public const uint MOUSEEVENTF_ABSOLUTE = 0x8000;

        public const int UOI_NAME = 2;
        public const int SM_CXSCREEN = 0;
        public const int SM_CYSCREEN = 1;
        public const int DESKTOPHORZRES = 118;
        public const int DESKTOPVERTRES = 117;
        public const uint SRCCOPY = 0x00CC0020;
        public const uint CAPTUREBLT = 0x40000000;

        public const uint TOKEN_ALL_ACCESS = 0xF01FF;
        public const uint MAXIMUM_ALLOWED = 0x02000000;
        public const int TokenSessionId = 12;
        public const uint CREATE_NO_WINDOW = 0x08000000;
        public const uint NORMAL_PRIORITY_CLASS = 0x00000020;
        public const int STARTF_USESHOWWINDOW = 0x00000001;
    }

    internal static class WinlogonInputHelper
    {
        public static string GetActiveInputDesktopName()
        {
            IntPtr hDesk = NativeWin32.OpenInputDesktop(0, false, 0x0001);
            if (hDesk == IntPtr.Zero)
            {
                return "";
            }
            try
            {
                byte[] buf = new byte[256];
                int needed;
                if (NativeWin32.GetUserObjectInformation(hDesk, NativeWin32.UOI_NAME, buf, buf.Length, out needed) && needed > 2)
                {
                    return Encoding.Unicode.GetString(buf, 0, needed - 2).TrimEnd('\\0');
                }
                return "";
            }
            finally
            {
                NativeWin32.CloseDesktop(hDesk);
            }
        }

        public static bool IsWinlogonActive()
        {
            string name = GetActiveInputDesktopName();
            return string.Equals(name, "Winlogon", StringComparison.OrdinalIgnoreCase);
        }

        public static uint SendVirtualKey(ushort vk, bool keyUp, bool extended)
        {
            INPUT[] inputs = new INPUT[1];
            inputs[0].type = NativeWin32.INPUT_KEYBOARD;
            inputs[0].U.ki.wVk = vk;
            inputs[0].U.ki.wScan = (ushort)NativeWin32.MapVirtualKey(vk, 0);
            uint flags = 0;
            if (extended) flags |= NativeWin32.KEYEVENTF_EXTENDEDKEY;
            if (keyUp) flags |= NativeWin32.KEYEVENTF_KEYUP;
            inputs[0].U.ki.dwFlags = flags;
            return NativeWin32.SendInput(1, inputs, Marshal.SizeOf(typeof(INPUT)));
        }

        public static void PressVirtualKey(ushort vk)
        {
            uint sentDown = SendVirtualKey(vk, false, false);
            if (sentDown == 0)
            {
                throw new InvalidOperationException("Windows klaviatura tugmasini qabul qilmadi (SendInput=0, err=" + Marshal.GetLastWin32Error() + ")");
            }
            Thread.Sleep(25);
            SendVirtualKey(vk, true, false);
        }

        public static void SendCtrlA()
        {
            SendVirtualKey(0x11, false, false);
            Thread.Sleep(15);
            PressVirtualKey(0x41);
            Thread.Sleep(15);
            SendVirtualKey(0x11, true, false);
        }

        public static bool ResolveVirtualKey(string rawToken, out ushort vk, out bool extended)
        {
            vk = 0;
            extended = false;
            if (string.IsNullOrEmpty(rawToken)) return false;
            string t = rawToken.Trim().ToLowerInvariant();

            if (t == "win" || t == "lwin" || t == "super" || t == "super_l" || t == "meta" || t == "windows") { vk = 0x5B; extended = true; return true; }
            if (t == "rwin" || t == "super_r") { vk = 0x5C; extended = true; return true; }
            if (t == "ctrl" || t == "control" || t == "lctrl" || t == "rctrl") { vk = 0x11; return true; }
            if (t == "alt" || t == "menu" || t == "lalt" || t == "ralt") { vk = 0x12; return true; }
            if (t == "shift" || t == "lshift" || t == "rshift") { vk = 0x10; return true; }

            if (t == "enter" || t == "return") { vk = 0x0D; return true; }
            if (t == "tab") { vk = 0x09; return true; }
            if (t == "esc" || t == "escape") { vk = 0x1B; return true; }
            if (t == "space" || t == " ") { vk = 0x20; return true; }
            if (t == "backspace" || t == "back") { vk = 0x08; return true; }
            if (t == "delete" || t == "del") { vk = 0x2E; extended = true; return true; }
            if (t == "insert" || t == "ins") { vk = 0x2D; extended = true; return true; }
            if (t == "home") { vk = 0x24; extended = true; return true; }
            if (t == "end") { vk = 0x23; extended = true; return true; }
            if (t == "pageup" || t == "pgup" || t == "prior") { vk = 0x21; extended = true; return true; }
            if (t == "pagedown" || t == "pgdn" || t == "next") { vk = 0x22; extended = true; return true; }
            if (t == "left" || t == "arrowleft") { vk = 0x25; extended = true; return true; }
            if (t == "up" || t == "arrowup") { vk = 0x26; extended = true; return true; }
            if (t == "right" || t == "arrowright") { vk = 0x27; extended = true; return true; }
            if (t == "down" || t == "arrowdown") { vk = 0x28; extended = true; return true; }
            if (t == "printscreen" || t == "prtsc" || t == "snapshot") { vk = 0x2C; extended = true; return true; }
            if (t == "capslock") { vk = 0x14; return true; }
            if (t == "numlock") { vk = 0x90; extended = true; return true; }
            if (t == "volumeup") { vk = 0xAF; extended = true; return true; }
            if (t == "volumedown") { vk = 0xAE; extended = true; return true; }
            if (t == "volumemute") { vk = 0xAD; extended = true; return true; }

            if (t.StartsWith("f") && t.Length >= 2 && t.Length <= 3)
            {
                int fn;
                if (int.TryParse(t.Substring(1), out fn) && fn >= 1 && fn <= 24)
                {
                    vk = (ushort)(0x70 + (fn - 1));
                    return true;
                }
            }

            if (t.Length == 1)
            {
                char ch = t[0];
                if (ch >= 'a' && ch <= 'z')
                {
                    vk = (ushort)('A' + (ch - 'a'));
                    return true;
                }
                if (ch >= '0' && ch <= '9')
                {
                    vk = (ushort)ch;
                    return true;
                }
                short scan = NativeWin32.VkKeyScan(rawToken.Trim()[0]);
                if (scan != -1)
                {
                    vk = (ushort)(scan & 0xFF);
                    return true;
                }
            }

            return false;
        }

        public static string SendKeyOrCombo(string keySpec)
        {
            if (string.IsNullOrEmpty(keySpec))
            {
                throw new InvalidOperationException("Klaviatura tugmasi ko'rsatilmagan.");
            }
            string[] rawParts = keySpec.Split(new char[] { '+' }, StringSplitOptions.RemoveEmptyEntries);
            if (rawParts.Length == 0)
            {
                throw new InvalidOperationException("Klaviatura tugmasi bo'sh: " + keySpec);
            }

            ushort[] vks = new ushort[rawParts.Length];
            bool[] exts = new bool[rawParts.Length];
            for (int i = 0; i < rawParts.Length; i++)
            {
                ushort vk;
                bool ext;
                if (!ResolveVirtualKey(rawParts[i], out vk, out ext))
                {
                    throw new InvalidOperationException("Noma'lum klaviatura tugmasi: " + rawParts[i]);
                }
                vks[i] = vk;
                exts[i] = ext;
            }

            if (vks.Length == 2 && (vks[0] == 0x5B || vks[0] == 0x5C) && vks[1] == 0x4C)
            {
                if (!NativeWin32.LockWorkStation())
                {
                    throw new InvalidOperationException("LockWorkStation bajarilmadi (err=" + Marshal.GetLastWin32Error() + ")");
                }
                return "Locked workstation (Win+L)";
            }

            for (int i = 0; i < vks.Length; i++)
            {
                uint sent = SendVirtualKey(vks[i], false, exts[i]);
                if (sent == 0)
                {
                    for (int j = i - 1; j >= 0; j--) SendVirtualKey(vks[j], true, exts[j]);
                    throw new InvalidOperationException("Windows klaviatura tugmasini blokladi (SendInput=0, key=" + keySpec + ", err=" + Marshal.GetLastWin32Error() + ")");
                }
                Thread.Sleep(25);
            }
            Thread.Sleep(35);
            for (int i = vks.Length - 1; i >= 0; i--)
            {
                SendVirtualKey(vks[i], true, exts[i]);
                Thread.Sleep(15);
            }
            return "Sent real Win32 key " + keySpec;
        }

        public static void TypeUnicodeText(string text)
        {
            if (string.IsNullOrEmpty(text)) return;
            for (int i = 0; i < text.Length; i++)
            {
                char ch = text[i];
                INPUT[] inputs = new INPUT[2];
                inputs[0].type = NativeWin32.INPUT_KEYBOARD;
                inputs[0].U.ki.wVk = 0;
                inputs[0].U.ki.wScan = (ushort)ch;
                inputs[0].U.ki.dwFlags = NativeWin32.KEYEVENTF_UNICODE;

                inputs[1].type = NativeWin32.INPUT_KEYBOARD;
                inputs[1].U.ki.wVk = 0;
                inputs[1].U.ki.wScan = (ushort)ch;
                inputs[1].U.ki.dwFlags = NativeWin32.KEYEVENTF_UNICODE | NativeWin32.KEYEVENTF_KEYUP;

                uint sent = NativeWin32.SendInput(2, inputs, Marshal.SizeOf(typeof(INPUT)));
                if (sent == 0)
                {
                    throw new InvalidOperationException("Windows matn kiritishni blokladi (SendInput=0, err=" + Marshal.GetLastWin32Error() + ")");
                }
                Thread.Sleep(18);
            }
        }

        public static void SendMouseAction(int x, int y, string button, bool click)
        {
            int sw = NativeWin32.GetSystemMetrics(NativeWin32.SM_CXSCREEN);
            int sh = NativeWin32.GetSystemMetrics(NativeWin32.SM_CYSCREEN);
            if (sw <= 0) sw = 1920;
            if (sh <= 0) sh = 1080;

            int absX = (int)Math.Max(0, Math.Min(65535, Math.Round((double)x * 65535.0 / Math.Max(1, sw - 1))));
            int absY = (int)Math.Max(0, Math.Min(65535, Math.Round((double)y * 65535.0 / Math.Max(1, sh - 1))));

            INPUT[] move = new INPUT[1];
            move[0].type = NativeWin32.INPUT_MOUSE;
            move[0].U.mi.dx = absX;
            move[0].U.mi.dy = absY;
            move[0].U.mi.dwFlags = NativeWin32.MOUSEEVENTF_MOVE | NativeWin32.MOUSEEVENTF_ABSOLUTE;
            NativeWin32.SendInput(1, move, Marshal.SizeOf(typeof(INPUT)));
            NativeWin32.SetCursorPos(x, y);

            if (!click) return;
            Thread.Sleep(35);

            if (button == "right")
            {
                SendMouseButtons(NativeWin32.MOUSEEVENTF_RIGHTDOWN, NativeWin32.MOUSEEVENTF_RIGHTUP);
            }
            else if (button == "double")
            {
                SendMouseButtons(NativeWin32.MOUSEEVENTF_LEFTDOWN, NativeWin32.MOUSEEVENTF_LEFTUP);
                Thread.Sleep(60);
                SendMouseButtons(NativeWin32.MOUSEEVENTF_LEFTDOWN, NativeWin32.MOUSEEVENTF_LEFTUP);
            }
            else
            {
                SendMouseButtons(NativeWin32.MOUSEEVENTF_LEFTDOWN, NativeWin32.MOUSEEVENTF_LEFTUP);
            }
        }

        private static void SendMouseButtons(uint downFlag, uint upFlag)
        {
            INPUT[] btn = new INPUT[2];
            btn[0].type = NativeWin32.INPUT_MOUSE;
            btn[0].U.mi.dwFlags = downFlag;
            btn[1].type = NativeWin32.INPUT_MOUSE;
            btn[1].U.mi.dwFlags = upFlag;
            NativeWin32.SendInput(2, btn, Marshal.SizeOf(typeof(INPUT)));
        }

        public static byte[] CaptureCurrentDesktopJpeg(out int width, out int height)
        {
            IntPtr hScreenDC = NativeWin32.GetDC(IntPtr.Zero);
            int w = NativeWin32.GetDeviceCaps(hScreenDC, NativeWin32.DESKTOPHORZRES);
            int h = NativeWin32.GetDeviceCaps(hScreenDC, NativeWin32.DESKTOPVERTRES);
            if (w <= 0) w = NativeWin32.GetSystemMetrics(NativeWin32.SM_CXSCREEN);
            if (h <= 0) h = NativeWin32.GetSystemMetrics(NativeWin32.SM_CYSCREEN);
            if (w <= 0) w = 1280;
            if (h <= 0) h = 720;
            width = w;
            height = h;

            IntPtr hMemDC = NativeWin32.CreateCompatibleDC(hScreenDC);
            IntPtr hBmp = NativeWin32.CreateCompatibleBitmap(hScreenDC, w, h);
            IntPtr hOld = NativeWin32.SelectObject(hMemDC, hBmp);
            try
            {
                NativeWin32.BitBlt(hMemDC, 0, 0, w, h, hScreenDC, 0, 0, NativeWin32.SRCCOPY | NativeWin32.CAPTUREBLT);
                using (Bitmap bmp = Image.FromHbitmap(hBmp))
                {
                    return Program.EncodeJpeg(bmp, 55L);
                }
            }
            finally
            {
                NativeWin32.SelectObject(hMemDC, hOld);
                NativeWin32.DeleteObject(hBmp);
                NativeWin32.DeleteDC(hMemDC);
                NativeWin32.ReleaseDC(IntPtr.Zero, hScreenDC);
            }
        }
    }

    internal static class WinlogonWorkerRunner
    {
        public static void Run(string workerPipeName)
        {
            JavaScriptSerializer json = new JavaScriptSerializer();
            json.MaxJsonLength = 32 * 1024 * 1024;

            PipeSecurity ps = new PipeSecurity();
            ps.AddAccessRule(new PipeAccessRule(new SecurityIdentifier(WellKnownSidType.LocalSystemSid, null), PipeAccessRights.FullControl, AccessControlType.Allow));

            DateTime lastRequestUtc = DateTime.UtcNow;
            while (true)
            {
                if (!WinlogonInputHelper.IsWinlogonActive())
                {
                    break;
                }
                if ((DateTime.UtcNow - lastRequestUtc).TotalSeconds > 20)
                {
                    break;
                }

                try
                {
                    using (NamedPipeServerStream server = new NamedPipeServerStream(workerPipeName, PipeDirection.InOut, 1, PipeTransmissionMode.Byte, PipeOptions.Asynchronous, 65536, 65536, ps))
                    {
                        IAsyncResult ar = server.BeginWaitForConnection(null, null);
                        while (!ar.IsCompleted)
                        {
                            if (ar.AsyncWaitHandle.WaitOne(400)) break;
                            if (!WinlogonInputHelper.IsWinlogonActive() || (DateTime.UtcNow - lastRequestUtc).TotalSeconds > 20)
                            {
                                return;
                            }
                        }
                        server.EndWaitForConnection(ar);
                        lastRequestUtc = DateTime.UtcNow;

                        StreamReader reader = new StreamReader(server, Encoding.UTF8, false, 4096, true);
                        string line = reader.ReadLine();
                        Dictionary<string, object> resp = HandleWorkerRequest(json, line);
                        string outJson = json.Serialize(resp) + "\\n";
                        byte[] outBytes = Encoding.UTF8.GetBytes(outJson);
                        server.Write(outBytes, 0, outBytes.Length);
                        server.Flush();
                        try { server.WaitForPipeDrain(); } catch { }
                    }
                }
                catch
                {
                    Thread.Sleep(150);
                }
            }
        }

        private static Dictionary<string, object> HandleWorkerRequest(JavaScriptSerializer json, string line)
        {
            Dictionary<string, object> resp = new Dictionary<string, object>();
            if (!WinlogonInputHelper.IsWinlogonActive())
            {
                resp["ok"] = false;
                resp["unlocked"] = true;
                resp["error"] = "Workstation already unlocked";
                return resp;
            }

            Dictionary<string, object> req = new Dictionary<string, object>();
            if (!string.IsNullOrEmpty(line))
            {
                try
                {
                    Dictionary<string, object> parsed = json.Deserialize<Dictionary<string, object>>(line);
                    if (parsed != null) req = parsed;
                }
                catch
                {
                }
            }

            string cmd = Program.GetStr(req, "cmd", "capture");
            try
            {
                if (cmd == "capture")
                {
                    int w;
                    int h;
                    byte[] jpg = WinlogonInputHelper.CaptureCurrentDesktopJpeg(out w, out h);
                    resp["ok"] = true;
                    resp["width"] = w;
                    resp["height"] = h;
                    resp["data"] = Convert.ToBase64String(jpg);
                    return resp;
                }

                if (cmd == "unlock")
                {
                    string pin = Program.GetStr(req, "pin", "");
                    bool wake = Program.GetBool(req, "wake");
                    if (wake)
                    {
                        WinlogonInputHelper.PressVirtualKey(0x20);
                        Thread.Sleep(480);
                        WinlogonInputHelper.SendCtrlA();
                        Thread.Sleep(50);
                        WinlogonInputHelper.PressVirtualKey(0x08);
                        Thread.Sleep(80);
                    }
                    if (!string.IsNullOrEmpty(pin))
                    {
                        WinlogonInputHelper.TypeUnicodeText(pin);
                        Thread.Sleep(60);
                        WinlogonInputHelper.PressVirtualKey(0x0D);
                    }
                    resp["ok"] = true;
                    resp["data"] = string.IsNullOrEmpty(pin)
                        ? "Windows qulf ekrani uyg'otildi"
                        : "Windows PIN/paroli kiritildi va Enter bosildi";
                    return resp;
                }

                if (cmd == "type")
                {
                    string text = Program.GetStr(req, "text", "");
                    bool enter = Program.GetBool(req, "enter");
                    WinlogonInputHelper.TypeUnicodeText(text);
                    if (enter)
                    {
                        Thread.Sleep(40);
                        WinlogonInputHelper.PressVirtualKey(0x0D);
                    }
                    resp["ok"] = true;
                    resp["data"] = "Typed " + text.Length + " chars on Winlogon";
                    return resp;
                }

                if (cmd == "key")
                {
                    string k = Program.GetStr(req, "key", "Enter");
                    SendMappedWinlogonKey(k);
                    resp["ok"] = true;
                    resp["data"] = "Sent key " + k + " on Winlogon";
                    return resp;
                }

                if (cmd == "click")
                {
                    int x = Program.GetInt(req, "x", 0);
                    int y = Program.GetInt(req, "y", 0);
                    string btn = Program.GetStr(req, "button", "left");
                    WinlogonInputHelper.SendMouseAction(x, y, btn, true);
                    resp["ok"] = true;
                    resp["data"] = "Clicked " + btn + " at (" + x + ", " + y + ") on Winlogon";
                    return resp;
                }

                if (cmd == "move")
                {
                    int x = Program.GetInt(req, "x", 0);
                    int y = Program.GetInt(req, "y", 0);
                    WinlogonInputHelper.SendMouseAction(x, y, "left", false);
                    resp["ok"] = true;
                    resp["data"] = "Moved cursor on Winlogon";
                    return resp;
                }

                resp["ok"] = false;
                resp["error"] = "Unsupported Winlogon cmd: " + cmd;
                return resp;
            }
            catch (Exception ex)
            {
                resp["ok"] = false;
                resp["error"] = ex.Message;
                return resp;
            }
        }

        private static void SendMappedWinlogonKey(string k)
        {
            WinlogonInputHelper.SendKeyOrCombo(k);
        }
    }

    internal sealed class JarvisUnlockService : ServiceBase
    {
        public const string PipeName = "JarvisWinlogonPipe";
        private volatile bool _stopping;
        private Thread _pipeThread;
        private static readonly object WorkerLaunchLock = new object();

        public JarvisUnlockService()
        {
            ServiceName = "JarvisUnlockService";
        }

        protected override void OnStart(string[] args)
        {
            _stopping = false;
            _pipeThread = new Thread(RunPipeServer);
            _pipeThread.IsBackground = true;
            _pipeThread.Start();
        }

        protected override void OnStop()
        {
            _stopping = true;
            try
            {
                using (NamedPipeClientStream wake = new NamedPipeClientStream(".", PipeName, PipeDirection.InOut))
                {
                    wake.Connect(150);
                }
            }
            catch
            {
            }
        }

        private void RunPipeServer()
        {
            JavaScriptSerializer json = new JavaScriptSerializer();
            json.MaxJsonLength = 32 * 1024 * 1024;

            PipeSecurity ps = new PipeSecurity();
            ps.AddAccessRule(new PipeAccessRule(new SecurityIdentifier(WellKnownSidType.LocalSystemSid, null), PipeAccessRights.FullControl, AccessControlType.Allow));
            ps.AddAccessRule(new PipeAccessRule(new SecurityIdentifier(WellKnownSidType.AuthenticatedUserSid, null), PipeAccessRights.ReadWrite, AccessControlType.Allow));

            while (!_stopping)
            {
                try
                {
                    using (NamedPipeServerStream server = new NamedPipeServerStream(PipeName, PipeDirection.InOut, 4, PipeTransmissionMode.Byte, PipeOptions.None, 65536, 65536, ps))
                    {
                        server.WaitForConnection();
                        if (_stopping) break;

                        StreamReader reader = new StreamReader(server, Encoding.UTF8, false, 4096, true);
                        string line = reader.ReadLine();
                        string replyJson = DispatchServiceRequest(json, line);
                        byte[] bytes = Encoding.UTF8.GetBytes(replyJson + "\\n");
                        server.Write(bytes, 0, bytes.Length);
                        server.Flush();
                        try { server.WaitForPipeDrain(); } catch { }
                    }
                }
                catch
                {
                    Thread.Sleep(150);
                }
            }
        }

        private string DispatchServiceRequest(JavaScriptSerializer json, string line)
        {
            Dictionary<string, object> req = new Dictionary<string, object>();
            if (!string.IsNullOrEmpty(line))
            {
                try
                {
                    Dictionary<string, object> parsed = json.Deserialize<Dictionary<string, object>>(line);
                    if (parsed != null) req = parsed;
                }
                catch
                {
                }
            }

            string cmd = Program.GetStr(req, "cmd", "capture");
            if (cmd == "sas")
            {
                try
                {
                    NativeWin32.SendSAS(false);
                    Dictionary<string, object> okResp = new Dictionary<string, object>();
                    okResp["ok"] = true;
                    okResp["data"] = "SAS (Ctrl+Alt+Del) sent";
                    return json.Serialize(okResp);
                }
                catch (Exception ex)
                {
                    Dictionary<string, object> errResp = new Dictionary<string, object>();
                    errResp["ok"] = false;
                    errResp["error"] = "SendSAS failed: " + ex.Message;
                    return json.Serialize(errResp);
                }
            }

            uint sessionId = NativeWin32.WTSGetActiveConsoleSessionId();
            if (sessionId == 0xFFFFFFFF)
            {
                Dictionary<string, object> noSess = new Dictionary<string, object>();
                noSess["ok"] = false;
                noSess["error"] = "Active console session not found";
                return json.Serialize(noSess);
            }

            string workerPipeName = "JarvisWinlogonWorker_" + sessionId;
            string reply = TrySendToWorker(workerPipeName, line, 600);
            if (reply != null)
            {
                return reply;
            }

            lock (WorkerLaunchLock)
            {
                reply = TrySendToWorker(workerPipeName, line, 400);
                if (reply != null) return reply;

                string errMsg;
                if (!LaunchWinlogonWorkerInSession(sessionId, workerPipeName, out errMsg))
                {
                    Dictionary<string, object> errResp = new Dictionary<string, object>();
                    errResp["ok"] = false;
                    errResp["error"] = errMsg;
                    return json.Serialize(errResp);
                }
            }

            for (int i = 0; i < 12; i++)
            {
                Thread.Sleep(180);
                reply = TrySendToWorker(workerPipeName, line, 700);
                if (reply != null) return reply;
            }

            Dictionary<string, object> timeoutResp = new Dictionary<string, object>();
            timeoutResp["ok"] = false;
            timeoutResp["error"] = "Winlogon ishchi jarayoni ulanmadi (ehtimol ekran allaqachon qulfdan chiqqan).";
            return json.Serialize(timeoutResp);
        }

        private static string TrySendToWorker(string workerPipeName, string line, int timeoutMs)
        {
            try
            {
                using (NamedPipeClientStream client = new NamedPipeClientStream(".", workerPipeName, PipeDirection.InOut))
                {
                    client.Connect(timeoutMs);
                    byte[] outBytes = Encoding.UTF8.GetBytes((line ?? "{}") + "\\n");
                    client.Write(outBytes, 0, outBytes.Length);
                    client.Flush();
                    StreamReader reader = new StreamReader(client, Encoding.UTF8);
                    return reader.ReadLine();
                }
            }
            catch
            {
                return null;
            }
        }

        private static bool LaunchWinlogonWorkerInSession(uint sessionId, string workerPipeName, out string error)
        {
            error = "";
            IntPtr hToken = IntPtr.Zero;
            IntPtr hDup = IntPtr.Zero;
            try
            {
                if (!NativeWin32.OpenProcessToken(NativeWin32.GetCurrentProcess(), NativeWin32.TOKEN_ALL_ACCESS, out hToken))
                {
                    error = "OpenProcessToken failed: " + Marshal.GetLastWin32Error();
                    return false;
                }
                if (!NativeWin32.DuplicateTokenEx(hToken, NativeWin32.MAXIMUM_ALLOWED, IntPtr.Zero, 2, 1, out hDup))
                {
                    error = "DuplicateTokenEx failed: " + Marshal.GetLastWin32Error();
                    return false;
                }
                uint sid = sessionId;
                if (!NativeWin32.SetTokenInformation(hDup, NativeWin32.TokenSessionId, ref sid, (uint)Marshal.SizeOf(typeof(uint))))
                {
                    error = "SetTokenInformation failed: " + Marshal.GetLastWin32Error();
                    return false;
                }

                string exePath = Assembly.GetExecutingAssembly().Location;
                string cmdLine = "\\"" + exePath + "\\" --winlogon-worker " + workerPipeName;
                STARTUPINFO si = new STARTUPINFO();
                si.cb = Marshal.SizeOf(si);
                si.lpDesktop = "winsta0\\\\winlogon";
                si.dwFlags = NativeWin32.STARTF_USESHOWWINDOW;
                si.wShowWindow = 0;

                PROCESS_INFORMATION pi;
                if (!NativeWin32.CreateProcessAsUser(hDup, null, cmdLine, IntPtr.Zero, IntPtr.Zero, false, NativeWin32.CREATE_NO_WINDOW | NativeWin32.NORMAL_PRIORITY_CLASS, IntPtr.Zero, null, ref si, out pi))
                {
                    error = "CreateProcessAsUser(winlogon) failed: " + Marshal.GetLastWin32Error();
                    return false;
                }

                NativeWin32.CloseHandle(pi.hThread);
                NativeWin32.CloseHandle(pi.hProcess);
                return true;
            }
            finally
            {
                if (hDup != IntPtr.Zero) NativeWin32.CloseHandle(hDup);
                if (hToken != IntPtr.Zero) NativeWin32.CloseHandle(hToken);
            }
        }
    }

    internal static class Program
    {
        private static readonly string WsUri = ${escapedWsUrl};
        private static readonly SemaphoreSlim SendLock = new SemaphoreSlim(1, 1);
        private static Mutex _singleInstanceMutex;

        [STAThread]
        private static void Main(string[] args)
        {
            if (args != null && args.Length >= 1 && args[0] == "--service")
            {
                try { NativeWin32.SetProcessDPIAware(); } catch { }
                ServiceBase.Run(new JarvisUnlockService());
                return;
            }

            if (args != null && args.Length >= 2 && args[0] == "--winlogon-worker")
            {
                try { NativeWin32.SetProcessDPIAware(); } catch { }
                WinlogonWorkerRunner.Run(args[1]);
                return;
            }

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

        private static Dictionary<string, object> CallUnlockPipe(JavaScriptSerializer json, Dictionary<string, object> req)
        {
            try
            {
                using (NamedPipeClientStream client = new NamedPipeClientStream(".", JarvisUnlockService.PipeName, PipeDirection.InOut))
                {
                    client.Connect(1200);
                    string line = json.Serialize(req) + "\\n";
                    byte[] bytes = Encoding.UTF8.GetBytes(line);
                    client.Write(bytes, 0, bytes.Length);
                    client.Flush();
                    StreamReader reader = new StreamReader(client, Encoding.UTF8);
                    string replyLine = reader.ReadLine();
                    if (!string.IsNullOrEmpty(replyLine))
                    {
                        return json.Deserialize<Dictionary<string, object>>(replyLine);
                    }
                }
            }
            catch
            {
            }
            return null;
        }

        private static string BuildFrameJson(JavaScriptSerializer json)
        {
            Rectangle bounds = GetScreenBoundsSafe();
            int w = bounds.Width > 0 ? bounds.Width : 1280;
            int h = bounds.Height > 0 ? bounds.Height : 720;
            byte[] jpegBytes = null;
            bool isLocked = IsWorkstationLocked();
            bool lockServiceReady = false;

            if (!isLocked)
            {
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
                    isLocked = true;
                }
            }

            if (isLocked)
            {
                Dictionary<string, object> capReq = new Dictionary<string, object>();
                capReq["cmd"] = "capture";
                Dictionary<string, object> pipeResp = CallUnlockPipe(json, capReq);
                if (pipeResp != null && pipeResp.ContainsKey("ok") && Convert.ToBoolean(pipeResp["ok"]))
                {
                    lockServiceReady = true;
                    string b64 = GetStr(pipeResp, "data", "");
                    if (!string.IsNullOrEmpty(b64))
                    {
                        jpegBytes = Convert.FromBase64String(b64);
                        w = GetInt(pipeResp, "width", w);
                        h = GetInt(pipeResp, "height", h);
                    }
                }

                if (jpegBytes == null)
                {
                    w = 960;
                    h = 540;
                    using (Bitmap lockedBmp = new Bitmap(w, h))
                    using (Graphics g = Graphics.FromImage(lockedBmp))
                    using (SolidBrush bg = new SolidBrush(Color.FromArgb(7, 11, 20)))
                    using (SolidBrush fg = new SolidBrush(Color.FromArgb(203, 213, 225)))
                    using (SolidBrush accent = new SolidBrush(Color.FromArgb(56, 189, 248)))
                    using (SolidBrush warn = new SolidBrush(Color.FromArgb(251, 191, 36)))
                    using (Font titleFont = new Font("Segoe UI", 20, FontStyle.Bold))
                    using (Font subFont = new Font("Segoe UI", 12, FontStyle.Regular))
                    {
                        g.FillRectangle(bg, 0, 0, w, h);
                        g.DrawString("PC QULFLANGAN (Win+L)", titleFont, accent, 60, 170);
                        g.DrawString("Fonda aloqa faol: run_powershell, run_bash va file_* buyruqlari ishlayapti.", subFont, fg, 60, 220);
                        g.DrawString("Win+L qulf ekrani va kod bilan ochish uchun JarvisPcAgent-Setup.bat ni", subFont, warn, 60, 265);
                        g.DrawString("bir marta Administrator sifatida ishga tushiring (JarvisUnlockService).", subFont, warn, 60, 295);
                        jpegBytes = EncodeJpeg(lockedBmp, 55L);
                    }
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
            frame["locked"] = isLocked;
            frame["lockServiceReady"] = lockServiceReady;
            frame["timestamp"] = ts;
            return json.Serialize(frame);
        }

        public static byte[] EncodeJpeg(Bitmap bmp, long quality)
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

        public static int GetInt(Dictionary<string, object> args, string key, int fallback)
        {
            object val;
            if (args != null && args.TryGetValue(key, out val) && val != null)
            {
                int parsed;
                if (int.TryParse(Convert.ToString(val), out parsed)) return parsed;
            }
            return fallback;
        }

        public static string GetStr(Dictionary<string, object> args, string key, string fallback)
        {
            object val;
            if (args != null && args.TryGetValue(key, out val) && val != null)
            {
                return Convert.ToString(val);
            }
            return fallback;
        }

        public static bool GetBool(Dictionary<string, object> args, string key)
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

        private static bool IsWorkstationLocked()
        {
            try
            {
                IntPtr hDesk = NativeWin32.OpenInputDesktop(0, false, 0x0001);
                if (hDesk == IntPtr.Zero)
                {
                    return true;
                }
                try
                {
                    byte[] buf = new byte[256];
                    int needed;
                    if (NativeWin32.GetUserObjectInformation(hDesk, NativeWin32.UOI_NAME, buf, buf.Length, out needed) && needed > 2)
                    {
                        string name = Encoding.Unicode.GetString(buf, 0, needed - 2).TrimEnd('\\0');
                        if (string.Equals(name, "Winlogon", StringComparison.OrdinalIgnoreCase))
                        {
                            return true;
                        }
                    }
                    return false;
                }
                finally
                {
                    NativeWin32.CloseDesktop(hDesk);
                }
            }
            catch
            {
                return false;
            }
        }

        private static object ForwardLockedCommandOrThrow(JavaScriptSerializer json, Dictionary<string, object> pipeReq)
        {
            Dictionary<string, object> resp = CallUnlockPipe(json, pipeReq);
            if (resp == null)
            {
                throw new InvalidOperationException(
                    "Kompyuter Win+L bilan qulflangan. Kodni masofadan yozib ochish uchun JarvisPcAgent-Setup.bat ni bir marta Administrator sifatida ishga tushiring (JarvisUnlockService o'rnatiladi)."
                );
            }
            if (resp.ContainsKey("ok") && Convert.ToBoolean(resp["ok"]))
            {
                return GetStr(resp, "data", "OK");
            }
            throw new InvalidOperationException(GetStr(resp, "error", "Winlogon xizmati buyruqni bajara olmadi"));
        }

        private static object ExecuteTool(string tool, Dictionary<string, object> args, JavaScriptSerializer json)
        {
            if (tool == "desktop_screenshot")
            {
                Rectangle bounds = GetScreenBoundsSafe();
                Dictionary<string, object> res = new Dictionary<string, object>();
                res["width"] = bounds.Width;
                res["height"] = bounds.Height;
                res["locked"] = IsWorkstationLocked();
                res["note"] = "Captured live real Windows PC frame (.exe)";
                return res;
            }

            if (tool == "unlock_pc")
            {
                bool sas = GetBool(args, "sas");
                if (sas)
                {
                    Dictionary<string, object> sasReq = new Dictionary<string, object>();
                    sasReq["cmd"] = "sas";
                    return ForwardLockedCommandOrThrow(json, sasReq);
                }

                string pin = GetStr(args, "pin", "");
                bool wake = args.ContainsKey("wake") ? GetBool(args, "wake") : true;
                if (!IsWorkstationLocked())
                {
                    return "Kompyuter allaqachon ochiq (qulflanmagan).";
                }
                Dictionary<string, object> unlockReq = new Dictionary<string, object>();
                unlockReq["cmd"] = "unlock";
                unlockReq["pin"] = pin;
                unlockReq["wake"] = wake;
                return ForwardLockedCommandOrThrow(json, unlockReq);
            }

            if (tool == "desktop_move")
            {
                int x = GetInt(args, "x", 0);
                int y = GetInt(args, "y", 0);
                if (IsWorkstationLocked())
                {
                    Dictionary<string, object> req = new Dictionary<string, object>();
                    req["cmd"] = "move";
                    req["x"] = x;
                    req["y"] = y;
                    return ForwardLockedCommandOrThrow(json, req);
                }
                NativeWin32.SetCursorPos(x, y);
                return "Moved cursor to (" + x + ", " + y + ")";
            }

            if (tool == "desktop_click")
            {
                int x = GetInt(args, "x", 0);
                int y = GetInt(args, "y", 0);
                string btn = GetStr(args, "button", "left");
                if (IsWorkstationLocked())
                {
                    Dictionary<string, object> req = new Dictionary<string, object>();
                    req["cmd"] = "click";
                    req["x"] = x;
                    req["y"] = y;
                    req["button"] = btn;
                    return ForwardLockedCommandOrThrow(json, req);
                }
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
                if (IsWorkstationLocked())
                {
                    return "Ignored scroll on lock screen";
                }
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
                bool enter = GetBool(args, "enter");
                if (IsWorkstationLocked())
                {
                    Dictionary<string, object> req = new Dictionary<string, object>();
                    req["cmd"] = "type";
                    req["text"] = txt;
                    req["enter"] = enter;
                    return ForwardLockedCommandOrThrow(json, req);
                }
                WinlogonInputHelper.TypeUnicodeText(txt);
                if (enter)
                {
                    Thread.Sleep(30);
                    WinlogonInputHelper.PressVirtualKey(0x0D);
                }
                return "Typed " + txt.Length + " chars";
            }

            if (tool == "desktop_key")
            {
                string k = GetStr(args, "key", "Enter");
                if (IsWorkstationLocked())
                {
                    Dictionary<string, object> req = new Dictionary<string, object>();
                    req["cmd"] = "key";
                    req["key"] = k;
                    return ForwardLockedCommandOrThrow(json, req);
                }
                return WinlogonInputHelper.SendKeyOrCombo(k);
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
title JarvisPcAgent.exe — Builder & Win+L Unlock Service Setup

if /I "%~1"=="--install-service-only" goto :install_service

set "TARGET_DIR=%USERPROFILE%\\JarvisAgent"
if not exist "%TARGET_DIR%" mkdir "%TARGET_DIR%"
set "CS_FILE=%TARGET_DIR%\\JarvisPcAgent.cs"
set "EXE_FILE=%TARGET_DIR%\\JarvisPcAgent.exe"

echo [1/4] Yuklab olinmoqda: ${csUrl}
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

echo [2/4] Eski jarayon to'xtatilmoqda va JarvisPcAgent.exe tuzilmoqda...
taskkill /F /IM JarvisPcAgent.exe >nul 2>&1
"%CSC%" /nologo /target:winexe /optimize+ /r:System.Core.dll /r:System.ServiceProcess.dll /r:System.Drawing.dll /r:System.Windows.Forms.dll /r:System.Web.Extensions.dll /out:"%EXE_FILE%" "%CS_FILE%"
if errorlevel 1 (
  echo XATO: .exe kompilyatsiya qilinmadi.
  pause
  exit /b 1
)

echo [3/4] Win+L qulf ekrani xizmati (JarvisUnlockService) o'rnatilmoqda...
net session >nul 2>&1
if errorlevel 1 (
  powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -ArgumentList '--install-service-only','\"%EXE_FILE%\"' -Verb RunAs -Wait" >nul 2>&1
  if errorlevel 1 (
    echo Eslatma: Administrator ruxsati berilmadi. Oddiy rejimda ishga tushirilmoqda.
  )
) else (
  call :do_install_service "%EXE_FILE%"
)

echo [4/4] JarvisPcAgent.exe fonda ishga tushirilmoqda...
start "" "%EXE_FILE%"

echo.
echo TAYYOR! %EXE_FILE% fonda ishlamoqda (konsol oynasisiz).
echo Win+L bosilganda ham jonli qulf ekranini ko'rib, PIN/parol yozib ocha olasiz!
echo Avto-ishga tushishga (Windows Startup) qo'shish uchun:
echo   copy /Y "%EXE_FILE%" "%APPDATA%\\Microsoft\\Windows\\Start Menu\\Programs\\Startup\\"
echo.
timeout /t 4 >nul
exit /b 0

:install_service
call :do_install_service "%~2"
exit /b %errorlevel%

:do_install_service
set "SRC_EXE=%~1"
set "SVC_DIR=%ProgramData%\\JarvisAgent"
if not exist "%SVC_DIR%" mkdir "%SVC_DIR%"
set "SVC_EXE=%SVC_DIR%\\JarvisPcAgent.exe"
sc.exe stop JarvisUnlockService >nul 2>&1
timeout /t 1 >nul
copy /Y "%SRC_EXE%" "%SVC_EXE%" >nul
sc.exe delete JarvisUnlockService >nul 2>&1
timeout /t 1 >nul
sc.exe create JarvisUnlockService binPath= "\\"%SVC_EXE%\\" --service" start= auto obj= LocalSystem DisplayName= "Jarvis Win+L Unlock Service" >nul
sc.exe start JarvisUnlockService >nul 2>&1
reg add "HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Policies\\System" /v SoftwareSASGeneration /t REG_DWORD /d 3 /f >nul 2>&1
exit /b 0
`;
}
