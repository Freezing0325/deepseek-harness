/**
 * Windows desktop alert fired by the web host for user-attention events.
 *
 * The approval badge in the Web UI is quiet by design; a user working in
 * another window misses it and the agent stalls. On approval, question, and
 * task-completion events the host spawns a fire-and-forget PowerShell child
 * (win32 only) that flashes the dsh browser taskbar icons and plays a sound.
 * Everything is fire-and-forget — no output is captured, no handle is kept —
 * so an alert can never delay or fail the event channel.
 *
 * Behavior is read from the `desktop-notify` settings namespace on each call
 * (hot-reloaded from the user document); off win32 the install is a no-op,
 * and a missing settings provider falls back to the defaults below. Each kind
 * carries its own sound switch and optional .wav; the default system sound
 * differs per kind (approval = exclamation, question = question, complete =
 * asterisk).
 *
 * @module @deepseek-ai/dsh-api-remotes/desktop-notify
 */

import { spawn } from 'node:child_process'
import type { SpawnOptions } from 'node:child_process'
import { performance } from 'node:perf_hooks'
import { fileURLToPath } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { SettingsScope } from '@deepseek-ai/dsh-settings'
import type { Agent, AgentStatus } from '@deepseek-ai/dsh-agent'
import type { ApprovalRequest } from '@deepseek-ai/dsh-user-approval'
import type { AskUserQuestionRequest } from '@deepseek-ai/dsh-user-questions'

/** The settings namespace carrying the desktop-alert switches. */
export const DESKTOP_NOTIFY_NAMESPACE = 'desktop-notify'

/** The user-attention events the host can announce. */
export type NotifyKind = 'approval' | 'question' | 'complete'

/** Per-kind alert switches; each kind may choose its own sound. */
export interface DesktopNotifyEventSettings {
  /** Whether this kind announces at all (overrides the master switch for this kind). */
  enabled: boolean
  /** Whether this kind plays its sound. */
  sound: boolean
  /** Custom .wav for this kind; empty = the kind's default system sound. */
  soundFile: string
}

/** Alert channels and per-kind switches. */
export interface DesktopNotifySettings {
  /** Master switch; false silences every channel. */
  enabled: boolean
  /** QQ-style taskbar flash on the dsh browser windows. */
  flash: boolean
  /** Foreground message box; off by default. */
  popup: boolean
  /** Process names whose windows flash; empty = the built-in browser list. */
  flashWindows: string[]
  approval: DesktopNotifyEventSettings
  question: DesktopNotifyEventSettings
  complete: DesktopNotifyEventSettings
}

/**
 * Process names the flash step targets when {@link DesktopNotifySettings.flashWindows} is empty.
 * Browsers only: the alert fires from the web host, where the dsh UI lives in
 * a browser tab — a CLI run never passes through this module, so flashing
 * terminal windows would only disturb unrelated console windows.
 */
export const DEFAULT_FLASH_WINDOWS = [
  'chrome', 'msedge', 'firefox', 'brave', 'opera', 'vivaldi',
]

/** Default system sound name per kind, used when the kind's soundFile is empty. */
export const DEFAULT_KIND_SOUNDS: Record<NotifyKind, string> = {
  approval: 'exclamation',
  question: 'question',
  complete: 'asterisk',
}

/** Defaults for one kind's switches; every field is always present. */
const DEFAULT_EVENT_SETTINGS: DesktopNotifyEventSettings = {
  enabled: true,
  sound: true,
  soundFile: '',
}

/** The composed defaults; every field is always present. */
export const DEFAULT_DESKTOP_NOTIFY_SETTINGS: DesktopNotifySettings = {
  enabled: true,
  flash: true,
  popup: false,
  flashWindows: [...DEFAULT_FLASH_WINDOWS],
  approval: { ...DEFAULT_EVENT_SETTINGS },
  question: { ...DEFAULT_EVENT_SETTINGS },
  complete: { ...DEFAULT_EVENT_SETTINGS },
}

