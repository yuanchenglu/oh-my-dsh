import type { Classification, Strategies } from '../shared/types.js'

const CJK_RE = /[一-鿿]+/g

/**
 * 关键词匹配得分（从 intent_router.py 移植）
 *
 * 1. 精确子串匹配 → 1.0
 * 2. 纯英文关键词（无 CJK）且无精确匹配 → 0.0
 * 3. 短 CJK（≤2字）→ 仅精确匹配，否则 0.0
 * 4. 长 CJK（≥3字）→ 去重字符在文本 CJK 中的重叠比例
 */
export function keywordMatchScore(keyword: string, text: string): number {
  // 1. 精确子串匹配
  if (text.toLowerCase().includes(keyword.toLowerCase())) return 1.0

  // 2. 提取 CJK 字符
  const cjkChars = keyword.match(CJK_RE)
  if (!cjkChars) return 0.0
  const kwCJK = cjkChars.join('')

  const textCjkChars = text.match(CJK_RE)
  const cjkText = textCjkChars ? textCjkChars.join('') : ''
  if (!cjkText) return 0.0

  // 3. 短 CJK（≤2字）：仅精确匹配
  if (kwCJK.length <= 2) return 0.0

  // 4. 长 CJK（≥3字）：字符重叠比例
  const kwChars = new Set(kwCJK)
  let matches = 0
  for (const ch of kwChars) {
    if (cjkText.includes(ch)) matches++
  }
  return matches / kwCJK.length
}

/**
 * 意图分类（从 intent_router.py 移植）
 *
 * 对每个意图的关键词累计得分（≥0.5 的匹配计入），
 * 置信度 = best / (best + second)，< 0.5 回退 spec_driven。
 */
export function classifyIntent(taskDescription: string, strategies: Strategies): Classification {
  const scores: Record<string, number> = {}

  for (const [intentName, intentConfig] of Object.entries(strategies)) {
    if (intentConfig.keywords.length === 0) continue
    let score = 0
    for (const keyword of intentConfig.keywords) {
      const match = keywordMatchScore(keyword, taskDescription)
      if (match >= 0.5) score += match
    }
    if (score > 0) scores[intentName] = score
  }

  const entries = Object.entries(scores)
  if (entries.length === 0) {
    return { intent: 'spec_driven', confidence: 0.0 }
  }

  entries.sort((a, b) => b[1] - a[1])
  const best = entries[0]
  const second = entries[1] ?? ['', 0]
  const confidence = best[1] / (best[1] + second[1])

  if (confidence < 0.5) {
    return { intent: 'spec_driven', confidence }
  }
  return { intent: best[0] as Classification['intent'], confidence }
}
