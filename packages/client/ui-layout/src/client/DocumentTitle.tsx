import { useEffect } from 'react'

/** How often the attention title alternates while the tab is hidden. */
const ATTENTION_INTERVAL_MS = 1000

/** Props for the browser title projection. */
export interface DocumentTitleProps {
  /** Durable title of the selected session, or undefined for the product title. */
  title?: string
  /** Build-configured or localized product title. */
  productTitle: string
  /**
   * Locale-owned title the tab alternates to while a session waits on the
   * user and the document is hidden (approval/question/plan-review).
   */
  attentionTitle: string
  /**
   * True while any session waits on the user. While the document is hidden
   * the browser title alternates to draw the tab's attention; it returns to
   * the projected title once the page is visible again or nothing is pending.
   */
  pendingInteraction?: boolean
}

/**
 * Project the selected durable session title into the browser title, restore
 * the build-selected product title when unmounted, and — while any session
 * waits on the user and the tab is hidden — alternate the title so a user
 * reading another tab notices. The flash only runs while the document is
 * hidden and stops (restoring the projected title) on visibility or when
 * nothing is pending.
 * @param props - title projection and pending-interaction attention flag.
 * @returns No rendered content.
 */
export function DocumentTitle({ title, productTitle, attentionTitle, pendingInteraction }: DocumentTitleProps): null {
  const base = title === undefined ? productTitle : `${title} — ${productTitle}`
  useEffect(() => {
    document.title = base
    return () => { document.title = productTitle }
  }, [base, productTitle])
  useEffect(() => {
    if (!pendingInteraction) return
    let timer: number | undefined
    const stop = (): void => {
      if (timer !== undefined) {
        clearInterval(timer)
        timer = undefined
      }
    }
    const start = (): void => {
      stop()
      document.title = base
      timer = window.setInterval(() => {
        document.title = document.title === attentionTitle ? base : attentionTitle
      }, ATTENTION_INTERVAL_MS)
    }
    const onVisibility = (): void => {
      if (document.hidden) start()
      else {
        stop()
        document.title = base
      }
    }
    document.addEventListener('visibilitychange', onVisibility)
    if (document.hidden) start()
    return () => {
      stop()
      document.removeEventListener('visibilitychange', onVisibility)
      document.title = base
    }
  }, [pendingInteraction, base, attentionTitle])
  return null
}
