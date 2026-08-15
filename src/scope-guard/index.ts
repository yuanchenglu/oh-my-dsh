import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import { randomUUID } from 'node:crypto'
import type { Session } from '@deepseek-ai/dsh-session'
import { appendFact } from '../shared/facts.js'
import { assessRisk } from '../shared/risk.js'
import {
  detectScopeChange,
  extractScopeContract,
  extractTargetPaths,
  isPathAllowed,
  type ScopeContract,
  type ScopeChange,
} from './contract.js'

export const name = 'scope-guard'

export interface Config {
  enabled: boolean
  defaultContract?: Partial<ScopeContract>
  autoExtract: boolean
}

export const Config: Schema<Config> = Schema.object({
  enabled: Schema.boolean().default(true),
  defaultContract: Schema.object({}).default({}),
  autoExtract: Schema.boolean().default(true),
})

type PreStepDecision =
  | { kind: 'reject' }
  | { kind: 'enter'; messages: unknown[] }

interface Proposal {
  proposalId: string
  change: ScopeChange
  contractRevision: number
  status: 'pending' | 'confirmed' | 'rejected' | 'expired'
  userMessagesSinceProposal: number
}

interface ContractState {
  initialized: boolean
  contract?: ScopeContract
  proposal?: Proposal
  lastUserFingerprint?: string
  userMessageCount: number
}

function sessionOf(agent: { session?: Session } | undefined): Session | undefined {
  return agent?.session
}

function stateKey(session: Session | undefined, agent: unknown): object | undefined {
  if (session) return session as unknown as object
  return typeof agent === 'object' && agent !== null ? agent : undefined
}

function mergeContract(base: Partial<ScopeContract>): ScopeContract {
  return {
    scopeId: base.scopeId ?? randomUUID(),
    version: base.version ?? 1,
    objective: base.objective ?? '',
    inScope: base.inScope ?? [],
    nonGoals: base.nonGoals ?? [],
    acceptanceCriteria: base.acceptanceCriteria ?? [],
    constraints: {
      allowedPaths: base.constraints?.allowedPaths ?? [],
      allowedTools: base.constraints?.allowedTools ?? [],
      externalSideEffects: base.constraints?.externalSideEffects ?? [],
    },
    changeBudget: base.changeBudget ?? {},
    owner: base.owner ?? 'user',
    status: base.status ?? 'active',
    contractRevision: base.contractRevision ?? 1,
  }
}

function appendScopeFact(session: Session | undefined, data: unknown): void {
  if (session?.header.cwd) appendFact(session, 'oh-my-dsh/scope-change', data)
}

function isConfirmation(text: string): boolean {
  return /(?:确认|同意|可以|好的|就这样|\byes\b|\bok\b)/i.test(text)
}

function isRejection(text: string): boolean {
  return /(?:拒绝|不同意|不要|不可以|改回|\bno\b)/i.test(text)
}

function reminder(proposal: Proposal): { role: 'user'; content: string } {
  return {
    role: 'user',
    content: `[scope-guard] 检测到范围${proposal.change.kind === 'addition' ? '增加' : '替换'}：${proposal.change.text}。请用户确认后再扩大契约范围。`,
  }
}

