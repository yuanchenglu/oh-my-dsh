import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import { classifyIntent } from './classifier.js'
import { strategies } from './strategies.js'

export const name = 'intent-router'
// 不声明 inject：agent/request 是事件挂钩，事件监听器在 agent 服务注册前挂上即可触发（v0.1 实测 inject 会导致加载顺序死锁）

export interface Config {
  enabled: boolean
  effortMap: Record<string, string>
}

export const Config: Schema<Config> = Schema.object({
  enabled: Schema.boolean().default(true),
  effortMap: Schema.dict(Schema.string()).default({
    architecture: 'max',
    research: 'max',
    collaboration: 'max',
    refactor: 'high',
    new: 'high',
    medium: 'high',
  }),
})

/** agent/request 调用配置（与 dsh LlmCallConfig 对齐的最小形状） */
interface CallConfig {
  provider: string
  model: string
  reasoningEffort?: string
  [key: string]: unknown
}

/** agent/request payload 的最小形状（agent.session.deriveMessages 见 dsh Session） */
interface RequestPayload {
  agent: {
    session: {
      deriveMessages(): Array<{ role?: string; content?: unknown }>
    }
  }
  turn: number
  step: number
  signal: AbortSignal
}

/** 把消息 content 拍平为纯文本（string 直取，ContentBlock[] 拼接 text part） */
function contentToText(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .map((part) => (part && typeof part === 'object' && 'text' in part ? String((part as { text: unknown }).text) : ''))
      .join('')
  }
  return ''
}

/** 从消息数组提取最后一条用户消息的纯文本 */
function extractLastUserMessage(messages: readonly { role?: string; content?: unknown }[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i]
    if (msg.role === 'user') return contentToText(msg.content)
  }
  return ''
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

    const lastMsg = extractLastUserMessage(payload.agent.session.deriveMessages())
    if (!lastMsg) return callConfig

    const { intent } = classifyIntent(lastMsg, strategies)
    const effort = config.effortMap[intent]
    if (!effort) return callConfig

    return { ...callConfig, reasoningEffort: effort }
  })
}
