import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import { extractHardConstraints, checkAgainstConstraints } from './extractor.js'

export const name = 'constraint-immune'

export interface Config {
  enabled: boolean
  customPatterns: string[]
}

export const Config: Schema<Config> = Schema.object({
  enabled: Schema.boolean().default(true),
  customPatterns: Schema.array(Schema.string()).default([]),
})

/** 简化版 PreStepDecision（与 dsh 对齐） */
type PreStepDecision =
  | { kind: 'reject' }
  | { kind: 'enter'; messages: unknown[] }

export function apply(ctx: Context, config: Config) {
  if (!config.enabled) return

  // 会话级硬约束状态：sessionId → constraints
  const sessionConstraints = new Map<string, Set<string>>()

  ctx.on('agent/pre-step', async ({ messages, turn, signal }: {
    messages: Array<{ role?: string; content?: unknown }>
    turn: number
    step: number
    signal: AbortSignal
  }, next: () => Promise<PreStepDecision>): Promise<PreStepDecision> => {
    if (signal.aborted) return next()

    // 提取会话 ID（用第一条消息作为简单 key）
    const sessionId = messages.length > 0 ? JSON.stringify(messages[0]).slice(0, 50) : 'default'
    if (!sessionConstraints.has(sessionId)) {
      sessionConstraints.set(sessionId, new Set())
    }
    const constraints = sessionConstraints.get(sessionId)!

    // 1. 从新消息提取硬约束
    for (const msg of messages) {
      if (msg.role === 'user') {
        const text = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content)
        const newConstraints = extractHardConstraints(text)
        for (const c of newConstraints) constraints.add(c)
      }
    }

    // 2. 检查是否有违规（生成前预防）
    if (constraints.size > 0 && turn > 0) {
      const allText = messages
        .map((m) => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content)))
        .join('\n')
      const { violated, matched } = checkAgainstConstraints(allText, constraints)
      if (violated && matched) {
        // 在 messages 末尾追加约束提醒
        const reminder = {
          role: 'user' as const,
          content: `[约束提醒] 检测到可能违反硬约束："${matched}"。请确保不违反此约束。`,
        }
        return { kind: 'enter', messages: [...messages, reminder] }
      }
    }

    return next()
  })
}
