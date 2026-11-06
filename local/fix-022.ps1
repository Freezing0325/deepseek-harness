# local/fix-022.ps1 - migrate the local dsh profiles to the 0.2.2-rc.1 line.
#
# Run after updating the checkout to dsh 0.2.2-rc.1:
#
#   pwsh -NoProfile -File local\fix-022.ps1
#
# What it fixes:
#   - dsh-tui 0.12.0 / 0.18.0 are rejected by dsh 0.2.2-rc.1. Version 0.19.0
#     is the first release whose peer range includes 0.2.2-rc.1.
#   - @linxin666/dsh-client-ui-web-ui-settings 0.4.4 imports
#     @deepseek-ai/dsh-settings without declaring it. The web profile therefore
#     fails to activate a required plugin. Add the package explicitly.
#   - the six @linxin666 client components have a 0.4.15 line that targets
#     0.2.2-rc.1; move the overrides from 0.4.4 to 0.4.15.
#
# The script edits only the dsh profiles. It backs up every file it changes and
# keeps unrelated profile dependencies and patch rows intact.

[CmdletBinding()]
param(
  [string]$DshHome = $(if ($env:DSH_HOME) { $env:DSH_HOME } else { Join-Path $env:USERPROFILE '.dsh' }),
  [switch]$SkipInstall,
  [switch]$SkipGlobalTui,
  [switch]$NoStopWeb
)

$ErrorActionPreference = 'Stop'
$tuiVersion = '0.19.0'
$settingsVersion = '0.2.2-rc.1'
$webUiVersion = '0.4.15'
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$profiles = Join-Path $DshHome 'profiles'
$failed = $false

function Say ($text) { Write-Host "`n== $text" -ForegroundColor Cyan }
function Ok ($text) { Write-Host "   ok   $text" -ForegroundColor Green }
function Note ($text) { Write-Host "   ..   $text" -ForegroundColor Yellow }
function Bad ($text) { Write-Host "   FAIL $text" -ForegroundColor Red; $script:failed = $true }

function Read-Json ($path) {
  Get-Content -LiteralPath $path -Raw | ConvertFrom-Json
}

function Write-TextIfChanged ($path, $text) {
  $old = if (Test-Path -LiteralPath $path) { Get-Content -LiteralPath $path -Raw } else { $null }
  if ($null -ne $old -and $old -eq $text) { Ok "unchanged: $path"; return }
  if ($null -ne $old) {
    $backup = "$path.bak-fix022-$stamp"
    Copy-Item -LiteralPath $path -Destination $backup
    Note "backup: $backup"
  }
  [IO.File]::WriteAllText($path, $text, (New-Object Text.UTF8Encoding($false)))
  Ok "wrote: $path"
}

function Save-Json ($path, $value) {
  Write-TextIfChanged $path (($value | ConvertTo-Json -Depth 100) + "`n")
}

function Set-Dependency ($manifest, $name, $version) {
  if ($null -eq $manifest.dependencies) {
    $manifest | Add-Member -NotePropertyName dependencies -NotePropertyValue ([pscustomobject]@{}) -Force
  }
  $manifest.dependencies | Add-Member -NotePropertyName $name -NotePropertyValue $version -Force
}

function Ensure-Exclude ($text, $entries) {
  $missing = @($entries | Where-Object { $text -notmatch [regex]::Escape($_) })
  if ($missing.Count -eq 0) { return $text }
  $lines = ($missing | ForEach-Object { "  - '$_'" }) -join "`n"
  if ($text -match '(?m)^minimumReleaseAgeExclude:\s*$') {
    return $text -replace '(?m)^(minimumReleaseAgeExclude:\s*)$', ('$1' + "`n" + $lines)
  }
  if ($text -match '(?m)^overrides:') {
    return $text -replace '(?m)^overrides:', ("minimumReleaseAgeExclude:`n" + $lines + "`n`noverrides:")
  }
  return $text
}

function Install-Profile ($name) {
  $path = Join-Path $profiles $name
  if (-not (Test-Path -LiteralPath (Join-Path $path 'package.json'))) {
    Note "missing profile: $path"
    return $true
  }
  Say "pnpm install in $name"
  $oldCi = $env:CI
  $env:CI = '1'
  Push-Location $path
  try {
    # Some pnpm/postinstall paths can leave an inherited stdin handle open. Feed
    # NUL so a non-interactive run cannot wait forever for a prompt.
    & cmd /d /s /c "pnpm install --no-frozen-lockfile --config.minimumReleaseAge=0 < NUL" | Out-Host
    $code = $LASTEXITCODE
  } finally {
    Pop-Location
    if ($null -eq $oldCi) { Remove-Item Env:CI -ErrorAction SilentlyContinue } else { $env:CI = $oldCi }
  }
  if ($code -ne 0) { Bad "pnpm install failed in $path"; return $false }
  Ok "$name installed"
  return $true
}

Say "checking dsh home"
if (-not (Test-Path -LiteralPath $profiles)) {
  Write-Host "   FAIL missing profile directory: $profiles" -ForegroundColor Red
  exit 1
}
Ok "dsh home: $DshHome"

if (-not $NoStopWeb) {
  Say "checking the Web port"
  & cmd /c 'netstat -ano | findstr ":3080" | findstr "LISTENING"' 2>$null | Out-Null
  if ($LASTEXITCODE -eq 0) {
    $launcher = Join-Path $DshHome 'bin\deepseek.cmd'
    if (Test-Path -LiteralPath $launcher) {
      Note "port 3080 is held by an old Web service; stopping it"
      & $launcher stop
      if ($LASTEXITCODE -ne 0) { Note "deepseek stop returned $LASTEXITCODE; inspect port 3080 manually" }
    } else {
      Note "port 3080 is in use and $launcher is missing; stop the old service manually"
    }
  } else {
    Ok "port 3080 is free"
  }
}

