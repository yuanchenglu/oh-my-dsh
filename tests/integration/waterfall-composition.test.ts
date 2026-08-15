import { describe, expect, it, vi } from 'vitest'
import { apply as applyCognition } from '../../src/cognition-gate/index.js'
import { apply as applyConstraint } from '../../src/constraint-immune/index.js'

type Message = { role: string; content: unknown }

function createContext() {
  const listeners: Record<string, Function[]> = {}
  const trace: string[] = []
  return {
    on: vi.fn((event: string, listener: Function) => {
      listeners[event] = [...(listeners[event] ?? []), listener]
    }),
    effect: vi.fn(),
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    listeners,
    trace,
    dispatch(event: string, payload: unknown, seed: unknown) {
      const chain = listeners[event] ?? []
      const invoke = (index: number): Promise<unknown> => {
        const listener = chain[index]
        if (!listener) return Promise.resolve(seed)
        return Promise.resolve(listener(payload, () => invoke(index + 1)))
      }
      return invoke(0)
    },
  }
}

const constraint = { role: 'user', content: '不要修改 API 契约' }
const violation = { role: 'assistant', content: '我现在修改 API 契约如下……' }
const config = {
  layers: { l1: true, l2: true, i02: true, i08: true },
  excludePatterns: [],
}

async function runComposition(order: ('cognition' | 'constraint')[]) {
  const ctx = createContext()
  for (const plugin of order) {
    if (plugin === 'cognition') applyCognition(ctx as never, config)
    else applyConstraint(ctx as never, { enabled: true, customPatterns: [], interception: 'deny' })
  }
  const result = await ctx.dispatch('agent/pre-step', {
    agent: { id: `${order.join('-')}` },
    messages: [constraint, violation] satisfies Message[],
    turn: 1,
    step: 0,
    signal: new AbortController().signal,
  }, { kind: 'enter', messages: [constraint, violation] }) as { kind: string; messages: Message[] }
  return { ctx, result }
}

describe('pre-step waterfall composition', () => {
  it.each([
    ['cognition then constraint', ['cognition', 'constraint'] as const],
    ['constraint then cognition', ['constraint', 'cognition'] as const],
  ])('%s preserves both plugin effects', async (_name, order) => {
    const { result } = await runComposition([...order])
    const text = result.messages.map((message) => String(message.content)).join('\n')
    expect(text).toContain('[L1')
    expect(text).toContain('[约束提醒]')
  })

  it('records observable decisions and materializes tool deny/allow/ask states', async () => {
    const ctx = createContext()
    const executed: string[] = []
    const decisions = [
      { kind: 'deny', reason: 'blocked' },
      { kind: 'allow' },
      { kind: 'ask', reason: 'requires approval' },
    ] as const

    for (const decision of decisions) {
      ctx.trace.push(`decision:${decision.kind}`)
      const result = await ctx.dispatch('tools/pre-execute', { name: 'write', arguments: {} }, decision) as typeof decision
      if (result.kind === 'allow') executed.push(result.kind)
      if (result.kind === 'ask') executed.push('deny:requires approval')
    }

    expect(ctx.trace).toEqual(['decision:deny', 'decision:allow', 'decision:ask'])
    expect(executed).toEqual(['allow', 'deny:requires approval'])
  })
})
