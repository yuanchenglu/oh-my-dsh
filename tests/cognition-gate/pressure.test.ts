import { describe, expect, it, vi } from 'vitest'
import { apply } from '../../src/cognition-gate/index.js'
import { readFacts } from '../../src/shared/facts.js'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

function createContext() {
  const listeners: Record<string, Function[]> = {}
  return {
    on: vi.fn((event: string, listener: Function) => {
      listeners[event] = [...(listeners[event] ?? []), listener]
    }),
    effect: vi.fn(),
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    listener: (event: string) => listeners[event]![0]!,
  }
}

describe('cognition-gate pressure signal', () => {
  it('tags stable injection and records pressure without dropping it', async () => {
    const session = { header: { id: 'pressure-1', cwd: mkdtempSync(join(tmpdir(), 'oh-my-dsh-pressure-')) } }
    const ctx = createContext()
    apply(ctx as never, {
      layers: { l1: true, l2: true, i02: true, i08: true },
      excludePatterns: [],
      pressureThreshold: 1,
    })
    const original = { role: 'user', content: '继续' }
    const result = await ctx.listener('agent/pre-step')({
      agent: { session }, messages: [original], turn: 0, step: 0,
      signal: new AbortController().signal,
    }, vi.fn().mockResolvedValue({ kind: 'enter', messages: [original] })) as { messages: Array<{ content: string }> }

    expect(result.messages[0]?.content).toContain('zone=stable')
    expect(result.messages[0]?.content).toContain('estimatedTokens=')
    expect(readFacts(session as never, 'oh-my-dsh/pressure')).toHaveLength(1)
    expect(result.messages[0]?.content).toContain('[L1 荣辱观]')
  })

  it('does not emit pressure below the configured threshold', async () => {
    const session = { header: { id: 'pressure-2', cwd: mkdtempSync(join(tmpdir(), 'oh-my-dsh-pressure-')) } }
    const ctx = createContext()
    apply(ctx as never, {
      layers: { l1: true, l2: true, i02: true, i08: true },
      excludePatterns: [],
      pressureThreshold: 10000,
    })
    await ctx.listener('agent/pre-step')({
      agent: { session }, messages: [{ role: 'user', content: '继续' }], turn: 0, step: 0,
      signal: new AbortController().signal,
    }, vi.fn().mockResolvedValue({ kind: 'enter', messages: [{ role: 'user', content: '继续' }] }))

    expect(readFacts(session as never, 'oh-my-dsh/pressure')).toHaveLength(0)
  })
})
