<#
.SYNOPSIS
  Build the unsigned Windows x64 installer of the orb form (大肥鱼) beside the classic Desktop build.

.DESCRIPTION
  Runs the existing packaging pipeline with a form-build identity, so this
  installer and the classic Desktop installer can coexist on one machine:

    product name       DeepSeek Harness Orb   own install directory, Start-menu shortcut,
                                              executable, userData, single-instance lock
    application id     com.deepseek.dsh.orb   own uninstall entry and updater cache
    dsh:// protocol    not registered         the classic installation keeps the scheme
    build variant      orb                    artifacts under
                                              .desktop-build/targets/win-x64/unsigned-artifacts-orb

  Data is shared on purpose: both builds read $DSH_HOME (~/.dsh). This build starts
  the `better` profile instead of `desktop`; the profile ships as
  resources/form-profile and the application copies it to <DSH_HOME>/profiles/better
  on first launch. The classic `desktop` profile is never touched, and an existing
  `better` profile is never overwritten.

  Packaging configuration and verification are owned by apps/desktop/packaging/README.md.

.PARAMETER BuildVersion
  Version embedded in the installer name. Omit to publish the product version from
  package.json; a different value is forwarded as --build-version.

.PARAMETER Check
  Validate configuration and tooling only (--check); builds nothing.

.PARAMETER Dir
  Stop at the unpacked application directory (--dir) instead of an installer.

.PARAMETER Open
  Select the artifact in File Explorer after a successful build.

.EXAMPLE
  pwsh -NoProfile -File apps/desktop/scripts/package-windows-orb.ps1

.EXAMPLE
  pwsh -NoProfile -File apps/desktop/scripts/package-windows-orb.ps1 -Check
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
$variant = 'orb'
$target = Join-Path $desktop '.desktop-build\targets\win-x64'
$artifacts = "$target\unsigned-artifacts-$variant"
$templateRoot = Join-Path $desktop ".desktop-build\form-profile\better"

$product = (Get-Content -Raw -Encoding utf8 (Join-Path $root 'package.json') | ConvertFrom-Json).version
$version = if ([string]::IsNullOrWhiteSpace($BuildVersion)) { $product } else { $BuildVersion }

$envFile = Join-Path $desktop '.env.windows'
if (-not (Test-Path -LiteralPath $envFile)) {
  throw "Missing $envFile. Copy apps/desktop/.env.windows.example and fill in DSH_DESKTOP_APP_ID and the mandatory-update policy settings."
}
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw 'node is not on PATH; install Node 24 or later.' }

function Write-Utf8File([string]$Path, [string]$Text) {
  $directory = Split-Path -Parent $Path
  if (-not (Test-Path -LiteralPath $directory)) {
    New-Item -ItemType Directory -Path $directory -Force | Out-Null
  }
  [System.IO.File]::WriteAllText($Path, $Text, (New-Object System.Text.UTF8Encoding($false)))
}

# The launch profile of this build. It is copied into the user's harness home on first
# launch, so it must stay a complete profile: manifest with form and bundles, the patch
# layer, and the pnpm workspace settings the plugin manager expects.
$manifest = [ordered]@{
  name        = 'dsh-profile-better'
  private     = $true
  dependencies = [ordered]@{}
  dsh         = [ordered]@{
    profile = [ordered]@{
      owner   = 'desktop'
      form    = [ordered]@{ kind = 'orb' }
      bundles = @(
        '@deepseek-ai/dsh-base'
        '@deepseek-ai/dsh-web-app'
        '@deepseek-ai/dsh-better-bundle'
      )
    }
  }
}

Remove-Item -LiteralPath $templateRoot -Recurse -Force -ErrorAction SilentlyContinue
Write-Utf8File (Join-Path $templateRoot 'package.json') (($manifest | ConvertTo-Json -Depth 8) + "`n")
Write-Utf8File (Join-Path $templateRoot 'cordis.yml') "[]`n"
Write-Utf8File (Join-Path $templateRoot 'cordis.patch.yml') @"
# Your patch layer for the orb profile, applied after every bundle layer:
# a top-level YAML array of loader patch entries (id-targeted config
# overrides, disables, and insert lists; ``!!js`` expressions allowed).
[]
"@
Write-Utf8File (Join-Path $templateRoot 'pnpm-workspace.yaml') @"
packages:
  - .

