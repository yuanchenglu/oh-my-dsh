import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import { extractHardConstraints, checkAgainstConstraints, type Constraint } from './extractor.js'

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

interface PreStepPayload {
  agent?: { id?: unknown }
  messages: Array<{ role?: string; content?: unknown }>
  turn: number
  step: number
  signal: AbortSignal
}

/** 约束 + 首次出现的消息下标（messages 只增不改，下标稳定；session 压缩时退化为近似值） */
type StoredConstraint = Constraint & { messageIndex: number }

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

export function apply(ctx: Context, config: Config) {
  if (!config.enabled) return

  // 会话级状态：sessionId → { 约束表, 已检查到的消息下标 }
  const sessions = new Map<string, { constraints: Map<string, StoredConstraint>; checkedUpTo: number }>()

  ctx.on('agent/pre-step', async (payload: PreStepPayload, next: () => Promise<PreStepDecision>): Promise<PreStepDecision> => {
    const { messages, turn, signal } = payload
    if (signal.aborted) return next()

    // 会话 key 优先用 agent 的 session id；拿不到则退化为全局单桶（不隔离，v0.1 可接受）
    const sessionId = payload.agent?.id != null ? String(payload.agent.id) : 'default'
    if (!sessions.has(sessionId)) {
      sessions.set(sessionId, { constraints: new Map(), checkedUpTo: 0 })
    }
    const session = sessions.get(sessionId)!
    const { constraints } = session

    // 1. 从用户消息提取硬约束（跳过本插件注入的提醒，避免自我再提取）
    messages.forEach((msg, index) => {
      if (msg.role !== 'user') return
      const text = contentToText(msg.content)
      if (text.startsWith('[约束提醒]')) return
      for (const c of extractHardConstraints(text, config.customPatterns)) {
        if (!constraints.has(c.raw)) constraints.set(c.raw, { ...c, messageIndex: index })
      }
    })

    // 2. 违规检查（review R3）：只看"约束首次出现之后"且"上一轮检查之后"的
    //    新 assistant 消息——拼全部消息会把用户约束原文和历史输出算进去，每轮必误报
    if (constraints.size > 0 && turn > 0) {
      for (const stored of constraints.values()) {
        const scope = messages
          .slice(Math.max(stored.messageIndex + 1, session.checkedUpTo))
          .filter((m) => m.role === 'assistant')
          .map((m) => contentToText(m.content))
          .join('\n')
        const { violated, matched } = checkAgainstConstraints(scope, [stored])
        if (violated && matched) {
          session.checkedUpTo = messages.length
          const reminder = {
            role: 'user' as const,
            content: `[约束提醒] 检测到可能违反硬约束："${matched}"。请确保不违反此约束。`,
          }
          return { kind: 'enter', messages: [...messages, reminder] }
        }
      }
    }

    session.checkedUpTo = messages.length
    return next()
  })
}
