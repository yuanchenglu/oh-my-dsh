import { describe, it, expect, vi } from 'vitest'
import { apply, Config } from '../../src/intent-router/index.js'

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
      for (const fn of fns) await fn(payload, next)
      return next
    },
  }
}

const defaultConfig = {
  enabled: true,
  effortMap: {
    architecture: 'max',
    research: 'max',
    collaboration: 'max',
    refactor: 'high',
    new: 'high',
    medium: 'high',
  },
}

describe('intent-router plugin', () => {
  it('registers llm/stream listener', () => {
    const ctx = createMockCtx()
    apply(ctx as any, defaultConfig)
    expect(ctx.on).toHaveBeenCalledWith('llm/stream', expect.any(Function))
  })

  it('sets reasoningEffort for architecture intent', async () => {
    const ctx = createMockCtx()
    apply(ctx as any, defaultConfig)
    const options = {
      messages: [{ role: 'user', content: '设计一个微服务架构' }],
      model: 'deepseek-v4-flash',
    }
    const next = await ctx._emitWaterfall('llm/stream', options)
    expect(next).toHaveBeenCalled()
  })

  it('does not register when disabled', () => {
    const ctx = createMockCtx()
    apply(ctx as any, { ...defaultConfig, enabled: false })
    expect(ctx.on).not.toHaveBeenCalled()
  })
})
