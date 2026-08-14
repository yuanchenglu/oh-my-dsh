import { describe, it, expect } from 'vitest'
import { evaluateUpgrade } from '../../src/model-router/index.js'

const baseConfig = {
  upgradeIntents: ['architecture', 'research'],
  tokenThreshold: 30000,
  dissatisfactionEnabled: true,
}

describe('evaluateUpgrade', () => {
  it('spec_driven + 低 token + 无不满意 → 不升级（AC-1 判定面）', () => {
    const d = evaluateUpgrade({ intent: 'spec_driven', estimatedTokens: 100, consecutiveDissatisfied: 0, config: baseConfig })
    expect(d).toEqual({ upgrade: false, reason: 'none' })
  })
  it('architecture 意图 → 升级（AC-2 判定面）', () => {
    const d = evaluateUpgrade({ intent: 'architecture', estimatedTokens: 100, consecutiveDissatisfied: 0, config: baseConfig })
    expect(d).toEqual({ upgrade: true, reason: 'intent' })
  })
  it('research 意图 → 升级', () => {
    expect(evaluateUpgrade({ intent: 'research', estimatedTokens: 0, consecutiveDissatisfied: 0, config: baseConfig }).upgrade).toBe(true)
  })
  it('token 超阈值 → 升级（AC-3 判定面）', () => {
    const d = evaluateUpgrade({ intent: 'simple', estimatedTokens: 30001, consecutiveDissatisfied: 0, config: baseConfig })
    expect(d).toEqual({ upgrade: true, reason: 'tokens' })
  })
  it('token 恰等于阈值 → 不升级（边界）', () => {
    expect(evaluateUpgrade({ intent: 'simple', estimatedTokens: 30000, consecutiveDissatisfied: 0, config: baseConfig }).upgrade).toBe(false)
  })
  it('连续 2 轮不满意 → 升级（AC-4 判定面）', () => {
    const d = evaluateUpgrade({ intent: 'simple', estimatedTokens: 0, consecutiveDissatisfied: 2, config: baseConfig })
    expect(d).toEqual({ upgrade: true, reason: 'dissatisfaction' })
  })
  it('仅 1 轮不满意 → 不升级', () => {
    expect(evaluateUpgrade({ intent: 'simple', estimatedTokens: 0, consecutiveDissatisfied: 1, config: baseConfig }).upgrade).toBe(false)
  })
  it('upgradeIntents 为空数组 → 意图条件关闭', () => {
    const d = evaluateUpgrade({ intent: 'architecture', estimatedTokens: 0, consecutiveDissatisfied: 0, config: { ...baseConfig, upgradeIntents: [] } })
    expect(d.upgrade).toBe(false)
  })
  it('tokenThreshold 为 0 → token 条件关闭', () => {
    const d = evaluateUpgrade({ intent: 'simple', estimatedTokens: 999999, consecutiveDissatisfied: 0, config: { ...baseConfig, tokenThreshold: 0 } })
    expect(d.upgrade).toBe(false)
  })
  it('dissatisfactionEnabled=false → 不满意条件关闭', () => {
    const d = evaluateUpgrade({ intent: 'simple', estimatedTokens: 0, consecutiveDissatisfied: 5, config: { ...baseConfig, dissatisfactionEnabled: false } })
    expect(d.upgrade).toBe(false)
  })
})
