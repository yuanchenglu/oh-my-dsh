import { describe, expect, it } from 'vitest'
import { appendFact, getLastSkippedFactCount, latestCheckpointForFork, latestFact, readFacts, resolveFactsPath } from '../../src/shared/facts.js'
import type { Session } from '@deepseek-ai/dsh-session'
import type { FactType } from '../../src/shared/facts.js'
import { mkdtempSync, appendFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

function session(id: string, cwd: string, parentSession?: string): Session {
  return { header: { id, cwd, parentSession } }
}

describe('sidecar fact store', () => {
  it('writes six fact types as valid JSONL with a safe session path', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'oh-my-dsh-facts-'))
    const current = session('session/with traversal', cwd)
    const types: FactType[] = [
      'oh-my-dsh/strategy',
      'oh-my-dsh/scope-change',
      'oh-my-dsh/verdict',
      'oh-my-dsh/checkpoint',
      'oh-my-dsh/pressure',
      'oh-my-dsh/test-result',
    ]
    for (const type of types) appendFact(current, type, { type })

    expect(resolveFactsPath(current)).toContain('facts-c2Vzc2lvbi93aXRoIHRyYXZlcnNhbA.jsonl')
    const lines = readFileSync(resolveFactsPath(current), 'utf8').trim().split('\n')
    expect(lines).toHaveLength(types.length)
    expect(lines.map((line) => JSON.parse(line).type)).toEqual(types)
    expect(latestFact(current, 'oh-my-dsh/pressure')?.data).toEqual({ type: 'oh-my-dsh/pressure' })
  })

  it('skips truncated or malformed lines without failing replay', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'oh-my-dsh-facts-'))
    const current = session('s1', cwd)
    appendFact(current, 'oh-my-dsh/checkpoint', { checkpointId: 'cp-1' })
    appendFileSync(resolveFactsPath(current), '{"broken"\nnot-json\n')

    const facts = readFacts(current)
    expect(facts).toHaveLength(1)
    expect(facts[0]?.data).toEqual({ checkpointId: 'cp-1' })
    expect(getLastSkippedFactCount()).toBe(2)
  })

  it('finds the latest checkpoint from a parent session for a fork', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'oh-my-dsh-facts-'))
    const parent = session('parent', cwd)
    const child = session('child', cwd, 'parent')
    appendFact(parent, 'oh-my-dsh/checkpoint', { checkpointId: 'cp-1' })
    appendFact(parent, 'oh-my-dsh/checkpoint', { checkpointId: 'cp-2' })

    expect(latestCheckpointForFork(child)?.data).toEqual({ checkpointId: 'cp-2' })
  })
})
