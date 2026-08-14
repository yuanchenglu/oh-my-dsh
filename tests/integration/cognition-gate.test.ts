import { describe, it, expect, vi } from 'vitest'
import { apply } from '../../src/cognition-gate/index.js'
import type { InjectionConfig } from '../../src/cognition-gate/injector.js'

/** 简化 mock：捕获 agent/pre-step listener 并手动触发 */
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
    _preStep: async (payload: { messages: unknown[]; turn: number; aborted?: boolean }) => {
      const controller = new AbortController()
      if (payload.aborted) controller.abort()
      const full = { messages: payload.messages, turn: payload.turn, step: 0, signal: controller.signal }
      const next = vi.fn().mockResolvedValue({ kind: 'enter', messages: payload.messages })
      const results = []
      for (const fn of listeners['agent/pre-step'] || []) results.push(await fn(full, next))
      return { next, results }
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
    const { next, results } = await ctx._preStep({
      messages: [{ role: 'user', content: '帮我写代码' }],
      turn: 0,
    })
    expect(next).not.toHaveBeenCalled()
    const messages = results[0].messages as Array<{ role: string; content: string }>
    expect(messages).toHaveLength(1)
    expect(messages[0].content).toContain('帮我写代码')
    expect(messages[0].content).toContain('[L1 荣辱观]')
    expect(messages[0].content).toContain('[L2 思维方式]')
    expect(messages[0].content).toContain('[I-02 双向原语]')
    expect(messages[0].content).toContain('[I-08 范围控制]')
  })

  it('injects brief cognition on turn 1', async () => {
    const ctx = createMockCtx()
    apply(ctx as never, defaultConfig)
    const { results } = await ctx._preStep({
      messages: [{ role: 'user', content: '继续' }],
      turn: 1,
    })
    const messages = results[0].messages as Array<{ role: string; content: string }>
    expect(messages[0].content).toContain('[L1]')
    expect(messages[0].content).toContain('[L2]')
    expect(messages[0].content).toContain('[I-08]')
    expect(messages[0].content).not.toContain('[I-02 双向原语]')
  })

  it('单层关闭时其余层仍注入（turn=1，Y2 回归）', async () => {
    const ctx = createMockCtx()
    apply(ctx as never, { ...defaultConfig, layers: { l1: true, l2: false, i02: true, i08: true } })
    const { results } = await ctx._preStep({
      messages: [{ role: 'user', content: '继续' }],
      turn: 1,
    })
    const messages = results[0].messages as Array<{ role: string; content: string }>
    expect(messages[0].content).toContain('[L1]')
    expect(messages[0].content).not.toContain('[L2]')
    expect(messages[0].content).toContain('[I-08]')
  })

  it('calls next when signal is aborted', async () => {
    const ctx = createMockCtx()
    apply(ctx as never, defaultConfig)
    const { next } = await ctx._preStep({
      messages: [{ role: 'user', content: '帮我写代码' }],
      turn: 0,
      aborted: true,
    })
    expect(next).toHaveBeenCalled()
  })
})
