import { describe, expect, it, vi } from 'vitest'
import { apply } from '../../src/review-router/index.js'
import { appendFact, readFacts } from '../../src/shared/facts.js'
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

function setup() {
  const cwd = mkdtempSync(join(tmpdir(), 'oh-my-dsh-review-'))
  const session = { header: { id: 'review-1', cwd } }
  const ctx = createContext()
  apply(ctx as never, { enabled: true, allowedPaths: [cwd], policyVersion: 'v0.3-test' })
  return { cwd, session, ctx }
}

async function execute(ctx: ReturnType<typeof createContext>, session: { header: { id: string; cwd: string } }, name: string, args: unknown) {
  const next = vi.fn().mockResolvedValue({ kind: 'allow' })
  const result = await ctx.listener('tools/pre-execute')({ name, arguments: args, agent: { session } }, next)
  return { result, next }
}

describe('review-router M0/M1/M4', () => {
  it('passes R0 read operations in M0', async () => {
    const { session, ctx } = setup()
    const { result, next } = await execute(ctx, session, 'read', { path: `${session.header.cwd}/a.ts` })
    expect(result).toEqual({ kind: 'allow' })
    expect(next).toHaveBeenCalled()
    expect(readFacts(session as never, 'oh-my-dsh/verdict')[0]?.data).toMatchObject({ verdict: 'pass', selectedReviewMode: 'M0' })
  })

  it('passes contract-internal write in M1 when checkpoint has successful test evidence', async () => {
    const { cwd, session, ctx } = setup()
    appendFact(session as never, 'oh-my-dsh/checkpoint', { checkpointId: 'cp-1', testResults: { exitCode: 0 } })
    const { result } = await execute(ctx, session, 'write', { path: join(cwd, 'src/a.ts') })
    expect(result).toEqual({ kind: 'allow' })
    expect(readFacts(session as never, 'oh-my-dsh/verdict')[0]?.data).toMatchObject({
      verdict: 'pass', selectedReviewMode: 'M1', checkpointRef: 'cp-1',
    })
  })

  it('asks for M1 evidence when a contract-internal write lacks tests', async () => {
    const { session, ctx } = setup()
    const { result } = await execute(ctx, session, 'edit', { path: `${session.header.cwd}/a.ts` })
    expect(result.kind).toBe('ask')
    expect(result.reason).toContain('checkpoint')
  })

  it('routes deletion and external side effects to M4 ask', async () => {
    const { session, ctx } = setup()
    const deletion = await execute(ctx, session, 'rm', { command: 'rm -f /tmp/a' })
    const external = await execute(ctx, session, 'publish', { target: `${session.header.cwd}/release` })
    expect(deletion.result).toEqual(expect.objectContaining({ kind: 'ask' }))
    expect(external.result).toEqual(expect.objectContaining({ kind: 'ask' }))
    expect(readFacts(session as never, 'oh-my-dsh/verdict').every((fact) => (fact.data as { selectedReviewMode: string }).selectedReviewMode === 'M4')).toBe(true)
  })

  it('observes the real post-execute waterfall signature and continues', async () => {
    const { session, ctx } = setup()
    const next = vi.fn().mockResolvedValue({ kind: 'allow' })
    await ctx.listener('tools/post-execute')({
      name: 'bash', arguments: { command: 'printf ok' }, agent: { session },
    }, { exitCode: 1 }, next)

    expect(next).toHaveBeenCalledTimes(1)
    expect(readFacts(session as never, 'oh-my-dsh/verdict')[0]?.data).toMatchObject({ verdict: 'reject' })
  })
})
