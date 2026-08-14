import { describe, it, expect } from 'vitest'
import { extractHardConstraints, checkAgainstConstraints } from '../../src/constraint-immune/extractor.js'

describe('extractHardConstraints', () => {
  it('提取"不要"约束（否定型）', () => {
    const result = extractHardConstraints('不要修改 API 契约')
    expect(result).toContainEqual({ raw: '不要修改 API 契约', keyword: '修改 API 契约', kind: 'negative' })
  })

  it('提取"禁止"约束（否定型）', () => {
    const result = extractHardConstraints('禁止删除生产数据')
    expect(result).toContainEqual({ raw: '禁止删除生产数据', keyword: '删除生产数据', kind: 'negative' })
  })

  it('提取"必须"约束（肯定型）', () => {
    const result = extractHardConstraints('必须先备份再操作')
    expect(result).toContainEqual({ raw: '必须先备份再操作', keyword: '先备份再操作', kind: 'positive' })
  })

  it('提取多个约束', () => {
    const result = extractHardConstraints('不要改 API。禁止删表。必须备份')
    expect(result).toHaveLength(3)
  })

  it('无约束返回空数组', () => {
    expect(extractHardConstraints('帮我写个函数')).toHaveLength(0)
  })

  it('自定义关键词提取（customPatterns，PRD AC-3）', () => {
    const result = extractHardConstraints('务必使用 pnpm 安装依赖', ['务必'])
    expect(result).toContainEqual({ raw: '务必使用 pnpm 安装依赖', keyword: '使用 pnpm 安装依赖', kind: 'negative' })
  })

  it('自定义关键词中的正则元字符被转义', () => {
    const result = extractHardConstraints('严禁*生产环境*直连数据库', ['严禁*'])
    expect(result.some((c) => c.raw.startsWith('严禁*'))).toBe(true)
  })
})

describe('checkAgainstConstraints', () => {
  it('否定型约束命中算违规', () => {
    const constraints = extractHardConstraints('不要修改 API')
    const result = checkAgainstConstraints('我来修改 API', constraints)
    expect(result.violated).toBe(true)
    expect(result.matched).toBe('不要修改 API')
  })

  it('否定型约束未命中', () => {
    const constraints = extractHardConstraints('不要修改 API')
    expect(checkAgainstConstraints('我来写测试', constraints).violated).toBe(false)
  })

  it('肯定型约束命中不算违规（遵守方向，Y3）', () => {
    const constraints = extractHardConstraints('必须先备份再操作')
    expect(checkAgainstConstraints('我先备份再操作', constraints).violated).toBe(false)
  })

  it('肯定型约束不命中也不算违规（v0.1 只记录不判定）', () => {
    const constraints = extractHardConstraints('必须先备份再操作')
    expect(checkAgainstConstraints('我直接操作了', constraints).violated).toBe(false)
  })
})
