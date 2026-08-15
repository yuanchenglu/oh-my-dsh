import { describe, expect, it, vi } from 'vitest'
import { apply as applyIntent } from '../../src/intent-router/index.js'
import { apply as applyModel } from '../../src/model-router/index.js'
import { readFacts } from '../../src/shared/facts.js'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

function createContext(session: { header: { id: string; cwd: string } }) {
  const listeners: Record<string, Function[]> = {}
  let currentMessages: Array<{ id: string; role: string; content: string }> = []
  const runtimeSession = { ...session, deriveMessages: () => currentMessages }
  return {
    on: vi.fn((event: string, listener: Function) => {
      listeners[event] = [...(listeners[event] ?? []), listener]
    }),
    effect: vi.fn(),
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    llm: { resolveModelInfo: vi.fn(async () => ({ reasoning: { efforts: [{ id: 'max' }] } })) },
    async dispatch(messages: Array<{ id: string; role: string; content: string }>) {
      currentMessages = messages
      const payload = {
        agent: { id: 'agent-1', session: runtimeSession },
        turn: 0, step: 0, signal: new AbortController().signal,
      }
      const chain = listeners['agent/request'] ?? []
      const invoke = (index: number, seed: Record<string, unknown>): Promise<Record<string, unknown>> => {
        const listener = chain[index]
        if (!listener) return Promise.resolve(seed)
        return Promise.resolve(listener(payload, () => invoke(index + 1, seed)))
      }
      return invoke(0, { provider: 'deepseek', model: 'flash' })
    },
  }
}

const modelConfig = {
  enabled: true,
  defaultModel: 'flash',
  proModel: 'pro',
  upgradeIntents: [],
  tokenThreshold: 0,
  dissatisfactionEnabled: true,
  dissatisfactionPatterns: [],
}

describe('model-router message-id deduplication', () => {
  it('counts the same dissatisfied message id once', async () => {
    const session = { header: { id: 'dedup-1', cwd: mkdtempSync(join(tmpdir(), 'oh-my-dsh-routing-')) } }
    const ctx = createContext(session)
    applyModel(ctx as never, modelConfig)
    const first = { id: 'm1', role: 'user', content: '不对，重来' }
    const second = { id: 'm2', role: 'user', content: '还是不对' }
    await ctx.dispatch([first])
    const duplicate = await ctx.dispatch([first])
    expect(duplicate.model).toBe('flash')
    const upgraded = await ctx.dispatch([first, second])
    expect(upgraded.model).toBe('pro')
  })

  it('writes model-router strategy facts that can share a message id with intent-router', async () => {
    const session = { header: { id: 'dedup-2', cwd: mkdtempSync(join(tmpdir(), 'oh-my-dsh-routing-')) } }
    const ctx = createContext(session)
    applyIntent(ctx as never, {
      enabled: true,
      effortMap: {
        refactor: 'high', new: 'high', medium: 'high', collaboration: 'high',
        architecture: 'max', research: 'max', simple: 'auto:lowest', spec_driven: 'high',
      },
    })
    applyModel(ctx as never, { ...modelConfig, upgradeIntents: ['architecture'] })
    await ctx.dispatch([{ id: 'shared-message', role: 'user', content: '设计一个架构' }])

    const facts = readFacts(session as never, 'oh-my-dsh/strategy')
    expect(new Set(facts.map((fact) => (fact.data as { source: string; messageId: string }).source))).toEqual(new Set(['intent-router', 'model-router']))
    expect(new Set(facts.map((fact) => (fact.data as { messageId: string }).messageId))).toEqual(new Set(['shared-message']))
  })
})
