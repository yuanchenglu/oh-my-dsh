import { contentToText, estimateTokens } from '../shared/messages.js'
import { createZoneSection, tagZoneContent } from '../shared/context-zones.js'

/** 首轮完整注入文本 */
export const FULL_INJECTION = `[L1 荣辱观] 以知道自己的不足为荣、以提升认知为荣、以告诉实情为荣。不确定就说不确定。
[L2 思维方式] 第一性原理、Step by Step、假设先行、找盲区、科研严谨。
[I-02 双向原语] 可用 /propose_skill 提议固化 Skill，/trigger_self_review 请求审查。
[I-08 范围控制] 不得超出用户显式声明范围。"不加步骤能完成 = 范围蔓延，拒绝"。`

/** 后续轮精简注入文本（每个层标记独占一行，filterLayers 才能按行过滤——review Y2） */
export const BRIEF_INJECTION = `[L1] 不确定就说不确定。
[L2] 假设先行。
[I-08] 不加步骤能完成 = 拒绝。`

/** 注入配置 */
export interface InjectionConfig {
  layers: {
    l1: boolean
    l2: boolean
    i02: boolean
    i08: boolean
  }
  excludePatterns: string[]
  pressureThreshold?: number
}

/** 按层配置过滤注入文本 */
function filterLayers(text: string, layers: InjectionConfig['layers']): string {
  const lines = text.split('\n')
  const filtered: string[] = []
  for (const line of lines) {
    if (line.includes('[L1') && !layers.l1) continue
    if (line.includes('[L2') && !layers.l2) continue
    if (line.includes('[I-02') && !layers.i02) continue
    if (line.includes('[I-08') && !layers.i08) continue
    filtered.push(line)
  }
  return filtered.join('\n')
}

/** 构建注入文本：首轮完整版，后续轮精简版 */
export function buildInjection(turn: number, config: InjectionConfig): string {
  const base = turn === 0 ? FULL_INJECTION : BRIEF_INJECTION
  return filterLayers(base, config.layers)
}

/** 检查消息是否匹配排除模式 */
function matchesExcludePattern(content: string, patterns: string[]): boolean {
  return patterns.some((pattern) => content.includes(pattern))
}

/** 认知注入：在最后一条用户消息末尾追加注入文本，返回新数组 */
export function injectCognition(
  messages: readonly unknown[],
  turn: number,
  config: InjectionConfig
): unknown[] {
  const injection = buildInjection(turn, config)
  if (!injection) return [...messages]
  const section = createZoneSection('stable', 'cognition-gate', 'session', estimateTokens([{ content: injection }]))
  const taggedInjection = tagZoneContent(injection, section)

  const result = [...messages]
  for (let i = result.length - 1; i >= 0; i--) {
    const msg = result[i] as { role?: string; content?: unknown }
    if (msg.role === 'user') {
      if (matchesExcludePattern(contentToText(msg.content), config.excludePatterns)) {
        return result
      }
      // ContentBlock[] 保持数组结构、追加 text part（review Y4：JSON.stringify 会把图片 part 拍成文本）
      if (Array.isArray(msg.content)) {
        result[i] = { ...msg, content: [...msg.content, { type: 'text', text: '\n\n' + taggedInjection }] }
      } else {
        result[i] = { ...msg, content: contentToText(msg.content) + '\n\n' + taggedInjection }
      }
      return result
    }
  }
  return result
}
