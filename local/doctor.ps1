<#
  dsh 本地补丁自检 — 检查逻辑（入口是同目录 doctor.cmd）

  三组检查：
    1) fork 漂移   —— 本地 my-custom 与 mine/my-custom 是否分叉、有没有未提交改动
    2) A 类源码补丁 —— 每条补丁跑它自带的 spec（补丁被打包了测试，测试就是探针）
    3) B 类仓库外补丁 —— 幂等重放 npm 产物补丁 + 断言启动器没漂移

  退出码 0 = 全部 OK；1 = 有 FAIL 或 WARN 需要处理。
  补丁清单与维护规则见同目录 README.md。

  只用 PowerShell 5.1 也支持的语法（doctor.cmd 在 pwsh 缺失时会回退 powershell.exe）。
#>
param(
  # 跳过 A 类 spec（只看 fork 漂移与 B 类），用于快速扫一眼。
  [switch]$Quick
)

$ErrorActionPreference = 'Continue'
$RepoRoot = Split-Path -Parent $PSScriptRoot
$Results = @()

function Add-Check {
  param([string]$Kind, [string]$Name, [string]$Status, [string]$Detail)
  $script:Results += [pscustomobject]@{ Kind = $Kind; Name = $Name; Status = $Status; Detail = $Detail }
}

function Write-Section {
  param([string]$Text)
  Write-Host ''
  Write-Host "== $Text" -ForegroundColor Cyan
}

function Get-Text {
  param([string]$Path, [int]$CodePage = 936)
  $bytes = [System.IO.File]::ReadAllBytes($Path)
  return [System.Text.Encoding]::GetEncoding($CodePage).GetString($bytes)
}

Write-Host ''
Write-Host 'dsh 本地补丁自检' -ForegroundColor White
Write-Host ("仓库: {0}" -f $RepoRoot) -ForegroundColor DarkGray

# --------------------------------------------------------------------------
# 1) fork 漂移
# --------------------------------------------------------------------------
Write-Section '1/4  fork 漂移（本地分支 vs mine/my-custom）'

$branch = (& git -C $RepoRoot rev-parse --abbrev-ref HEAD 2>$null)
if ($LASTEXITCODE -ne 0 -or -not $branch) {
  Add-Check 'fork' '读取当前分支' 'FAIL' 'git rev-parse 失败，仓库状态异常'
  $branch = 'my-custom'
}
else {
  $branch = $branch.Trim()
}

& git -C $RepoRoot fetch mine --quiet 2>&1 | Out-Null
$fetchOk = ($LASTEXITCODE -eq 0)

if (-not $fetchOk) {
  Add-Check 'fork' 'git fetch mine' 'WARN' '拉取失败（Clash 代理没开？）——下面的 ahead/behind 基于上次抓取的结果'
}

$counts = (& git -C $RepoRoot rev-list --left-right --count "$branch...mine/my-custom" 2>$null)
if ($LASTEXITCODE -eq 0 -and $counts) {
  $parts = (($counts | Out-String).Trim()) -split '\s+'
  $ahead = 0; $behind = 0
  if ($parts.Count -ge 2) { $ahead = [int]$parts[0]; $behind = [int]$parts[1] }

  if ($ahead -eq 0 -and $behind -eq 0) {
    Add-Check 'fork' "本地 $branch 与 fork 一致" 'OK' '双向零差异'
  }
  elseif ($ahead -gt 0 -and $behind -gt 0) {
    Add-Check 'fork' '本地与 fork 已分叉' 'FAIL' "本地领先 $ahead 条、落后 $behind 条 —— 需要人工决定合并方向，别直接 push"
  }
  elseif ($ahead -gt 0) {
    Add-Check 'fork' '有未推送的提交' 'WARN' "本地领先 $ahead 条 —— git push mine $branch"
  }
  else {
    Add-Check 'fork' 'fork 上有本地没有的提交' 'WARN' "落后 $behind 条 —— git merge --ff-only mine/$branch"
  }
}
else {
  Add-Check 'fork' '对比 ahead/behind' 'FAIL' "找不到远端分支 mine/my-custom"
}

