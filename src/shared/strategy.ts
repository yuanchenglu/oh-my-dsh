import type { Intent } from './types.js'

export type { Intent }

export type BudgetClass = 'low' | 'medium' | 'high' | 'max'
export type RiskClass = 'R0' | 'R1' | 'R2' | 'R3' | 'R4'

export type StrategySource = 'intent-router' | 'model-router'

export interface StrategyDecision {
  source: StrategySource
  messageId: string
  intent: Intent
  confidence: number
  model: string
  requestedReasoningEffort: string
  effectiveReasoningEffort?: string
  budgetClass: BudgetClass
  riskClass: RiskClass
  fallbackReason?: string
  evidenceRefs: string[]
}

export interface StrategyDefaults {
  requestedReasoningEffort: string
  budgetClass: BudgetClass
  riskClass: RiskClass
}

export const DEFAULT_STRATEGIES: Record<Intent, StrategyDefaults> = {
  refactor: { requestedReasoningEffort: 'high', budgetClass: 'high', riskClass: 'R1' },
  new: { requestedReasoningEffort: 'high', budgetClass: 'high', riskClass: 'R1' },
  medium: { requestedReasoningEffort: 'high', budgetClass: 'medium', riskClass: 'R1' },
  collaboration: { requestedReasoningEffort: 'high', budgetClass: 'high', riskClass: 'R1' },
  architecture: { requestedReasoningEffort: 'max', budgetClass: 'max', riskClass: 'R1' },
  research: { requestedReasoningEffort: 'max', budgetClass: 'max', riskClass: 'R0' },
  simple: { requestedReasoningEffort: 'auto:lowest', budgetClass: 'low', riskClass: 'R0' },
  spec_driven: { requestedReasoningEffort: 'high', budgetClass: 'high', riskClass: 'R1' },
}

export const DEFAULT_EFFORT_MAP: Record<Intent, string> = Object.fromEntries(
  Object.entries(DEFAULT_STRATEGIES).map(([intent, strategy]) => [intent, strategy.requestedReasoningEffort]),
) as Record<Intent, string>
