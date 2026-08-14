import { describe, it, expect } from 'vitest'
import { buildInjection, injectCognition, FULL_INJECTION, BRIEF_INJECTION, type InjectionConfig } from '../../src/cognition-gate/injector.js'

const allOn: InjectionConfig = {
  layers: { l1: true, l2: true, i02: true, i08: true },
  excludePatterns: [],
}

describe('buildInjection', () => {
  it('turn=0 returns full injection with all layers', () => {
    const result = buildInjection(0, allOn)
    expect(result).toBe(FULL_INJECTION)
    expect(result).toContain('[L1 荣辱观]')
    expect(result).toContain('[L2 思维方式]')
    expect(result).toContain('[I-02 双向原语]')
    expect(result).toContain('[I-08 范围控制]')
  })

  it('turn>0 returns brief injection', () => {
    const result = buildInjection(1, allOn)
    expect(result).toBe(BRIEF_INJECTION)
    expect(result).toContain('[L1]')
    expect(result).not.toContain('[I-02 双向原语]')
  })

  it('filters out l2 when layers.l2=false', () => {
    const config: InjectionConfig = {
      layers: { l1: true, l2: false, i02: true, i08: true },
      excludePatterns: [],
    }
    const result = buildInjection(0, config)
    expect(result).toContain('[L1 荣辱观]')
    expect(result).not.toContain('[L2 思维方式]')
    expect(result).toContain('[I-02 双向原语]')
    expect(result).toContain('[I-08 范围控制]')
  })

  it('turn=1 单层关闭时其余层仍注入（Y2 回归）', () => {
    const config: InjectionConfig = {
      layers: { l1: true, l2: false, i02: true, i08: true },
      excludePatterns: [],
    }
    const result = buildInjection(1, config)
    expect(result).toContain('[L1]')
    expect(result).not.toContain('[L2]')
    expect(result).toContain('[I-08]')
  })

  it('filters out all layers when all disabled', () => {
    const config: InjectionConfig = {
      layers: { l1: false, l2: false, i02: false, i08: false },
      excludePatterns: [],
    }
    const result = buildInjection(0, config)
    expect(result).toBe('')
  })
})

describe('injectCognition', () => {
  it('appends injection to last user message', () => {
    const messages = [
      { role: 'assistant', content: '你好' },
      { role: 'user', content: '帮我写代码' },
    ]
    const result = injectCognition(messages, 0, allOn)
    expect(result).toHaveLength(2)
    expect((result[1] as { content: string }).content).toContain('帮我写代码\n\n[L1 荣辱观]')
    expect((result[0] as { content: string }).content).toBe('你好')
  })

  it('appends to last user message when multiple user messages exist', () => {
    const messages = [
      { role: 'user', content: '第一条' },
      { role: 'assistant', content: '回复' },
      { role: 'user', content: '第二条' },
    ]
    const result = injectCognition(messages, 1, allOn)
    expect((result[2] as { content: string }).content).toContain('第二条\n\n[L1]')
    expect((result[0] as { content: string }).content).toBe('第一条')
  })

  it('returns new array without mutating original', () => {
    const messages = [{ role: 'user', content: '原始' }]
    const originalContent = (messages[0] as { content: string }).content
    const result = injectCognition(messages, 0, allOn)
    expect((messages[0] as { content: string }).content).toBe(originalContent)
    expect((result[0] as { content: string }).content).not.toBe(originalContent)
  })

  it('does not inject when exclude pattern matches', () => {
    const config: InjectionConfig = {
      layers: { l1: true, l2: true, i02: true, i08: true },
      excludePatterns: ['system'],
    }
    const messages = [{ role: 'user', content: 'system prompt here' }]
    const result = injectCognition(messages, 0, config)
    expect((result[0] as { content: string }).content).toBe('system prompt here')
  })

  it('returns original array when no user message found', () => {
    const messages = [{ role: 'assistant', content: '只有助手' }]
    const result = injectCognition(messages, 0, allOn)
    expect(result).toEqual(messages)
  })

  it('ContentBlock[] content 追加 text part，保持数组结构（Y4）', () => {
    const messages = [{ role: 'user', content: [{ type: 'text', text: '多模态' }, { type: 'image', url: 'x' }] }]
    const result = injectCognition(messages, 0, allOn)
    const content = (result[0] as { content: Array<{ type: string; text?: string }> }).content
    expect(Array.isArray(content)).toBe(true)
    expect(content).toHaveLength(3)
    expect(content[0]).toEqual({ type: 'text', text: '多模态' })
    expect(content[1]).toEqual({ type: 'image', url: 'x' })
    expect(content[2].type).toBe('text')
    expect(content[2].text).toContain('[L1 荣辱观]')
  })
})