const desktopNotifyEventSettingsSchema: z<DesktopNotifyEventSettings> = z.object({
  enabled: z.boolean().default(true),
  sound: z.boolean().default(true),
  soundFile: z.string().default(''),
})

const desktopNotifySettingsSchema: z<DesktopNotifySettings> = z.object({
  enabled: z.boolean().default(true),
  flash: z.boolean().default(true),
  popup: z.boolean().default(false),
  flashWindows: z.array(z.string()).default([...DEFAULT_FLASH_WINDOWS]),
  approval: desktopNotifyEventSettingsSchema.default({ ...DEFAULT_EVENT_SETTINGS }),
  question: desktopNotifyEventSettingsSchema.default({ ...DEFAULT_EVENT_SETTINGS }),
  complete: desktopNotifyEventSettingsSchema.default({ ...DEFAULT_EVENT_SETTINGS }),
})

/** Minimum spacing between two alerts; bursts of parallel events collapse into one. */
const COOLDOWN_MS = 2000

/** The only child-process surface the notifier touches. */
export interface DesktopNotifyChild {
  /** Detach the child so the host can exit without waiting for it. */
  unref(): void
}

/** Injectable seams for deterministic tests. */
export interface DesktopNotifyInternals {
  /** Platform override; defaults to `process.platform`. */
  platform?: NodeJS.Platform
  /** Clock override for the cooldown window; defaults to `performance.now`. */
  now?: () => number
  /** Spawn override; defaults to `node:child_process` spawn. */
  spawn?: (command: string, args: readonly string[], options: SpawnOptions) => DesktopNotifyChild
}

/** One user-attention event's alert payload. */
export interface NotifyEventInfo {
  /** The tool or interaction asking for attention, when the event is tool-scoped. */
  toolName?: string
  /** The escalation reason the tool gave, when present (approval). */
  reason?: string
  /** The owning session id, when the event is session-scoped (complete). */
  sessionId?: string
}

/** The host-side alert entry point installed by {@link installDesktopNotify}. */
export interface DesktopNotifyHandle {
  /**
   * Alert the user about one attention event unless disabled, off win32, or
   * still inside the cooldown window. Never throws and never blocks.
   * @param kind - the event kind to announce.
   * @param info - event-specific payload.
   */
  notify(kind: NotifyKind, info?: NotifyEventInfo): void
}

function defaultSpawn(command: string, args: readonly string[], options: SpawnOptions): DesktopNotifyChild {
  return spawn(command, [...args], options)
}

/** User-facing title for one event kind (browser alert payload). */
function titleFor(kind: NotifyKind): string {
  switch (kind) {
    case 'approval': return 'DeepSeek Harness 权限请求'
    case 'question': return 'DeepSeek Harness 提问'
    case 'complete': return 'DeepSeek Harness 任务完成'
  }
}

/** User-facing message for one event kind and its payload. */
function messageFor(kind: NotifyKind, info: NotifyEventInfo): string {
  switch (kind) {
    case 'approval':
      return info.reason === undefined
        ? `工具 ${info.toolName ?? '未知'} 正在请求权限，请回到页面确认。`
        : `工具 ${info.toolName ?? '未知'} 请求权限：${info.reason}`
    case 'question':
      return 'dsh 正在向你提问，请回到页面回答。'
    case 'complete':
      return '任务已完成，请回到页面查看。'
  }
}

/**
 * Install the desktop alert on this fiber. Registers the `desktop-notify`
 * settings namespace when a settings provider is mounted; the returned handle
 * reads the resolved value on every call, so edits to the user document apply
 * without a restart.
 * @param ctx - the calling plugin context.
 * @param internals - test seams; production callers omit them.
 * @returns the alert handle; a no-op off win32.
 */
