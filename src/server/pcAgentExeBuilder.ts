export function buildCSharpPcAgentSource(wsUrl: string, token?: string | null): string {
  const finalWsUrl = token ? `${wsUrl}?token=${encodeURIComponent(token)}` : wsUrl;
  const escapedWsUrl = JSON.stringify(finalWsUrl);

  return `// ClaudeWin 10 Pro / J.A.R.V.I.S. — Native Windows Background PC Agent (.NET 4.5+)
// Compiled automatically to JarvisPcAgent.exe via built-in Windows csc.exe (C# 5 compatible)
// Supports LocalSystem Windows Service (--service) -> Console Session SYSTEM Agent (--session-agent)
// so Win+L (Winlogon) Lock Screen streams live and accepts PIN/password unlock without dropping connection.

using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Imaging;
using System.IO;
using System.Net;
using System.Net.WebSockets;
using System.Runtime.InteropServices;
using System.ServiceProcess;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;

namespace JarvisPcAgent
{
    internal static class NativeWin32
    {
        public const uint ES_CONTINUOUS = 0x80000000;
        public const uint ES_SYSTEM_REQUIRED = 0x00000001;

        public const int SM_CXSCREEN = 0;
        public const int SM_CYSCREEN = 1;

        public const int SRCCOPY = 0x00CC0020;
        public const int CAPTUREBLT = 0x40000000;

        public const int UOI_NAME = 2;
        public const uint DESKTOP_READOBJECTS = 0x0001;
        public const uint DESKTOP_CREATEWINDOW = 0x0002;
        public const uint DESKTOP_CREATEMENU = 0x0004;
        public const uint DESKTOP_HOOKCONTROL = 0x0008;
        public const uint DESKTOP_JOURNALRECORD = 0x0010;
        public const uint DESKTOP_JOURNALPLAYBACK = 0x0020;
        public const uint DESKTOP_ENUMERATE = 0x0040;
        public const uint DESKTOP_WRITEOBJECTS = 0x0080;
        public const uint DESKTOP_SWITCHDESKTOP = 0x0100;
        public const uint DESKTOP_ALL_ACCESS =
            DESKTOP_READOBJECTS | DESKTOP_CREATEWINDOW | DESKTOP_CREATEMENU |
            DESKTOP_HOOKCONTROL | DESKTOP_JOURNALRECORD | DESKTOP_JOURNALPLAYBACK |
            DESKTOP_ENUMERATE | DESKTOP_WRITEOBJECTS | DESKTOP_SWITCHDESKTOP;

        public const uint INPUT_MOUSE = 0;
        public const uint INPUT_KEYBOARD = 1;

        public const uint KEYEVENTF_EXTENDEDKEY = 0x0001;
        public const uint KEYEVENTF_KEYUP = 0x0002;
        public const uint KEYEVENTF_UNICODE = 0x0004;
        public const uint KEYEVENTF_SCANCODE = 0x0008;

        public const uint MOUSEEVENTF_LEFTDOWN = 0x0002;
        public const uint MOUSEEVENTF_LEFTUP = 0x0004;
        public const uint MOUSEEVENTF_RIGHTDOWN = 0x0008;
        public const uint MOUSEEVENTF_RIGHTUP = 0x0010;
        public const uint MOUSEEVENTF_WHEEL = 0x0800;

        public const uint TOKEN_ALL_ACCESS = 0x000F01FF;
        public const uint MAXIMUM_ALLOWED = 0x02000000;
        public const int SecurityImpersonation = 2;
        public const int TokenPrimary = 1;
        public const int TokenSessionId = 12;
        public const uint CREATE_NO_WINDOW = 0x08000000;
        public const uint CREATE_UNICODE_ENVIRONMENT = 0x00000400;
        public const int STARTF_USESHOWWINDOW = 0x00000001;
        public const short SW_HIDE = 0;

        [StructLayout(LayoutKind.Sequential)]
        public struct POINT
        {
            public int X;
            public int Y;
        }

        [StructLayout(LayoutKind.Sequential)]
        public struct INPUT
        {
            public uint type;
            public InputUnion U;
        }

        [StructLayout(LayoutKind.Explicit)]
        public struct InputUnion
        {
            [FieldOffset(0)] public MOUSEINPUT mi;
            [FieldOffset(0)] public KEYBDINPUT ki;
            [FieldOffset(0)] public HARDWAREINPUT hi;
        }

        [StructLayout(LayoutKind.Sequential)]
        public struct MOUSEINPUT
        {
            public int dx;
            public int dy;
            public uint mouseData;
            public uint dwFlags;
            public uint time;
            public IntPtr dwExtraInfo;
        }

        [StructLayout(LayoutKind.Sequential)]
        public struct KEYBDINPUT
        {
            public ushort wVk;
            public ushort wScan;
            public uint dwFlags;
            public uint time;
            public IntPtr dwExtraInfo;
        }

        [StructLayout(LayoutKind.Sequential)]
        public struct HARDWAREINPUT
        {
            public uint uMsg;
            public ushort wParamL;
            public ushort wParamH;
        }

        [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
        public struct STARTUPINFO
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
        public struct PROCESS_INFORMATION
        {
            public IntPtr hProcess;
            public IntPtr hThread;
            public int dwProcessId;
            public int dwThreadId;
        }

        [DllImport("user32.dll")]
        public static extern bool SetProcessDPIAware();

        [DllImport("kernel32.dll")]
        public static extern uint SetThreadExecutionState(uint esFlags);

        [DllImport("user32.dll", SetLastError = true)]
        public static extern IntPtr OpenInputDesktop(uint dwFlags, bool fInherit, uint dwDesiredAccess);

        [DllImport("user32.dll", SetLastError = true)]
        public static extern bool SetThreadDesktop(IntPtr hDesktop);

        [DllImport("user32.dll", SetLastError = true)]
        public static extern bool CloseDesktop(IntPtr hDesktop);

        [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        public static extern bool GetUserObjectInformation(IntPtr hObj, int nIndex, byte[] pvInfo, int nLength, out int lpnLengthNeeded);

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
        public static extern bool BitBlt(IntPtr hdcDest, int nXDest, int nYDest, int nWidth, int nHeight, IntPtr hdcSrc, int nXSrc, int nYSrc, int dwRop);

        [DllImport("user32.dll")]
        public static extern bool GetCursorPos(out POINT lpPoint);

        [DllImport("user32.dll")]
        public static extern bool SetCursorPos(int X, int Y);

        [DllImport("user32.dll")]
        public static extern void mouse_event(uint dwFlags, uint dx, uint dy, uint dwData, UIntPtr dwExtraInfo);

        [DllImport("user32.dll", SetLastError = true)]
        public static extern uint SendInput(uint nInputs, INPUT[] pInputs, int cbSize);

        [DllImport("user32.dll")]
        public static extern short VkKeyScan(char ch);

        [DllImport("user32.dll")]
        public static extern uint MapVirtualKey(uint uCode, uint uMapType);

        [DllImport("user32.dll", SetLastError = true)]
        public static extern bool LockWorkStation();

        [DllImport("kernel32.dll")]
        public static extern uint WTSGetActiveConsoleSessionId();

        [DllImport("wtsapi32.dll", SetLastError = true)]
        public static extern bool WTSQueryUserToken(uint SessionId, out IntPtr phToken);

        [DllImport("advapi32.dll", SetLastError = true)]
        public static extern bool ImpersonateLoggedOnUser(IntPtr hToken);

        [DllImport("advapi32.dll", SetLastError = true)]
        public static extern bool RevertToSelf();

        [DllImport("kernel32.dll")]
        public static extern IntPtr GetCurrentProcess();

        [DllImport("kernel32.dll", SetLastError = true)]
        public static extern bool CloseHandle(IntPtr hObject);

        [DllImport("advapi32.dll", SetLastError = true)]
        public static extern bool OpenProcessToken(IntPtr ProcessHandle, uint DesiredAccess, out IntPtr TokenHandle);

        [DllImport("advapi32.dll", SetLastError = true)]
        public static extern bool DuplicateTokenEx(IntPtr hExistingToken, uint dwDesiredAccess, IntPtr lpTokenAttributes, int ImpersonationLevel, int TokenType, out IntPtr phNewToken);

        [DllImport("advapi32.dll", SetLastError = true)]
        public static extern bool SetTokenInformation(IntPtr TokenHandle, int TokenInformationClass, ref uint TokenInformation, int TokenInformationLength);

        [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        public static extern bool CreateProcessAsUser(
            IntPtr hToken,
            string lpApplicationName,
            string lpCommandLine,
            IntPtr lpProcessAttributes,
            IntPtr lpThreadAttributes,
            bool bInheritHandles,
            uint dwCreationFlags,
            IntPtr lpEnvironment,
            string lpCurrentDirectory,
            ref STARTUPINFO lpStartupInfo,
            out PROCESS_INFORMATION lpProcessInformation);
    }

    internal static class DesktopHelper
    {
        public static bool SwitchThreadToInputDesktop(out string desktopName)
        {
            desktopName = "Default";
            IntPtr hDesk = NativeWin32.OpenInputDesktop(0, false, NativeWin32.DESKTOP_ALL_ACCESS);
            if (hDesk == IntPtr.Zero)
            {
                hDesk = NativeWin32.OpenInputDesktop(0, false, NativeWin32.DESKTOP_READOBJECTS | NativeWin32.DESKTOP_WRITEOBJECTS);
            }
            if (hDesk == IntPtr.Zero)
            {
                hDesk = NativeWin32.OpenInputDesktop(0, false, NativeWin32.DESKTOP_READOBJECTS);
            }
            if (hDesk == IntPtr.Zero)
            {
                desktopName = "Winlogon";
                return false;
            }

            try
            {
                byte[] buf = new byte[256];
                int needed = 0;
                if (NativeWin32.GetUserObjectInformation(hDesk, NativeWin32.UOI_NAME, buf, buf.Length, out needed) && needed > 2)
                {
                    string parsed = Encoding.Unicode.GetString(buf, 0, needed).TrimEnd('\\0');
                    if (!string.IsNullOrEmpty(parsed))
                    {
                        desktopName = parsed;
                    }
                }
                return NativeWin32.SetThreadDesktop(hDesk);
            }
            finally
            {
                NativeWin32.CloseDesktop(hDesk);
            }
        }

        public static bool IsLockDesktopName(string desktopName)
        {
            if (string.IsNullOrEmpty(desktopName)) return false;
            return desktopName.Equals("Winlogon", StringComparison.OrdinalIgnoreCase)
                || desktopName.Equals("Screen-saver", StringComparison.OrdinalIgnoreCase);
        }

        public static string LockWorkStationAsActiveUser()
        {
            uint sid = NativeWin32.WTSGetActiveConsoleSessionId();
            IntPtr userToken = IntPtr.Zero;
            if (sid != 0xFFFFFFFF && NativeWin32.WTSQueryUserToken(sid, out userToken))
            {
                try
                {
                    if (NativeWin32.ImpersonateLoggedOnUser(userToken))
                    {
                        try
                        {
                            if (NativeWin32.LockWorkStation())
                            {
                                return "Locked workstation (Win+L)";
                            }
                        }
                        finally
                        {
                            NativeWin32.RevertToSelf();
                        }
                    }

                    NativeWin32.STARTUPINFO si = new NativeWin32.STARTUPINFO();
                    si.cb = Marshal.SizeOf(typeof(NativeWin32.STARTUPINFO));
                    si.lpDesktop = "winsta0\\\\default";
                    si.dwFlags = NativeWin32.STARTF_USESHOWWINDOW;
                    si.wShowWindow = NativeWin32.SW_HIDE;
                    NativeWin32.PROCESS_INFORMATION pi;
                    string cmd = "rundll32.exe user32.dll,LockWorkStation";
                    if (NativeWin32.CreateProcessAsUser(
                        userToken,
                        null,
                        cmd,
                        IntPtr.Zero,
                        IntPtr.Zero,
                        false,
                        NativeWin32.CREATE_NO_WINDOW,
                        IntPtr.Zero,
                        null,
                        ref si,
                        out pi))
                    {
                        if (pi.hThread != IntPtr.Zero) NativeWin32.CloseHandle(pi.hThread);
                        if (pi.hProcess != IntPtr.Zero) NativeWin32.CloseHandle(pi.hProcess);
                        return "Locked workstation via user session (Win+L)";
                    }
                }
                finally
                {
                    NativeWin32.CloseHandle(userToken);
                }
            }

            if (NativeWin32.LockWorkStation())
            {
                return "Locked workstation (Win+L)";
            }
            return "LockWorkStation requested";
        }
    }

    internal sealed class InputWorker
    {
        private sealed class WorkItem
        {
            public Func<object> Action;
            public object Result;
            public Exception Error;
            public ManualResetEvent Done = new ManualResetEvent(false);
        }

        private readonly Queue<WorkItem> _queue = new Queue<WorkItem>();
        private readonly object _sync = new object();
        private readonly Thread _thread;

        public InputWorker()
        {
            _thread = new Thread(RunLoop);
            _thread.IsBackground = true;
            _thread.Start();
        }

        public object Execute(Func<object> action)
        {
            WorkItem item = new WorkItem();
            item.Action = action;
            lock (_sync)
            {
                _queue.Enqueue(item);
                Monitor.Pulse(_sync);
            }
            item.Done.WaitOne();
            item.Done.Close();
            if (item.Error != null)
            {
                throw item.Error;
            }
            return item.Result;
        }

        private void RunLoop()
        {
            while (true)
            {
                WorkItem item;
                lock (_sync)
                {
                    while (_queue.Count == 0)
                    {
                        Monitor.Wait(_sync);
                    }
                    item = _queue.Dequeue();
                }

                try
                {
                    string deskName;
                    DesktopHelper.SwitchThreadToInputDesktop(out deskName);
                    item.Result = item.Action();
                }
                catch (Exception ex)
                {
                    item.Error = ex;
                }
                finally
                {
                    item.Done.Set();
                }
            }
        }

        private static NativeWin32.INPUT MakeKeyInput(ushort vk, ushort scan, uint flags)
        {
            NativeWin32.INPUT input = new NativeWin32.INPUT();
            input.type = NativeWin32.INPUT_KEYBOARD;
            input.U.ki = new NativeWin32.KEYBDINPUT();
            input.U.ki.wVk = vk;
            input.U.ki.wScan = scan;
            input.U.ki.dwFlags = flags;
            input.U.ki.time = 0;
            input.U.ki.dwExtraInfo = IntPtr.Zero;
            return input;
        }

        private static void SendSingleVk(ushort vk, bool extended)
        {
            ushort scan = (ushort)NativeWin32.MapVirtualKey(vk, 0);
            uint downFlags = extended ? NativeWin32.KEYEVENTF_EXTENDEDKEY : 0;
            uint upFlags = NativeWin32.KEYEVENTF_KEYUP | (extended ? NativeWin32.KEYEVENTF_EXTENDEDKEY : 0);
            NativeWin32.INPUT[] inputs = new NativeWin32.INPUT[2];
            inputs[0] = MakeKeyInput(vk, scan, downFlags);
            inputs[1] = MakeKeyInput(vk, scan, upFlags);
            NativeWin32.SendInput((uint)inputs.Length, inputs, Marshal.SizeOf(typeof(NativeWin32.INPUT)));
        }

        private static void SendKeyCombo(ushort modVk, ushort keyVk)
        {
            ushort modScan = (ushort)NativeWin32.MapVirtualKey(modVk, 0);
            ushort keyScan = (ushort)NativeWin32.MapVirtualKey(keyVk, 0);
            NativeWin32.INPUT[] inputs = new NativeWin32.INPUT[4];
            inputs[0] = MakeKeyInput(modVk, modScan, 0);
            inputs[1] = MakeKeyInput(keyVk, keyScan, 0);
            inputs[2] = MakeKeyInput(keyVk, keyScan, NativeWin32.KEYEVENTF_KEYUP);
            inputs[3] = MakeKeyInput(modVk, modScan, NativeWin32.KEYEVENTF_KEYUP);
            NativeWin32.SendInput((uint)inputs.Length, inputs, Marshal.SizeOf(typeof(NativeWin32.INPUT)));
        }

        public static void TypeText(string text, bool enter)
        {
            if (!string.IsNullOrEmpty(text))
            {
                for (int i = 0; i < text.Length; i++)
                {
                    char ch = text[i];
                    if (ch == '\\r') continue;
                    if (ch == '\\n')
                    {
                        SendSingleVk(0x0D, false);
                        Thread.Sleep(8);
                        continue;
                    }

                    short vkScan = NativeWin32.VkKeyScan(ch);
                    int shiftState = (vkScan >> 8) & 0xFF;
                    if (vkScan != -1 && (shiftState == 0 || shiftState == 1))
                    {
                        ushort vk = (ushort)(vkScan & 0xFF);
                        ushort scan = (ushort)NativeWin32.MapVirtualKey(vk, 0);
                        if (shiftState == 1)
                        {
                            ushort shiftScan = (ushort)NativeWin32.MapVirtualKey(0x10, 0);
                            NativeWin32.INPUT[] inputs = new NativeWin32.INPUT[4];
                            inputs[0] = MakeKeyInput(0x10, shiftScan, 0);
                            inputs[1] = MakeKeyInput(vk, scan, 0);
                            inputs[2] = MakeKeyInput(vk, scan, NativeWin32.KEYEVENTF_KEYUP);
                            inputs[3] = MakeKeyInput(0x10, shiftScan, NativeWin32.KEYEVENTF_KEYUP);
                            NativeWin32.SendInput((uint)inputs.Length, inputs, Marshal.SizeOf(typeof(NativeWin32.INPUT)));
                        }
                        else
                        {
                            NativeWin32.INPUT[] inputs = new NativeWin32.INPUT[2];
                            inputs[0] = MakeKeyInput(vk, scan, 0);
                            inputs[1] = MakeKeyInput(vk, scan, NativeWin32.KEYEVENTF_KEYUP);
                            NativeWin32.SendInput((uint)inputs.Length, inputs, Marshal.SizeOf(typeof(NativeWin32.INPUT)));
                        }
                    }
                    else
                    {
                        NativeWin32.INPUT[] inputs = new NativeWin32.INPUT[2];
                        inputs[0] = MakeKeyInput(0, (ushort)ch, NativeWin32.KEYEVENTF_UNICODE);
                        inputs[1] = MakeKeyInput(0, (ushort)ch, NativeWin32.KEYEVENTF_UNICODE | NativeWin32.KEYEVENTF_KEYUP);
                        NativeWin32.SendInput((uint)inputs.Length, inputs, Marshal.SizeOf(typeof(NativeWin32.INPUT)));
                    }

                    Thread.Sleep(8);
                }
            }

            if (enter)
            {
                Thread.Sleep(15);
                SendSingleVk(0x0D, false);
            }
        }

        public static string SendKeyName(string key)
        {
            string k = string.IsNullOrEmpty(key) ? "Enter" : key;
            if (k.Equals("Win+L", StringComparison.OrdinalIgnoreCase))
            {
                return DesktopHelper.LockWorkStationAsActiveUser();
            }
            if (k == "Enter" || k == "Return") { SendSingleVk(0x0D, false); return "Sent key " + k; }
            if (k == "Space" || k == " ") { SendSingleVk(0x20, false); return "Sent key " + k; }
            if (k == "Tab") { SendSingleVk(0x09, false); return "Sent key " + k; }
            if (k == "Escape") { SendSingleVk(0x1B, false); return "Sent key " + k; }
            if (k == "Backspace") { SendSingleVk(0x08, false); return "Sent key " + k; }
            if (k == "Delete") { SendSingleVk(0x2E, true); return "Sent key " + k; }
            if (k == "Home") { SendSingleVk(0x24, true); return "Sent key " + k; }
            if (k == "End") { SendSingleVk(0x23, true); return "Sent key " + k; }
            if (k == "PageUp") { SendSingleVk(0x21, true); return "Sent key " + k; }
            if (k == "PageDown") { SendSingleVk(0x22, true); return "Sent key " + k; }
            if (k == "ArrowLeft") { SendSingleVk(0x25, true); return "Sent key " + k; }
            if (k == "ArrowUp") { SendSingleVk(0x26, true); return "Sent key " + k; }
            if (k == "ArrowRight") { SendSingleVk(0x27, true); return "Sent key " + k; }
            if (k == "ArrowDown") { SendSingleVk(0x28, true); return "Sent key " + k; }
            if (k == "Win") { SendSingleVk(0x5B, true); return "Sent key " + k; }
            if (k.Equals("Ctrl+S", StringComparison.OrdinalIgnoreCase)) { SendKeyCombo(0x11, 0x53); return "Sent key " + k; }
            if (k.Equals("Ctrl+C", StringComparison.OrdinalIgnoreCase)) { SendKeyCombo(0x11, 0x43); return "Sent key " + k; }
            if (k.Equals("Ctrl+V", StringComparison.OrdinalIgnoreCase)) { SendKeyCombo(0x11, 0x56); return "Sent key " + k; }
            if (k.Equals("Ctrl+A", StringComparison.OrdinalIgnoreCase)) { SendKeyCombo(0x11, 0x41); return "Sent key " + k; }
            if (k.Equals("Alt+F4", StringComparison.OrdinalIgnoreCase)) { SendKeyCombo(0x12, 0x73); return "Sent key " + k; }

            if (k.Length == 1)
            {
                TypeText(k, false);
                return "Sent key " + k;
            }
            SendSingleVk(0x0D, false);
            return "Sent key " + k;
        }
    }

    internal sealed class AgentWindowsService : ServiceBase
    {
        private Thread _supervisorThread;
        private volatile bool _stopping;
        private Process _childProcess;
        private uint _childSessionId = 0xFFFFFFFF;
        private EventWaitHandle _shutdownEvent;

        public AgentWindowsService()
        {
            ServiceName = "JarvisPcAgentService";
        }

        protected override void OnStart(string[] args)
        {
            _stopping = false;
            try
            {
                _shutdownEvent = new EventWaitHandle(false, EventResetMode.ManualReset, "Global\\\\JarvisPcAgentShutdownEvent");
                _shutdownEvent.Reset();
            }
            catch
            {
                _shutdownEvent = null;
            }
            _supervisorThread = new Thread(SupervisorLoop);
            _supervisorThread.IsBackground = true;
            _supervisorThread.Start();
        }

        protected override void OnStop()
        {
            _stopping = true;
            KillChildProcess();
            if (_shutdownEvent != null)
            {
                try { _shutdownEvent.Close(); } catch { }
                _shutdownEvent = null;
            }
        }

        private void KillChildProcess()
        {
            try
            {
                if (_childProcess != null && !_childProcess.HasExited)
                {
                    _childProcess.Kill();
                }
            }
            catch
            {
            }
            _childProcess = null;
            _childSessionId = 0xFFFFFFFF;
        }

        private void SupervisorLoop()
        {
            string exePath = Process.GetCurrentProcess().MainModule.FileName;
            string workDir = Path.GetDirectoryName(exePath);

            while (!_stopping)
            {
                if (_shutdownEvent != null)
                {
                    try
                    {
                        if (_shutdownEvent.WaitOne(0))
                        {
                            _stopping = true;
                            KillChildProcess();
                            try { Stop(); } catch { }
                            break;
                        }
                    }
                    catch
                    {
                    }
                }
                try
                {
                    uint activeSid = NativeWin32.WTSGetActiveConsoleSessionId();
                    bool needsRestart = false;

                    if (_childProcess == null)
                    {
                        needsRestart = true;
                    }
                    else
                    {
                        try
                        {
                            if (_childProcess.HasExited || _childSessionId != activeSid)
                            {
                                needsRestart = true;
                            }
                        }
                        catch
                        {
                            needsRestart = true;
                        }
                    }

                    if (needsRestart && activeSid != 0xFFFFFFFF)
                    {
                        KillChildProcess();
                        SpawnSessionAgent(exePath, workDir, activeSid);
                    }
                }
                catch
                {
                }

                Thread.Sleep(1000);
            }
        }

        private void SpawnSessionAgent(string exePath, string workDir, uint sessionId)
        {
            IntPtr hToken = IntPtr.Zero;
            IntPtr hDupToken = IntPtr.Zero;
            try
            {
                if (!NativeWin32.OpenProcessToken(NativeWin32.GetCurrentProcess(), NativeWin32.TOKEN_ALL_ACCESS, out hToken))
                {
                    return;
                }
                if (!NativeWin32.DuplicateTokenEx(
                    hToken,
                    NativeWin32.MAXIMUM_ALLOWED,
                    IntPtr.Zero,
                    NativeWin32.SecurityImpersonation,
                    NativeWin32.TokenPrimary,
                    out hDupToken))
                {
                    return;
                }
                uint sid = sessionId;
                if (!NativeWin32.SetTokenInformation(hDupToken, NativeWin32.TokenSessionId, ref sid, sizeof(uint)))
                {
                    return;
                }

                NativeWin32.STARTUPINFO si = new NativeWin32.STARTUPINFO();
                si.cb = Marshal.SizeOf(typeof(NativeWin32.STARTUPINFO));
                si.lpDesktop = "winsta0\\\\default";
                si.dwFlags = NativeWin32.STARTF_USESHOWWINDOW;
                si.wShowWindow = NativeWin32.SW_HIDE;

                NativeWin32.PROCESS_INFORMATION pi;
                string cmdLine = "\\"" + exePath + "\\" --session-agent";
                if (NativeWin32.CreateProcessAsUser(
                    hDupToken,
                    exePath,
                    cmdLine,
                    IntPtr.Zero,
                    IntPtr.Zero,
                    false,
                    NativeWin32.CREATE_NO_WINDOW | NativeWin32.CREATE_UNICODE_ENVIRONMENT,
                    IntPtr.Zero,
                    workDir,
                    ref si,
                    out pi))
                {
                    if (pi.hThread != IntPtr.Zero) NativeWin32.CloseHandle(pi.hThread);
                    if (pi.hProcess != IntPtr.Zero) NativeWin32.CloseHandle(pi.hProcess);
                    _childSessionId = sessionId;
                    try
                    {
                        _childProcess = Process.GetProcessById(pi.dwProcessId);
                    }
                    catch
                    {
                        _childProcess = null;
                    }
                }
            }
            finally
            {
                if (hDupToken != IntPtr.Zero) NativeWin32.CloseHandle(hDupToken);
                if (hToken != IntPtr.Zero) NativeWin32.CloseHandle(hToken);
            }
        }
    }

    internal static class Program
    {
        private static readonly string WsUri = ${escapedWsUrl};
        private static readonly SemaphoreSlim SendLock = new SemaphoreSlim(1, 1);
        private static readonly InputWorker Input = new InputWorker();
        private static Mutex _singleInstanceMutex;
        private static volatile bool _shutdownRequested = false;

        private static void RequestPermanentShutdown()
        {
            _shutdownRequested = true;
            try
            {
                EventWaitHandle ev = EventWaitHandle.OpenExisting("Global\\\\JarvisPcAgentShutdownEvent");
                ev.Set();
                ev.Close();
            }
            catch
            {
            }
            try
            {
                ServiceController sc = new ServiceController("JarvisPcAgentService");
                if (sc.Status == ServiceControllerStatus.Running || sc.Status == ServiceControllerStatus.StartPending)
                {
                    sc.Stop();
                }
                sc.Close();
            }
            catch
            {
            }
        }

        private static void Main(string[] args)
        {
            bool isService = false;
            bool isSessionAgent = false;
            if (args != null)
            {
                for (int i = 0; i < args.Length; i++)
                {
                    if (string.Equals(args[i], "--service", StringComparison.OrdinalIgnoreCase)) isService = true;
                    if (string.Equals(args[i], "--session-agent", StringComparison.OrdinalIgnoreCase)) isSessionAgent = true;
                }
            }

            if (isService)
            {
                bool svcNew;
                _singleInstanceMutex = new Mutex(true, "Global\\\\JarvisPcAgentServiceMutex", out svcNew);
                if (!svcNew) return;
                ServiceBase.Run(new AgentWindowsService());
                return;
            }

            bool createdNew;
            string mutexName = isSessionAgent ? "Global\\\\JarvisPcAgentSessionMutex" : "Local\\\\JarvisPcAgentSingleInstance";
            _singleInstanceMutex = new Mutex(true, mutexName, out createdNew);
            if (!createdNew)
            {
                try
                {
                    if (!_singleInstanceMutex.WaitOne(2500))
                    {
                        return;
                    }
                }
                catch
                {
                    return;
                }
            }

            try
            {
                NativeWin32.SetProcessDPIAware();
            }
            catch
            {
            }

            try
            {
                NativeWin32.SetThreadExecutionState(NativeWin32.ES_CONTINUOUS | NativeWin32.ES_SYSTEM_REQUIRED);
            }
            catch
            {
            }

            ServicePointManager.SecurityProtocol = (SecurityProtocolType)3072;

            int backoffMs = 500;
            while (true)
            {
                if (_shutdownRequested) break;
                try
                {
                    NativeWin32.SetThreadExecutionState(NativeWin32.ES_CONTINUOUS | NativeWin32.ES_SYSTEM_REQUIRED);
                    bool connected = RunSessionLoop();
                    if (_shutdownRequested) break;
                    if (connected)
                    {
                        backoffMs = 500;
                    }
                }
                catch
                {
                }
                if (_shutdownRequested) break;
                Thread.Sleep(backoffMs);
                backoffMs = Math.Min(3000, backoffMs * 2);
            }
        }

        private static bool RunSessionLoop()
        {
            bool established = false;
            using (ClientWebSocket ws = new ClientWebSocket())
            {
                ws.Options.KeepAliveInterval = TimeSpan.FromSeconds(8);
                CancellationTokenSource cts = new CancellationTokenSource();
                ws.ConnectAsync(new Uri(WsUri), cts.Token).GetAwaiter().GetResult();

                JavaScriptSerializer json = new JavaScriptSerializer();
                json.MaxJsonLength = 32 * 1024 * 1024;

                Size screenSize = GetScreenSizeSafe();
                Dictionary<string, object> hello = new Dictionary<string, object>();
                hello["type"] = "agent:hello";
                hello["hostname"] = Environment.MachineName;
                hello["osVersion"] = Environment.OSVersion.VersionString;
                hello["username"] = Environment.UserName;
                hello["screenWidth"] = screenSize.Width;
                hello["screenHeight"] = screenSize.Height;
                SendText(ws, json.Serialize(hello), cts.Token);
                established = true;

                Thread frameThread = new Thread(delegate()
                {
                    byte[] prevJpeg = null;
                    bool prevLocked = false;
                    long lastSentMs = 0;
                    while (!cts.IsCancellationRequested && ws.State == WebSocketState.Open)
                    {
                        try
                        {
                            NativeWin32.SetThreadExecutionState(NativeWin32.ES_CONTINUOUS | NativeWin32.ES_SYSTEM_REQUIRED);
                            int fw;
                            int fh;
                            int sw;
                            int sh;
                            bool isLocked;
                            string desktopName;
                            byte[] jpegBytes = CaptureDesktopJpeg(out fw, out fh, out sw, out sh, out isLocked, out desktopName);
                            long nowMs = (long)(DateTime.UtcNow - new DateTime(1970, 1, 1)).TotalMilliseconds;
                            bool changed = prevJpeg == null || isLocked != prevLocked || (nowMs - lastSentMs) >= 1800 || !BytesEqual(prevJpeg, jpegBytes);
                            if (changed)
                            {
                                string payload = BuildFrameJsonFromBytes(json, jpegBytes, fw, fh, sw, sh, isLocked, desktopName, nowMs);
                                SendText(ws, payload, cts.Token);
                                prevJpeg = jpegBytes;
                                prevLocked = isLocked;
                                lastSentMs = nowMs;
                            }
                        }
                        catch
                        {
                            try { cts.Cancel(); } catch { }
                            break;
                        }
                        Thread.Sleep(65);
                    }
                });
                frameThread.IsBackground = true;
                frameThread.Start();

                byte[] buffer = new byte[65536];
                while (!cts.IsCancellationRequested && ws.State == WebSocketState.Open)
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
                                return established;
                            }
                            if (res.Count > 0)
                            {
                                ms.Write(buffer, 0, res.Count);
                            }
                        }
                        while (!res.EndOfMessage);

                        string rawMsg = Encoding.UTF8.GetString(ms.ToArray());
                        HandleIncomingMessage(ws, json, rawMsg, cts);
                    }
                }

                cts.Cancel();
            }
            return established;
        }

        private static void HandleIncomingMessage(ClientWebSocket ws, JavaScriptSerializer json, string rawMsg, CancellationTokenSource cts)
        {
            Dictionary<string, object> msg = json.Deserialize<Dictionary<string, object>>(rawMsg);
            if (msg == null) return;
            object typeObj;
            if (!msg.TryGetValue("type", out typeObj)) return;
            string msgType = Convert.ToString(typeObj);
            if (msgType == "agent:shutdown")
            {
                RequestPermanentShutdown();
                try { cts.Cancel(); } catch { }
                return;
            }
            if (msgType != "cmd:exec") return;

            string reqId = msg.ContainsKey("requestId") ? Convert.ToString(msg["requestId"]) : "";
            string tool = msg.ContainsKey("tool") ? Convert.ToString(msg["tool"]) : "";
            Dictionary<string, object> args = new Dictionary<string, object>();
            if (msg.ContainsKey("args") && msg["args"] is Dictionary<string, object>)
            {
                args = (Dictionary<string, object>)msg["args"];
            }

            if (tool == "agent_disconnect")
            {
                Dictionary<string, object> bye = new Dictionary<string, object>();
                bye["type"] = "agent:result";
                bye["requestId"] = reqId;
                bye["ok"] = true;
                bye["data"] = "Disconnected PC agent";
                try
                {
                    SendText(ws, json.Serialize(bye), cts.Token);
                }
                catch
                {
                }
                RequestPermanentShutdown();
                try { cts.Cancel(); } catch { }
                try { ws.CloseOutputAsync(WebSocketCloseStatus.NormalClosure, "Disconnected by user", CancellationToken.None).GetAwaiter().GetResult(); } catch { }
                Environment.Exit(0);
                return;
            }

            CancellationToken token = cts.Token;
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

        private static Size GetScreenSizeSafe()
        {
            int w = NativeWin32.GetSystemMetrics(NativeWin32.SM_CXSCREEN);
            int h = NativeWin32.GetSystemMetrics(NativeWin32.SM_CYSCREEN);
            if (w <= 0) w = 1280;
            if (h <= 0) h = 720;
            return new Size(w, h);
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

        private static bool BytesEqual(byte[] a, byte[] b)
        {
            if (a == null || b == null || a.Length != b.Length) return false;
            for (int i = 0; i < a.Length; i++)
            {
                if (a[i] != b[i]) return false;
            }
            return true;
        }

        private static byte[] CaptureDesktopJpeg(out int w, out int h, out int screenW, out int screenH, out bool isLocked, out string desktopName)
        {
            bool switched = DesktopHelper.SwitchThreadToInputDesktop(out desktopName);
            isLocked = DesktopHelper.IsLockDesktopName(desktopName);
            Size sz = GetScreenSizeSafe();
            screenW = sz.Width;
            screenH = sz.Height;
            w = sz.Width;
            h = sz.Height;

            if (switched)
            {
                IntPtr hdcScreen = IntPtr.Zero;
                IntPtr hdcMem = IntPtr.Zero;
                IntPtr hBmp = IntPtr.Zero;
                IntPtr hOld = IntPtr.Zero;
                try
                {
                    hdcScreen = NativeWin32.GetDC(IntPtr.Zero);
                    if (hdcScreen != IntPtr.Zero)
                    {
                        hdcMem = NativeWin32.CreateCompatibleDC(hdcScreen);
                        hBmp = NativeWin32.CreateCompatibleBitmap(hdcScreen, w, h);
                        if (hdcMem != IntPtr.Zero && hBmp != IntPtr.Zero)
                        {
                            hOld = NativeWin32.SelectObject(hdcMem, hBmp);
                            bool bltOk = NativeWin32.BitBlt(hdcMem, 0, 0, w, h, hdcScreen, 0, 0, NativeWin32.SRCCOPY | NativeWin32.CAPTUREBLT);
                            NativeWin32.SelectObject(hdcMem, hOld);
                            hOld = IntPtr.Zero;
                            if (bltOk)
                            {
                                using (Bitmap bmp = Image.FromHbitmap(hBmp))
                                {
                                    if (w > 1280)
                                    {
                                        int targetW = 1280;
                                        int targetH = (int)((long)h * 1280 / w);
                                        using (Bitmap scaled = new Bitmap(targetW, targetH))
                                        using (Graphics g = Graphics.FromImage(scaled))
                                        {
                                            g.InterpolationMode = System.Drawing.Drawing2D.InterpolationMode.Bilinear;
                                            g.DrawImage(bmp, 0, 0, targetW, targetH);
                                            w = targetW;
                                            h = targetH;
                                            return EncodeJpeg(scaled, 48L);
                                        }
                                    }
                                    return EncodeJpeg(bmp, 50L);
                                }
                            }
                        }
                    }
                }
                catch
                {
                }
                finally
                {
                    if (hOld != IntPtr.Zero && hdcMem != IntPtr.Zero) NativeWin32.SelectObject(hdcMem, hOld);
                    if (hBmp != IntPtr.Zero) NativeWin32.DeleteObject(hBmp);
                    if (hdcMem != IntPtr.Zero) NativeWin32.DeleteDC(hdcMem);
                    if (hdcScreen != IntPtr.Zero) NativeWin32.ReleaseDC(IntPtr.Zero, hdcScreen);
                }
            }

            isLocked = true;
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
                g.DrawString("PC QULFLANGAN (Win+L)", titleFont, accent, 60, 190);
                g.DrawString("Aloqa faol. Jonli Winlogon ekrani va PIN/parol kiritish uchun", subFont, fg, 60, 242);
                g.DrawString("JarvisPcAgent-Setup.bat ni Administrator (Servis) sifatida o'rnating.", subFont, fg, 60, 274);
                return EncodeJpeg(lockedBmp, 55L);
            }
        }

        private static string BuildFrameJsonFromBytes(
            JavaScriptSerializer json,
            byte[] jpegBytes,
            int w,
            int h,
            int screenW,
            int screenH,
            bool isLocked,
            string desktopName,
            long ts)
        {
            NativeWin32.POINT cursor = new NativeWin32.POINT();
            try
            {
                NativeWin32.GetCursorPos(out cursor);
            }
            catch
            {
            }

            Dictionary<string, object> frame = new Dictionary<string, object>();
            frame["type"] = "agent:frame";
            frame["mimeType"] = "image/jpeg";
            frame["width"] = w;
            frame["height"] = h;
            frame["screenWidth"] = screenW;
            frame["screenHeight"] = screenH;
            frame["data"] = Convert.ToBase64String(jpegBytes);
            frame["cursorX"] = cursor.X;
            frame["cursorY"] = cursor.Y;
            frame["timestamp"] = ts;
            frame["locked"] = isLocked;
            frame["desktopName"] = desktopName;
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

        private static object ExecuteTool(string tool, Dictionary<string, object> args, JavaScriptSerializer json)
        {
            if (tool == "desktop_screenshot")
            {
                Size sz = GetScreenSizeSafe();
                Dictionary<string, object> res = new Dictionary<string, object>();
                res["width"] = sz.Width;
                res["height"] = sz.Height;
                res["note"] = "Captured live real Windows PC frame (.exe)";
                return res;
            }

            if (tool == "desktop_move")
            {
                int x = GetInt(args, "x", 0);
                int y = GetInt(args, "y", 0);
                return Input.Execute(delegate
                {
                    NativeWin32.SetCursorPos(x, y);
                    return "Moved cursor to (" + x + ", " + y + ")";
                });
            }

            if (tool == "desktop_click")
            {
                int x = GetInt(args, "x", 0);
                int y = GetInt(args, "y", 0);
                string btn = GetStr(args, "button", "left");
                return Input.Execute(delegate
                {
                    NativeWin32.SetCursorPos(x, y);
                    Thread.Sleep(35);
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
                });
            }

            if (tool == "desktop_scroll")
            {
                int x = GetInt(args, "x", 640);
                int y = GetInt(args, "y", 360);
                int clicks = GetInt(args, "clicks", 3);
                string dir = GetStr(args, "direction", "down");
                int delta = (dir == "up") ? (120 * clicks) : (-120 * clicks);
                return Input.Execute(delegate
                {
                    NativeWin32.SetCursorPos(x, y);
                    NativeWin32.mouse_event(NativeWin32.MOUSEEVENTF_WHEEL, 0, 0, unchecked((uint)delta), UIntPtr.Zero);
                    return "Scrolled " + dir + " at (" + x + ", " + y + ")";
                });
            }

            if (tool == "desktop_type")
            {
                string txt = GetStr(args, "text", "");
                bool enter = GetBool(args, "enter");
                return Input.Execute(delegate
                {
                    InputWorker.TypeText(txt, enter);
                    return "Typed " + txt.Length + " chars";
                });
            }

            if (tool == "desktop_key")
            {
                string k = GetStr(args, "key", "Enter");
                return Input.Execute(delegate
                {
                    return InputWorker.SendKeyName(k);
                });
            }

            if (tool == "unlock_pc")
            {
                string pin = GetStr(args, "pin", "");
                bool wake = !args.ContainsKey("wake") || GetBool(args, "wake");
                return Input.Execute(delegate
                {
                    if (wake)
                    {
                        InputWorker.SendKeyName("Space");
                        Thread.Sleep(300);
                        InputWorker.SendKeyName("Escape");
                        Thread.Sleep(200);
                    }
                    if (!string.IsNullOrEmpty(pin))
                    {
                        InputWorker.TypeText(pin, true);
                        return "Unlocked PC with PIN/password (" + pin.Length + " chars)";
                    }
                    return "Woke up PC lock screen";
                });
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
title JarvisPcAgent.exe — Builder & Win+L Service Installer

if "%~1"=="--install-svc" goto :INSTALL_SVC

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
"%CSC%" /nologo /target:winexe /optimize+ /r:System.Drawing.dll /r:System.Windows.Forms.dll /r:System.Web.Extensions.dll /r:System.ServiceProcess.dll /out:"%EXE_FILE%" "%CS_FILE%"
if errorlevel 1 (
  echo XATO: .exe kompilyatsiya qilinmadi.
  pause
  exit /b 1
)

echo [3/3] Win+L qulf ekrani uchun LocalSystem servisi o'rnatilmoqda...
net session >nul 2>&1
if errorlevel 1 (
  powershell -NoProfile -Command "try { Start-Process -FilePath '%~f0' -ArgumentList '--install-svc', ('\"' + $env:EXE_FILE + '\"') -Verb RunAs -Wait } catch { exit 1 }"
) else (
  call :DO_INSTALL_SVC "%EXE_FILE%"
)

sc query JarvisPcAgentService 2>nul | findstr /I "RUNNING" >nul
if not errorlevel 1 (
  echo.
  echo TAYYOR! JarvisPcAgentService ^(LocalSystem^) fonda ishlamoqda.
  echo Win+L bosilganda ham aloqa uzilmaydi, qulf ekrani ko'rinadi va PIN/parol bilan ochish ishlaydi.
  timeout /t 4 >nul
  exit /b 0
)

echo Servis o'rnatilmadi (UAC rad etildi). Oddiy foydalanuvchi rejimida ishga tushirilmoqda...
start "" "%EXE_FILE%"
echo TAYYOR! %EXE_FILE% fonda ishlamoqda.
timeout /t 4 >nul
exit /b 0

:INSTALL_SVC
call :DO_INSTALL_SVC "%~2"
exit /b 0

:DO_INSTALL_SVC
set "SRC_EXE=%~1"
set "SVC_DIR=%ProgramData%\\JarvisAgent"
if not exist "%SVC_DIR%" mkdir "%SVC_DIR%"
set "SVC_EXE=%SVC_DIR%\\JarvisPcAgent.exe"
sc stop JarvisPcAgentService >nul 2>&1
timeout /t 1 >nul
taskkill /F /IM JarvisPcAgent.exe >nul 2>&1
copy /Y "%SRC_EXE%" "%SVC_EXE%" >nul
sc delete JarvisPcAgentService >nul 2>&1
timeout /t 1 >nul
sc create JarvisPcAgentService binPath= "\\"%SVC_EXE%\\" --service" start= auto DisplayName= "Jarvis PC Live Agent" >nul
sc description JarvisPcAgentService "Jarvis Real PC Live Stream and Win+L Lock Screen Bridge" >nul
sc failure JarvisPcAgentService reset= 60 actions= restart/2000/restart/2000/restart/5000 >nul
sc start JarvisPcAgentService >nul
exit /b 0
`;
}
