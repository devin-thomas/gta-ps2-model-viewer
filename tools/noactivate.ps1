# Dot-source, then Start-NoActivate instead of Start-Process: the child's first window is shown without activation
# (STARTUPINFO wShowWindow = SW_SHOWNOACTIVATE), so a launch never takes keyboard focus.
#   . "$PSScriptRoot\noactivate.ps1"; $p = Start-NoActivate -Exe $exe -ArgList @("a", "b c") -WorkDir $dir [-NoConsole]
#
# The code is the NoActivate module (https://github.com/uppercut-labs/ps-kit, packages/no-activate), pinned to 0.1.0. Install it
# once on the machine: a folder named NoActivate\0.1.0 holding the module files, under a folder on $env:PSModulePath.
# The module also has -Mute, -Show, Invoke-OnPrivateDesktop, Move-ToDisplay and Wait-Pinned; this viewer only needs Start-NoActivate.
Import-Module NoActivate -RequiredVersion 0.1.0 -ErrorAction Stop
