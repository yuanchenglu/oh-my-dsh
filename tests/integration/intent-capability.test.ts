import { describe, expect, it, vi } from 'vitest'
import { apply } from '../../src/intent-router/index.js'
import { readFacts } from '../../src/shared/facts.js'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

function createContext(resolver: (provider: string, model: string, signal?: AbortSignal) => Promise<unknown>) {
  const listeners: Record<string, Function[]> = {}
  return {
    on: vi.fn((event: string, listener: Function) => {
      listeners[event] = [...(listeners[event] ?? []), listener]
    }),
    effect: vi.fn(),
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    llm: { resolveModelInfo: vi.fn(resolver) },
    dispatch(payload: unknown, seed: Record<string, unknown>) {
      const listener = listeners['agent/request']![0]!
      return listener(payload, vi.fn().mockResolvedValue(seed))
    },
  }
}

function config() {
  return {
    enabled: true,
    effortMap: {
      refactor: 'high', new: 'high', medium: 'high', collaboration: 'high',
      architecture: 'max', research: 'max', simple: 'auto:lowest', spec_driven: 'high',
    },
  }
}

describe('capability-aware intent routing', () => {
  it('downgrades unsupported effort and records the fallback', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'oh-my-dsh-routing-'))
    const session = { header: { id: 'intent-1', cwd } }
    const ctx = createContext(async () => ({ reasoning: { efforts: [{ id: 'low' }, { id: 'high' }] } }))
    apply(ctx as never, config())
    const result = await ctx.dispatch({
      agent: { session: { ...session, deriveMessages: () => [{ id: 'm1', role: 'user', content: '设计一个架构' }] } },
      turn: 0, step: 0, signal: new AbortController().signal,
    }, { provider: 'deepseek', model: 'flash' })

    expect(result.reasoningEffort).toBe('high')
    const facts = readFacts(session as never, 'oh-my-dsh/strategy')
    expect(facts[0]?.data).toMatchObject({
      requestedReasoningEffort: 'max', effectiveReasoningEffort: 'high',
      fallbackReason: expect.any(String), messageId: 'm1',
    })
  })

  it('uses the lowest advertised effort for auto:lowest', async () => {
    const session = { header: { id: 'intent-2', cwd: mkdtempSync(join(tmpdir(), 'oh-my-dsh-routing-')) } }
    const ctx = createContext(async () => ({ reasoning: { efforts: [{ id: 'low' }, { id: 'high' }] } }))
    apply(ctx as never, config())
    const result = await ctx.dispatch({
      agent: { session: { ...session, deriveMessages: () => [{ id: 'm2', role: 'user', content: '修复一个 typo' }] } },
      turn: 0, step: 0, signal: new AbortController().signal,
    }, { provider: 'deepseek', model: 'flash' })

    expect(result.reasoningEffort).toBe('low')
  })

  it('falls back to provider default when capability is unknown', async () => {
    const session = { header: { id: 'intent-3', cwd: mkdtempSync(join(tmpdir(), 'oh-my-dsh-routing-')) } }
    const ctx = createContext(async () => { throw new Error('catalog unavailable') })
    apply(ctx as never, config())
    const result = await ctx.dispatch({
      agent: { session: { ...session, deriveMessages: () => [{ id: 'm3', role: 'user', content: '设计一个架构' }] } },
      turn: 0, step: 0, signal: new AbortController().signal,
    }, { provider: 'deepseek', model: 'flash', reasoningEffort: 'seed' })

    expect(result.reasoningEffort).toBeUndefined()
    expect(readFacts(session as never, 'oh-my-dsh/strategy')[0]?.data).toMatchObject({ fallbackReason: 'capability-unknown' })
  })
})
