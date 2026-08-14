import { describe, it, expect, vi } from 'vitest'
import { apply } from '../../src/constraint-immune/index.js'

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
    _preStep: async (payload: {
      agent?: { id?: string }
      messages: Array<{ role: string; content: unknown }>
      turn: number
    }) => {
      const full = { step: 0, signal: new AbortController().signal, ...payload }
      const next = vi.fn().mockResolvedValue({ kind: 'enter', messages: full.messages })
      const results = []
      for (const fn of listeners['agent/pre-step'] || []) results.push(await fn(full, next))
      return { next, results }
    },
    /** 模拟 tools/pre-execute 瀑布 */
    _preExecute: async (exec: { name: string; arguments: unknown; agent?: { id?: string } }) => {
      const next = vi.fn().mockResolvedValue({ kind: 'allow' })
      const results = []
      for (const fn of listeners['tools/pre-execute'] || []) results.push(await fn(exec, next))
      return { next, results }
    },
  }
}

const USER_CONSTRAINT = '不要修改 API 契约'

describe('constraint-immune plugin', () => {
  it('registers agent/pre-step listener', () => {
    const ctx = createMockCtx()
    apply(ctx as any, { enabled: true, customPatterns: [] })
    expect(ctx.on).toHaveBeenCalledWith('agent/pre-step', expect.any(Function))
  })

  it('does not register when disabled', () => {
    const ctx = createMockCtx()
    apply(ctx as any, { enabled: false, customPatterns: [] })
    expect(ctx.on).not.toHaveBeenCalled()
  })

  it('turn=0 只提取不检查', async () => {
    const ctx = createMockCtx()
    apply(ctx as any, { enabled: true, customPatterns: [] })
    const { next, results } = await ctx._preStep({
      messages: [{ role: 'user', content: USER_CONSTRAINT }],
      turn: 0,
    })
    expect(next).toHaveBeenCalled()
    expect(results[0]).toEqual({ kind: 'enter', messages: [{ role: 'user', content: USER_CONSTRAINT }] })
  })

  it('R3：turn>0 时历史里用户自己的约束原文不触发误报', async () => {
    const ctx = createMockCtx()
    apply(ctx as any, { enabled: true, customPatterns: [] })
    const agent = { id: 's1' }
    await ctx._preStep({ agent, messages: [{ role: 'user', content: USER_CONSTRAINT }], turn: 0 })
    const { next, results } = await ctx._preStep({
      agent,
      messages: [
        { role: 'user', content: USER_CONSTRAINT },
        { role: 'assistant', content: '好的，我会遵守约束，保持契约不变。' },
      ],
      turn: 1,
    })
    expect(next).toHaveBeenCalled()
    expect(results[0].messages).toHaveLength(2)
  })

  it('模型输出违反否定型约束时追加提醒', async () => {
    const ctx = createMockCtx()
    apply(ctx as any, { enabled: true, customPatterns: [] })
    const agent = { id: 's1' }
    await ctx._preStep({ agent, messages: [{ role: 'user', content: USER_CONSTRAINT }], turn: 0 })
    const { results } = await ctx._preStep({
      agent,
      messages: [
        { role: 'user', content: USER_CONSTRAINT },
        { role: 'assistant', content: '我现在修改 API 契约如下……' },
      ],
      turn: 1,
    })
    const messages = results[0].messages as Array<{ role: string; content: string }>
    expect(messages).toHaveLength(3)
    expect(messages[2].content).toContain('[约束提醒]')
    expect(messages[2].content).toContain(USER_CONSTRAINT)
  })

  it('约束首次出现之前的 assistant 消息不参与判定', async () => {
    const ctx = createMockCtx()
    apply(ctx as any, { enabled: true, customPatterns: [] })
    const agent = { id: 's1' }
    // assistant 在约束出现之前提到"修改 API 契约"，之后没有再提
    const messages = [
      { role: 'assistant', content: '我建议修改 API 契约来简化。' },
      { role: 'user', content: USER_CONSTRAINT },
    ]
    await ctx._preStep({ agent, messages, turn: 0 })
    const { next, results } = await ctx._preStep({ agent, messages, turn: 1 })
    expect(next).toHaveBeenCalled()
    expect(results[0].messages).toHaveLength(2)
  })

  it('提醒文本不会被再次提取为约束（不自我复制）', async () => {
    const ctx = createMockCtx()
    apply(ctx as any, { enabled: true, customPatterns: [] })
    const agent = { id: 's1' }
    await ctx._preStep({ agent, messages: [{ role: 'user', content: USER_CONSTRAINT }], turn: 0 })
    const first = await ctx._preStep({
      agent,
      messages: [
        { role: 'user', content: USER_CONSTRAINT },
        { role: 'assistant', content: '我现在修改 API 契约如下……' },
      ],
      turn: 1,
    })
    const withReminder = first.results[0].messages as Array<{ role: string; content: string }>
    // 下一轮带着提醒文本 + 合规的 assistant 回复：不应再追加提醒
    const second = await ctx._preStep({
      agent,
      messages: [...withReminder, { role: 'assistant', content: '明白，我不会改动契约。' }],
      turn: 2,
    })
    expect(second.next).toHaveBeenCalled()
    expect(second.results[0].messages).toHaveLength(4)
  })

  it('Y5：不同 agent.id 的会话约束互相隔离', async () => {
    const ctx = createMockCtx()
    apply(ctx as any, { enabled: true, customPatterns: [] })
    await ctx._preStep({ agent: { id: 's1' }, messages: [{ role: 'user', content: USER_CONSTRAINT }], turn: 0 })
    // s2 没有约束，即使 assistant 提到关键词也不追加提醒
    const { next, results } = await ctx._preStep({
      agent: { id: 's2' },
      messages: [
        { role: 'user', content: '继续' },
        { role: 'assistant', content: '我现在修改 API 契约如下……' },
      ],
      turn: 1,
    })
    expect(next).toHaveBeenCalled()
    expect(results[0].messages).toHaveLength(2)
  })

  it('R2：customPatterns 自定义前缀参与提取与判定', async () => {
    const ctx = createMockCtx()
    apply(ctx as any, { enabled: true, customPatterns: ['务必'] })
    const agent = { id: 's1' }
    await ctx._preStep({ agent, messages: [{ role: 'user', content: '务必使用 pnpm 安装依赖' }], turn: 0 })
    const { results } = await ctx._preStep({
      agent,
      messages: [
        { role: 'user', content: '务必使用 pnpm 安装依赖' },
        { role: 'assistant', content: '我现在使用 pnpm 安装依赖。' },
      ],
      turn: 1,
    })
    const messages = results[0].messages as Array<{ role: string; content: string }>
    expect(messages).toHaveLength(3)
    expect(messages[2].content).toContain('[约束提醒]')
  })

  it('AC-1：命中否定型约束的工具调用被 deny', async () => {
    const ctx = createMockCtx()
    apply(ctx as any, { enabled: true, customPatterns: [], interception: 'deny' })
    const agent = { id: 's1' }
    await ctx._preStep({ agent, messages: [{ role: 'user', content: '禁止删除生产数据' }], turn: 0 })
    const { next, results } = await ctx._preExecute({
      name: 'delete_file',
      arguments: { path: '/生产数据/users.db', note: '删除生产数据' },
      agent,
    })
    expect(next).not.toHaveBeenCalled()
    expect(results[0].kind).toBe('deny')
    expect(results[0].reason).toContain('禁止删除生产数据')
  })

  it('AC-2：不命中约束的工具调用放行', async () => {
    const ctx = createMockCtx()
    apply(ctx as any, { enabled: true, customPatterns: [], interception: 'deny' })
    const agent = { id: 's1' }
    await ctx._preStep({ agent, messages: [{ role: 'user', content: '禁止删除生产数据' }], turn: 0 })
    const { next } = await ctx._preExecute({ name: 'read_file', arguments: { path: '/tmp/a.txt' }, agent })
    expect(next).toHaveBeenCalled()
  })

  it("AC-3：interception='off' 不注册 tools/pre-execute", () => {
    const ctx = createMockCtx()
    apply(ctx as any, { enabled: true, customPatterns: [], interception: 'off' })
    const events = (ctx.on as any).mock.calls.map((c: any[]) => c[0])
    expect(events).toContain('agent/pre-step')
    expect(events).not.toContain('tools/pre-execute')
  })

  it('AC-4：关键词 < 4 字符的否定型约束不触发拦截', async () => {
    const ctx = createMockCtx()
    apply(ctx as any, { enabled: true, customPatterns: [], interception: 'deny' })
    const agent = { id: 's1' }
    await ctx._preStep({ agent, messages: [{ role: 'user', content: '禁止删表' }], turn: 0 })
    const { next } = await ctx._preExecute({ name: 'execute_sql', arguments: { sql: 'DROP TABLE t -- 删表' }, agent })
    expect(next).toHaveBeenCalled()
  })

  it('AC-5：拦截状态按 agent 隔离', async () => {
    const ctx = createMockCtx()
    apply(ctx as any, { enabled: true, customPatterns: [], interception: 'deny' })
    await ctx._preStep({ agent: { id: 's1' }, messages: [{ role: 'user', content: '禁止删除生产数据' }], turn: 0 })
    const { next } = await ctx._preExecute({
      name: 'delete_file',
      arguments: { note: '删除生产数据' },
      agent: { id: 's2' },
    })
    expect(next).toHaveBeenCalled()
  })

  it('肯定型约束不触发拦截（PRD 3.3 AC-4）', async () => {
    const ctx = createMockCtx()
    apply(ctx as any, { enabled: true, customPatterns: [], interception: 'deny' })
    const agent = { id: 's1' }
    await ctx._preStep({ agent, messages: [{ role: 'user', content: '必须先备份再操作' }], turn: 0 })
    const { next } = await ctx._preExecute({ name: 'run', arguments: { cmd: '先备份再操作' }, agent })
    expect(next).toHaveBeenCalled()
  })

  it('AC-1：肯定型约束被遵守（含关键词）→ 不提醒', async () => {
    const ctx = createMockCtx()
    apply(ctx as any, { enabled: true, customPatterns: [], interception: 'deny' })
    const agent = { id: 's1' }
    await ctx._preStep({ agent, messages: [{ role: 'user', content: '必须先备份再操作' }], turn: 0 })
    const { next, results } = await ctx._preStep({
      agent,
      messages: [
        { role: 'user', content: '必须先备份再操作' },
        { role: 'assistant', content: '好的，我先备份再操作。' },
      ],
      turn: 1,
    })
    expect(next).toHaveBeenCalled()
    expect(results[0].messages).toHaveLength(2)
  })

  it('AC-2：肯定型约束缺执行 → 追加一次"未执行"提醒', async () => {
    const ctx = createMockCtx()
    apply(ctx as any, { enabled: true, customPatterns: [], interception: 'deny' })
    const agent = { id: 's1' }
    await ctx._preStep({ agent, messages: [{ role: 'user', content: '必须先备份再操作' }], turn: 0 })
    const { results } = await ctx._preStep({
      agent,
      messages: [
        { role: 'user', content: '必须先备份再操作' },
        { role: 'assistant', content: '我直接开始改代码。' },
      ],
      turn: 1,
    })
    const messages = results[0].messages as Array<{ role: string; content: string }>
    expect(messages).toHaveLength(3)
    expect(messages[2].content).toContain('可能未执行硬约束')
    expect(messages[2].content).toContain('必须先备份再操作')
  })

  it('AC-3：提醒只出现一次', async () => {
    const ctx = createMockCtx()
    apply(ctx as any, { enabled: true, customPatterns: [], interception: 'deny' })
    const agent = { id: 's1' }
    await ctx._preStep({ agent, messages: [{ role: 'user', content: '必须先备份再操作' }], turn: 0 })
    const first = await ctx._preStep({
      agent,
      messages: [
        { role: 'user', content: '必须先备份再操作' },
        { role: 'assistant', content: '我直接开始改代码。' },
      ],
      turn: 1,
    })
    const withReminder = first.results[0].messages as Array<{ role: string; content: string }>
    const second = await ctx._preStep({
      agent,
      messages: [...withReminder, { role: 'assistant', content: '继续改。' }],
      turn: 2,
    })
    expect(second.next).toHaveBeenCalled()
    expect(second.results[0].messages).toHaveLength(4)
  })
})
