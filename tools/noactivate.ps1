# Dot-source, then Start-NoActivate instead of Start-Process: the child's first window is shown without activation
# (STARTUPINFO wShowWindow = SW_SHOWNOACTIVATE), so a launch never takes keyboard focus from Devin.
# SDL apps get their own no-activate hints, because SDL picks its own ShowWindow command.
#   . "$PSScriptRoot\noactivate.ps1"; $p = Start-NoActivate -Exe $exe -ArgList @("a", "b c") -WorkDir $dir [-NoConsole]
# Show flags aren't airtight: 3SX still took focus 1 time in 27 with SW_SHOWMINNOACTIVE. For launch loops, also make the window
# unfocusable in the app itself (our 3SX probe build: SDL_WINDOW_NOT_FOCUSABLE, see games/3sx/quiet.py;
# not SDL_WINDOW_HIDDEN, which made each 3SX exit take minutes in the GL driver).
# Headless console tools (gsrunner, mame -video none) take -NoConsole so no console window opens either.
if (-not ("NoAct" -as [type])) {
Add-Type @"
using System; using System.Runtime.InteropServices;
public static class NoAct {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)] public struct SI {
    public int cb; public string r, desk, title; public int x, y, xs, ys, xc, yc, fill, flags; public short show, r2;
    public IntPtr r3, hin, hout, herr; }
  [StructLayout(LayoutKind.Sequential)] public struct PI { public IntPtr hp, ht; public int pid, tid; }
  [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
  static extern bool CreateProcessW(string app, System.Text.StringBuilder cmd, IntPtr pa, IntPtr ta, bool inh,
    uint flags, IntPtr env, string dir, ref SI si, out PI pi);
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr h);
  public static int Start(string exe, string cmd, string dir, uint flags) {
    var si = new SI(); si.cb = Marshal.SizeOf(si); si.flags = 0x1; si.show = 4;  // STARTF_USESHOWWINDOW, SW_SHOWNOACTIVATE
    PI pi;
    if (!CreateProcessW(exe, new System.Text.StringBuilder(cmd), IntPtr.Zero, IntPtr.Zero, false, flags, IntPtr.Zero, dir, ref si, out pi))
      throw new System.ComponentModel.Win32Exception();
    CloseHandle(pi.ht); CloseHandle(pi.hp); return pi.pid;
  }
}
"@
}
function Start-NoActivate([Parameter(Mandatory)][string]$Exe, [string[]]$ArgList = @(), [string]$WorkDir, [switch]$NoConsole) {
  $env:SDL_WINDOW_ACTIVATE_WHEN_SHOWN = "0"        # SDL3
  $env:SDL_WINDOW_ACTIVATE_WHEN_RAISED = "0"       # SDL3
  $env:SDL_WINDOW_NO_ACTIVATION_WHEN_SHOWN = "1"   # SDL2
  if (-not $WorkDir) { $WorkDir = Split-Path $Exe }
  $cmd = (@($Exe) + $ArgList | ForEach-Object { '"' + $_ + '"' }) -join ' '
  $flags = if ($NoConsole) { 0x08000000 } else { 0 }   # CREATE_NO_WINDOW: a console tool gets no console window at all
  [System.Diagnostics.Process]::GetProcessById([NoAct]::Start($Exe, $cmd, $WorkDir, $flags))
}
