import { randomUUID } from 'node:crypto'
import type { Session } from '@deepseek-ai/dsh-session'
import { resolveWorkspaceDigest, sha256, type DigestMethod } from './digest.js'

export interface CheckpointInput {
  session: Session
  taskId?: string
  sequence?: number
  turn?: number
  step?: number
  contractRevision?: number
  strategyDecisionRef?: string
  planDigest?: string
  changesetRefs?: string[]
  evidenceRefs?: string[]
  testResults?: unknown
  approvals?: unknown[]
  openIssues?: string[]
  resumePreconditions?: unknown
  outcome?: string
  changedPaths?: string[]
  workspaceDigest?: string
  digestMethod?: DigestMethod
}

export interface Checkpoint {
  checkpointId: string
  taskId: string
  sequence: number
  sessionId: string
  turn: number
  step: number
  contractRevision?: number
  strategyDecisionRef?: string
  workspaceDigest: string
  digestMethod: DigestMethod
  planDigest?: string
  changesetRefs: string[]
  evidenceRefs: string[]
  testResults?: unknown
  approvals: unknown[]
  openIssues: string[]
  resumePreconditions: unknown
  outcome?: string
  previousCheckpointId?: string
  integrityHash: string
}

const REDACT_KEY = /token|key|secret|password/i

export function redactValue(value: unknown, key?: string): unknown {
  if (key && REDACT_KEY.test(key)) return undefined
  if (Array.isArray(value)) return value.map((item) => redactValue(item)).filter((item) => item !== undefined)
  if (typeof value === 'object' && value !== null) {
    const result: Record<string, unknown> = {}
    for (const [childKey, childValue] of Object.entries(value)) {
      const redacted = redactValue(childValue, childKey)
      if (redacted !== undefined) result[childKey] = redacted
    }
    return result
  }
  return value
}

export function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)).map(([key, child]) => [key, canonicalize(child)]))
  }
  return value
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value))
}

export function createCheckpoint(input: CheckpointInput, previousCheckpointId?: string): Checkpoint {
  const digest = input.workspaceDigest === undefined
    ? resolveWorkspaceDigest(input.session.header.cwd ?? process.cwd(), input.changedPaths ?? [])
    : { digest: input.workspaceDigest, digestMethod: input.digestMethod ?? 'paths-mtime' as const }
  const base: Omit<Checkpoint, 'integrityHash'> = {
    checkpointId: randomUUID(),
    taskId: input.taskId ?? String(input.session.header.id),
    sequence: input.sequence ?? 1,
    sessionId: String(input.session.header.id),
    turn: input.turn ?? 0,
    step: input.step ?? 0,
    ...(input.contractRevision === undefined ? {} : { contractRevision: input.contractRevision }),
    ...(input.strategyDecisionRef === undefined ? {} : { strategyDecisionRef: input.strategyDecisionRef }),
    workspaceDigest: digest.digest,
    digestMethod: digest.digestMethod,
    ...(input.planDigest === undefined ? {} : { planDigest: input.planDigest }),
    changesetRefs: input.changesetRefs ?? [],
    evidenceRefs: input.evidenceRefs ?? [],
    ...(input.testResults === undefined ? {} : { testResults: redactValue(input.testResults) }),
    approvals: (redactValue(input.approvals ?? []) ?? []) as unknown[],
    openIssues: input.openIssues ?? [],
    resumePreconditions: redactValue(input.resumePreconditions ?? { workspaceDigest: digest.digest, hashChain: 'complete' }),
    ...(input.outcome === undefined ? {} : { outcome: input.outcome }),
    ...(previousCheckpointId === undefined ? {} : { previousCheckpointId }),
  }
  const redactedBase = redactValue(base) as Omit<Checkpoint, 'integrityHash'>
  return { ...redactedBase, integrityHash: sha256(`${canonicalJson(redactedBase)}${previousCheckpointId ?? ''}`) }
}

export function verifyCheckpointIntegrity(checkpoint: Checkpoint): boolean {
  const { integrityHash, ...base } = checkpoint
  return sha256(`${canonicalJson(base)}${checkpoint.previousCheckpointId ?? ''}`) === integrityHash
}
