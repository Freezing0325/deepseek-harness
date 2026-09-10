// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render } from '@testing-library/react'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-test-runtime'
import type { SessionListState } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { DocumentTitle } from '../src/client/DocumentTitle.tsx'
import type { MainPanelId, PanelInfo } from '../src/client/service.ts'

let originalTitle: string
beforeEach(() => { originalTitle = document.title })
afterEach(() => {
  try { cleanup() } finally {
    document.title = originalTitle
    vi.useRealTimers()
  }
})

const PRODUCT_TITLE = 'DeepSeek Harness'
const ATTENTION_TITLE = '⚠️ 待处理'

function titleSources() {
  const sessionId = 'session-title' as SessionId
  const sessions = createSnapshotStore<SessionListState>({
    ids: [sessionId],
    byId: { [sessionId]: { id: sessionId, displayTitle: 'Test', running: false, blank: false, updatedAt: 1 } },
    current: sessionId,
    phase: 'ready',
    subagentsByParent: {},
    jobsBySession: {},
    currentAddress: undefined,
  })
  const panelInfo = createSnapshotStore<PanelInfo>({ activePanelId: null })
  return {
    sessionId, sessions, panelInfo,
    props: { useSessions: bindSnapshotSelector(sessions), usePanelInfo: bindSnapshotSelector(panelInfo) },
  }
}

describe('DocumentTitle', () => {
  it('projects a durable title and restores the product title', () => {
    const { sessionId, sessions, props } = titleSources()
    document.title = 'stale title'
    const mounted = render(<DocumentTitle {...props} productTitle={PRODUCT_TITLE} attentionTitle={ATTENTION_TITLE} />)
    expect(document.title).toBe(PRODUCT_TITLE)
    act(() => { sessions.update((state) => { state.byId[sessionId]!.title = 'First title' }) })
    expect(document.title).toBe('First title — DeepSeek Harness')
    act(() => { sessions.update((state) => { state.byId[sessionId]!.title = 'Revised title' }) })
    expect(document.title).toBe('Revised title — DeepSeek Harness')
    act(() => { sessions.update((state) => { state.current = undefined }) })
    expect(document.title).toBe(PRODUCT_TITLE)
    mounted.unmount()
    expect(document.title).toBe(PRODUCT_TITLE)
  })

  it('uses the localized product title supplied by the frame', () => {
    const { sessionId, sessions, props } = titleSources()
    sessions.update((state) => { state.byId[sessionId]!.title = 'First title' })
    const mounted = render(<DocumentTitle {...props} productTitle="DSH Local Build" attentionTitle={ATTENTION_TITLE} />)
    expect(document.title).toBe('First title — DSH Local Build')
    mounted.unmount()
    expect(document.title).toBe('DSH Local Build')
  })

  it('keeps the product title across global panels and restores the latest Session title on return', () => {
    const { sessionId, sessions, panelInfo, props } = titleSources()
    sessions.update((state) => { state.byId[sessionId]!.title = 'Session title' })
    render(<DocumentTitle {...props} productTitle="Product" attentionTitle={ATTENTION_TITLE} />)
    expect(document.title).toBe('Session title — Product')
    act(() => { panelInfo.set({ activePanelId: 'panel-a' as MainPanelId }) })
    expect(document.title).toBe('Product')
    act(() => { sessions.update((state) => { state.byId[sessionId]!.title = 'Updated title' }) })
    expect(document.title).toBe('Product')
    act(() => { panelInfo.set({ activePanelId: 'panel-b' as MainPanelId }) })
    expect(document.title).toBe('Product')
    expect(sessions.getSnapshot().current).toBe(sessionId)
    act(() => { panelInfo.set({ activePanelId: null }) })
    expect(document.title).toBe('Updated title — Product')
  })

  it('uses the product title when the current Session row is not available', () => {
    const { sessions, props } = titleSources()
    sessions.update((state) => { state.byId = {}; state.ids = [] })
    render(<DocumentTitle {...props} productTitle="Product" attentionTitle={ATTENTION_TITLE} />)
    expect(document.title).toBe('Product')
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
    const { props } = titleSources()
    document.title = PRODUCT_TITLE
    render(<DocumentTitle {...props} productTitle={PRODUCT_TITLE} attentionTitle={ATTENTION_TITLE} pendingInteraction />)
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
    const { sessionId, sessions, props } = titleSources()
    sessions.update((state) => { state.byId[sessionId]!.title = 'First title' })
    render(<DocumentTitle {...props} productTitle={PRODUCT_TITLE} attentionTitle={ATTENTION_TITLE} pendingInteraction />)
    vi.advanceTimersByTime(1000)
    expect(document.title).toBe(ATTENTION_TITLE)
    unhide()
    document.dispatchEvent(new Event('visibilitychange'))
    expect(document.title).toBe('First title — DeepSeek Harness')
  })

  it('stops flashing and restores the projected title when nothing is pending', () => {
    vi.useFakeTimers()
    const unhide = hidden(true)
    const { props } = titleSources()
    const mounted = render(<DocumentTitle {...props} productTitle={PRODUCT_TITLE} attentionTitle={ATTENTION_TITLE} pendingInteraction />)
    vi.advanceTimersByTime(1000)
    expect(document.title).toBe(ATTENTION_TITLE)
    mounted.rerender(<DocumentTitle {...props} productTitle={PRODUCT_TITLE} attentionTitle={ATTENTION_TITLE} />)
    vi.advanceTimersByTime(1000)
    expect(document.title).toBe(PRODUCT_TITLE)
    unhide()
  })

  it('does not flash while the tab is visible', () => {
    vi.useFakeTimers()
    const unhide = hidden(false)
    const { props } = titleSources()
    render(<DocumentTitle {...props} productTitle={PRODUCT_TITLE} attentionTitle={ATTENTION_TITLE} pendingInteraction />)
    expect(document.title).toBe(PRODUCT_TITLE)
    vi.advanceTimersByTime(3000)
    expect(document.title).toBe(PRODUCT_TITLE)
    unhide()
  })
})
