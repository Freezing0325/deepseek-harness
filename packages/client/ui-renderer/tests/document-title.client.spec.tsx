// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { DocumentTitle } from '../src/client/DocumentTitle.tsx'

afterEach(() => {
  cleanup()
  document.title = ''
  vi.unstubAllEnvs()
  delete (document as unknown as Record<string, unknown>).hidden
  vi.useRealTimers()
})

/** Force the jsdom document into the given hidden state for the flash specs. */
function setHidden(hidden: boolean): void {
  Object.defineProperty(document, 'hidden', { configurable: true, value: hidden })
}

describe('DocumentTitle', () => {
  it('projects a durable title and restores the product title', () => {
    vi.stubEnv('DSH_CLIENT_TITLE', 'DeepSeek Harness')
    document.title = 'stale title'
    const mounted = render(<DocumentTitle />)
    expect(document.title).toBe('DeepSeek Harness')
    mounted.rerender(<DocumentTitle title="First title" />)
    expect(document.title).toBe('First title — DeepSeek Harness')
    mounted.rerender(<DocumentTitle title="Revised title" />)
    expect(document.title).toBe('Revised title — DeepSeek Harness')
    mounted.rerender(<DocumentTitle />)
    expect(document.title).toBe('DeepSeek Harness')
    mounted.unmount()
    expect(document.title).toBe('DeepSeek Harness')
  })

  it('uses the generic title when the build provides no title', () => {
    vi.stubEnv('DSH_CLIENT_TITLE', '')
    delete process.env.DSH_CLIENT_TITLE
    const mounted = render(<DocumentTitle title="First title" />)
    expect(document.title).toBe('First title — DSH Local Build')
    mounted.unmount()
    expect(document.title).toBe('DSH Local Build')
  })
})

describe('DocumentTitle pending-interaction attention', () => {
  it('alternates the attention title only while the tab is hidden and pending', () => {
    vi.useFakeTimers()
    document.title = 'DeepSeek Harness'
    setHidden(true)
    render(<DocumentTitle pendingInteraction />)
    // The interval has not ticked yet; the projected title stands.
    expect(document.title).toBe('DeepSeek Harness')
    vi.advanceTimersByTime(1000)
    expect(document.title).toBe('⚠️ 待审批')
    vi.advanceTimersByTime(1000)
    expect(document.title).toBe('DeepSeek Harness')
  })

  it('restores the projected title when the tab becomes visible', () => {
    vi.useFakeTimers()
    document.title = 'DeepSeek Harness'
    setHidden(true)
    render(<DocumentTitle title="First title" pendingInteraction />)
    vi.advanceTimersByTime(1000)
    expect(document.title).toBe('⚠️ 待审批')
    setHidden(false)
    document.dispatchEvent(new Event('visibilitychange'))
    expect(document.title).toBe('First title — DeepSeek Harness')
    vi.advanceTimersByTime(5000)
    expect(document.title).toBe('First title — DeepSeek Harness')
  })

  it('stops flashing and restores the projected title when nothing is pending', () => {
    vi.useFakeTimers()
    document.title = 'DeepSeek Harness'
    setHidden(true)
    const mounted = render(<DocumentTitle pendingInteraction />)
    vi.advanceTimersByTime(1000)
    expect(document.title).toBe('⚠️ 待审批')
    mounted.rerender(<DocumentTitle />)
    expect(document.title).toBe('DeepSeek Harness')
    vi.advanceTimersByTime(5000)
    expect(document.title).toBe('DeepSeek Harness')
  })

  it('does not flash while the tab is visible', () => {
    vi.useFakeTimers()
    document.title = 'DeepSeek Harness'
    setHidden(false)
    render(<DocumentTitle pendingInteraction />)
    vi.advanceTimersByTime(5000)
    expect(document.title).toBe('DeepSeek Harness')
  })
})
