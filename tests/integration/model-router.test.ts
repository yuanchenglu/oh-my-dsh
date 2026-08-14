import { describe, it, expect, vi } from 'vitest'
import { apply } from '../../src/model-router/index.js'

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
    _dispatchRequest: async (
      messages: Array<{ role: string; content: unknown }>,
      seed: Record<string, unknown> = { provider: 'deepseek-official', model: 'deepseek-v4-flash' },
      agentId = 's1',
    ) => {
      const payload = {
        agent: { id: agentId, session: { deriveMessages: () => messages } },
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
  defaultModel: 'deepseek-v4-flash',
  proModel: 'deepseek-v4-pro',
  upgradeIntents: ['architecture', 'research'],
  tokenThreshold: 30000,
  dissatisfactionEnabled: true,
  dissatisfactionPatterns: [] as string[],
}

describe('model-router plugin', () => {
  it('registers agent/request listener', () => {
    const ctx = createMockCtx()
    apply(ctx as any, defaultConfig)
    expect(ctx.on).toHaveBeenCalledWith('agent/request', expect.any(Function))
  })

  it('AC-1：简单任务保持 flash', async () => {
    const ctx = createMockCtx()
    apply(ctx as any, defaultConfig)
    const { result } = await ctx._dispatchRequest([{ role: 'user', content: '修复这个 typo' }])
    expect(result.model).toBe('deepseek-v4-flash')
  })

  it('AC-2：架构意图升级 pro', async () => {
    const ctx = createMockCtx()
    apply(ctx as any, defaultConfig)
    const { result } = await ctx._dispatchRequest([{ role: 'user', content: '设计一个微服务架构方案' }])
    expect(result.model).toBe('deepseek-v4-pro')
  })

  it('AC-3：token 超阈值升级 pro', async () => {
    const ctx = createMockCtx()
    apply(ctx as any, defaultConfig)
    const { result } = await ctx._dispatchRequest([
      { role: 'user', content: '继续' },
      { role: 'assistant', content: 'x'.repeat(120001) },
    ])
    expect(result.model).toBe('deepseek-v4-pro')
  })

  it('AC-4：连续两轮不满意升级，随后正常消息回落 flash', async () => {
    const ctx = createMockCtx()
    apply(ctx as any, defaultConfig)
    await ctx._dispatchRequest([{ role: 'user', content: '不对，重来' }])
    const second = await ctx._dispatchRequest([
      { role: 'user', content: '不对，重来' },
      { role: 'assistant', content: '...' },
      { role: 'user', content: '还是不对' },
    ])
    expect(second.result.model).toBe('deepseek-v4-pro')
    const third = await ctx._dispatchRequest([
      { role: 'user', content: '不对，重来' },
      { role: 'assistant', content: '...' },
      { role: 'user', content: '还是不对' },
      { role: 'assistant', content: '...' },
      { role: 'user', content: '好的，继续' },
    ])
    expect(third.result.model).toBe('deepseek-v4-flash')
  })

  it('AC-5：enabled=false 不注册 listener', () => {
    const ctx = createMockCtx()
    apply(ctx as any, { ...defaultConfig, enabled: false })
    expect(ctx.on).not.toHaveBeenCalled()
  })

  it('AC-6：provider 永远不被修改', async () => {
    const ctx = createMockCtx()
    apply(ctx as any, defaultConfig)
    const { result } = await ctx._dispatchRequest([{ role: 'user', content: '设计一个微服务架构方案' }])
    expect(result.provider).toBe('deepseek-official')
  })

  it('不满意计数按 agent 隔离', async () => {
    const ctx = createMockCtx()
    apply(ctx as any, defaultConfig)
    await ctx._dispatchRequest([{ role: 'user', content: '不对' }], undefined, 's1')
    const r = await ctx._dispatchRequest([{ role: 'user', content: '重新来' }], undefined, 's2')
    expect(r.result.model).toBe('deepseek-v4-flash')
  })

  it('自定义不满意关键词生效', async () => {
    const ctx = createMockCtx()
    apply(ctx as any, { ...defaultConfig, dissatisfactionPatterns: ['离谱'] })
    await ctx._dispatchRequest([{ role: 'user', content: '太离谱了' }])
    const r = await ctx._dispatchRequest([
      { role: 'user', content: '太离谱了' },
      { role: 'assistant', content: '...' },
      { role: 'user', content: '离谱' },
    ])
    expect(r.result.model).toBe('deepseek-v4-pro')
  })
})