export function apply(ctx: Context, config: Config) {
  if (!config.enabled) return
  const states = new WeakMap<object, ContractState>()

  ctx.on('agent/pre-step', async (payload: {
    agent?: { session?: Session }
    messages: Array<{ role?: string; content?: unknown }>
    turn: number
    step: number
    signal: AbortSignal
  }, next: () => Promise<PreStepDecision>): Promise<PreStepDecision> => {
    if (payload.signal.aborted) return next()
    return next().then((decision) => {
      if (decision.kind === 'reject' || payload.signal.aborted) return decision
      const session = sessionOf(payload.agent)
      const key = stateKey(session, payload.agent)
      if (!key) return decision
      const state = states.get(key) ?? { initialized: false, userMessageCount: 0 }
      states.set(key, state)
      const userMessages = decision.messages.filter((message) => {
        const candidate = message as { role?: string; content?: unknown }
        return candidate.role === 'user' && !String(candidate.content ?? '').startsWith('[scope-guard]')
      }) as Array<{ role?: string; content?: unknown }>
      const lastUserText = String(userMessages.at(-1)?.content ?? '')
      const fingerprint = `${userMessages.length}:${lastUserText}`
      const isNewUserMessage = state.lastUserFingerprint !== fingerprint
      if (isNewUserMessage) {
        state.lastUserFingerprint = fingerprint
        state.userMessageCount += 1
      }

      if (!state.initialized) {
        state.initialized = true
        state.contract = config.defaultContract ? mergeContract(config.defaultContract) : (config.autoExtract ? extractScopeContract(lastUserText) : undefined)
        return decision
      }

      if (state.proposal?.status === 'pending') {
        if (isNewUserMessage) {
          if (isConfirmation(lastUserText) && detectScopeChange(lastUserText).kind === 'none') {
            state.proposal.status = 'confirmed'
            if (state.contract) state.contract.contractRevision = state.proposal.contractRevision
            appendScopeFact(session, { ...state.proposal, status: 'confirmed', contractRevision: state.proposal.contractRevision })
            return decision
          }
          if (isRejection(lastUserText)) {
            state.proposal.status = 'rejected'
            appendScopeFact(session, { ...state.proposal, status: 'rejected' })
            return decision
          }
          state.proposal.userMessagesSinceProposal += 1
          if (state.proposal.userMessagesSinceProposal > 3) {
            state.proposal.status = 'expired'
            appendScopeFact(session, { ...state.proposal, status: 'expired' })
            return decision
          }
        }
        return { kind: 'enter', messages: [...decision.messages, reminder(state.proposal)] }
      }

      const change = detectScopeChange(lastUserText)
      if (isNewUserMessage && change.kind !== 'none' && state.contract) {
        const proposal: Proposal = {
          proposalId: randomUUID(),
          change,
          contractRevision: state.contract.contractRevision + 1,
          status: 'pending',
          userMessagesSinceProposal: 0,
        }
        state.proposal = proposal
        appendScopeFact(session, { ...proposal })
        return { kind: 'enter', messages: [...decision.messages, reminder(proposal)] }
      }
      return decision
    })
  })

  ctx.on('tools/pre-execute', (exec: {
    name: string
    arguments: unknown
    agent?: { session?: Session }
  }, next: () => Promise<{ kind: 'allow' } | { kind: 'deny'; reason: string } | { kind: 'ask'; reason?: string }>) => {
    const session = sessionOf(exec.agent)
    let state = session ? states.get(session as unknown as object) : undefined
    if (!state && session && config.defaultContract) {
      state = { initialized: true, contract: mergeContract(config.defaultContract), userMessageCount: 0 }
      states.set(session as unknown as object, state)
    }
    const contract = state?.contract
    if (!contract) return next()
    const paths = extractTargetPaths(exec.arguments)
    const outsidePath = paths.find((path) => !isPathAllowed(path, contract.constraints.allowedPaths, session?.header.cwd))
    if (outsidePath) {
      const data = { proposalId: randomUUID(), status: 'rejected', reason: 'out-of-scope-path', path: outsidePath, contractRevision: contract.contractRevision }
      appendScopeFact(session, data)
      return Promise.resolve({ kind: 'deny' as const, reason: `[scope-guard] path outside contract: ${outsidePath}` })
    }

    const risk = assessRisk({ name: exec.name, arguments: exec.arguments, allowedPaths: contract.constraints.allowedPaths })
    if (risk.requiresApproval) {
      appendScopeFact(session, { proposalId: randomUUID(), status: 'pending', reason: 'requires approval', tool: exec.name, contractRevision: contract.contractRevision })
      return Promise.resolve({ kind: 'ask' as const, reason: `[scope-guard] requires approval for ${exec.name}` })
    }
    if (contract.constraints.allowedTools.length > 0 && !contract.constraints.allowedTools.includes(exec.name)) {
      appendScopeFact(session, { proposalId: randomUUID(), status: 'rejected', reason: 'tool outside contract', tool: exec.name, contractRevision: contract.contractRevision })
      return Promise.resolve({ kind: 'deny' as const, reason: `[scope-guard] tool outside contract: ${exec.name}` })
    }
    return next()
  })
}