$dirty = (& git -C $RepoRoot status --porcelain 2>$null)
if ($dirty) {
  $n = ($dirty | Measure-Object).Count
  Add-Check 'fork' '工作树不干净' 'WARN' "有 $n 处未提交改动，会挡住 rebase —— 先提交或 git restore"
}
else {
  Add-Check 'fork' '工作树干净' 'OK' 'rebase 可以正常进行'
}

# --------------------------------------------------------------------------
# 2) A 类源码补丁 —— 跑补丁自带的 spec
# --------------------------------------------------------------------------
Write-Section '2/4  A 类源码补丁（跑 spec 探针）'

$specGroups = @(
  @{ Name = 'A1 OpenCode session 头'; Specs = @('packages/llm/llm-pi-ai/tests/session-header.spec.ts') },
  @{ Name = 'A2 桌面提醒 desktop-notify'; Specs = @('packages/api/remotes/tests/desktop-notify.spec.ts') },
  @{ Name = 'A3 标签页待审批闪烁'; Specs = @('packages/client/ui-layout/tests/document-title.client.spec.tsx') },
  @{ Name = 'A4 沙箱升级幂等'; Specs = @(
      'packages/sandbox/sandbox/tests/escalation.spec.ts',
      'packages/fs/tool-fs/tests/tools.spec.ts',
      'packages/shell/tool-bash/tests/tools.spec.ts',
      'packages/shell/tool-pwsh/tests/tools.spec.ts') },
  @{ Name = 'A7 session.events getter（TUI 读取）'; Specs = @('packages/core/session/tests/session.spec.ts') }
)

if ($Quick) {
  Add-Check 'A类' 'spec 探针' 'SKIP' '本次带了 -Quick，跳过（不跑测试）'
}
else {
  # 从 dsh 服务继承来的环境里 NODE_ENV=production。Vite 在生产模式下会把 setupFiles
  # 引用的 node: 内置模块错误地按浏览器路径外部化，于是**所有** jsdom 客户端套件在加载
  # 阶段就失败并报 "No such built-in module: node:"（0 个用例被收集）。症状看起来像补丁
  # 被 rebase 改坏，实际与补丁无关——纯上游在同样的环境里也一样红。
  # 证据：同一个 spec，NODE_ENV=production 时 0 通过，NODE_ENV=test 时全绿。
  $env:NODE_ENV = 'test'
  Push-Location $RepoRoot
  foreach ($group in $specGroups) {
    Write-Host ("  running {0} ..." -f $group.Name) -ForegroundColor DarkGray
    $cmdArgs = @('vitest', 'run') + $group.Specs
    $out = (& pnpm @cmdArgs 2>&1 | Out-String)
    $code = $LASTEXITCODE

    $passed = ([regex]::Match($out, 'Tests\s+(?:\d+ failed \| )?(\d+) passed')).Groups[1].Value
    $failed = ([regex]::Match($out, 'Tests\s+(\d+) failed')).Groups[1].Value
    if (-not $passed) { $passed = '0' }
    if (-not $failed) { $failed = '0' }

    if ($code -eq 0) {
      Add-Check 'A类' $group.Name 'OK' "$passed 个用例通过"
    }
    else {
      Add-Check 'A类' $group.Name 'FAIL' "$failed 个用例失败（$passed 通过）—— rebase 可能吃掉或改坏了这条补丁，跑 pnpm vitest run 看细节"
    }
  }
  Pop-Location
}

# 设施文件与文档配对：没有 spec，用存在性断言
$infraFiles = @(
  'GIT-GUIDE.md', 'update-dsh.cmd', 'local\README.md', 'local\PORTING.md',
  'local\doctor.cmd', 'local\doctor.ps1', 'local\patch-opencode-session.cjs'
)
$missing = @()
foreach ($rel in $infraFiles) {
  if (-not (Test-Path (Join-Path $RepoRoot $rel))) { $missing += $rel }
}
if ($missing.Count -eq 0) {
  Add-Check 'A类' 'A5 更新脚本与指南齐全' 'OK' "$($infraFiles.Count) 个文件都在"
}
else {
  Add-Check 'A类' 'A5 更新脚本与指南缺失' 'FAIL' ("缺: " + ($missing -join ', '))
}

