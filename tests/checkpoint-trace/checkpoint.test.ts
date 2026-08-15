import { describe, expect, it } from 'vitest'
import { createCheckpoint, verifyCheckpointIntegrity } from '../../src/checkpoint-trace/checkpoint.js'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

function session() {
  return { header: { id: 'checkpoint-1', cwd: mkdtempSync(join(tmpdir(), 'oh-my-dsh-checkpoint-')) } }
}

describe('checkpoint hash chain', () => {
  it('creates verifiable checkpoints linked to the previous id', () => {
    const currentSession = session()
    const first = createCheckpoint({ session: currentSession, taskId: 'task', turn: 1, step: 0, changedPaths: [] })
    const second = createCheckpoint({ session: currentSession, taskId: 'task', turn: 1, step: 1, changedPaths: [] }, first.checkpointId)
    expect(first.previousCheckpointId).toBeUndefined()
    expect(second.previousCheckpointId).toBe(first.checkpointId)
    expect(verifyCheckpointIntegrity(first)).toBe(true)
    expect(verifyCheckpointIntegrity(second)).toBe(true)
    expect(verifyCheckpointIntegrity({ ...second, workspaceDigest: 'tampered' })).toBe(false)
  })

  it('redacts secret-shaped fields before persistence and hashing', () => {
    const checkpoint = createCheckpoint({
      session: session(), taskId: 'task', turn: 1, step: 0, changedPaths: [],
      testResults: { apiKey: 'secret-value', nested: { password: 'pw', ok: true } },
    }) as unknown as Record<string, unknown>
    expect(JSON.stringify(checkpoint)).not.toContain('secret-value')
    expect(JSON.stringify(checkpoint)).not.toContain('password')
    expect((checkpoint.testResults as Record<string, unknown>).nested).toEqual({ ok: true })
  })
})
