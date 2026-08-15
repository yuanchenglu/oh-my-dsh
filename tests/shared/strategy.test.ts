import { describe, expect, it } from 'vitest'
import { DEFAULT_STRATEGIES, type Intent } from '../../src/shared/strategy.js'

const intents: Intent[] = ['refactor', 'new', 'medium', 'collaboration', 'architecture', 'research', 'simple', 'spec_driven']

describe('strategy defaults', () => {
  it('covers all eight intents', () => {
    expect(Object.keys(DEFAULT_STRATEGIES).sort()).toEqual([...intents].sort())
  })

  it('uses capability-aware sentinel and explicit spec strategy', () => {
    expect(DEFAULT_STRATEGIES.simple.requestedReasoningEffort).toBe('auto:lowest')
    expect(DEFAULT_STRATEGIES.spec_driven.requestedReasoningEffort).toBe('high')
  })
})
