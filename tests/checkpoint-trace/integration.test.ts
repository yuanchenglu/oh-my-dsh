import { describe, expect, it, vi } from 'vitest'
import { apply } from '../../src/checkpoint-trace/index.js'
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
    listeners,
  }
}

describe('checkpoint-trace integration', () => {
  it('records paired checkpoints even when a downstream tool decision is deny', async () => {
    const session = { header: { id: 'trace-1', cwd: mkdtempSync(join(tmpdir(), 'oh-my-dsh-trace-')) } }
    const ctx = createContext()
    apply(ctx as never, { enabled: true, allowedPaths: [session.header.cwd] })
    const next = vi.fn().mockResolvedValue({ kind: 'deny', reason: 'blocked downstream' })
    const result = await ctx.listeners['tools/pre-execute']![0]!({
      name: 'write', arguments: { path: join(session.header.cwd, 'a.ts') }, agent: { session }, turn: 1, step: 0,
    }, next)

    expect(result.kind).toBe('deny')
    expect(next).toHaveBeenCalledTimes(1)
    const checkpoints = readFacts(session as never, 'oh-my-dsh/checkpoint')
    expect(checkpoints).toHaveLength(2)
    expect(checkpoints.at(-1)?.data).toMatchObject({ outcome: 'denied' })
  })

  it('records test results from post-execute without using session.append', async () => {
    const session = { header: { id: 'trace-2', cwd: mkdtempSync(join(tmpdir(), 'oh-my-dsh-trace-')) } }
    const ctx = createContext()
    apply(ctx as never, { enabled: true, allowedPaths: [session.header.cwd] })
    await ctx.listeners['tools/post-execute']![0]!({
      name: 'bash', arguments: { command: 'pnpm test' }, result: { exitCode: 1, stderr: 'failed' }, agent: { session },
    })

    expect(readFacts(session as never, 'oh-my-dsh/test-result')[0]?.data).toMatchObject({ exitCode: 1, command: 'pnpm test' })
  })
})
