import { describe, expect, it, vi } from 'vitest'
import { apply } from '../../src/constraint-immune/index.js'

function createContext() {
  const listeners: Record<string, Function[]> = {}
  return {
    on: vi.fn((event: string, listener: Function) => {
      listeners[event] = [...(listeners[event] ?? []), listener]
    }),
    effect: vi.fn(),
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    listener(event: string) {
      return listeners[event]![0]!
    },
  }
}

const constraint = { role: 'user', content: '不要修改 API 契约' }
const violation = { role: 'assistant', content: '我现在修改 API 契约如下……' }

describe('constraint-immune waterfall delegation', () => {
  it('delegates before appending a violation reminder', async () => {
    const ctx = createContext()
    apply(ctx as never, { enabled: true, customPatterns: [] })
    const next = vi.fn().mockResolvedValue({ kind: 'enter', messages: [constraint, violation] })
    const result = await ctx.listener('agent/pre-step')({
      messages: [constraint, violation],
      turn: 1,
      step: 0,
      signal: new AbortController().signal,
    }, next)

    expect(next).toHaveBeenCalledTimes(1)
    expect(result.kind).toBe('enter')
    expect(result.messages.at(-1)?.content).toContain('[约束提醒]')
  })

  it('passes through downstream reject without appending a reminder', async () => {
    const ctx = createContext()
    apply(ctx as never, { enabled: true, customPatterns: [] })
    const next = vi.fn().mockResolvedValue({ kind: 'reject' })
    const result = await ctx.listener('agent/pre-step')({
      messages: [constraint, violation],
      turn: 1,
      step: 0,
      signal: new AbortController().signal,
    }, next)

    expect(next).toHaveBeenCalledTimes(1)
    expect(result).toEqual({ kind: 'reject' })
  })

  it('passes through downstream result when already aborted', async () => {
    const ctx = createContext()
    apply(ctx as never, { enabled: true, customPatterns: [] })
    const controller = new AbortController()
    controller.abort()
    const downstream = { kind: 'enter', messages: [constraint] }
    const next = vi.fn().mockResolvedValue(downstream)
    const result = await ctx.listener('agent/pre-step')({
      messages: [constraint, violation],
      turn: 1,
      step: 0,
      signal: controller.signal,
    }, next)

    expect(next).toHaveBeenCalledTimes(1)
    expect(result).toBe(downstream)
  })
})
