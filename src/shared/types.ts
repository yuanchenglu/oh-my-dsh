/** 意图类型（7+1） */
export type Intent =
  | 'refactor' | 'new' | 'medium' | 'collaboration'
  | 'architecture' | 'research' | 'simple' | 'spec_driven'

/** 意图分类结果 */
export interface Classification {
  intent: Intent
  confidence: number
}

/** 意图配置 */
export interface IntentConfig {
  description: string
  keywords: string[]
  common_creep: string[]
}

/** 策略表 */
export type Strategies = Record<Intent, IntentConfig>
