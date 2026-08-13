/**
 * 硬约束提取器（从 gate.py extract_hard_constraints + immune_audit.py 移植）
 * 提取用户消息中的硬约束（"不要..."、"禁止..."、"必须..."），
 * 并检查模型输出是否违反这些约束。
 */

/** 硬约束正则（从 gate.py 移植） */
const HARD_CONSTRAINT_RE = /(?:不能|不要|不得|禁止|严禁|不允许|千万别|绝对不|必须)[^，。；、！？\n]{2,60}/g

/**
 * 从用户消息中提取硬约束集合
 */
export function extractHardConstraints(message: string): Set<string> {
  const matches = message.match(HARD_CONSTRAINT_RE)
  return new Set(matches ?? [])
}

/**
 * 检查文本是否违反硬约束
 * @returns violated=true 时 matched 为被违反的约束原文
 */
export function checkAgainstConstraints(
  text: string,
  constraints: Set<string>,
): { violated: boolean; matched?: string } {
  for (const constraint of constraints) {
    // 提取约束关键词（去掉"不要"/"必须"等前缀）
    const keyword = constraint.replace(
      /^(?:不能|不要|不得|禁止|严禁|不允许|千万别|绝对不|必须)/,
      '',
    )
    if (text.includes(keyword)) {
      return { violated: true, matched: constraint }
    }
  }
  return { violated: false }
}