$docFiles = @(
  '.agents\notes\implemented\feature\2026-09-05-opencode-session-header.md',
  '.agents\notes\implemented\feature\2026-09-05-opencode-session-header.zh.md',
  '.agents\notes\implemented\feature\2026-09-05-opencode-session-header.i18n.yaml'
)
$missingDoc = @()
foreach ($rel in $docFiles) {
  if (-not (Test-Path (Join-Path $RepoRoot $rel))) { $missingDoc += $rel }
}
if ($missingDoc.Count -eq 0) {
  Add-Check 'A类' 'A6 文档配对记录齐全' 'OK' 'note 三件套都在'
}
else {
  Add-Check 'A类' 'A6 文档配对记录缺失' 'FAIL' ("缺: " + ($missingDoc -join ', '))
}

# --------------------------------------------------------------------------
# 3) B 类仓库外补丁
# --------------------------------------------------------------------------
Write-Section '3/4  B 类仓库外补丁'

# B1：npm 版 dsh 的 x-opencode-session 头（deepseek tui 链路）
$patchScript = Join-Path $PSScriptRoot 'patch-opencode-session.cjs'
if (-not (Test-Path $patchScript)) {
  Add-Check 'B类' 'B1 npm 产物 session 头' 'FAIL' "找不到 $patchScript"
}
else {
  $out = (& node $patchScript 2>&1 | Out-String)
  $code = $LASTEXITCODE
  $actions = ([regex]::Matches($out, 'patch:\s+(.+)') | ForEach-Object { $_.Groups[1].Value.Trim() }) -join '; '
  $verifies = ([regex]::Matches($out, 'verify:\s+(.+)') | ForEach-Object { $_.Groups[1].Value.Trim() }) -join '; '
  if ($code -eq 0) {
    Add-Check 'B类' 'B1 npm 产物 session 头' 'OK' ("$actions | $verifies")
  }
  else {
    $firstErr = ([regex]::Match($out, 'patch-opencode-session:.*')).Value
    if (-not $firstErr) { $firstErr = ($out.Trim() -split "`r?`n" | Select-Object -Last 1) }
    Add-Check 'B类' 'B1 npm 产物 session 头' 'FAIL' "$actions | $firstErr"
  }
}

# B2：deepseek 启动器（只断言，不自动重放 —— 见 README 第三节）
$binDir = Join-Path $env:USERPROFILE '.dsh\bin'
$launcherCmd = Join-Path $binDir 'deepseek.cmd'
$launcherExe = Join-Path $binDir 'deepseek.exe'
$lprobs = @()
if (-not (Test-Path $launcherExe)) { $lprobs += 'deepseek.exe 不存在' }
if (-not (Test-Path $launcherCmd)) {
  $lprobs += 'deepseek.cmd 不存在'
}
else {
  $bytes = [System.IO.File]::ReadAllBytes($launcherCmd)
  $text = [System.Text.Encoding]::GetEncoding(936).GetString($bytes)
  if (-not $text.Contains('--no-open')) { $lprobs += 'deepseek.cmd 丢了 --no-open（会双开浏览器）' }
  if (-not ($bytes -contains 13)) { $lprobs += 'deepseek.cmd 不是 CRLF 行尾（cmd 标签扫描会错乱）' }
  if (-not ($text.Contains('web-url.log') -or $text.Contains('web.out.log'))) { $lprobs += 'deepseek.cmd 丢了 token 提取（找不到 web-url.log / web.out.log 引用）' }
}
if ($lprobs.Count -eq 0) {
  Add-Check 'B类' 'B2 deepseek 启动器' 'OK' 'exe 在、--no-open 在、CRLF 在、token 提取在'
}
else {
  Add-Check 'B类' 'B2 deepseek 启动器漂移' 'FAIL' (($lprobs -join '; ') + ' —— 需人工修 ~/.dsh/bin')
}

# --------------------------------------------------------------------------
# 4) 跨机器核对：profile 补丁层引用的仓库外文件是否还在
#    （换机后最容易踩的坑：整份 checkout 可移植，但 profile 的
#     cordis.patch.yml 里可能有指向工作区的 file:// 绝对路径）
# --------------------------------------------------------------------------
Write-Section '4/4  跨机器核对（profile 补丁层的外部引用）'

