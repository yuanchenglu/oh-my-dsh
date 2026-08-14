import { describe, it, expect, vi } from 'vitest'
import { apply, Config } from '../../src/intent-router/index.js'

/** 简化 mock：捕获 agent/request listener，模拟 cordis waterfall 的 unwind 替换语义 */
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
    /** 模拟 agent/request 瀑布：seed 配置经 listener 链 unwind 后返回最终配置 */
    _dispatchRequest: async (messages: Array<{ role: string; content: unknown }>, seed: Record<string, unknown> = { provider: 'deepseek', model: 'deepseek-v4-flash' }) => {
      const payload = {
        agent: { session: { deriveMessages: () => messages } },
        turn: 0,
        step: 0,
        signal: new AbortController().signal,
      }
      const fns = listeners['agent/request'] || []
      const next = vi.fn().mockResolvedValue(seed)
      let result: any = seed
      for (const fn of fns) result = await fn(payload, next)
      return { result, next }
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
  it('registers agent/request listener', () => {
    const ctx = createMockCtx()
    apply(ctx as any, defaultConfig)
    expect(ctx.on).toHaveBeenCalledWith('agent/request', expect.any(Function))
  })

  it('sets reasoningEffort=max for architecture intent', async () => {
    const ctx = createMockCtx()
    apply(ctx as any, defaultConfig)
    const { result } = await ctx._dispatchRequest([{ role: 'user', content: '设计一个微服务架构' }])
    expect(result.reasoningEffort).toBe('max')
  })

  it('sets reasoningEffort=high for refactor intent', async () => {
    const ctx = createMockCtx()
    apply(ctx as any, defaultConfig)
    const { result } = await ctx._dispatchRequest([{ role: 'user', content: '重构这个模块拆分逻辑' }])
    expect(result.reasoningEffort).toBe('high')
  })

  it('keeps seed config when no keyword matches (spec_driven fallback)', async () => {
    const ctx = createMockCtx()
    apply(ctx as any, defaultConfig)
    const seed = { provider: 'deepseek', model: 'deepseek-v4-flash', reasoningEffort: 'low' }
    const { result } = await ctx._dispatchRequest([{ role: 'user', content: '你好' }], seed)
    expect(result).toEqual(seed)
  })

  it('reads text from ContentBlock[] user messages', async () => {
    const ctx = createMockCtx()
    apply(ctx as any, defaultConfig)
    const { result } = await ctx._dispatchRequest([
      { role: 'user', content: [{ type: 'text', text: '设计一个微服务架构' }] },
    ])
    expect(result.reasoningEffort).toBe('max')
  })

  it('does not register when disabled', () => {
    const ctx = createMockCtx()
    apply(ctx as any, { ...defaultConfig, enabled: false })
    expect(ctx.on).not.toHaveBeenCalled()
  })
})
