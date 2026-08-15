import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import { injectCognition, type InjectionConfig } from './injector.js'
import { appendFact } from '../shared/facts.js'
import { buildPressureEvent, createZoneSection, PRESSURE_THRESHOLD, type Zone } from '../shared/context-zones.js'
import { estimateTokens } from '../shared/messages.js'
import type { Session } from '@deepseek-ai/dsh-session'

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
  pressureThreshold: Schema.number().default(PRESSURE_THRESHOLD),
})

/** 简化版 PreStepDecision（与 dsh 对齐） */
type PreStepDecision =
  | { kind: 'reject' }
  | { kind: 'enter'; messages: unknown[] }

export function apply(ctx: Context, config: Config) {
  ctx.on('agent/pre-step', async ({ agent, messages, turn, signal }: {
    agent?: { session?: Session }
    messages: unknown[]
    turn: number
    signal: AbortSignal
  }, next: () => Promise<PreStepDecision>): Promise<PreStepDecision> => {
    if (signal.aborted) return next()
    const decision = await next()
    if (decision.kind === 'reject' || signal.aborted) return decision
    const injectedMessages = injectCognition(decision.messages, turn, config)
    const stableTokens = estimateTokens(injectedMessages.slice(-1) as Array<{ content?: unknown }>)
    const zones: Record<Zone, ReturnType<typeof createZoneSection>> = {
      stable: createZoneSection('stable', 'cognition-gate', 'session', stableTokens),
      evidence: createZoneSection('evidence', 'dsh', 'turn', 0),
      active: createZoneSection('active', 'dsh', 'turn', estimateTokens(decision.messages as Array<{ content?: unknown }>)),
      external: createZoneSection('external', 'dsh', 'ttl', 0),
    }
    const pressure = buildPressureEvent(zones, config.pressureThreshold ?? PRESSURE_THRESHOLD)
    if (pressure.totalEstimatedTokens >= pressure.pressureThreshold && agent?.session?.header?.cwd) {
      appendFact(agent.session, 'oh-my-dsh/pressure', pressure)
    }
    return { kind: 'enter', messages: injectedMessages }
  })
}
