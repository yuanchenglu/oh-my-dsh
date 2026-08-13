import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import { injectCognition, type InjectionConfig } from './injector.js'

export const name = 'cognition-gate'

export interface Config extends InjectionConfig {}

export const Config: Schema<Config> = Schema.object({
  layers: Schema.object({
    l1: Schema.boolean().default(true),
    l2: Schema.boolean().default(true),
    i02: Schema.boolean().default(true),
    i08: Schema.boolean().default(true),
  }).default({ l1: true, l2: true, i02: true, i08: true }),
  excludePatterns: Schema.array(Schema.string()).default([]),
})

/** 简化版 PreStepDecision（与 dsh 对齐） */
type PreStepDecision =
  | { kind: 'reject' }
  | { kind: 'enter'; messages: unknown[] }

export function apply(ctx: Context, config: Config) {
  ctx.on('agent/pre-step', async ({ messages, turn, signal }: {
    messages: unknown[]
    turn: number
    signal: AbortSignal
  }, next: () => Promise<PreStepDecision>): Promise<PreStepDecision> => {
    if (signal.aborted) return next()
    const injected = injectCognition(messages, turn, config)
    return { kind: 'enter', messages: injected }
  })
}
