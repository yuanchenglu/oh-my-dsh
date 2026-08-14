/**
 * 硬约束提取器（从 gate.py extract_hard_constraints + immune_audit.py 移植）
 * 提取用户消息中的硬约束，并检查模型输出是否违反。
 *
 * 约束分两类（review Y3）：
 * - 否定型（不能/不要/禁止…）：模型输出命中关键词 = 违规
 * - 肯定型（必须…）：命中关键词是"遵守"而非违规，v0.1 只记录不判定
 */

const NEGATIVE_PREFIXES = ['不能', '不要', '不得', '禁止', '严禁', '不允许', '千万别', '绝对不'] as const
const POSITIVE_PREFIXES = ['必须'] as const

const NEGATIVE_RE = /(?:不能|不要|不得|禁止|严禁|不允许|千万别|绝对不)[^，。；、！？\n]{2,60}/g
const POSITIVE_RE = /(?:必须)[^，。；、！？\n]{2,60}/g

export interface Constraint {
  /** 约束原文（含前缀），如 "不要修改 API 契约" */
  raw: string
  /** 去掉前缀后的关键词，如 "修改 API 契约" */
  keyword: string
  kind: 'negative' | 'positive'
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** 仅为有明确语义对应关系的工具动作提供英文别名。 */
const TOOL_OPERATION_ALIASES: Readonly<Record<string, readonly string[]>> = Object.freeze({
  删除: ['rm', 'delete', 'remove', 'unlink', 'rmdir'],
})

function includesToolAlias(text: string, alias: string): boolean {
  // 工具名可能是 delete_file，命令参数也可能是 rm -f；按字母边界匹配两者。
  return new RegExp(`(?:^|[^A-Za-z])${escapeRegExp(alias)}(?:$|[^A-Za-z])`, 'i').test(text)
}

/**
 * 检查工具调用文本是否命中否定型约束。
 * 除字面命中外，仅对显式动作词映射 + 原始对象文本同时出现的情况判定。
 */
export function matchesToolConstraint(text: string, constraint: Constraint): boolean {
  if (constraint.kind !== 'negative' || !constraint.keyword) return false
  if (text.includes(constraint.keyword)) return true

  for (const [operation, aliases] of Object.entries(TOOL_OPERATION_ALIASES)) {
    if (!constraint.keyword.startsWith(operation)) continue
    const operand = constraint.keyword.slice(operation.length).trim()
    if (operand && text.includes(operand) && aliases.some((alias) => includesToolAlias(text, alias))) return true
  }
  return false
}

function collect(
  message: string,
  re: RegExp,
  prefixes: readonly string[],
  kind: Constraint['kind'],
  out: Constraint[],
): void {
  for (const raw of message.match(re) ?? []) {
    const prefix = prefixes.find((p) => raw.startsWith(p))
    if (prefix === undefined) continue
    out.push({ raw, keyword: raw.slice(prefix.length), kind })
  }
}

/**
 * 从用户消息中提取硬约束。
 * @param customPatterns 用户自定义约束前缀（如 "务必"），按否定型处理（PRD AC-3）
 */
export function extractHardConstraints(message: string, customPatterns: string[] = []): Constraint[] {
  const out: Constraint[] = []
  collect(message, NEGATIVE_RE, NEGATIVE_PREFIXES, 'negative', out)
  collect(message, POSITIVE_RE, POSITIVE_PREFIXES, 'positive', out)
  for (const pattern of customPatterns) {
    if (!pattern) continue
    collect(message, new RegExp(`(?:${escapeRegExp(pattern)})[^，。；、！？\n]{2,60}`, 'g'), [pattern], 'negative', out)
  }
  return out
}

/**
 * 检查文本是否违反硬约束。只判定否定型；肯定型命中不代表违规。
 * @returns violated=true 时 matched 为被违反的约束原文
 */
export function checkAgainstConstraints(
  text: string,
  constraints: Iterable<Constraint>,
): { violated: boolean; matched?: string } {
  for (const constraint of constraints) {
    if (constraint.kind !== 'negative') continue
    if (constraint.keyword && text.includes(constraint.keyword)) {
      return { violated: true, matched: constraint.raw }
    }
  }
  return { violated: false }
}
