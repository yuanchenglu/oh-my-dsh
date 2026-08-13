import { describe, it, expect } from 'vitest'
import { extractHardConstraints, checkAgainstConstraints } from '../../src/constraint-immune/extractor.js'

describe('extractHardConstraints', () => {
  it('提取"不要"约束', () => {
    const result = extractHardConstraints('不要修改 API 契约')
    expect(result.has('不要修改 API 契约')).toBe(true)
  })

  it('提取"禁止"约束', () => {
    const result = extractHardConstraints('禁止删除生产数据')
    expect(result.has('禁止删除生产数据')).toBe(true)
  })

  it('提取"必须"约束', () => {
    const result = extractHardConstraints('必须先备份再操作')
    expect(result.has('必须先备份再操作')).toBe(true)
  })

  it('提取多个约束', () => {
    const result = extractHardConstraints('不要改 API。禁止删表。必须备份')
    expect(result.size).toBe(3)
  })

  it('无约束返回空 Set', () => {
    const result = extractHardConstraints('帮我写个函数')
    expect(result.size).toBe(0)
  })
})

describe('checkAgainstConstraints', () => {
  it('检查命中', () => {
    const constraints = new Set(['不要修改 API'])
    const result = checkAgainstConstraints('我来修改 API', constraints)
    expect(result.violated).toBe(true)
    expect(result.matched).toBe('不要修改 API')
  })

  it('检查未命中', () => {
    const constraints = new Set(['不要修改 API'])
    const result = checkAgainstConstraints('我来写测试', constraints)
    expect(result.violated).toBe(false)
  })
})
