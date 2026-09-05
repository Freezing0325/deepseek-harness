import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import * as LlmPiAi from '@deepseek-ai/dsh-llm-pi-ai'
import { closeMockServers, mockServer, textEvents } from './mock-server.ts'
import type { MockServer } from './mock-server.ts'

afterEach(async () => {
  vi.unstubAllEnvs()
  await closeMockServers()
})

const SESSION_ID = 'session-11111111-2222-3333-4444-555555555555'
const SESSION_UUID = '11111111-2222-3333-4444-555555555555'

async function routeHarness(route: string, url: string, extra?: { headers?: Record<string, string> }): Promise<Context> {
  vi.stubEnv('PI_TEST_KEY', 'test-key')
  const ctx = new Context()
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(LlmPiAi, {
    providers: {
      [route]: {
        apiKeyEnv: 'PI_TEST_KEY',
        api: 'openai-completions',
        baseURL: url,
        models: [{ id: 'probe-model' }],
        ...(extra ?? {}),
      },
    },
  })
  return ctx
}

async function streamProbeModel(ctx: Context, provider: string, sessionId: string | undefined): Promise<void> {
  for await (const _chunk of ctx.llm.stream({
    provider,
    model: 'probe-model',
    messages: [],
    ...(sessionId === undefined ? {} : { sessionId: sessionId as never }),
  })) {
    // The mock server's header record is the assertion.
  }
}

function sentSessionHeader(server: MockServer): unknown {
  return server.headers[0]?.['x-opencode-session']
}

describe('session affinity header on opencode routes', () => {
  it('attaches the normalized session id on opencode routes', async () => {
    const server = await mockServer([{ events: textEvents }])
    const ctx = await routeHarness('opencode-go', server.url)
    await streamProbeModel(ctx, 'opencode-go', SESSION_ID)
    expect(sentSessionHeader(server)).toBe(SESSION_UUID)
  })

  it('sends nothing on non-opencode routes', async () => {
    const server = await mockServer([{ events: textEvents }])
    const ctx = await routeHarness('deepseek', server.url)
    await streamProbeModel(ctx, 'deepseek', SESSION_ID)
    expect(sentSessionHeader(server)).toBeUndefined()
  })

  it('sends nothing without a session id', async () => {
    const server = await mockServer([{ events: textEvents }])
    const ctx = await routeHarness('opencode-go', server.url)
    await streamProbeModel(ctx, 'opencode-go', undefined)
    expect(sentSessionHeader(server)).toBeUndefined()
  })

  it('lets the runtime value win over a static entry', async () => {
    const server = await mockServer([{ events: textEvents }])
    const ctx = await routeHarness('opencode-go', server.url, { headers: { 'x-opencode-session': 'static-stale' } })
    await streamProbeModel(ctx, 'opencode-go', SESSION_ID)
    expect(sentSessionHeader(server)).toBe(SESSION_UUID)
  })

  it('sends a non-UUID session id raw', async () => {
    const server = await mockServer([{ events: textEvents }])
    const ctx = await routeHarness('opencode-go', server.url)
    await streamProbeModel(ctx, 'opencode-go', 'plain-probe-id')
    expect(sentSessionHeader(server)).toBe('plain-probe-id')
  })
})
