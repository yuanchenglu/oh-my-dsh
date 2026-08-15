import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import { extractHardConstraints, checkAgainstConstraints, matchesToolConstraint, type Constraint } from './extractor.js'
import { contentToText } from '../shared/messages.js'

export const name = 'constraint-immune'

export interface Config {
  enabled: boolean
  customPatterns: string[]
  interception?: 'off' | 'deny'
}

export const Config: Schema<Config> = Schema.object({
  enabled: Schema.boolean().default(true),
  customPatterns: Schema.array(Schema.string()).default([]),
  interception: Schema.string().default('deny'),
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

/** 约束 + 首次出现的消息下标 + 肯定型一次性检查标记 */
type StoredConstraint = Constraint & { messageIndex: number; positiveChecked?: boolean }

export function apply(ctx: Context, config: Config) {
  if (!config.enabled) return

  // 会话级状态：sessionId → { 约束表, 已检查到的消息下标 }
  const sessions = new Map<string, { constraints: Map<string, StoredConstraint>; checkedUpTo: number }>()

  ctx.on('agent/pre-step', async (payload: PreStepPayload, next: () => Promise<PreStepDecision>): Promise<PreStepDecision> => {
    const { turn, signal } = payload
    const decision = await next()
    if (decision.kind === 'reject' || signal.aborted) return decision
    const messages = decision.messages as Array<{ role?: string; content?: unknown }>

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
          return { kind: 'enter', messages: [...decision.messages, reminder] }
        }
      }
    }

    // 3. 肯定型约束“缺少执行”一次性检查：只看首次出现后的第一段新 assistant 输出。
    for (const stored of constraints.values()) {
      if (stored.kind !== 'positive' || stored.positiveChecked) continue
      const scope = messages
        .slice(Math.max(stored.messageIndex + 1, session.checkedUpTo))
        .filter((m) => m.role === 'assistant')
        .map((m) => contentToText(m.content))
        .join('\n')
      if (!scope.trim()) continue
      stored.positiveChecked = true
      if (!scope.includes(stored.keyword)) {
        session.checkedUpTo = messages.length
        const reminder = {
          role: 'user' as const,
          content: `[约束提醒] 检测到可能未执行硬约束："${stored.raw}"。请确认已执行。`,
        }
        return { kind: 'enter', messages: [...decision.messages, reminder] }
      }
    }

    session.checkedUpTo = messages.length
    return decision
  })

  // 执行时拦截：工具派发前检查工具名与参数是否命中否定型约束关键词。
  if (config.interception === 'deny') {
    ctx.on('tools/pre-execute', (exec: {
      name: string
      arguments: unknown
      agent?: { id?: unknown }
    }, next: () => Promise<{ kind: 'allow' } | { kind: 'deny'; reason: string } | { kind: 'ask'; reason?: string }>) => {
      const sessionId = exec.agent?.id != null ? String(exec.agent.id) : 'default'
      const session = sessions.get(sessionId)
      if (!session || session.constraints.size === 0) return next()

      const argsText = typeof exec.arguments === 'string'
        ? exec.arguments
        : JSON.stringify(exec.arguments ?? '')
      const text = exec.name + '\n' + argsText

      for (const stored of session.constraints.values()) {
        if (stored.kind !== 'negative') continue
        if (stored.keyword.length < 4) continue
        if (matchesToolConstraint(text, stored)) {
          return Promise.resolve({
            kind: 'deny' as const,
            reason: `[constraint-immune] 命中硬约束："${stored.raw}"`,
          })
        }
      }
      return next()
    })
  }
}
