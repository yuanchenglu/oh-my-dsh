import { appendFileSync, chmodSync, mkdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { Session } from '@deepseek-ai/dsh-session'

export type FactType =
  | 'oh-my-dsh/strategy'
  | 'oh-my-dsh/scope-change'
  | 'oh-my-dsh/verdict'
  | 'oh-my-dsh/checkpoint'
  | 'oh-my-dsh/pressure'
  | 'oh-my-dsh/test-result'

export interface Fact<T = unknown> {
  time: string
  sessionId: string
  type: FactType
  data: T
}

const FACT_TYPES: readonly FactType[] = [
  'oh-my-dsh/strategy',
  'oh-my-dsh/scope-change',
  'oh-my-dsh/verdict',
  'oh-my-dsh/checkpoint',
  'oh-my-dsh/pressure',
  'oh-my-dsh/test-result',
]

let lastSkippedFactCount = 0

function sessionIdOf(session: Session): string {
  const id = String(session.header.id)
  if (!id) throw new Error('session id must not be empty')
  return id
}

function workspaceOf(session: Session): string {
  const cwd = session.header.cwd
  if (!cwd) throw new Error('session header.cwd is required for fact storage')
  return cwd
}

export function resolveFactsPath(session: Session): string {
  const encodedId = Buffer.from(sessionIdOf(session)).toString('base64url')
  return join(workspaceOf(session), '.dsh', 'oh-my-dsh', `facts-${encodedId}.jsonl`)
}

function ensureFactFile(path: string): void {
  const directory = dirname(path)
  mkdirSync(directory, { recursive: true, mode: 0o700 })
  chmodSync(directory, 0o700)
  try {
    chmodSync(path, 0o600)
  } catch {
    // The append below creates a missing file with the requested mode.
  }
}

export function appendFact<T>(session: Session, type: FactType, data: T): void {
  const path = resolveFactsPath(session)
  ensureFactFile(path)
  const fact: Fact<T> = {
    time: new Date().toISOString(),
    sessionId: sessionIdOf(session),
    type,
    data,
  }
  appendFileSync(path, `${JSON.stringify(fact)}\n`, { encoding: 'utf8', mode: 0o600 })
  chmodSync(path, 0o600)
}

function isFact(value: unknown): value is Fact {
  if (typeof value !== 'object' || value === null) return false
  const record = value as Record<string, unknown>
  return typeof record.time === 'string'
    && typeof record.sessionId === 'string'
    && typeof record.type === 'string'
    && FACT_TYPES.includes(record.type as FactType)
    && 'data' in record
}

export function readFacts(session: Session, type?: FactType): Fact[] {
  lastSkippedFactCount = 0
  let content: string
  try {
    content = readFileSync(resolveFactsPath(session), 'utf8')
  } catch {
    return []
  }

  const facts: Fact[] = []
  for (const line of content.split(/\r?\n/)) {
    if (!line.trim()) continue
    try {
      const parsed: unknown = JSON.parse(line)
      if (!isFact(parsed) || (type !== undefined && parsed.type !== type)) {
        if (isFact(parsed) && type !== undefined && parsed.type !== type) continue
        lastSkippedFactCount += 1
        continue
      }
      facts.push(parsed)
    } catch {
      lastSkippedFactCount += 1
    }
  }
  return facts
}

export function getLastSkippedFactCount(): number {
  return lastSkippedFactCount
}

export function latestFact(session: Session, type: FactType): Fact | undefined {
  return readFacts(session, type).at(-1)
}

export function latestCheckpointForFork(childSession: Session): Fact | undefined {
  const parentId = childSession.header.parentSession
  if (!parentId) return undefined
  const parentSession = {
    header: { id: parentId, cwd: childSession.header.cwd },
  } as Session
  return latestFact(parentSession, 'oh-my-dsh/checkpoint')
}
