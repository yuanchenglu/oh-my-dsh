import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import { classifyIntent } from './classifier.js'
import { strategies } from './strategies.js'

export const name = 'intent-router'
export const inject = ['llm']

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

/** 从消息数组提取最后一条用户消息 */
function extractLastUserMessage(messages: readonly unknown[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i] as { role?: string; content?: unknown }
    if (msg.role === 'user') {
      return typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content)
    }
  }
  return ''
}

export function apply(ctx: Context, config: Config) {
  if (!config.enabled) return

  ctx.on('llm/stream', (options: {
    messages: readonly unknown[]
    reasoningEffort?: string
    [key: string]: unknown
  }, next: () => AsyncIterable<unknown>) => {
    const lastMsg = extractLastUserMessage(options.messages)
    if (!lastMsg) return next()

    const { intent } = classifyIntent(lastMsg, strategies)
    const effort = config.effortMap[intent]
    if (effort) {
      options = Object.freeze({ ...options, reasoningEffort: effort })
    }
    return next()
  })
}
