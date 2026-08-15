import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import { classifyIntent } from './classifier.js'
import { strategies } from './strategies.js'
import { extractLastUserMessage } from '../shared/messages.js'
import { appendFact } from '../shared/facts.js'
import { DEFAULT_EFFORT_MAP, DEFAULT_STRATEGIES, type StrategyDecision } from '../shared/strategy.js'
import type { Session } from '@deepseek-ai/dsh-session'

export const name = 'intent-router'
// 不声明 inject：agent/request 是事件挂钩，事件监听器在 agent 服务注册前挂上即可触发（v0.1 实测 inject 会导致加载顺序死锁）

export interface Config {
  enabled: boolean
  effortMap: Record<string, string>
}

export const Config: Schema<Config> = Schema.object({
  enabled: Schema.boolean().default(true),
  effortMap: Schema.dict(Schema.string()).default(DEFAULT_EFFORT_MAP),
})

/** agent/request 调用配置（与 dsh LlmCallConfig 对齐的最小形状） */
interface CallConfig {
  provider: string
  model: string
  reasoningEffort?: string
  [key: string]: unknown
}

interface RequestMessage {
  id?: string
  role?: string
  content?: unknown
}

/** agent/request payload 的最小形状（agent.session.deriveMessages 见 dsh Session） */
interface RequestPayload {
  agent: {
    session: {
      deriveMessages(): RequestMessage[]
      header?: { id: string; cwd?: string }
    }
  }
  turn: number
  step: number
  signal: AbortSignal
}

export function apply(ctx: Context, config: Config) {
  if (!config.enabled) return

  // agent/request 是 dsh 设计的调用配置改写通道：
  // listener 在 unwind 阶段返回修改后的 config，loop 会将变更记入 request/header 快照。
  // （llm/stream 的 options 被 agent-loop deepFreeze，且 waterfall 的 next() 不透传参数，
  //   在 llm/stream 里改写 reasoningEffort 必然失效——review R1）
  ctx.on('agent/request', async (payload: RequestPayload, next: () => Promise<CallConfig>): Promise<CallConfig> => {
    const callConfig = await next()
    if (payload.signal.aborted) return callConfig

    const messages = payload.agent.session.deriveMessages()
    const lastMsg = extractLastUserMessage(messages)
    if (!lastMsg) return callConfig

    const classification = classifyIntent(lastMsg, strategies)
    const { intent } = classification
    const effort = config.effortMap[intent]
    if (!effort) return callConfig

    const lastUser = [...messages].reverse().find((message) => message.role === 'user')
    const messageId = lastUser?.id ?? `${payload.agent.session.header?.id ?? 'session'}:${payload.turn}:${payload.step}`
    const defaults = DEFAULT_STRATEGIES[intent]
    let effectiveReasoningEffort: string | undefined = effort
    let fallbackReason: string | undefined

    const resolver = ctx.llm?.resolveModelInfo
    if (typeof resolver !== 'function') {
      return { ...callConfig, reasoningEffort: effort }
    }

    try {
      const info = await resolver.call(ctx.llm, callConfig.provider, callConfig.model, payload.signal)
      const efforts = info.reasoning?.efforts?.map((item) => item.id) ?? []
      if (efforts.length === 0) {
        effectiveReasoningEffort = undefined
        fallbackReason = 'capability-unknown'
      } else {
        const desired = effort === 'auto:lowest' ? efforts[0] : effort
        if (desired !== undefined && efforts.includes(desired)) {
          effectiveReasoningEffort = desired
        } else if (desired !== undefined) {
          const rank: Record<string, number> = { low: 0, medium: 1, high: 2, max: 3 }
          const desiredRank = rank[desired]
          effectiveReasoningEffort = [...efforts].sort((left, right) => {
            if (desiredRank === undefined) return 0
            return Math.abs((rank[left] ?? desiredRank) - desiredRank) - Math.abs((rank[right] ?? desiredRank) - desiredRank)
          })[0]
          fallbackReason = `unsupported-effort:${effort}->${effectiveReasoningEffort}`
        }
      }
    } catch {
      effectiveReasoningEffort = undefined
      fallbackReason = 'capability-unknown'
    }

    if (payload.agent.session.header?.cwd) {
      const decision: StrategyDecision = {
        source: 'intent-router',
        messageId,
        intent,
        confidence: classification.confidence,
        model: callConfig.model,
        requestedReasoningEffort: effort,
        effectiveReasoningEffort,
        budgetClass: defaults.budgetClass,
        riskClass: defaults.riskClass,
        ...(fallbackReason === undefined ? {} : { fallbackReason }),
        evidenceRefs: [],
      }
      appendFact(payload.agent.session as Session, 'oh-my-dsh/strategy', decision)
    }

    if (effectiveReasoningEffort === undefined) {
      const { reasoningEffort: _reasoningEffort, ...providerDefault } = callConfig
      return providerDefault
    }
    return { ...callConfig, reasoningEffort: effectiveReasoningEffort }
  })
}
