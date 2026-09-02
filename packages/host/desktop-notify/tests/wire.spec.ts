/**
 * Host wiring: the three user-attention events reach the alert handle, the
 * two waterfall listeners always delegate through `next()`, and subagent
 * sessions never announce task completion.
 */

import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { ApprovalOutcome } from '@deepseek-ai/dsh-user-approval'
import type { AskUserQuestionAnswer } from '@deepseek-ai/dsh-user-questions'
import type { DesktopNotifyHandle } from '../src/desktop-notify.ts'
import { wireDesktopNotify } from '../src/index.ts'

/** A minimal Agent-shaped subject with an optional parent session. */
function agent(id: string, parentSession?: string): Agent {
  return {
    id,
    session: {
      header: { ...(parentSession === undefined ? {} : { parentSession }) },
    },
  } as unknown as Agent
}

function harness() {
  const ctx = new Context()
  const notify = vi.fn()
  const handle: DesktopNotifyHandle = { notify }
  wireDesktopNotify(ctx, handle)
  return { ctx, notify, handle }
}

describe('wireDesktopNotify', () => {
  it('announces approval/request and still delegates the waterfall', async () => {
    const { ctx, notify } = harness()
    let downstreamHeard = false
    ctx.on('approval/request', (_req, next) => {
      downstreamHeard = true
      return next()
    })
    await ctx.waterfall(
      'approval/request',
      { agent: agent('s1'), toolName: 'bash', reason: 'escalation' },
      async () => 'allowed-once' as ApprovalOutcome,
    )
    expect(notify).toHaveBeenCalledWith('approval', { toolName: 'bash', reason: 'escalation' })
    expect(downstreamHeard).toBe(true)
  })

  it('announces user-questions/request and delegates the waterfall', async () => {
    const { ctx, notify } = harness()
    let downstreamHeard = false
    ctx.on('user-questions/request', (_req, next) => {
      downstreamHeard = true
      return next()
    })
    await ctx.waterfall(
      'user-questions/request',
      { agent: agent('s1'), questions: [] },
      async () => ({ answers: [] }) as AskUserQuestionAnswer,
    )
    expect(notify).toHaveBeenCalledWith('question', { toolName: 'ask_user_question' })
    expect(downstreamHeard).toBe(true)
  })

  it('announces completion only on the top-level running → idle edge', () => {
    const { ctx, notify } = harness()
    const top = agent('top')
    // Subagent sessions never announce; their edge is ignored entirely.
    ctx.emit('agent/status', { agent: agent('child', 'top'), status: 'running' })
    ctx.emit('agent/status', { agent: agent('child', 'top'), status: 'idle' })
    expect(notify).not.toHaveBeenCalled()

    ctx.emit('agent/status', { agent: top, status: 'running' })
    ctx.emit('agent/status', { agent: top, status: 'idle' })
    expect(notify).toHaveBeenCalledWith('complete', { sessionId: 'top' })
  })

  it('does not announce an idle-only edge or a running-only edge', () => {
    const { ctx, notify } = harness()
    ctx.emit('agent/status', { agent: agent('a'), status: 'idle' })
    expect(notify).not.toHaveBeenCalled()
    ctx.emit('agent/status', { agent: agent('b'), status: 'running' })
    expect(notify).not.toHaveBeenCalled()
  })
})
