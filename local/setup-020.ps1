# local/setup-020.ps1 - recreate this fork's dsh 0.2.0 environment in a checkout.
#
# Run it on the machine that just cloned/pulled this repository:
#
#   pwsh -File local\setup-020.ps1                 # this checkout becomes the 0.2.0 tree
#   pwsh -File local\setup-020.ps1 -Tree D:\Code\dsh-020
#   pwsh -File local\setup-020.ps1 -SkipInstall    # only write the files and pointers
#
# It uses pwsh 7 and stays ASCII-only so Windows PowerShell 5.1 cannot misread it
# as GBK (see local/PORTING.md). Nothing it does is destructive: a file it would
# replace is first copied to <name>.bak-<timestamp>, and it never deletes a
# profile or a plugin.
#
# What it does:
#   1. writes ~/.dsh/profiles/web020      from local/profile/web020      (the 0.2.0 Web profile)
#   2. writes ~/.dsh/profiles/dsh-tui     from local/profile/dsh-tui     (the TUI profile's LLM routes)
#   3. pnpm install in both profile directories
#   4. points the launcher at this checkout: ~/.dsh/tree.txt + <tree>\.dsh-profile
#   5. installs the global TUI (@deepseek-harness-tui/dsh-tui@0.12.0) when it is missing
#   6. prints the checks to run afterwards
#
# What it does NOT do (the git / OS level steps, documented in local/PORTING.md):
#   - build the checkout:  pnpm install ; pnpm run build   (apps/web/dist must exist)
#   - credentials:         ~/.dsh/.credentials.yaml   (API keys; never in git)
#   - the launcher itself: ~/.dsh/bin/*.cmd, ~/.dsh/custom.cmd  (compare against PORTING.md section 2)
param(
  [string]$Tree = (Split-Path -Parent $PSScriptRoot),
  [switch]$SkipInstall,
  [switch]$Force
)

$ErrorActionPreference = 'Stop'
$dshHome = if ($env:DSH_HOME) { $env:DSH_HOME } else { Join-Path $env:USERPROFILE '.dsh' }
$profiles = Join-Path $dshHome 'profiles'
$templateRoot = Join-Path $PSScriptRoot 'profile'
$tuiVersion = '0.12.0'
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'

function Say ($text) { Write-Host "`n== $text" -ForegroundColor Cyan }
function Ok ($text) { Write-Host "   ok   $text" -ForegroundColor Green }
function Note ($text) { Write-Host "   ..   $text" -ForegroundColor Yellow }
function Fail ($text) { Write-Host "   FAIL $text" -ForegroundColor Red; exit 1 }

# ---------------------------------------------------------------------------
Say "checking the checkout"
if (-not (Test-Path (Join-Path $Tree 'package.json'))) { Fail "$Tree has no package.json; pass -Tree <checkout>" }
$tree = (Resolve-Path $Tree).Path
Ok "tree: $tree"
if (-not (Test-Path (Join-Path $tree 'apps\web\dist\index.html'))) {
  Note "apps/web/dist is missing - run  pnpm install ; pnpm run build  in the tree before starting"
} else { Ok "frontend build present (apps/web/dist/index.html)" }
if (-not (Test-Path (Join-Path $tree 'apps\cli\src\bin.ts'))) { Fail "$tree does not look like a dsh checkout" }

# ---------------------------------------------------------------------------
Say "installing the profile definitions"
foreach ($name in 'web020', 'dsh-tui') {
  $source = Join-Path $templateRoot $name
  if (-not (Test-Path $source)) { Fail "missing template $source" }
  $target = Join-Path $profiles $name
  New-Item -ItemType Directory -Force -Path $target | Out-Null
  foreach ($file in Get-ChildItem $source -File) {
    $destination = Join-Path $target $file.Name
    if (-not (Test-Path $destination)) {
      Copy-Item $file.FullName $destination
      Ok "$name\$($file.Name) written"
      continue
    }
    $same = (Get-FileHash $file.FullName).Hash -eq (Get-FileHash $destination).Hash
    if ($same) { Ok "$name\$($file.Name) already identical"; continue }
    if (-not $Force) {
      Note "$name\$($file.Name) differs; left it alone (compare with local\profile\$name\$($file.Name), or re-run with -Force)"
      continue
    }
    Copy-Item $destination "$destination.bak-$stamp"
    Copy-Item $file.FullName $destination
    Ok "$name\$($file.Name) replaced (previous kept as .bak-$stamp)"
  }
}

