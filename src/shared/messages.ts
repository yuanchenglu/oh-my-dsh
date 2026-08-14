/** 把消息 content 拍平为纯文本（string 直取，ContentBlock[] 拼接 text part） */
export function contentToText(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .map((part) => (part && typeof part === 'object' && 'text' in part ? String((part as { text: unknown }).text) : ''))
      .join('')
  }
  return ''
}

/** 从消息数组提取最后一条用户消息的纯文本 */
export function extractLastUserMessage(messages: readonly { role?: string; content?: unknown }[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i]
    if (msg.role === 'user') return contentToText(msg.content)
  }
  return ''
}

/**
 * 估算消息列表的 token 数：总字符数 / 4，向上取整。
 * 启发式来源：官方 token-meter 固定比率估计器（CHARS_PER_TOKEN = 4）。
 */
export function estimateTokens(messages: readonly { content?: unknown }[]): number {
  let chars = 0
  for (const msg of messages) chars += contentToText(msg.content).length
  return Math.ceil(chars / 4)
}
