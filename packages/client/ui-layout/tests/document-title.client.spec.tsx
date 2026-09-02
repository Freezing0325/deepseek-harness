// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { DocumentTitle } from '../src/client/DocumentTitle.tsx'

afterEach(() => {
  cleanup()
  document.title = ''
  vi.unstubAllEnvs()
  vi.useRealTimers()
})

const PRODUCT_TITLE = 'DeepSeek Harness'
const ATTENTION_TITLE = '⚠️ 待处理'

describe('DocumentTitle', () => {
  it('projects a durable title and restores the product title', () => {
    document.title = 'stale title'
    const mounted = render(<DocumentTitle productTitle={PRODUCT_TITLE} attentionTitle={ATTENTION_TITLE} />)
    expect(document.title).toBe(PRODUCT_TITLE)
    mounted.rerender(<DocumentTitle title="First title" productTitle={PRODUCT_TITLE} attentionTitle={ATTENTION_TITLE} />)
    expect(document.title).toBe('First title — DeepSeek Harness')
    mounted.rerender(<DocumentTitle title="Revised title" productTitle={PRODUCT_TITLE} attentionTitle={ATTENTION_TITLE} />)
    expect(document.title).toBe('Revised title — DeepSeek Harness')
    mounted.rerender(<DocumentTitle productTitle={PRODUCT_TITLE} attentionTitle={ATTENTION_TITLE} />)
    expect(document.title).toBe(PRODUCT_TITLE)
    mounted.unmount()
    expect(document.title).toBe(PRODUCT_TITLE)
  })

  it('uses the generic product title when the build provides no title', () => {
    const mounted = render(<DocumentTitle title="First title" productTitle="DSH Local Build" attentionTitle={ATTENTION_TITLE} />)
    expect(document.title).toBe('First title — DSH Local Build')
    mounted.unmount()
    expect(document.title).toBe('DSH Local Build')
  })
})

describe('DocumentTitle pending-interaction attention', () => {
  function hidden(value: boolean): () => void {
    Object.defineProperty(document, 'hidden', { configurable: true, value })
    return () => { Object.defineProperty(document, 'hidden', { configurable: true, value: false }) }
  }

  it('alternates the attention title only while the tab is hidden and pending', () => {
    vi.useFakeTimers()
    const unhide = hidden(true)
    document.title = PRODUCT_TITLE
    render(<DocumentTitle productTitle={PRODUCT_TITLE} attentionTitle={ATTENTION_TITLE} pendingInteraction />)
    expect(document.title).toBe(PRODUCT_TITLE)
    vi.advanceTimersByTime(1000)
    expect(document.title).toBe(ATTENTION_TITLE)
    vi.advanceTimersByTime(1000)
    expect(document.title).toBe(PRODUCT_TITLE)
    unhide()
  })

  it('restores the projected title when the tab becomes visible', () => {
    vi.useFakeTimers()
    const unhide = hidden(true)
    render(<DocumentTitle title="First title" productTitle={PRODUCT_TITLE} attentionTitle={ATTENTION_TITLE} pendingInteraction />)
    vi.advanceTimersByTime(1000)
    expect(document.title).toBe(ATTENTION_TITLE)
    unhide()
    document.dispatchEvent(new Event('visibilitychange'))
    expect(document.title).toBe('First title — DeepSeek Harness')
  })

  it('stops flashing and restores the projected title when nothing is pending', () => {
    vi.useFakeTimers()
    const unhide = hidden(true)
    const mounted = render(<DocumentTitle productTitle={PRODUCT_TITLE} attentionTitle={ATTENTION_TITLE} pendingInteraction />)
    vi.advanceTimersByTime(1000)
    expect(document.title).toBe(ATTENTION_TITLE)
    mounted.rerender(<DocumentTitle productTitle={PRODUCT_TITLE} attentionTitle={ATTENTION_TITLE} />)
    vi.advanceTimersByTime(1000)
    expect(document.title).toBe(PRODUCT_TITLE)
    unhide()
  })

  it('does not flash while the tab is visible', () => {
    vi.useFakeTimers()
    const unhide = hidden(false)
    render(<DocumentTitle productTitle={PRODUCT_TITLE} attentionTitle={ATTENTION_TITLE} pendingInteraction />)
    expect(document.title).toBe(PRODUCT_TITLE)
    vi.advanceTimersByTime(3000)
    expect(document.title).toBe(PRODUCT_TITLE)
    unhide()
  })
})