export function installDesktopNotify(
  ctx: Context,
  internals: DesktopNotifyInternals = {},
): DesktopNotifyHandle {
  const platform = internals.platform ?? process.platform
  if (platform !== 'win32') return { notify: () => {} }

  const scriptPath = fileURLToPath(new URL('../scripts/desktop-notify.ps1', import.meta.url))
  const settings = ctx.get('settings')
  const scope: SettingsScope<DesktopNotifySettings> | undefined =
    settings === undefined
      ? undefined
      : settings.register(DESKTOP_NOTIFY_NAMESPACE, desktopNotifySettingsSchema)
  const config = (): DesktopNotifySettings => scope?.get() ?? DEFAULT_DESKTOP_NOTIFY_SETTINGS

  const now = internals.now ?? (() => performance.now())
  const run = internals.spawn ?? defaultSpawn
  let lastAlertAt = Number.NEGATIVE_INFINITY

  return {
    notify(kind, info = {}) {
      const cfg = config()
      const event = cfg[kind]
      if (!cfg.enabled || !event.enabled) return
      if (!cfg.flash && !event.sound && !cfg.popup) return
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
        if (event.sound) args.push('-Sound')
        if (cfg.popup) args.push('-Popup')
        args.push('-Kind', kind, '-SoundFile', event.soundFile, '-FlashWindows', cfg.flashWindows.join(','))
        // Never pass `detached` or `windowsHide` here: under the harness's
        // restricted-token sandbox those flags make powershell.exe exit
        // silently (exit 0) without running the script, so the alert never
        // fires. Plain `stdio: 'ignore'` + the script's own
        // `-WindowStyle Hidden` argument stays quiet and actually executes;
        // `unref()` keeps the host free of the child.
        run('powershell.exe', args, {
          env: {
            ...process.env,
            DSH_NOTIFY_TITLE: titleFor(kind),
            DSH_NOTIFY_MESSAGE: messageFor(kind, info),
            DSH_NOTIFY_TOOL: info.toolName ?? '',
          },
          stdio: 'ignore',
        }).unref()
      } catch {
        // A missing powershell.exe or a failed spawn must never surface on
        // the event path; the alert is best-effort by contract.
      }
    },
  }
}

/**
 * Wire the web host's user-attention events to the desktop alert: an approval
 * request, a user question, and a top-level task finishing (agent running →
 * idle). Each listener is an observer — it announces and then delegates
 * (waterfall listeners call `next()`), so the alert can never stall or change
 * the forwarded event semantics.
 * @param ctx - the web-host plugin context whose Cordis events carry the
 *   user-attention signals.
 * @param notify - the alert handle; defaults to {@link installDesktopNotify}.
 */
export function installDesktopAlertObservers(
  ctx: Context,
  notify: DesktopNotifyHandle = installDesktopNotify(ctx),
): void {
  // Task-completion alert: the agent running → idle edge. Track the last seen
  // status per session so the alert fires once per run, and skip subagents —
  // only a top-level task finishing deserves a desktop alert.
  const lastRunning = new Map<string, boolean>()
  ctx.on('agent/status', ({ agent, status }: { agent: Agent; status: AgentStatus }) => {
    const running = status === 'running'
    const wasRunning = lastRunning.get(String(agent.id)) ?? false
    lastRunning.set(String(agent.id), running)
    if (wasRunning && !running && agent.session.header.parentSession === undefined) {
      notify.notify('complete', { sessionId: String(agent.id) })
    }
  })

  // Approval alert: every approval request the browser is asked to answer.
  ctx.on('approval/request', (request: ApprovalRequest, next) => {
    notify.notify('approval', {
      toolName: request.toolName,
      ...request.reason === undefined ? {} : { reason: request.reason },
    })
    return next()
  })

  // Question alert: every ask_user_question the browser is asked to answer.
  ctx.on('user-questions/request', (_request: AskUserQuestionRequest, next) => {
    notify.notify('question', { toolName: 'ask_user_question' })
    return next()
  })
}
