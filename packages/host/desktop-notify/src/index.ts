/**
 * Host plugin wiring the Windows desktop alert to the web host's
 * user-attention events.
 *
 * The web approval and question badges are quiet by design; someone working
 * in another window misses them and the agent stalls. This package observes
 * the three host events that mean "the user must look at the page" —
 * `approval/request` (a tool asks for a decision), `user-questions/request`
 * (ask_user_question is pending), and the `agent/status` running→idle edge
 * for top-level tasks — and hands each to the fire-and-forget win32 notifier.
 *
 * The two waterfall events are observed, never answered: the listeners
 * register with `prepend` so the alert fires before the browser forwarding
 * chain, then always delegate through `next()` so the browser answerer still
 * resolves the request. `agent/status` is a plain emit; the running→idle edge
 * is tracked per agent and subagents are skipped — only a top-level task
 * finishing deserves a desktop alert.
 *
 * @module @deepseek-ai/dsh-host-desktop-notify
 */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-settings'
// Type-only: pulls the `approval/request` waterfall and `ctx.get('approval')`
// surface without a value dependency on the seam (optional composition).
import type {} from '@deepseek-ai/dsh-user-approval'
// Type-only: pulls the `user-questions/request` waterfall surface.
import type {} from '@deepseek-ai/dsh-user-questions'
// Type-only: pulls the `agent/status` event payload (Agent / AgentStatus).
import type {} from '@deepseek-ai/dsh-agent'
import { installDesktopNotify, type DesktopNotifyHandle } from './desktop-notify.ts'

/** Cordis plugin name. */
export const name = 'desktop-notify'

/**
 * Host plugin body: install the notifier and wire the three attention
 * events. The waterfall listeners must keep delegating — this plugin only
 * alerts, it never answers the request.
 * @param ctx - the web host context.
 */
export function apply(ctx: Context): void {
  wireDesktopNotify(ctx, installDesktopNotify(ctx))
}

/**
 * Wire one desktop-alert handle to the host's three user-attention events.
 * The waterfall listeners register with `prepend` so the alert fires before
 * api-remotes' forwarding listener regardless of load order, then always
 * delegate through `next()` to keep the browser answerer authoritative.
 * @param ctx - the web host context.
 * @param handle - the alert handle (production: {@link apply}'s install; tests: a spy).
 */
export function wireDesktopNotify(ctx: Context, handle: DesktopNotifyHandle): void {
  // Task-completion alert: the agent running → idle edge. Track the last seen
  // status per session so the alert fires once per run, and skip subagents —
  // only a top-level task finishing deserves a desktop alert.
  const lastRunning = new Map<string, boolean>()
  ctx.on('agent/status', ({ agent, status }) => {
    if (agent.session.header.parentSession !== undefined) return
    const running = status === 'running'
    const wasRunning = lastRunning.get(agent.id) ?? false
    lastRunning.set(agent.id, running)
    if (wasRunning && !running) {
      handle.notify('complete', { sessionId: String(agent.id) })
    }
  })

  // approval/request is a waterfall: the host forwards it to the browser
  // answerer (ui-approval). Alert before that chain and delegate — returning
  // next() keeps the browser answer authoritative. prepend guarantees the
  // alert listener runs before api-remotes' forwarding listener regardless of
  // load order.
  ctx.on('approval/request', (request, next) => {
    handle.notify('approval', {
      toolName: request.toolName,
      ...(request.reason === undefined ? {} : { reason: request.reason }),
    })
    return next()
  }, { prepend: true })

  // user-questions/request waterfall: same observe-and-delegate contract.
  ctx.on('user-questions/request', (_request, next) => {
    handle.notify('question', { toolName: 'ask_user_question' })
    return next()
  }, { prepend: true })
}