$profileRoot = Join-Path $env:USERPROFILE '.dsh\profiles'
$patchFiles = @()
if (Test-Path $profileRoot) {
  Get-ChildItem $profileRoot -Directory -ErrorAction SilentlyContinue | ForEach-Object {
    $candidate = Join-Path $_.FullName 'cordis.patch.yml'
    if (Test-Path $candidate) { $patchFiles += $candidate }
  }
}
$brokenRefs = @()
$checkedRefs = 0
foreach ($pf in $patchFiles) {
  $text = Get-Content $pf -Raw -ErrorAction SilentlyContinue
  if (-not $text) { continue }
  foreach ($m in [regex]::Matches($text, "file:///([^'`"\s\)]+)")) {
    $checkedRefs += 1
    $decoded = ([System.Uri]::UnescapeDataString($m.Groups[1].Value)) -replace '/', '\'
    if (-not (Test-Path $decoded)) { $brokenRefs += ("{0}: {1}" -f (Split-Path $pf -Leaf), $decoded) }
  }
}
if ($checkedRefs -eq 0) {
  Add-Check '跨机' 'profile 外部插件引用' 'OK' "补丁层没有 file:// 外部引用（查了 $($patchFiles.Count) 个 cordis.patch.yml）"
}
elseif ($brokenRefs.Count -eq 0) {
  Add-Check '跨机' 'profile 外部插件引用' 'OK' "$checkedRefs 处引用都可达"
}
else {
  Add-Check '跨机' 'profile 外部插件路径不存在' 'WARN' (($brokenRefs -join '; ') + ' —— 按 local/PORTING.md 第四节改成这台机器的实际路径')
}

# --------------------------------------------------------------------------
# 结果表
# --------------------------------------------------------------------------
Write-Section '自检结果'

$okCount = 0; $warnCount = 0; $failCount = 0; $skipCount = 0
foreach ($r in $Results) {
  $color = 'Gray'
  switch ($r.Status) {
    'OK'   { $color = 'Green';  $okCount++ }
    'WARN' { $color = 'Yellow'; $warnCount++ }
    'FAIL' { $color = 'Red';    $failCount++ }
    'SKIP' { $color = 'DarkGray'; $skipCount++ }
  }
  Write-Host ("[{0,-4}] {1,-5} {2}" -f $r.Status, $r.Kind, $r.Name) -ForegroundColor $color
  if ($r.Detail) { Write-Host ("           {0}" -f $r.Detail) -ForegroundColor DarkGray }
}

Write-Host ''
Write-Host ("合计: OK {0} / WARN {1} / FAIL {2} / SKIP {3}" -f $okCount, $warnCount, $failCount, $skipCount) -ForegroundColor White

Write-Section 'C 类：只能人工核对（doctor 不代改）'
Write-Host '  - ~/.dsh/settings.yaml 的 desktop-notify 段（开关/提示音/flashWindows）' -ForegroundColor DarkGray
Write-Host '  - ~/.dsh/profiles/web/cordis.patch.yml、~/.dsh/profiles/dsh-tui/cordis.patch.yml 的插件注册' -ForegroundColor DarkGray
Write-Host '  - ~/.dsh/mode.txt（默认模式 web / cli / tui）' -ForegroundColor DarkGray
Write-Host '  - .credentials.yaml 的 version 必须是数字 1' -ForegroundColor DarkGray
Write-Host '  - npm 全局若又生成无扩展名 shim（%APPDATA%\npm\dsh、dsh-tui），删掉' -ForegroundColor DarkGray

Write-Host ''
if ($failCount -gt 0) {
  Write-Host '结论: 有 FAIL，按上面的提示逐条处理。' -ForegroundColor Red
  exit 1
}
if ($warnCount -gt 0) {
  Write-Host '结论: 没有硬失败，但有 WARN 待处理。' -ForegroundColor Yellow
  exit 1
}
Write-Host '结论: 全部通过。' -ForegroundColor Green
exit 0
