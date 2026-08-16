/**
 * Permission-request desktop alert: platform gating, settings resolution
 * (with hot reload), cooldown collapsing, and the exact spawn contract.
 */

import { describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import type { SpawnOptions } from 'node:child_process'
import {
  DEFAULT_FLASH_WINDOWS,
  DEFAULT_PERMISSION_NOTIFY_SETTINGS,
  installPermissionNotify,
  PERMISSION_NOTIFY_NAMESPACE,
  type PermissionNotifyChild,
  type PermissionNotifyInternals,
  type PermissionNotifySettings,
} from '../src/permission-notify.ts'

type SpawnCall = [command: string, args: string[], options: SpawnOptions]

function harness(overrides: {
  settings?: unknown
  value?: PermissionNotifySettings
  internals?: Partial<PermissionNotifyInternals>
} = {}) {
  let clock = 0
  const spawn = vi.fn((_command: string, _args: string[], _options: SpawnOptions): PermissionNotifyChild => {
    return { unref: vi.fn() }
  })
  const settings = overrides.settings ?? (overrides.value === undefined
    ? undefined
    : { register: () => ({ get: () => overrides.value }) })
  const ctx = {
    get: (key: string) => key === 'settings' ? settings : undefined,
  } as unknown as Context
  const handle = installPermissionNotify(ctx, {
    platform: 'win32',
    now: () => clock,
    spawn,
    ...overrides.internals,
  } as PermissionNotifyInternals)
  return {
    handle,
    spawn,
    call: (): SpawnCall | undefined => spawn.mock.calls[0] as SpawnCall | undefined,
    calls: () => spawn.mock.calls as SpawnCall[],
    tick: (ms: number) => { clock += ms },
  }
}

describe('installPermissionNotify', () => {
  it('is a no-op off win32', () => {
    const spawn = vi.fn(() => ({ unref: vi.fn() }))
    const handle = installPermissionNotify(
      { get: () => undefined } as unknown as Context,
      { platform: 'linux', spawn },
    )
    handle.notify({ toolName: 'bash' })
    expect(spawn).not.toHaveBeenCalled()
  })

  it('spawns detached powershell with the script path and env payload', () => {
    const { handle, call } = harness()
    handle.notify({ toolName: 'bash', reason: 'escalation' })

    const [command, args, options] = call()!
    expect(command).toBe('powershell.exe')
    const fileIndex = args.indexOf('-File')
    expect(fileIndex).toBeGreaterThan(0)
    expect(args[fileIndex + 1]).toMatch(/permission-notify\.ps1$/)
    expect(args).toContain('-Flash')
    expect(args).toContain('-Sound')
    expect(args).not.toContain('-Popup')
    expect(args).toContain(DEFAULT_FLASH_WINDOWS.join(','))
    expect(options.detached).toBe(true)
    expect(options.stdio).toBe('ignore')
    expect(options.windowsHide).toBe(true)
    const env = options.env as Record<string, string>
    expect(env.DSH_NOTIFY_TOOL).toBe('bash')
    expect(env.DSH_NOTIFY_MESSAGE).toContain('bash')
    expect(env.DSH_NOTIFY_MESSAGE).toContain('escalation')
    expect(env.DSH_NOTIFY_TITLE).toContain('权限请求')
  })

  it('collapses parallel approvals inside the cooldown window', () => {
    const { handle, spawn, tick } = harness()
    handle.notify({ toolName: 'a' })
    tick(1000)
    handle.notify({ toolName: 'b' })
    expect(spawn).toHaveBeenCalledTimes(1)
    tick(1100)
    handle.notify({ toolName: 'c' })
    expect(spawn).toHaveBeenCalledTimes(2)
  })

  it('reads the settings namespace per request and hot-reloads it', () => {
    let value = { ...DEFAULT_PERMISSION_NOTIFY_SETTINGS }
    const register = vi.fn(() => ({ get: () => value }))
    const { handle, spawn } = harness({ settings: { register } })

    expect(register).toHaveBeenCalledWith(PERMISSION_NOTIFY_NAMESPACE, expect.anything())
    value = { ...DEFAULT_PERMISSION_NOTIFY_SETTINGS, enabled: false }
    handle.notify({ toolName: 'bash' })
    expect(spawn).not.toHaveBeenCalled()

    value = { ...DEFAULT_PERMISSION_NOTIFY_SETTINGS }
    handle.notify({ toolName: 'bash' })
    expect(spawn).toHaveBeenCalledTimes(1)
  })

  it('falls back to defaults without a settings provider', () => {
    const { handle, calls } = harness()
    handle.notify({ toolName: 'bash' })
    expect(calls()).toHaveLength(1)
  })

  it('stays silent when every channel is off', () => {
    const { handle, spawn } = harness({
      value: { ...DEFAULT_PERMISSION_NOTIFY_SETTINGS, flash: false, sound: false, popup: false },
    })
    handle.notify({ toolName: 'bash' })
    expect(spawn).not.toHaveBeenCalled()
  })

  it('mirrors channel switches and passes a custom sound file through', () => {
    const { handle, call } = harness({
      value: {
        ...DEFAULT_PERMISSION_NOTIFY_SETTINGS,
        flash: false,
        popup: true,
        soundFile: 'C:\\sounds\\ding.wav',
        flashWindows: ['chrome'],
      },
    })
    handle.notify({ toolName: 'bash' })
    const [, args] = call()!
    expect(args).not.toContain('-Flash')
    expect(args).toContain('-Popup')
    expect(args).toContain('C:\\sounds\\ding.wav')
    expect(args).toContain('chrome')
  })

  it('never throws on a failed spawn', () => {
    const spawn = vi.fn(() => { throw new Error('spawn failed') })
    const handle = installPermissionNotify(
      { get: () => undefined } as unknown as Context,
      { platform: 'win32', now: () => 0, spawn },
    )
    expect(() => handle.notify({ toolName: 'bash' })).not.toThrow()
  })
})
