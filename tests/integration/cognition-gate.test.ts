import { describe, it, expect, vi } from 'vitest'
import { apply } from '../../src/cognition-gate/index.js'
import type { InjectionConfig } from '../../src/cognition-gate/injector.js'

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
    /** 模拟触发 waterfall 事件 */
    _emitWaterfall: async (event: string, payload: Record<string, unknown>) => {
      const fns = listeners[event] || []
      const next = vi.fn().mockResolvedValue({ kind: 'enter', messages: payload.messages ?? [] })
      for (const fn of fns) await fn(payload, next)
      return next
    },
  }
}

const defaultConfig: InjectionConfig = {
  layers: { l1: true, l2: true, i02: true, i08: true },
  excludePatterns: [],
}

describe('cognition-gate plugin', () => {
  it('registers agent/pre-step listener', () => {
    const ctx = createMockCtx()
    apply(ctx as never, defaultConfig)
    expect(ctx.on).toHaveBeenCalledWith('agent/pre-step', expect.any(Function))
  })

  it('injects full cognition on turn 0', async () => {
    const ctx = createMockCtx()
    apply(ctx as never, defaultConfig)
    const payload = {
      messages: [{ role: 'user', content: '帮我写代码' }],
      turn: 0,
      step: 0,
      signal: new AbortController().signal,
    }
    const next = await ctx._emitWaterfall('agent/pre-step', payload)
    expect(next).not.toHaveBeenCalled()
  })

  it('calls next when signal is aborted', async () => {
    const ctx = createMockCtx()
    apply(ctx as never, defaultConfig)
    const controller = new AbortController()
    controller.abort()
    const payload = {
      messages: [{ role: 'user', content: '帮我写代码' }],
      turn: 0,
      step: 0,
      signal: controller.signal,
    }
    const next = await ctx._emitWaterfall('agent/pre-step', payload)
    expect(next).toHaveBeenCalled()
  })

  it('injects brief cognition on turn 1', async () => {
    const ctx = createMockCtx()
    apply(ctx as never, defaultConfig)
    const payload = {
      messages: [{ role: 'user', content: '继续' }],
      turn: 1,
      step: 0,
      signal: new AbortController().signal,
    }
    await ctx._emitWaterfall('agent/pre-step', payload)
  })
})
