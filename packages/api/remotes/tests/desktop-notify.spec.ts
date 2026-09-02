/**
 * Desktop alert for user-attention events: platform gating, per-kind settings
 * resolution (with hot reload), cooldown collapsing, the exact spawn contract,
 * and the web-host event observers wired in `installDesktopAlertObservers`.
 */

import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { scopeTarget } from '@deepseek-ai/dsh-scope'
import type { SpawnOptions } from 'node:child_process'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { ApprovalOutcome } from '@deepseek-ai/dsh-user-approval'
import {
  DEFAULT_DESKTOP_NOTIFY_SETTINGS,
  DEFAULT_FLASH_WINDOWS,
  DESKTOP_NOTIFY_NAMESPACE,
  installDesktopAlertObservers,
  installDesktopNotify,
  type DesktopNotifyChild,
  type DesktopNotifyHandle,
  type DesktopNotifyInternals,
  type DesktopNotifySettings,
  type NotifyKind,
} from '../src/desktop-notify.ts'

type SpawnCall = [command: string, args: string[], options: SpawnOptions]

function harness(overrides: {
  settings?: unknown
  value?: DesktopNotifySettings
  internals?: Partial<DesktopNotifyInternals>
} = {}) {
  let clock = 0
  const spawn = vi.fn((_command: string, _args: string[], _options: SpawnOptions): DesktopNotifyChild => {
    return { unref: vi.fn() }
  })
  const settings = overrides.settings ?? (overrides.value === undefined
    ? undefined
    : { register: () => ({ get: () => overrides.value }) })
  const ctx = {
    get: (key: string) => key === 'settings' ? settings : undefined,
  } as unknown as Context
  const handle = installDesktopNotify(ctx, {
    platform: 'win32',
    now: () => clock,
    spawn,
    ...overrides.internals,
  } as DesktopNotifyInternals)
  return {
    handle,
    spawn,
    call: (): SpawnCall | undefined => spawn.mock.calls[0] as SpawnCall | undefined,
    calls: () => spawn.mock.calls as SpawnCall[],
    tick: (ms: number) => { clock += ms },
  }
}

/** A minimal top-level (or child) agent double for the observers' status edges. */
function agentDouble(parentSession: unknown = undefined): Agent {
  return {
    id: 'session-1',
    session: { header: { parentSession } },
  } as unknown as Agent
}

/** Register the observers over a fake notify handle and a bare Context. */
function observerHarness() {
  const ctx = new Context()
  const announced: Array<[NotifyKind, Record<string, string | undefined>]> = []
  const notify: DesktopNotifyHandle = { notify: (kind, info = {}) => { announced.push([kind, { ...info }]) } }
  installDesktopAlertObservers(ctx, notify)
  return { ctx, announced }
}

