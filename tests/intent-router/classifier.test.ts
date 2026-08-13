import { describe, it, expect } from 'vitest'
import { classifyIntent, keywordMatchScore } from '../../src/intent-router/classifier.js'
import { strategies } from '../../src/intent-router/strategies.js'
import { fixtures } from './fixtures.js'

describe('keywordMatchScore', () => {
  it('exact substring match returns 1.0', () => {
    expect(keywordMatchScore('重构', '帮我重构代码')).toBe(1.0)
  })
  it('non-CJK keyword without match returns 0.0', () => {
    expect(keywordMatchScore('xyz', 'hello world')).toBe(0.0)
  })
  it('short CJK without exact match returns 0.0', () => {
    expect(keywordMatchScore('重构', '重新构造')).toBe(0.0)
  })
})

describe('classifyIntent', () => {
  for (const { input, expectedIntent, minConfidence } of fixtures) {
    it(`"${input.slice(0, 20)}..." → ${expectedIntent}`, () => {
      const result = classifyIntent(input, strategies)
      expect(result.intent).toBe(expectedIntent)
      expect(result.confidence).toBeGreaterThanOrEqual(minConfidence)
    })
  }
  it('empty input returns spec_driven', () => {
    expect(classifyIntent('', strategies).intent).toBe('spec_driven')
  })
  it('confidence is in [0, 1]', () => {
    const r = classifyIntent('帮我重构这个模块', strategies)
    expect(r.confidence).toBeGreaterThanOrEqual(0)
    expect(r.confidence).toBeLessThanOrEqual(1)
  })
})
