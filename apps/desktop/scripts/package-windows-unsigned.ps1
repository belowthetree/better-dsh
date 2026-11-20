<#
.SYNOPSIS
  Build the unsigned Windows x64 Desktop installer (EXE) in one command.

.DESCRIPTION
  Thin wrapper over the existing packaging pipeline; it adds no build behavior of
  its own. Packaging and its configuration are documented in
  apps/desktop/packaging/README.md, which owns the canonical commands, version
  rules, and installer verification.

  The wrapper resolves the workspace pnpm entry (the repository pins pnpm 11),
  checks that apps/desktop/.env.windows exists, runs
    pnpm --dir apps/desktop run package:win:x64:unsigned -- <flags>
  and then reports the newest artifact under
  apps/desktop/.desktop-build/targets/win-x64/unsigned-artifacts/.

.PARAMETER BuildVersion
  Version embedded in the installer name. Omit to publish the product version
  from package.json, which passes no --build-version. A different value is
  forwarded as --build-version and must keep the product version as its prefix.

.PARAMETER Check
  Validate packaging configuration and build tooling only (--check); builds
  nothing.

.PARAMETER Dir
  Stop at the unpacked application directory (--dir) instead of an installer.

.PARAMETER Open
  Select the artifact in File Explorer after a successful build.

.EXAMPLE
  pwsh -NoProfile -File apps/desktop/scripts/package-windows-unsigned.ps1

.EXAMPLE
  pwsh -NoProfile -File apps/desktop/scripts/package-windows-unsigned.ps1 -Check

.EXAMPLE
  pwsh -NoProfile -File apps/desktop/scripts/package-windows-unsigned.ps1 -BuildVersion 0.2.2-rc.4.20261119.1 -Open
#>
[CmdletBinding()]
param(
  [string]$BuildVersion,
  [switch]$Check,
  [switch]$Dir,
  [switch]$Open
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 3.0

$root = (Resolve-Path (Join-Path $PSScriptRoot '..\..\..')).Path
$desktop = Join-Path $root 'apps\desktop'
$target = Join-Path $desktop '.desktop-build\targets\win-x64'
$artifacts = Join-Path $target 'unsigned-artifacts'

$product = (Get-Content -Raw -Encoding utf8 (Join-Path $root 'package.json') | ConvertFrom-Json).version
$version = if ([string]::IsNullOrWhiteSpace($BuildVersion)) { $product } else { $BuildVersion }

$envFile = Join-Path $desktop '.env.windows'
if (-not (Test-Path -LiteralPath $envFile)) {
  throw "Missing $envFile. Copy apps/desktop/.env.windows.example and fill in DSH_DESKTOP_APP_ID and the mandatory-update policy settings (see apps/desktop/packaging/README.md)."
}

if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw 'node is not on PATH; install Node 24 or later.' }

# The repository pins pnpm through packageManager; run the workspace copy so the
# nested package commands inherit a pnpm that matches the lockfile.
$pnpmEntry = Join-Path $desktop 'node_modules\pnpm\bin\pnpm.cjs'
$pnpm = if (Test-Path -LiteralPath $pnpmEntry) {
  @((Get-Command node).Source, $pnpmEntry)
} elseif (Get-Command pnpm -ErrorAction SilentlyContinue) {
  @((Get-Command pnpm).Source)
} else {
  throw 'pnpm is not available; run pnpm install at the repository root first.'
}

$forward = @()
if ($version -ne $product) { $forward += @('--build-version', $version) }
if ($Check) { $forward += '--check' }
if ($Dir) { $forward += '--dir' }

$arguments = @(
  '--dir', $desktop,
  'run', 'package:win:x64:unsigned'
) + $(if ($forward.Count -gt 0) { @('--') + $forward } else { @() })

Write-Host "Packaging unsigned Windows x64 Desktop $version"
Write-Host ("  pnpm: " + ($pnpm -join ' '))
Write-Host ("  args: " + ($arguments -join ' '))
Write-Host ''

$launcher = $pnpm[0]
$launcherArguments = @()
if ($pnpm.Count -gt 1) { $launcherArguments = $pnpm[1..($pnpm.Count - 1)] }

# A packaging run reports progress and some warnings on stderr. Keep native
# stderr from becoming a terminating error so the exit code decides the result.
$previousPreference = $ErrorActionPreference
$ErrorActionPreference = 'Continue'
Push-Location $root
try {
  & $launcher @($launcherArguments + $arguments)
  $code = $LASTEXITCODE
} finally {
  $ErrorActionPreference = $previousPreference
  Pop-Location
}
if ($code -ne 0) { throw "Packaging failed with exit code $code. Stage logs: $(Join-Path $desktop '.desktop-build\packaging-runs')." }

if ($Check) { Write-Host 'Configuration and toolchain checks passed.'; exit 0 }

if ($Dir) {
  $application = Get-ChildItem -LiteralPath $target -Directory -Filter 'win-unpacked' -ErrorAction SilentlyContinue |
    Select-Object -First 1
  if ($null -eq $application) { throw "No unpacked application found under $target." }
  Write-Host "APPLICATION: $($application.FullName)"
  if ($Open) { Start-Process explorer.exe -ArgumentList ('/select,' + $application.FullName) }
  exit 0
}

$installer = Get-ChildItem -LiteralPath $artifacts -Filter '*.exe' -File -ErrorAction SilentlyContinue |
  Sort-Object LastWriteTime -Descending | Select-Object -First 1
if ($null -eq $installer) { throw "Packaging reported success but no installer exists in $artifacts." }

$hash = (Get-FileHash -LiteralPath $installer.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
Write-Host ''
Write-Host "EXE: $($installer.FullName)"
Write-Host ("SIZE: {0:N1} MiB" -f ($installer.Length / 1MB))
Write-Host "SHA256: $hash"
if ($Open) { Start-Process explorer.exe -ArgumentList ('/select,' + $installer.FullName) }
exit 0