nodeLinker: hoisted
autoInstallPeers: false
"@

$env:DSH_DESKTOP_PRODUCT_NAME = 'DeepSeek Harness Orb'
$env:DSH_DESKTOP_ARTIFACT_PREFIX = 'deepseek-harness-orb'
$env:DSH_DESKTOP_VARIANT = $variant
$env:DSH_DESKTOP_DEFAULT_PROFILE = 'better'
$env:DSH_DESKTOP_PROFILE_TEMPLATE_DIR = $templateRoot
# The classic installation owns the dsh:// handler; two registrations would fight over it.
$env:DSH_DESKTOP_DISABLE_PROTOCOL = '1'

# Release fields are file-owned: the loader never takes them from the shell, so the orb
# application id comes from a generated machine preset derived from .env.windows. The
# preset name must equal the deployment its DSH_DESKTOP_AUTO_UPDATE_ENV selects.
$configRoot = Join-Path $desktop ".desktop-build\packaging-config\$variant"
$source = Get-Content -LiteralPath $envFile -Encoding utf8
$deployment = $null
foreach ($line in $source) {
  if ($line -match '^\s*DSH_DESKTOP_AUTO_UPDATE_ENV\s*=\s*(\S+)\s*$') { $deployment = $Matches[1] }
}
if ($deployment -ne 'test' -and $deployment -ne 'production') {
  throw "Set DSH_DESKTOP_AUTO_UPDATE_ENV=test or production in $envFile; the preset name must match that deployment."
}

$presetLines = @()
$appIdWritten = $false
foreach ($line in $source) {
  if ($line -match '^\s*DSH_DESKTOP_APP_ID\s*=') {
    $presetLines += 'DSH_DESKTOP_APP_ID=com.deepseek.dsh.orb'
    $appIdWritten = $true
  } elseif ($line -match '^\s*DSH_DESKTOP_WINDOWS_' -or $line -match '^\s*DOWNLOAD_(TEST|PROD)_COS_' -or $line -match '^\s*DOWNLOAD_PROD_EO_ZONE_ID\s*=') {
    # Unsigned builds carry no signing or upload credentials; public presets reject them.
    continue
  } else {
    $presetLines += $line
  }
}
if (-not $appIdWritten) { $presetLines = @('DSH_DESKTOP_APP_ID=com.deepseek.dsh.orb') + $presetLines }

Remove-Item -LiteralPath (Join-Path $configRoot 'presets') -Recurse -Force -ErrorAction SilentlyContinue
Write-Utf8File (Join-Path $configRoot "presets\$deployment.env") (($presetLines -join "`n") + "`n")
$env:DSH_PACKAGING_CONFIG_DIR = $configRoot
$env:DSH_PACKAGING_PRESET = $deployment

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

$arguments = @('--dir', $desktop, 'run', 'package:win:x64:unsigned') +
  $(if ($forward.Count -gt 0) { @('--') + $forward } else { @() })

Write-Host "Packaging the orb form: DeepSeek Harness Orb $version"
Write-Host ("  profile : $templateRoot")
Write-Host ("  pnpm    : " + ($pnpm -join ' '))
Write-Host ''

$launcher = $pnpm[0]
$launcherArguments = @()
if ($pnpm.Count -gt 1) { $launcherArguments = $pnpm[1..($pnpm.Count - 1)] }

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
  $application = Get-ChildItem -LiteralPath $artifacts -Directory -Filter 'win-unpacked' -ErrorAction SilentlyContinue |
    Select-Object -First 1
  if ($null -eq $application) { throw "No unpacked application found under $artifacts." }
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
