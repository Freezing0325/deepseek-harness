import { useEffect } from 'react'

const DEFAULT_CLIENT_TITLE = 'DSH Local Build'

/** Title alternated with the projected title while a wait is pending and the tab is hidden. */
const ATTENTION_TITLE = '⚠️ 待审批'

/** How often the attention title alternates while the tab is hidden. */
const ATTENTION_INTERVAL_MS = 1000

/** Props for the browser title projection. */
export interface DocumentTitleProps {
  /** Durable title of the selected session, or undefined for the product title. */
  title?: string
  /**
   * True while any session waits on the user (approval/question/plan-review).
   * While the document is hidden the browser title alternates to draw the
   * tab's attention; it returns to the projected title once the page is
   * visible again or nothing is pending.
   */
  pendingInteraction?: boolean
}

/**
 * Project the selected durable session title into the browser title, restore
 * the build-selected product title when unmounted, and — while any session
 * waits on the user and the tab is hidden — flash the title so a user reading
 * another tab notices. The flash only runs while the document is hidden and
 * stops (restoring the projected title) on visibility or when nothing is
 * pending.
 * @param props - title projection and pending-interaction attention flag.
 * @returns No rendered content.
 */
export function DocumentTitle({ title, pendingInteraction }: DocumentTitleProps): null {
  const productTitle = process.env.DSH_CLIENT_TITLE ?? DEFAULT_CLIENT_TITLE
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
        document.title = document.title === ATTENTION_TITLE ? base : ATTENTION_TITLE
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
  }, [pendingInteraction, base])
  return null
}
