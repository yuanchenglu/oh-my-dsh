import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import { execFileSync } from 'node:child_process'
import type { Session } from '@deepseek-ai/dsh-session'
import { appendFact, latestFact, readFacts } from '../shared/facts.js'
import { assessRisk } from '../shared/risk.js'
import { createCheckpoint, type Checkpoint } from './checkpoint.js'

export const name = 'checkpoint-trace'

export interface Config {
  enabled: boolean
  allowedPaths?: string[]
  contractRevision?: number
}

export const Config: Schema<Config> = Schema.object({
  enabled: Schema.boolean().default(true),
  allowedPaths: Schema.array(Schema.string()).default([]),
  contractRevision: Schema.number().default(1),
})

interface State {
  sequence: number
  lastCheckpointId?: string
  lastDigest?: string
}

function sessionOf(agent: { session?: Session } | undefined): Session | undefined {
  return agent?.session
}

function changedPaths(cwd: string): string[] {
  try {
    return execFileSync('git', ['diff', '--name-only', 'HEAD'], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).split(/\r?\n/).filter(Boolean)
  } catch {
    return []
  }
}

function isTestCommand(name: string, args: unknown): { command: string; exitCode?: number; summary?: string } | undefined {
  const record = typeof args === 'object' && args !== null ? args as Record<string, unknown> : {}
  const command = typeof record.command === 'string' ? record.command : typeof args === 'string' ? args : name
  if (!/(?:vitest|jest|pytest|go\s+test|cargo\s+test|pnpm\s+(?:run\s+)?test|npm\s+(?:run\s+)?test)/i.test(command)) return undefined
  const exitCode = typeof record.exitCode === 'number' ? record.exitCode : undefined
  const summary = typeof record.stderr === 'string' ? record.stderr.slice(0, 500) : undefined
  return { command, exitCode, summary }
}

export function apply(ctx: Context, config: Config) {
  if (!config.enabled) return
  const states = new WeakMap<object, State>()

  const recordCheckpoint = (session: Session, payload: { turn?: number; step?: number }, outcome?: string): Checkpoint => {
    const key = session as unknown as object
    const state = states.get(key) ?? { sequence: 0 }
    states.set(key, state)
    if (state.sequence === 0) {
      const previous = readFacts(session, 'oh-my-dsh/checkpoint').filter((fact) => {
        const data = fact.data as { checkpointId?: unknown; sequence?: unknown; workspaceDigest?: unknown }
        return typeof data.checkpointId === 'string'
      }).at(-1)?.data as { checkpointId?: string; sequence?: number; workspaceDigest?: string } | undefined
      state.lastCheckpointId = previous?.checkpointId
      state.sequence = previous?.sequence ?? 0
      state.lastDigest = previous?.workspaceDigest
    }
    const paths = changedPaths(session.header.cwd ?? process.cwd())
    const checkpoint = createCheckpoint({
      session,
      sequence: state.sequence + 1,
      turn: payload.turn,
      step: payload.step,
      contractRevision: config.contractRevision,
      changedPaths: paths,
      testResults: latestFact(session, 'oh-my-dsh/test-result')?.data,
      outcome,
      workspaceDigest: undefined,
    }, state.lastCheckpointId)
    if (state.lastDigest && state.lastDigest !== checkpoint.workspaceDigest) {
      appendFact(session, 'oh-my-dsh/checkpoint', {
        kind: 'invalidation',
        invalidatedCheckpointId: state.lastCheckpointId,
        previousDigest: state.lastDigest,
        currentDigest: checkpoint.workspaceDigest,
      })
    }
    appendFact(session, 'oh-my-dsh/checkpoint', checkpoint)
    state.sequence = checkpoint.sequence
    state.lastCheckpointId = checkpoint.checkpointId
    state.lastDigest = checkpoint.workspaceDigest
    return checkpoint
  }

  ctx.on('tools/pre-execute', async (exec: {
    name: string
    arguments: unknown
    agent?: { session?: Session }
    turn?: number
    step?: number
  }, next: () => Promise<{ kind: 'allow' } | { kind: 'deny'; reason: string } | { kind: 'ask'; reason?: string }>) => {
    const session = sessionOf(exec.agent)
    const allowedPaths = config.allowedPaths && config.allowedPaths.length > 0 ? config.allowedPaths : (session?.header.cwd ? [session.header.cwd] : [])
    const risk = assessRisk({ name: exec.name, arguments: exec.arguments, allowedPaths })
    if (!session || !risk.requiresCheckpoint) return next()
    recordCheckpoint(session, exec, 'pre')
    try {
      const decision = await next()
      recordCheckpoint(session, exec, decision.kind === 'allow' ? 'allowed' : decision.kind === 'deny' ? 'denied' : 'asked')
      return decision
    } catch (error) {
      recordCheckpoint(session, exec, 'error')
      throw error
    }
  })

  ctx.on('tools/post-execute', (
    payload: { name: string; arguments: unknown; agent?: { session?: Session } },
    result: unknown,
    next: () => Promise<unknown>,
  ) => {
    const session = sessionOf(payload.agent)
    const test = isTestCommand(payload.name, payload.arguments)
    if (session && test) {
      const resultRecord = typeof result === 'object' && result !== null ? result as Record<string, unknown> : {}
      appendFact(session, 'oh-my-dsh/test-result', {
        command: test.command,
        exitCode: test.exitCode ?? (typeof resultRecord.exitCode === 'number' ? resultRecord.exitCode : typeof resultRecord.code === 'number' ? resultRecord.code : 0),
        summary: test.summary ?? (typeof resultRecord.stderr === 'string' ? resultRecord.stderr.slice(0, 500) : undefined),
      })
    }
    return next()
  })

  const lifecycle = (payload: { agent?: { session?: Session }; turn?: number; step?: number }) => {
    const session = sessionOf(payload.agent)
    if (session) recordCheckpoint(session, payload, 'lifecycle')
  }
  ctx.on('agent/turn-stopping', lifecycle)
  ctx.on('agent/request-error', lifecycle)
  ctx.on('agent/error', lifecycle)
  ctx.on('agent/pause', lifecycle)
  ctx.on('agent/exit', lifecycle)
}