describe('installDesktopNotify', () => {
  it('is a no-op off win32', () => {
    const spawn = vi.fn(() => ({ unref: vi.fn() }))
    const handle = installDesktopNotify(
      { get: () => undefined } as unknown as Context,
      { platform: 'linux', spawn },
    )
    handle.notify('approval', { toolName: 'bash' })
    expect(spawn).not.toHaveBeenCalled()
  })

  it('spawns a plain powershell with the script path, kind, and env payload', () => {
    const { handle, call } = harness()
    handle.notify('approval', { toolName: 'bash', reason: 'escalation' })

    const [command, args, options] = call()!
    expect(command).toBe('powershell.exe')
    const fileIndex = args.indexOf('-File')
    expect(fileIndex).toBeGreaterThan(0)
    expect(args[fileIndex + 1]).toMatch(/desktop-notify\.ps1$/)
    expect(args).toContain('-Flash')
    expect(args).toContain('-Sound')
    expect(args).not.toContain('-Popup')
    expect(args).toContain('-Kind')
    expect(args[args.indexOf('-Kind') + 1]).toBe('approval')
    expect(args).toContain(DEFAULT_FLASH_WINDOWS.join(','))
    // Regression guard: `detached`/`windowsHide` make powershell.exe exit
    // without running the script under the restricted-token sandbox, so the
    // child must be spawned as a plain `stdio: 'ignore'` process.
    expect(options.detached).toBeUndefined()
    expect(options.windowsHide).toBeUndefined()
    expect(options.stdio).toBe('ignore')
    const env = options.env as Record<string, string>
    expect(env.DSH_NOTIFY_TOOL).toBe('bash')
    expect(env.DSH_NOTIFY_MESSAGE).toContain('bash')
    expect(env.DSH_NOTIFY_MESSAGE).toContain('escalation')
    expect(env.DSH_NOTIFY_TITLE).toContain('权限请求')
  })

  it('passes the kind through for question and complete events', () => {
    const { handle, calls, tick } = harness()
    handle.notify('question', { toolName: 'ask_user_question' })
    tick(3000)
    handle.notify('complete', { sessionId: 's1' })

    const questionArgs = calls()[0]![1]
    expect(questionArgs[questionArgs.indexOf('-Kind') + 1]).toBe('question')
    const completeArgs = calls()[1]![1]
    expect(completeArgs[completeArgs.indexOf('-Kind') + 1]).toBe('complete')
    const completeEnv = calls()[1]![2].env as Record<string, string>
    expect(completeEnv.DSH_NOTIFY_MESSAGE).toContain('任务已完成')
    expect(completeEnv.DSH_NOTIFY_TITLE).toContain('任务完成')
  })

  it('respects the per-kind enabled switch independently', () => {
    const { handle, spawn, tick } = harness({
      value: {
        ...DEFAULT_DESKTOP_NOTIFY_SETTINGS,
        question: { enabled: false, sound: true, soundFile: '' },
      },
    })
    handle.notify('question')
    expect(spawn).not.toHaveBeenCalled()
    tick(3000)
    handle.notify('approval', { toolName: 'bash' })
    expect(spawn).toHaveBeenCalledTimes(1)
  })

  it('collapses parallel events inside the cooldown window across kinds', () => {
    const { handle, spawn, tick } = harness()
    handle.notify('approval', { toolName: 'a' })
    tick(1000)
    handle.notify('question')
    expect(spawn).toHaveBeenCalledTimes(1)
    tick(1100)
    handle.notify('complete', { sessionId: 's1' })
    expect(spawn).toHaveBeenCalledTimes(2)
  })

  it('reads the settings namespace per call and hot-reloads it', () => {
    let value = { ...DEFAULT_DESKTOP_NOTIFY_SETTINGS }
    const register = vi.fn(() => ({ get: () => value }))
    const { handle, spawn } = harness({ settings: { register } })

    expect(register).toHaveBeenCalledWith(DESKTOP_NOTIFY_NAMESPACE, expect.anything())
    value = { ...DEFAULT_DESKTOP_NOTIFY_SETTINGS, enabled: false }
    handle.notify('approval', { toolName: 'bash' })
    expect(spawn).not.toHaveBeenCalled()

    value = { ...DEFAULT_DESKTOP_NOTIFY_SETTINGS }
    handle.notify('approval', { toolName: 'bash' })
    expect(spawn).toHaveBeenCalledTimes(1)
  })

  it('falls back to defaults without a settings provider', () => {
    const { handle, calls } = harness()
    handle.notify('approval', { toolName: 'bash' })
    expect(calls()).toHaveLength(1)
  })

  it('stays silent when every channel is off', () => {
    const { handle, spawn } = harness({
      value: {
        ...DEFAULT_DESKTOP_NOTIFY_SETTINGS,
        flash: false,
        popup: false,
        approval: { enabled: true, sound: false, soundFile: '' },
        question: { enabled: true, sound: false, soundFile: '' },
        complete: { enabled: true, sound: false, soundFile: '' },
      },
    })
    handle.notify('approval', { toolName: 'bash' })
    expect(spawn).not.toHaveBeenCalled()
  })

  it('mirrors channel switches and passes a custom sound file through', () => {
    const { handle, call } = harness({
      value: {
        ...DEFAULT_DESKTOP_NOTIFY_SETTINGS,
        flash: false,
        popup: true,
        flashWindows: ['chrome'],
        approval: { enabled: true, sound: true, soundFile: 'C:\\sounds\\ding.wav' },
      },
    })
    handle.notify('approval', { toolName: 'bash' })
    const [, args] = call()!
    expect(args).not.toContain('-Flash')
    expect(args).toContain('-Popup')
    expect(args).toContain('C:\\sounds\\ding.wav')
    expect(args).toContain('chrome')
  })

  it('default flash windows are browsers only, never unrelated terminals', () => {
    // The alert fires from the web host (the dsh UI lives in a browser tab);
    // flashing terminal windows would disturb unrelated console work such as
    // a Windows Terminal running another script.
    const terminals = ['windowsTerminal', 'mintty', 'wezterm-gui', 'alacritty', 'conemu64', 'cmd', 'conhost']
    expect(DEFAULT_FLASH_WINDOWS).toEqual(expect.not.arrayContaining(terminals))
    expect(DEFAULT_FLASH_WINDOWS).toContain('chrome')
    expect(DEFAULT_FLASH_WINDOWS).toContain('msedge')
  })

  it('never throws on a failed spawn', () => {
    const spawn = vi.fn(() => { throw new Error('spawn failed') })
    const handle = installDesktopNotify(
      { get: () => undefined } as unknown as Context,
      { platform: 'win32', now: () => 0, spawn },
    )
    expect(() => handle.notify('approval', { toolName: 'bash' })).not.toThrow()
  })
})

describe('installDesktopAlertObservers', () => {
  it('announces a top-level agent running → idle edge once per run', () => {
    const { ctx, announced } = observerHarness()
    const agent = agentDouble()
    ctx.emit('agent/status', { agent, status: 'running' })
    ctx.emit('agent/status', { agent, status: 'idle' })
    expect(announced).toEqual([['complete', { sessionId: 'session-1' }]])
  })

  it('skips subagents on the completion edge', () => {
    const { ctx, announced } = observerHarness()
    const child = agentDouble('parent-session')
    ctx.emit('agent/status', { agent: child, status: 'running' })
    ctx.emit('agent/status', { agent: child, status: 'idle' })
    expect(announced).toEqual([])
  })

  it('announces approval requests but delegates through the waterfall', async () => {
    const { ctx, announced } = observerHarness()
    const request = { agent: agentDouble(), toolName: 'bash', reason: 'escalation' }
    const outcome = await ctx.waterfall(
      scopeTarget(request.agent, request.agent),
      'approval/request',
      request,
      async (): Promise<ApprovalOutcome> => 'unavailable',
    )
    expect(announced).toEqual([['approval', { toolName: 'bash', reason: 'escalation' }]])
    expect(outcome).toBe('unavailable')
  })

  it('announces user questions but delegates through the waterfall', async () => {
    const { ctx, announced } = observerHarness()
    const request = { agent: agentDouble(), questions: [{ id: 'q1', question: 'pick?' }] }
    let tailReached = false
    const outcome = await ctx.waterfall(
      scopeTarget(request.agent, request.agent),
      'user-questions/request',
      request,
      async () => { tailReached = true; return { answers: [] } },
    )
    expect(announced).toEqual([['question', { toolName: 'ask_user_question' }]])
    expect(tailReached).toBe(true)
    expect(outcome).toEqual({ answers: [] })
  })
})
