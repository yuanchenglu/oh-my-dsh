import { describe, it, expect } from 'vitest'
import { contentToText, extractLastUserMessage, estimateTokens } from '../../src/shared/messages.js'

describe('contentToText', () => {
  it('string 直取', () => {
    expect(contentToText('你好')).toBe('你好')
  })
  it('ContentBlock[] 拼接 text part', () => {
    expect(contentToText([{ type: 'text', text: 'a' }, { type: 'image', url: 'x' }, { type: 'text', text: 'b' }])).toBe('ab')
  })
  it('其他类型返回空串', () => {
    expect(contentToText(undefined)).toBe('')
    expect(contentToText(42)).toBe('')
  })
})

describe('extractLastUserMessage', () => {
  it('取最后一条 user 消息', () => {
    const msgs = [
      { role: 'user', content: '第一条' },
      { role: 'assistant', content: '回复' },
      { role: 'user', content: '第二条' },
    ]
    expect(extractLastUserMessage(msgs)).toBe('第二条')
  })
  it('无 user 消息返回空串', () => {
    expect(extractLastUserMessage([{ role: 'assistant', content: 'x' }])).toBe('')
  })
})

describe('estimateTokens', () => {
  it('字符数 / 4 向上取整', () => {
    expect(estimateTokens([{ content: 'a'.repeat(100) }])).toBe(25)
    expect(estimateTokens([{ content: 'a'.repeat(101) }])).toBe(26)
  })
  it('空列表为 0', () => {
    expect(estimateTokens([])).toBe(0)
  })
})
