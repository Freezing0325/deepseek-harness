#requires -Version 5.0
# =====================================================================
#  DeepSeek Harness user-attention desktop alert (Windows)
#
#  Spawned fire-and-forget by the web host when a user-attention event is
#  broadcast (approval request, question, task completion), so a user
#  working in another window notices the quiet badge:
#    - flash: QQ-style taskbar flash on the dsh browser windows
#    - sound: per-kind system sound (or a custom .wav)
#    - popup: optional message box (default off)
#
#  This file is ASCII-only on purpose: Windows PowerShell 5.1 reads a
#  BOM-less UTF-8 script as GBK, and any non-ASCII byte would corrupt the
#  parse. The user-facing Chinese title/message therefore arrive through
#  the DSH_NOTIFY_* environment variables, which the spawner sets through
#  the WideChar API (no command-line encoding pitfalls).
# =====================================================================
param(
  [switch]$Flash,
  [switch]$Sound,
  [switch]$Popup,
  [string]$Kind = 'approval',
  [string]$SoundFile = '',
  [string]$FlashWindows = ''
)
$ErrorActionPreference = 'SilentlyContinue'

$title   = if ($env:DSH_NOTIFY_TITLE)   { $env:DSH_NOTIFY_TITLE }   else { 'DeepSeek Harness notification' }
$message = if ($env:DSH_NOTIFY_MESSAGE) { $env:DSH_NOTIFY_MESSAGE } else { 'DeepSeek Harness needs your attention.' }
$tool    = if ($env:DSH_NOTIFY_TOOL)    { $env:DSH_NOTIFY_TOOL }    else { '' }

# ---------------- log (capped at ~200KB, auto-truncated) ----------------
$logPath = Join-Path $env:USERPROFILE '.dsh\notify.log'
function Write-Log($line) {
  try {
    if (Test-Path $logPath) {
      if ((Get-Item $logPath).Length -gt 204800) { Set-Content $logPath '' -Encoding UTF8 }
    }
    "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')  $line" | Out-File $logPath -Append -Encoding UTF8
  } catch {}
}
Write-Log ("desktop-notify: kind=$Kind flash=$Flash sound=$Sound popup=$Popup tool=$tool")

# ---------------- sound ----------------
if ($Sound) {
  if ($SoundFile -and (Test-Path $SoundFile)) {
    try { (New-Object Media.SoundPlayer $SoundFile).Play() } catch {}
  } else {
    # Default system sound per kind: approval = exclamation (needs a decision),
    # question = question chime, complete = asterisk (informational).
    try {
      switch ($Kind) {
        'question' { [System.Media.SystemSounds]::Question.Play() }
        'complete' { [System.Media.SystemSounds]::Asterisk.Play() }
        default    { [System.Media.SystemSounds]::Exclamation.Play() }
      }
    } catch {}
  }
}

# ---------------- taskbar flash (QQ-style, no focus steal) ----------------
if ($Flash) {
  try {
    if (-not ('WinFlash' -as [type])) {
      Add-Type @"
using System;
using System.Runtime.InteropServices;
public class WinFlash {
  [StructLayout(LayoutKind.Sequential)]
  public struct FLASHWINFO {
    public uint cbSize; public IntPtr hwnd; public uint dwFlags; public uint uCount; public uint dwTimeout;
  }
  [DllImport("user32.dll")] [return: MarshalAs(UnmanagedType.Bool)]
  public static extern bool FlashWindowEx(ref FLASHWINFO pwfi);
  [DllImport("user32.dll")]
  public static extern IntPtr GetForegroundWindow();
}
"@
    }

    $targets = @($FlashWindows -split ',' | ForEach-Object { $_.Trim().ToLower() } | Where-Object { $_ -ne '' })
    if ($targets.Count -eq 0) {
      # Browsers only: the alert fires from the web host, where the dsh UI
      # lives in a browser tab; terminal windows (WindowsTerminal, mintty,
      # wezterm, ...) belong to unrelated console work and must not flash.
      $targets = @('chrome','msedge','firefox','brave','opera','vivaldi')
    }

    $fg  = [WinFlash]::GetForegroundWindow()
    $hit = 0
    Get-Process -ErrorAction SilentlyContinue | Where-Object {
      $_.MainWindowHandle -ne [IntPtr]::Zero -and $targets -contains $_.ProcessName.ToLower()
    } | ForEach-Object {
      $hwnd = $_.MainWindowHandle
      $isFg = ($fg -eq $hwnd)
      $fi = New-Object WinFlash+FLASHWINFO
      $fi.cbSize    = [uint32][System.Runtime.InteropServices.Marshal]::SizeOf([type]'WinFlash+FLASHWINFO')
      $fi.hwnd      = $hwnd
      if ($isFg) {
        $fi.dwFlags = 3      # FLASHW_ALL, brief confirm while the window is in front
        $fi.uCount  = 6
      } else {
        $fi.dwFlags = 15     # FLASHW_ALL | FLASHW_TIMERNOFG, keep taskbar highlighted until focused
        $fi.uCount  = 5
      }
      $fi.dwTimeout = 0
      $ok = [WinFlash]::FlashWindowEx([ref]$fi)
      $hit++
      Write-Log ("  -> flash name=$($_.ProcessName) fg=$isFg ok=$ok")
    }
    Write-Log ("  -> flash targets=$($targets -join ',') hit=$hit")
  } catch {
    Write-Log ("  -> flash failed: $($_.Exception.Message)")
  }
}

# ---------------- popup (separate process so the script returns at once) ----------------
if ($Popup) {
  $env:DSH_NOTIFY_TITLE   = $title
  $env:DSH_NOTIFY_MESSAGE = $message
  $psCmd = 'Add-Type -AssemblyName System.Windows.Forms; [void][System.Windows.Forms.MessageBox]::Show($env:DSH_NOTIFY_MESSAGE,$env:DSH_NOTIFY_TITLE,0,48)'
  Start-Process powershell -ArgumentList @('-NoProfile','-WindowStyle','Hidden','-Command',$psCmd) -WindowStyle Hidden | Out-Null
}
