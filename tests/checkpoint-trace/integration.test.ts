import { describe, expect, it, vi } from 'vitest'
import { apply } from '../../src/checkpoint-trace/index.js'
import { readFacts } from '../../src/shared/facts.js'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
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
    const next = vi.fn().mockResolvedValue({ kind: 'accept' })
    await ctx.listeners['tools/post-execute']![0]!(
      { name: 'bash', arguments: { command: 'pnpm test' }, agent: { session } },
      { exitCode: 1, stderr: 'failed' },
      next,
    )

    expect(readFacts(session as never, 'oh-my-dsh/test-result')[0]?.data).toMatchObject({ exitCode: 1, command: 'pnpm test' })
    expect(next).toHaveBeenCalledTimes(1)
  })

  it('invalidates the previous digest after state is restored in a new plugin instance', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'oh-my-dsh-trace-'))
    execFileSync('git', ['init', '-q', cwd])
    writeFileSync(join(cwd, 'tracked.txt'), 'before\n')
    execFileSync('git', ['-C', cwd, 'add', 'tracked.txt'])
    execFileSync('git', ['-C', cwd, '-c', 'user.name=oh-my-dsh-test', '-c', 'user.email=test@oh-my-dsh.invalid', 'commit', '-qm', 'initial'])
    const session = { header: { id: 'trace-3', cwd } }

    const firstContext = createContext()
    apply(firstContext as never, { enabled: true, allowedPaths: [cwd] })
    await firstContext.listeners['tools/pre-execute']![0]({
      name: 'write', arguments: { path: join(cwd, 'first.ts') }, agent: { session }, turn: 1, step: 0,
    }, vi.fn().mockResolvedValue({ kind: 'allow' }))

    writeFileSync(join(cwd, 'tracked.txt'), 'after\n')
    const secondContext = createContext()
    apply(secondContext as never, { enabled: true, allowedPaths: [cwd] })
    await secondContext.listeners['tools/pre-execute']![0]({
      name: 'write', arguments: { path: join(cwd, 'second.ts') }, agent: { session }, turn: 2, step: 0,
    }, vi.fn().mockResolvedValue({ kind: 'allow' }))

    const invalidation = readFacts(session as never, 'oh-my-dsh/checkpoint').find((fact) => (fact.data as { kind?: string }).kind === 'invalidation')
    expect(invalidation?.data).toMatchObject({ kind: 'invalidation' })
    expect((invalidation?.data as { previousDigest?: string; currentDigest?: string }).previousDigest).not.toBe(
      (invalidation?.data as { currentDigest?: string }).currentDigest,
    )
  })
})
