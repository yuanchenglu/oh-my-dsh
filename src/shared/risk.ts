import { resolve, sep } from 'node:path'

export type RiskLevel = 'R0' | 'R1' | 'R2' | 'R3' | 'R4'

export interface RiskAssessment {
  level: RiskLevel
  requiresCheckpoint: boolean
  requiresApproval: boolean
}

export interface RiskInput {
  toolName?: string
  name?: string
  command?: string
  arguments?: unknown
  allowedPaths?: readonly string[]
}

const READ_RE = /(?:^|[-_])(read|grep|ls|list|cat|stat|find|inspect)(?:$|[-_])/i
const WRITE_RE = /(?:^|[-_])(write|edit|create|patch|update)(?:$|[-_])/i
const DELETE_RE = /(?:^|[-_])(rm|delete|remove|unlink|rmdir|move|mv)(?:$|[-_])/i
const EXTERNAL_RE = /(?:^|[-_])(send|publish|deploy)(?:$|[-_])/i
const TEST_RE = /(?:pnpm|npm|yarn)\s+(?:run\s+)?(?:test|build|typecheck)|(?:vitest|jest|pytest|go\s+test|cargo\s+test|tsc\b)/i

function textOf(input: RiskInput): string {
  let args = ''
  try {
    args = typeof input.arguments === 'string' ? input.arguments : JSON.stringify(input.arguments ?? '')
  } catch {
    args = '[unserializable arguments]'
  }
  return [input.toolName, input.name, input.command, args].filter(Boolean).join('\n')
}

function collectStrings(value: unknown, out: string[]): void {
  if (typeof value === 'string') {
    if (value.includes('/')) out.push(value)
    return
  }
  if (Array.isArray(value)) {
    value.forEach((item) => collectStrings(item, out))
    return
  }
  if (typeof value === 'object' && value !== null) {
    Object.values(value).forEach((item) => collectStrings(item, out))
  }
}

function isWithin(path: string, allowed: readonly string[]): boolean {
  const target = resolve(path)
  return allowed.some((root) => {
    const normalizedRoot = root.replace(/\/\*\*?$/, '') || sep
    const absoluteRoot = resolve(normalizedRoot)
    return target === absoluteRoot || target.startsWith(`${absoluteRoot}${sep}`)
  })
}

function assessment(level: RiskLevel): RiskAssessment {
  return {
    level,
    requiresCheckpoint: level === 'R1' || level === 'R3' || level === 'R4',
    requiresApproval: level === 'R3' || level === 'R4',
  }
}

export function assessRisk(input: RiskInput): RiskAssessment {
  const tool = input.toolName ?? input.name ?? ''
  const command = `${tool}\n${input.command ?? ''}`
  const text = textOf(input)

  if (EXTERNAL_RE.test(tool) || /\b(?:send|publish|deploy)\b/i.test(command)) return assessment('R4')
  if (DELETE_RE.test(tool) || DELETE_RE.test(command)) return assessment('R3')
  if (TEST_RE.test(text)) return assessment('R2')
  if (READ_RE.test(tool)) return assessment('R0')

  if (WRITE_RE.test(tool)) {
    const paths: string[] = []
    collectStrings(input.arguments, paths)
    const allowedPaths = input.allowedPaths
    if (paths.length > 0 && allowedPaths !== undefined && paths.every((path) => isWithin(path, allowedPaths))) {
      return assessment('R1')
    }
    return assessment('R3')
  }

  return assessment('R3')
}
