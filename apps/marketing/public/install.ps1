# K-code installer for Windows (PowerShell 5.1+ or PowerShell 7).
#
#   irm https://kcode.agentbox.io.vn/install.ps1 | iex                                   # headless server + `kcode` CLI
#   & ([scriptblock]::Create((irm https://kcode.agentbox.io.vn/install.ps1))) -Desktop   # desktop app
#
# Options (when run as a script or scriptblock):
#   -Desktop           download and run the desktop installer (K-code-windows-x64-setup.exe)
#   -Version <x.y.z>   install a specific release instead of the latest
#   -InstallDir <dir>  where the server is unpacked (default: %LOCALAPPDATA%\kcode\server)
#   -Silent            run the desktop installer without UI
#   -DryRun            download and verify, but change nothing on this machine
#
# Environment (for `irm | iex`, which cannot take parameters):
#   KCODE_DESKTOP=1, KCODE_VERSION, KCODE_INSTALL_DIR, KCODE_DRY_RUN=1
#   KCODE_DOWNLOAD_BASE  where assets are fetched from (default:
#                        https://github.com/zt-hky/k-code/releases/latest/download).
#                        A plain directory path or file:// URL works for local mirrors.
#
# Re-running is safe: an install whose archive checksum already matches is left
# as is, and a different release replaces the old one.
[CmdletBinding()]
param(
  [switch]$Desktop,
  [string]$Version,
  [string]$InstallDir,
  [switch]$Silent,
  [switch]$DryRun
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
try { [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12 } catch {}

$repo = 'zt-hky/k-code'
if ($env:KCODE_DESKTOP -eq '1') { $Desktop = $true }
if (-not $Version) { $Version = $env:KCODE_VERSION }
if (-not $InstallDir) { $InstallDir = $env:KCODE_INSTALL_DIR }
if ($env:KCODE_DRY_RUN -eq '1') { $DryRun = $true }
if ($Version) { $Version = $Version.TrimStart('v') }

if ($env:KCODE_DOWNLOAD_BASE) {
  $base = $env:KCODE_DOWNLOAD_BASE.TrimEnd('/', '\')
} elseif ($Version) {
  $base = "https://github.com/$repo/releases/download/v$Version"
} else {
  $base = "https://github.com/$repo/releases/latest/download"
}

function Fail([string]$Message) {
  throw "kcode install: $Message"
}

function Step([string]$Message) {
  Write-Host "  $Message" -ForegroundColor DarkGray
}

# Windows on ARM runs the x64 builds under emulation.
if (-not [Environment]::Is64BitOperatingSystem) { Fail 'a 64-bit version of Windows is required' }

function Get-Asset([string]$Name, [string]$Destination) {
  if ($base -match '^file://') {
    $source = ([Uri]$base).LocalPath
    Copy-Item -LiteralPath (Join-Path $source $Name) -Destination $Destination -Force
  } elseif ($base -match '^[A-Za-z]:\\' -or $base.StartsWith('\\') -or $base.StartsWith('/')) {
    Copy-Item -LiteralPath (Join-Path $base $Name) -Destination $Destination -Force
  } else {
    Invoke-WebRequest -UseBasicParsing -Uri "$base/$Name" -OutFile $Destination
  }
}

# Downloads $Asset into $Tmp, checks it against SHA256SUMS.txt, returns its hash.
function Get-VerifiedAsset([string]$Asset, [string]$Tmp) {
  Step 'Fetching checksums...'
  $sums = Join-Path $Tmp 'SHA256SUMS.txt'
  try { Get-Asset 'SHA256SUMS.txt' $sums } catch { Fail "could not download SHA256SUMS.txt from $base ($($_.Exception.Message))" }
  $expected = $null
  foreach ($line in Get-Content -LiteralPath $sums) {
    if ($line -match '^([0-9a-fA-F]{64})\s+\*?(.+)$' -and $Matches[2].Trim() -eq $Asset) { $expected = $Matches[1].ToLowerInvariant(); break }
  }
  if (-not $expected) { Fail "$Asset is not listed in SHA256SUMS.txt" }
  Step "Downloading $Asset..."
  $file = Join-Path $Tmp $Asset
  try { Get-Asset $Asset $file } catch { Fail "could not download $Asset from $base ($($_.Exception.Message))" }
  Step 'Verifying SHA-256...'
  $actual = (Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($actual -ne $expected) { Fail "checksum mismatch for $Asset (expected $expected, got $actual)" }
  return $actual
}

function Add-UserPath([string]$Dir) {
  $current = [Environment]::GetEnvironmentVariable('Path', 'User')
  $entries = @()
  if ($current) { $entries = $current.Split(';') | Where-Object { $_ } }
  if ($entries -notcontains $Dir) {
    if ($DryRun) { Step "[dry-run] would add $Dir to your user PATH"; return $false }
    [Environment]::SetEnvironmentVariable('Path', (($entries + $Dir) -join ';'), 'User')
    return $true
  }
  return $false
}

$tmp = Join-Path ([IO.Path]::GetTempPath()) ("kcode-install-" + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $tmp | Out-Null
try {
  Write-Host ''
  Write-Host '  K-code installer' -ForegroundColor Cyan -NoNewline
  Write-Host "  (windows-x64, $(if ($Desktop) { 'desktop' } else { 'server' }))"
  Write-Host ''

  if ($Desktop) {
    $asset = 'K-code-windows-x64-setup.exe'
    $null = Get-VerifiedAsset $asset $tmp
    if ($DryRun) {
      Step "[dry-run] would run $asset"
      Write-Host "`n  Dry run finished: $asset verified, nothing was installed.`n" -ForegroundColor Green
      return
    }
    Step 'Running the installer...'
    $installerArgs = @()
    if ($Silent) { $installerArgs += '/S' }
    $process = Start-Process -FilePath (Join-Path $tmp $asset) -ArgumentList $installerArgs -Wait -PassThru
    if ($process.ExitCode -ne 0) { Fail "the installer exited with code $($process.ExitCode)" }
    Write-Host "`n  Installed K-code. Launch it from the Start menu.`n" -ForegroundColor Green
    Write-Host '  The build is unsigned: if SmartScreen warns, choose "More info" > "Run anyway".' -ForegroundColor DarkGray
    Write-Host ''
    return
  }

  $asset = 'kcode-server-windows-x64.zip'
  $hash = Get-VerifiedAsset $asset $tmp
  if (-not $InstallDir) { $InstallDir = Join-Path $env:LOCALAPPDATA 'kcode\server' }
  $marker = Join-Path $InstallDir '.sha256'

  if ((Test-Path -LiteralPath $marker) -and ((Get-Content -LiteralPath $marker -Raw).Trim() -eq $hash)) {
    Step "This release is already installed in $InstallDir."
  } else {
    Step 'Unpacking...'
    $unpack = Join-Path $tmp 'unpack'
    Expand-Archive -LiteralPath (Join-Path $tmp $asset) -DestinationPath $unpack -Force
    $root = Get-ChildItem -LiteralPath $unpack -Directory | Select-Object -First 1
    if (-not $root -or -not (Test-Path -LiteralPath (Join-Path $root.FullName 't3.exe'))) { Fail 'the archive does not contain the server executable' }
    & (Join-Path $root.FullName 't3.exe') --version *> $null
    if ($LASTEXITCODE -ne 0) { Fail 'the downloaded executable does not run on this machine' }
    Set-Content -LiteralPath (Join-Path $root.FullName '.sha256') -Value $hash -NoNewline
    if ($DryRun) {
      Step "[dry-run] would install into $InstallDir"
    } else {
      $parent = Split-Path -Parent $InstallDir
      New-Item -ItemType Directory -Path $parent -Force | Out-Null
      if (Test-Path -LiteralPath $InstallDir) {
        $old = "$InstallDir.old"
        if (Test-Path -LiteralPath $old) { Remove-Item -LiteralPath $old -Recurse -Force }
        Move-Item -LiteralPath $InstallDir -Destination $old
      }
      Move-Item -LiteralPath $root.FullName -Destination $InstallDir
      if (Test-Path -LiteralPath "$InstallDir.old") { Remove-Item -LiteralPath "$InstallDir.old" -Recurse -Force -ErrorAction SilentlyContinue }
    }
  }

  $pathChanged = Add-UserPath $InstallDir
  if ($DryRun) {
    Write-Host "`n  Dry run finished: $asset verified, nothing was installed.`n" -ForegroundColor Green
    return
  }
  Write-Host "`n  Installed K-code server to $InstallDir`n" -ForegroundColor Green
  if ($pathChanged) { Write-Host '  Open a new terminal so `kcode` is on your PATH.' -ForegroundColor DarkGray; Write-Host '' }
  Write-Host '  Next steps:'
  Write-Host '    kcode serve                 start the server; it prints a pairing URL to open in your browser'
  Write-Host '    kcode auth pairing create   issue another pairing link for a new device'
  Write-Host '    https://kcode.agentbox.io.vn/docs'
  Write-Host ''
} finally {
  Remove-Item -LiteralPath $tmp -Recurse -Force -ErrorAction SilentlyContinue
}