# ---------------------------------------------------------------------------
if ($SkipInstall) {
  Say "skipping pnpm install (-SkipInstall)"
} else {
  Say "installing profile plugins (pnpm)"
  foreach ($name in 'web020', 'dsh-tui') {
    $target = Join-Path $profiles $name
    Write-Host "   pnpm install in $target"
    Push-Location $target
    try { & pnpm install --no-frozen-lockfile } finally { Pop-Location }
    if ($LASTEXITCODE -ne 0) { Fail "pnpm install failed in $target" }
    Ok "$name installed"
  }
}

# ---------------------------------------------------------------------------
Say "pointing the launcher at this checkout"
$pointer = Join-Path $dshHome 'tree.txt'
if ((Test-Path $pointer) -and ((Get-Content $pointer -Raw).Trim() -ne $tree)) {
  Copy-Item $pointer "$pointer.bak-$stamp"
  Note "old tree pointer kept as tree.txt.bak-$stamp"
}
Set-Content -Path $pointer -Value $tree -Encoding ascii -NoNewline
Ok "$pointer = $tree"
Set-Content -Path (Join-Path $tree '.dsh-profile') -Value 'web020' -Encoding ascii -NoNewline
Ok "$tree\.dsh-profile = web020"
Note 'the 0.1.5 tree carries no .dsh-profile, so it still resolves to the "web" profile'

# ---------------------------------------------------------------------------
Say "checking the global TUI"
$globalManifest = Join-Path $env:APPDATA "npm\node_modules\@deepseek-harness-tui\dsh-tui\package.json"
$installed = if (Test-Path $globalManifest) { (Get-Content $globalManifest -Raw | ConvertFrom-Json).version } else { $null }
if ($installed -eq $tuiVersion) {
  Ok "global @deepseek-harness-tui/dsh-tui@$installed"
} else {
  Note "global TUI is $(if ($installed) { $installed } else { 'not installed' }); installing $tuiVersion"
  & npm i -g --legacy-peer-deps "@deepseek-harness-tui/dsh-tui@$tuiVersion"
  if ($LASTEXITCODE -ne 0) { Note "npm install failed - run it by hand: npm i -g --legacy-peer-deps @deepseek-harness-tui/dsh-tui@$tuiVersion" }
}
Note "dsh-tui 0.12.0 peers require dsh 0.2.0-rc, so the TUI only runs while the tree above is the 0.2.0 one"

# ---------------------------------------------------------------------------
Say "checking the launcher contract"
# The launchers live outside git (PORTING.md section 2 keeps them per machine),
# so the one thing that silently ruins this setup is an OLD launcher that never
# reads the pointers: the tree would be 0.2.0 while the profile stayed "web", and
# the Web UI would come up unable to save any setting. Fail loud instead.
$launcherContract = @(
  @{ Label = '~\.dsh\custom.cmd'; Path = (Join-Path $dshHome 'custom.cmd'); Needs = @('tree.txt', '.dsh-profile') },
  @{ Label = '~\.dsh\bin\dsh.cmd'; Path = (Join-Path $dshHome 'bin\dsh.cmd'); Needs = @('tree.txt', '.dsh-profile') },
  @{ Label = '~\.dsh\bin\deepseek.cmd'; Path = (Join-Path $dshHome 'bin\deepseek.cmd'); Needs = @('--no-open', 'taskkill') }
)
foreach ($entry in $launcherContract) {
  if (-not (Test-Path $entry.Path)) {
    Note "$($entry.Label) is missing - copy it from the other machine (PORTING.md section 2)"
    continue
  }
  $text = Get-Content $entry.Path -Raw
  $missing = @($entry.Needs | Where-Object { $text -notmatch [regex]::Escape($_) })
  if ($missing.Count -gt 0) {
    Note "$($entry.Label) does not mention $($missing -join ', ') - it predates the pointer scheme; refresh it from the other machine (PORTING.md section 2)"
  } else {
    Ok "$($entry.Label) carries the current contract"
  }
}

# ---------------------------------------------------------------------------
Say "done - verify next"
@"
   deepseek stop
   deepseek web                 # then look at %USERPROFILE%\.dsh\web.out.log
   node D:\Code\dsh-kit\tools\dsh-web-check.mjs   # a helper that only exists on this machine (not in the repo): renders the page headlessly; PASS = every client entry activated
   deepseek tui                 # the model picker must list the routes from local/profile/dsh-tui/cordis.patch.yml

known-inert rows in this profile (upstream has no 0.2.0 build yet, or the row poisons the settings domain):
   @linxin666/dsh-perf, dsh-doctor, dsh-desktop-launcher, dsh-tool-describe-image
   dsh-tui-workspaces/-command-trees/-settings-sections/-scenes/-plugin-host/-extensions
"@