$webProfile = Join-Path $profiles 'web020'
if (Test-Path -LiteralPath (Join-Path $webProfile 'package.json')) {
  Say "updating the web020 profile"
  $pkg = Read-Json (Join-Path $webProfile 'package.json')
  Set-Dependency $pkg '@deepseek-harness-tui/dsh-tui' "^$tuiVersion"
  Set-Dependency $pkg '@deepseek-ai/dsh-settings' $settingsVersion
  Save-Json (Join-Path $webProfile 'package.json') $pkg

  $wsPath = Join-Path $webProfile 'pnpm-workspace.yaml'
  if (Test-Path -LiteralPath $wsPath) {
    $ws = Get-Content -LiteralPath $wsPath -Raw
    $ws = $ws -replace '0\.4\.4', $webUiVersion
    $ws = Ensure-Exclude $ws @(
      "@deepseek-harness-tui/dsh-tui@$tuiVersion",
      "@deepseek-ai/dsh-settings@$settingsVersion",
      "@linxin666/dsh-client-ui-market@$webUiVersion",
      "@linxin666/dsh-client-ui-skin-center@$webUiVersion",
      "@linxin666/dsh-client-ui-task-board@$webUiVersion",
      "@linxin666/dsh-client-ui-web-ui-settings@$webUiVersion",
      "@linxin666/dsh-pet@$webUiVersion",
      "@linxin666/dsh-ssh@$webUiVersion"
    )
    Write-TextIfChanged $wsPath $ws
  } else {
    Note "missing $wsPath; overrides were not updated"
  }
} else {
  Note "missing web020 profile; skipped"
}

$tuiProfile = Join-Path $profiles 'dsh-tui'
if (Test-Path -LiteralPath (Join-Path $tuiProfile 'package.json')) {
  Say "updating the dsh-tui profile"
  $pkg = Read-Json (Join-Path $tuiProfile 'package.json')
  Set-Dependency $pkg '@deepseek-harness-tui/dsh-tui' $tuiVersion
  Save-Json (Join-Path $tuiProfile 'package.json') $pkg

  $wsPath = Join-Path $tuiProfile 'pnpm-workspace.yaml'
  if (Test-Path -LiteralPath $wsPath) {
    $ws = Get-Content -LiteralPath $wsPath -Raw
    $ws = $ws -replace "@deepseek-harness-tui/dsh-tui@[^\r\n']+", "@deepseek-harness-tui/dsh-tui@$tuiVersion"
    $ws = Ensure-Exclude $ws @("@deepseek-harness-tui/dsh-tui@$tuiVersion")
    Write-TextIfChanged $wsPath $ws
  }
} else {
  Note "missing dsh-tui profile; skipped"
}

if (-not $SkipInstall) {
  $webOk = Install-Profile 'web020'
  $tuiOk = Install-Profile 'dsh-tui'
  if (-not $webOk -or -not $tuiOk) { $failed = $true }
}

if (-not $SkipGlobalTui) {
  Say "checking the global TUI launcher"
  $globalManifest = Join-Path $env:APPDATA 'npm\node_modules\@deepseek-harness-tui\dsh-tui\package.json'
  $installed = if (Test-Path -LiteralPath $globalManifest) {
    (Read-Json $globalManifest).version
  } else {
    $null
  }
  if ($installed -eq $tuiVersion) {
    Ok "global dsh-tui@$installed"
  } else {
    Note "global dsh-tui is $(if ($installed) { $installed } else { 'missing' }); installing $tuiVersion"
    & npm i -g --legacy-peer-deps --no-fund --no-audit "@deepseek-harness-tui/dsh-tui@$tuiVersion"
    if ($LASTEXITCODE -ne 0) {
      Bad "global dsh-tui install failed"
    } else {
      Ok "global dsh-tui@$tuiVersion installed"
    }
  }
}

Say "verifying the profile packages"
if (Test-Path -LiteralPath (Join-Path $webProfile 'package.json')) {
  $settingsManifest = Join-Path $webProfile 'node_modules\@deepseek-ai\dsh-settings\package.json'
  if (Test-Path -LiteralPath $settingsManifest) {
    $v = (Read-Json $settingsManifest).version
    if ($v -eq $settingsVersion) { Ok "web020 resolves @deepseek-ai/dsh-settings@$v" }
    else { Bad "web020 resolves @deepseek-ai/dsh-settings@$v, expected $settingsVersion" }
  } else {
    Bad "web020 still cannot resolve @deepseek-ai/dsh-settings"
  }

  $clientManifest = Join-Path $webProfile 'node_modules\@linxin666\dsh-client-ui-web-ui-settings\package.json'
  if (Test-Path -LiteralPath $clientManifest) {
    $v = (Read-Json $clientManifest).version
    if ($v -eq $webUiVersion) { Ok "web020 uses dsh-client-ui-web-ui-settings@$v" }
    else { Note "web020 uses dsh-client-ui-web-ui-settings@$v, expected $webUiVersion" }
  }
}

if ($failed) {
  Say "finished with errors"
  Write-Host 'Review the FAIL lines above, then rerun: pwsh -NoProfile -File local\fix-022.ps1' -ForegroundColor Yellow
  exit 1
}

Say "done"
Write-Host @'
Start the services with:
  deepseek web
  deepseek tui

The session-delete bundle may still print a compatibility warning and be
skipped. That warning is not fatal; the old GitHub package has no 0.2.2 build.
'@ -ForegroundColor Gray
