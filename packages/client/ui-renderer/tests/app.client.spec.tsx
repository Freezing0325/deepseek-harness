// @vitest-environment jsdom
/**
 * buildRenderApp on SlotTestRuntime: the fail-loud sessions precondition, the
 * one ctx-level renderSlot('root') call, and the document-title projection
 * arms over the real slot stack.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { Context } from '@deepseek-ai/cordis'
import { SlotTestRuntime } from '@deepseek-ai/dsh-client-test-runtime'
import type { SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import { buildRenderApp } from '../src/client/app.tsx'

let runtime: SlotTestRuntime | undefined

afterEach(async () => {
  cleanup()
  await runtime?.dispose()
  runtime = undefined
  document.title = ''
  vi.unstubAllEnvs()
  delete (document as unknown as Record<string, unknown>).hidden
  vi.useRealTimers()
})

async function bench() {
  runtime = await SlotTestRuntime.create()
  await runtime.root.declare({}, () => <div data-testid="frame" />)
  return { runtime, renderApp: buildRenderApp({ ctx: runtime.ctx }) }
}

describe('buildRenderApp', () => {
  it('fails loud when the sessions service is unavailable', () => {
    expect(() => buildRenderApp({ ctx: new Context() })).toThrow('sessions service unavailable')
  })

  it('renders the root slot tree', async () => {
    const b = await bench()
    const view = render(<>{b.renderApp()}</>)
    expect(view.getByTestId('frame')).toBeTruthy()
  })

  it('projects the selected durable session title', async () => {
    vi.stubEnv('DSH_CLIENT_TITLE', 'Product')
    document.title = 'stale title'
    const b = await bench()
    render(<>{b.renderApp()}</>)
    expect(document.title).toBe('Product')
    await b.runtime.sessions.add({ id: 's1', summary: { title: 'First' } })
    expect(document.title).toBe('First — Product')
    await b.runtime.sessions.setCurrent(undefined)
    expect(document.title).toBe('Product')
    await b.runtime.sessions.add({ id: 's2' })
    expect(document.title).toBe('Product')
  })

  it('falls back when the selected id has no list row', async () => {
    vi.stubEnv('DSH_CLIENT_TITLE', 'Product')
    document.title = 'stale title'
    const b = await bench()
    await b.runtime.sessions.add({ id: 's1', summary: { title: 'First' } })
    render(<>{b.renderApp()}</>)
    expect(document.title).toBe('First — Product')
    b.runtime.sessions.list.update((draft) => { draft.current = 'ghost' as SessionId })
    await b.runtime.flush()
    expect(document.title).toBe('Product')
  })

  it('flashes the tab title while a session waits on the user and stops when it is gone', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    vi.stubEnv('DSH_CLIENT_TITLE', 'Product')
    document.title = 'Product'
    Object.defineProperty(document, 'hidden', { configurable: true, value: true })
    const b = await bench()
    render(<>{b.renderApp()}</>)
    expect(document.title).toBe('Product')
    await b.runtime.sessions.add({ id: 's1', summary: { pendingInteraction: 'approval' } })
    vi.advanceTimersByTime(1000)
    expect(document.title).toBe('⚠️ 待审批')
    await b.runtime.sessions.remove('s1')
    expect(document.title).toBe('Product')
    vi.advanceTimersByTime(5000)
    expect(document.title).toBe('Product')
  })
})
