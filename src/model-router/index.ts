import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import { classifyIntent } from '../intent-router/classifier.js'
import { strategies } from '../intent-router/strategies.js'
import { extractLastUserMessage, estimateTokens } from '../shared/messages.js'
import { appendFact } from '../shared/facts.js'
import { DEFAULT_STRATEGIES, type StrategyDecision } from '../shared/strategy.js'
import type { Session } from '@deepseek-ai/dsh-session'

export const name = 'model-router'
// 不声明 inject：与 intent-router 同理，事件监听器先于服务注册挂上即可触发

export interface Config {
  enabled: boolean
  defaultModel: string
  proModel: string
  upgradeIntents: string[]
  tokenThreshold: number
  dissatisfactionEnabled: boolean
  dissatisfactionPatterns: string[]
}

export const Config: Schema<Config> = Schema.object({
  enabled: Schema.boolean().default(true),
  defaultModel: Schema.string().default('deepseek-v4-flash'),
  proModel: Schema.string().default('deepseek-v4-pro'),
  upgradeIntents: Schema.array(Schema.string()).default(['architecture', 'research']),
  tokenThreshold: Schema.number().default(30000),
  dissatisfactionEnabled: Schema.boolean().default(true),
  dissatisfactionPatterns: Schema.array(Schema.string()).default([]),
})

/** 内置“不满意”判定正则（PRD 3.1.2） */
const BUILTIN_DISSATISFACTION_RE =
  /(?:不对|错了|重新|重来|不行|不符合|不是这样|再试|wrong|try again|not right)/i

/** agent/request 调用配置的最小形状（与 dsh LlmCallConfig 对齐） */
interface CallConfig {
  provider: string
  model: string
  reasoningEffort?: string
  [key: string]: unknown
}

interface RequestPayload {
  agent: {
    id?: unknown
    session: {
      deriveMessages(): Array<{ id?: string; role?: string; content?: unknown }>
      header?: { id: string; cwd?: string }
    }
  }
  turn: number
  step: number
  signal: AbortSignal
}

/** 升级评估结果（纯函数，便于单测） */
export interface UpgradeDecision {
  upgrade: boolean
  reason: 'intent' | 'tokens' | 'dissatisfaction' | 'none'
}

/**
 * 升级条件评估（PRD 3.1.1，满足任一即升 Pro）。
 * 纯函数：不读 ctx、不读状态，调用方负责传入连续不满意轮数。
 */
export function evaluateUpgrade(params: {
  intent: string
  estimatedTokens: number
  consecutiveDissatisfied: number
  config: Pick<Config, 'upgradeIntents' | 'tokenThreshold' | 'dissatisfactionEnabled'>
}): UpgradeDecision {
  const { intent, estimatedTokens, consecutiveDissatisfied, config } = params
  if (config.upgradeIntents.includes(intent)) return { upgrade: true, reason: 'intent' }
  if (config.tokenThreshold > 0 && estimatedTokens > config.tokenThreshold) {
    return { upgrade: true, reason: 'tokens' }
  }
  if (config.dissatisfactionEnabled && consecutiveDissatisfied >= 2) {
    return { upgrade: true, reason: 'dissatisfaction' }
  }
  return { upgrade: false, reason: 'none' }
}

export function apply(ctx: Context, config: Config) {
  if (!config.enabled) return

  interface SessionState { seenMessageIds: Set<string>; streak: number }
  const dissatisfactionState = new WeakMap<object, SessionState>()

  const customRes = config.dissatisfactionPatterns
    .filter((p) => p.length > 0)
    .map((p) => new RegExp(p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'))

  ctx.on('agent/request', async (payload: RequestPayload, next: () => Promise<CallConfig>): Promise<CallConfig> => {
    const callConfig = await next()
    if (payload.signal.aborted) return callConfig

    const messages = payload.agent.session.deriveMessages()
    const lastUser = extractLastUserMessage(messages)

    const dissatisfied =
      lastUser.length > 0 &&
      (BUILTIN_DISSATISFACTION_RE.test(lastUser) || customRes.some((re) => re.test(lastUser)))
    const sessionObject = payload.agent.session as unknown as object
    let state = dissatisfactionState.get(sessionObject)
    if (payload.agent.session.header) {
      state ??= { seenMessageIds: new Set(), streak: 0 }
      dissatisfactionState.set(sessionObject, state)
    }

    const lastUserMessage = [...messages].reverse().find((message) => message.role === 'user')
    let streak: number
    if (state && lastUserMessage?.id) {
      if (!state.seenMessageIds.has(lastUserMessage.id)) {
        state.seenMessageIds.add(lastUserMessage.id)
        state.streak = dissatisfied ? state.streak + 1 : 0
      }
      streak = state.streak
    } else {
      streak = 0
      for (const message of [...messages].reverse()) {
        if (message.role !== 'user') continue
        const text = extractLastUserMessage([message])
        const matches = text.length > 0 && (BUILTIN_DISSATISFACTION_RE.test(text) || customRes.some((re) => re.test(text)))
        if (!matches) break
        streak += 1
      }
    }

    const { intent } = lastUser
      ? classifyIntent(lastUser, strategies)
      : { intent: 'spec_driven' as const }

    const decision = evaluateUpgrade({
      intent,
      estimatedTokens: estimateTokens(messages),
      consecutiveDissatisfied: streak,
      config,
    })

    const model = decision.upgrade ? config.proModel : config.defaultModel
    if (decision.upgrade && payload.agent.session.header?.cwd) {
      const lastUserMessageId = lastUserMessage?.id ?? `${payload.agent.session.header.id}:${payload.turn}:${payload.step}`
      const defaults = DEFAULT_STRATEGIES[intent]
      const strategy: StrategyDecision = {
        source: 'model-router',
        messageId: lastUserMessageId,
        intent,
        confidence: lastUser ? classifyIntent(lastUser, strategies).confidence : 0,
        model,
        requestedReasoningEffort: callConfig.reasoningEffort ?? '',
        effectiveReasoningEffort: callConfig.reasoningEffort,
        budgetClass: defaults.budgetClass,
        riskClass: defaults.riskClass,
        fallbackReason: `model-upgrade:${decision.reason}`,
        evidenceRefs: [],
      }
      appendFact(payload.agent.session as Session, 'oh-my-dsh/strategy', strategy)
    }

    // 只改 model，provider 与其余字段原样保留（PRD AC-6）
    return { ...callConfig, model }
  })
}
