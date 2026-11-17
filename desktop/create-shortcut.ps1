# Creates a "Jelly Ocean" shortcut on the desktop (and in the Start menu).
# It opens the ocean in its own window (Microsoft Edge app mode: no tabs, no address bar).
# If Edge is not found, the shortcut opens the page in the default browser instead.
# Run it from the folder that contains index.html and JellyOcean.ico.

$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$html = Join-Path $here 'index.html'
$icon = Join-Path $here 'JellyOcean.ico'
if (-not (Test-Path $html)) { throw "index.html not found next to this script ($here)" }
$url = ([System.Uri]$html).AbsoluteUri

# find Microsoft Edge (ships with Windows 10 / 11)
$edge = $null
try { $edge = (Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\msedge.exe' -ErrorAction Stop).'(default)' } catch {}
if (-not $edge -or -not (Test-Path $edge)) {
  foreach ($p in @("${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe", "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe", "$env:LOCALAPPDATA\Microsoft\Edge\Application\msedge.exe")) {
    if ($p -and (Test-Path $p)) { $edge = $p; break }
  }
}

$shell = New-Object -ComObject WScript.Shell
$targets = @(
  (Join-Path ([Environment]::GetFolderPath('Desktop')) 'Jelly Ocean.lnk'),
  (Join-Path ([Environment]::GetFolderPath('Programs')) 'Jelly Ocean.lnk')
)
foreach ($lnkPath in $targets) {
  $lnk = $shell.CreateShortcut($lnkPath)
  if ($edge) {
    $lnk.TargetPath = $edge
    $lnk.Arguments = "--app=`"$url`" --window-size=1600,900"
  } else {
    $lnk.TargetPath = $html
    $lnk.Arguments = ''
  }
  $lnk.WorkingDirectory = $here
  if (Test-Path $icon) { $lnk.IconLocation = "$icon,0" }
  $lnk.Description = 'Jelly Ocean Diorama - a living miniature ocean'
  $lnk.Save()
}

if ($edge) { Write-Host "Shortcut created: Jelly Ocean (opens in its own window)." }
else { Write-Host "Shortcut created: Jelly Ocean (Edge not found - opens in your default browser)." }
Write-Host "Desktop: $($targets[0])"
