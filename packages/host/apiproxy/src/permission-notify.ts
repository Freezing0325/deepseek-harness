/**
 * Windows desktop alert fired when the Web carrier requests an approval.
 *
 * The approval badge in the Web UI is quiet by design; a user working in
 * another window misses it and the agent stalls. This module ports the Claude
 * Code notification recipe (taskbar flash + chime) to the host side: on every
 * broadcast `approval/requested` the proxy spawns a fire-and-forget PowerShell
 * child (win32 only) that flashes the dsh browser/terminal taskbar icons and
 * plays a sound. Everything is fire-and-forget — no output is captured, no
 * handle is kept — so an alert can never delay or fail the approval channel.
 *
 * Behavior is read from the `permission-notify` settings namespace on each
 * request (hot-reloaded from the user document); off win32 the install is a
 * no-op, and a missing settings provider falls back to the defaults below.
 *
 * @module dsh-apiproxy/permission-notify
 */

import { spawn } from 'node:child_process'
import type { SpawnOptions } from 'node:child_process'
import { performance } from 'node:perf_hooks'
import { fileURLToPath } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { settingsNamespace } from '@deepseek-ai/dsh-settings'
import type { SettingsScope } from '@deepseek-ai/dsh-settings'

/** Settings namespace carrying the permission-request alert switches. */
export const PERMISSION_NOTIFY_NAMESPACE = settingsNamespace('permission-notify')

/** Alert channels and their defaults. */
export interface PermissionNotifySettings {
  /** Master switch; false silences every channel. */
  enabled: boolean
  /** QQ-style taskbar flash on the dsh browser windows. */
  flash: boolean
  /** System exclamation chime, or the configured {@link soundFile}. */
  sound: boolean
  /** Foreground message box; off by default. */
  popup: boolean
  /** Optional .wav path played instead of the system chime; empty = system sound. */
  soundFile: string
  /** Process names whose windows flash; empty = the built-in browser list. */
  flashWindows: string[]
}

/**
 * Process names the flash step targets when {@link PermissionNotifySettings.flashWindows} is empty.
 * Browsers only: the alert fires from the web host (apiproxy), where the dsh
 * UI lives in a browser tab — a CLI run never passes through this module, so
 * flashing terminal windows would only disturb unrelated console windows
 * (e.g. a Windows Terminal running an unrelated script).
 */
export const DEFAULT_FLASH_WINDOWS = [
  'chrome', 'msedge', 'firefox', 'brave', 'opera', 'vivaldi',
]

/** The composed defaults; every field is always present. */
export const DEFAULT_PERMISSION_NOTIFY_SETTINGS: PermissionNotifySettings = {
  enabled: true,
  flash: true,
  sound: true,
  popup: false,
  soundFile: '',
  flashWindows: [...DEFAULT_FLASH_WINDOWS],
}

const permissionNotifySettingsSchema: z<PermissionNotifySettings> = z.object({
  enabled: z.boolean().default(true),
  flash: z.boolean().default(true),
  sound: z.boolean().default(true),
  popup: z.boolean().default(false),
  soundFile: z.string().default(''),
  flashWindows: z.array(z.string()).default([...DEFAULT_FLASH_WINDOWS]),
})

/** Minimum spacing between two alerts; bursts of parallel approvals collapse into one. */
const COOLDOWN_MS = 2000

/** The only child-process surface the notifier touches. */
export interface PermissionNotifyChild {
  /** Detach the child so the host can exit without waiting for it. */
  unref(): void
}

/** Injectable seams for deterministic tests. */
export interface PermissionNotifyInternals {
  /** Platform override; defaults to `process.platform`. */
  platform?: NodeJS.Platform
  /** Clock override for the cooldown window; defaults to `performance.now`. */
  now?: () => number
  /** Spawn override; defaults to `node:child_process` spawn. */
  spawn?: (command: string, args: readonly string[], options: SpawnOptions) => PermissionNotifyChild
}

/** One approval request's alert payload. */
export interface PermissionRequestInfo {
  /** The tool asking for permission. */
  toolName: string
  /** The escalation reason the tool gave, when present. */
  reason?: string
}

/** The host-side alert entry point installed by {@link installPermissionNotify}. */
export interface PermissionNotifyHandle {
  /**
   * Alert the user about one approval request unless disabled, off win32, or
   * still inside the cooldown window. Never throws and never blocks.
   * @param info - the approval request to announce.
   */
  notify(info: PermissionRequestInfo): void
}

function defaultSpawn(command: string, args: readonly string[], options: SpawnOptions): PermissionNotifyChild {
  return spawn(command, [...args], options)
}

/**
 * Install the permission-request desktop alert on this fiber. Registers the
 * `permission-notify` settings namespace when a settings provider is mounted;
 * the returned handle reads the resolved value on every call, so edits to the
 * user document apply without a restart.
 * @param ctx - the calling plugin context.
 * @param internals - test seams; production callers omit them.
 * @returns the alert handle; a no-op off win32.
 */
export function installPermissionNotify(
  ctx: Context,
  internals: PermissionNotifyInternals = {},
): PermissionNotifyHandle {
  const platform = internals.platform ?? process.platform
  if (platform !== 'win32') return { notify: () => {} }

  const scriptPath = fileURLToPath(new URL('../scripts/permission-notify.ps1', import.meta.url))
  const settings = ctx.get('settings')
  const scope: SettingsScope<PermissionNotifySettings> | undefined =
    settings === undefined
      ? undefined
      : settings.register(PERMISSION_NOTIFY_NAMESPACE, permissionNotifySettingsSchema)
  const config = (): PermissionNotifySettings => scope?.get() ?? DEFAULT_PERMISSION_NOTIFY_SETTINGS

  const now = internals.now ?? (() => performance.now())
  const run = internals.spawn ?? defaultSpawn
  let lastAlertAt = Number.NEGATIVE_INFINITY

  return {
    notify(info) {
      const cfg = config()
      if (!cfg.enabled || (!cfg.flash && !cfg.sound && !cfg.popup)) return
      const at = now()
      if (at - lastAlertAt < COOLDOWN_MS) return
      lastAlertAt = at
      try {
        // Switch flags are passed present/absent (never `-Flash:$false`):
        // `powershell -File` binds every following token as a string, and a
        // `"$false"` string fails SwitchParameter conversion in PS 5.1.
        const args = [
          '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden',
          '-File', scriptPath,
        ]
        if (cfg.flash) args.push('-Flash')
        if (cfg.sound) args.push('-Sound')
        if (cfg.popup) args.push('-Popup')
        args.push('-SoundFile', cfg.soundFile, '-FlashWindows', cfg.flashWindows.join(','))
        run('powershell.exe', args, {
          env: {
            ...process.env,
            DSH_NOTIFY_TITLE: 'DeepSeek Harness 权限请求',
            DSH_NOTIFY_MESSAGE: info.reason === undefined
              ? `工具 ${info.toolName} 正在请求权限，请回到页面确认。`
              : `工具 ${info.toolName} 请求权限：${info.reason}`,
            DSH_NOTIFY_TOOL: info.toolName,
          },
          // Never pass `detached` or `windowsHide` here: under the harness's
          // restricted-token sandbox those flags make powershell.exe exit
          // silently (exit 0) without running the script, so the alert never
          // fires. Plain `stdio: 'ignore'` + the script's own
          // `-WindowStyle Hidden` argument stays quiet and actually executes;
          // `unref()` keeps the host free of the child.
          stdio: 'ignore',
        }).unref()
      } catch {
        // A missing powershell.exe or a failed spawn must never surface on
        // the approval path; the alert is best-effort by contract.
      }
    },
  }
}
