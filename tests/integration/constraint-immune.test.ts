import { describe, it, expect, vi } from 'vitest'
import { apply } from '../../src/constraint-immune/index.js'

/** 简化 mock：仅包含测试需要的 on/effect */
function createMockCtx() {
  const listeners: Record<string, Function[]> = {}
  return {
    on: vi.fn((event: string, fn: Function) => {
      listeners[event] = listeners[event] || []
      listeners[event].push(fn)
    }),
    effect: vi.fn(),
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    _listeners: listeners,
    _emitWaterfall: async (event: string, payload: any) => {
      const fns = listeners[event] || []
      const next = vi.fn().mockResolvedValue({ kind: 'enter', messages: payload.messages ?? [] })
      const results = []
      for (const fn of fns) results.push(await fn(payload, next))
      return { next, results }
    },
  }
}

describe('constraint-immune plugin', () => {
  it('registers agent/pre-step listener', () => {
    const ctx = createMockCtx()
    apply(ctx as any, { enabled: true, customPatterns: [] })
    expect(ctx.on).toHaveBeenCalledWith('agent/pre-step', expect.any(Function))
  })

  it('extracts constraints from user messages', async () => {
    const ctx = createMockCtx()
    apply(ctx as any, { enabled: true, customPatterns: [] })
    const payload = {
      messages: [{ role: 'user', content: '不要修改 API 契约' }],
      turn: 0,
      step: 0,
      signal: new AbortController().signal,
    }
    const { next } = await ctx._emitWaterfall('agent/pre-step', payload)
    expect(next).toHaveBeenCalled()
  })

  it('does not register when disabled', () => {
    const ctx = createMockCtx()
    apply(ctx as any, { enabled: false, customPatterns: [] })
    expect(ctx.on).not.toHaveBeenCalled()
  })
})
