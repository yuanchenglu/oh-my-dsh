import { describe, expect, it, vi } from 'vitest'
import { apply } from '../../src/scope-guard/index.js'
import type { ScopeContract } from '../../src/scope-guard/contract.js'
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

function contract(cwd: string): Partial<ScopeContract> {
  return {
    scopeId: 'scope-1', version: 1, objective: '修改 src', inScope: ['src'], nonGoals: [],
    acceptanceCriteria: [], owner: 'user', status: 'active', contractRevision: 1,
    constraints: { allowedPaths: [cwd], allowedTools: ['write', 'edit', 'bash'], externalSideEffects: [] },
    changeBudget: {},
  }
}

describe('scope-guard governance', () => {
  it('denies an out-of-scope path at tools/pre-execute', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'oh-my-dsh-scope-'))
    const session = { header: { id: 'scope-1', cwd } }
    const ctx = createContext()
    apply(ctx as never, { enabled: true, autoExtract: false, defaultContract: contract(cwd) })
    const next = vi.fn().mockResolvedValue({ kind: 'allow' })
    const result = await ctx.listener('tools/pre-execute')({
      name: 'write', arguments: { path: '/outside/secret.txt' }, agent: { session },
    }, next)

    expect(result.kind).toBe('deny')
    expect(next).not.toHaveBeenCalled()
    expect(readFacts(session as never, 'oh-my-dsh/scope-change')[0]?.data).toMatchObject({ status: 'rejected' })
  })

  it('asks for approval for an external side effect', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'oh-my-dsh-scope-'))
    const session = { header: { id: 'scope-2', cwd } }
    const ctx = createContext()
    apply(ctx as never, { enabled: true, autoExtract: false, defaultContract: contract(cwd) })
    const result = await ctx.listener('tools/pre-execute')({
      name: 'publish', arguments: { target: join(cwd, 'release') }, agent: { session },
    }, vi.fn().mockResolvedValue({ kind: 'allow' }))

    expect(result).toEqual(expect.objectContaining({ kind: 'ask' }))
    expect(result.reason).toContain('requires approval')
  })

  it('requires confirmation before bumping contract revision', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'oh-my-dsh-scope-'))
    const session = { header: { id: 'scope-3', cwd } }
    const ctx = createContext()
    apply(ctx as never, { enabled: true, autoExtract: false, defaultContract: contract(cwd) })
    const run = (messages: Array<{ role: string; content: string }>, turn: number) => ctx.listener('agent/pre-step')({
      agent: { session }, messages, turn, step: 0, signal: new AbortController().signal,
    }, vi.fn().mockResolvedValue({ kind: 'enter', messages }))

    const first = [{ role: 'user', content: '开始修改 src' }]
    await run(first, 0)
    const pending = await run([...first, { role: 'user', content: '顺便加上 README' }], 1) as { messages: Array<{ content: string }> }
    expect(pending.messages.at(-1)?.content).toContain('请用户确认')
    expect(readFacts(session as never, 'oh-my-dsh/scope-change').at(-1)?.data).toMatchObject({ status: 'pending', contractRevision: 2 })

    await run([...first, { role: 'user', content: '顺便加上 README' }, { role: 'user', content: '确认' }], 2)
    expect(readFacts(session as never, 'oh-my-dsh/scope-change').at(-1)?.data).toMatchObject({ status: 'confirmed', contractRevision: 2 })
  })

  it('does not treat clarification as a scope change', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'oh-my-dsh-scope-'))
    const session = { header: { id: 'scope-4', cwd } }
    const ctx = createContext()
    apply(ctx as never, { enabled: true, autoExtract: false, defaultContract: contract(cwd) })
    const messages = [{ role: 'user', content: '我的意思是保留原目标' }]
    const result = await ctx.listener('agent/pre-step')({
      agent: { session }, messages, turn: 0, step: 0, signal: new AbortController().signal,
    }, vi.fn().mockResolvedValue({ kind: 'enter', messages })) as { messages: unknown[] }

    expect(result.messages).toHaveLength(1)
    expect(readFacts(session as never, 'oh-my-dsh/scope-change')).toHaveLength(0)
  })
})
