import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import type { Session } from '@deepseek-ai/dsh-session'
import { appendFact, readFacts } from '../shared/facts.js'
import { assessRisk } from '../shared/risk.js'
import { createRiskRecord, selectReviewMode, type Verdict } from './verdict.js'

export const name = 'review-router'

export interface Config {
  enabled: boolean
  allowedPaths?: string[]
  policyVersion: string
}

export const Config: Schema<Config> = Schema.object({
  enabled: Schema.boolean().default(true),
  allowedPaths: Schema.array(Schema.string()).default([]),
  policyVersion: Schema.string().default('oh-my-dsh-v0.3'),
})

function sessionOf(agent: { session?: Session } | undefined): Session | undefined {
  return agent?.session
}

function latestCheckpoint(session: Session): { checkpointId?: string; testResults?: { exitCode?: number }; evidenceRefs?: string[] } | undefined {
  return readFacts(session, 'oh-my-dsh/checkpoint').map((fact) => fact.data as { checkpointId?: string; testResults?: { exitCode?: number }; evidenceRefs?: string[] }).reverse().find((data) => data.checkpointId)
}

function verdictFor(result: { kind: string }, riskRecord: ReturnType<typeof createRiskRecord>, checkpointRef: string | undefined, evidenceRefs: string[], reason: string, policyVersion: string): Verdict {
  return {
    verdict: result.kind === 'allow' ? 'pass' : result.kind === 'ask' ? 'ask' : 'reject',
    selectedReviewMode: riskRecord.selectedReviewMode,
    ...(checkpointRef === undefined ? {} : { checkpointRef }),
    evidenceRefs,
    reason,
    policyVersion,
    riskRecord,
  }
}

export function apply(ctx: Context, config: Config) {
  if (!config.enabled) return

  ctx.on('tools/pre-execute', async (exec: {
    name: string
    arguments: unknown
    agent?: { session?: Session }
  }, next: () => Promise<{ kind: 'allow' } | { kind: 'deny'; reason: string } | { kind: 'ask'; reason?: string }>) => {
    const session = sessionOf(exec.agent)
    const allowedPaths = config.allowedPaths && config.allowedPaths.length > 0 ? config.allowedPaths : (session?.header.cwd ? [session.header.cwd] : [])
    const assessment = assessRisk({ name: exec.name, arguments: exec.arguments, allowedPaths })
    const checkpoint = session ? latestCheckpoint(session) : undefined
    const checkpointRef = checkpoint?.checkpointId
    const evidenceRefs = checkpoint?.evidenceRefs ?? (checkpoint?.testResults ? ['test-result'] : [])
    const riskRecord = createRiskRecord(exec.name, assessment, [])
    const mode = selectReviewMode(assessment)

    if (mode === 'M4') {
      const reason = `[review-router] requires approval for ${exec.name}`
      if (session?.header.cwd) appendFact(session, 'oh-my-dsh/verdict', { verdict: 'ask', selectedReviewMode: riskRecord.selectedReviewMode, checkpointRef, evidenceRefs, reason, policyVersion: config.policyVersion, riskRecord })
      return Promise.resolve({ kind: 'ask' as const, reason })
    }

    if (mode === 'M1' && checkpoint?.testResults?.exitCode !== 0) {
      const reason = '[review-router] checkpoint test evidence is required'
      if (session?.header.cwd) appendFact(session, 'oh-my-dsh/verdict', { verdict: 'ask', selectedReviewMode: riskRecord.selectedReviewMode, checkpointRef, evidenceRefs, reason, policyVersion: config.policyVersion, riskRecord })
      return Promise.resolve({ kind: 'ask' as const, reason })
    }

    const result = await next()
    const verdict = verdictFor(result, riskRecord, checkpointRef, evidenceRefs, mode === 'M1' ? 'checkpoint test evidence satisfied' : 'low-risk operation', config.policyVersion)
    if (session?.header.cwd) appendFact(session, 'oh-my-dsh/verdict', verdict)
    return result
  })

  ctx.on('tools/post-execute', (payload: { name: string; arguments: unknown; result?: unknown; agent?: { session?: Session } }) => {
    const session = sessionOf(payload.agent)
    if (!session?.header.cwd) return
    const result = typeof payload.result === 'object' && payload.result !== null ? payload.result as Record<string, unknown> : {}
    const assessment = assessRisk({ name: payload.name, arguments: payload.arguments, allowedPaths: config.allowedPaths ?? [session.header.cwd] })
    const riskRecord = createRiskRecord(payload.name, assessment, [])
    appendFact(session, 'oh-my-dsh/verdict', {
      verdict: result.error || result.exitCode && result.exitCode !== 0 ? 'reject' : 'pass',
      selectedReviewMode: riskRecord.selectedReviewMode,
      evidenceRefs: [],
      reason: 'tool result observed',
      policyVersion: config.policyVersion,
      riskRecord,
    })
  })

  const failure = (payload: { agent?: { session?: Session } }) => {
    const session = sessionOf(payload.agent)
    if (!session?.header.cwd) return
    appendFact(session, 'oh-my-dsh/verdict', {
      verdict: 'defer', evidenceRefs: [], reason: 'agent request failed before review completed', policyVersion: config.policyVersion,
    })
  }
  ctx.on('agent/request-error', failure)
  ctx.on('agent/error', failure)
  ctx.on('agent/turn-stopping', failure)
}
