import { resolve, sep } from 'node:path'
import { randomUUID } from 'node:crypto'

export type ScopeStatus = 'active' | 'pending' | 'confirmed' | 'rejected' | 'expired'
export type ScopeChangeKind = 'addition' | 'replacement' | 'none'

export interface ScopeConstraints {
  allowedPaths: string[]
  allowedTools: string[]
  externalSideEffects: string[]
}

export interface ScopeContract {
  scopeId: string
  version: number
  objective: string
  inScope: string[]
  nonGoals: string[]
  acceptanceCriteria: string[]
  constraints: ScopeConstraints
  changeBudget: Record<string, unknown>
  owner: string
  status: ScopeStatus
  contractRevision: number
}

export interface ScopeChange {
  kind: ScopeChangeKind
  text: string
  paths: string[]
}

const PATH_KEYS = new Set(['path', 'file', 'filePath', 'target', 'dest', 'destination', 'cwd'])
const KNOWN_TOOLS = ['bash', 'read', 'write', 'edit', 'delete_file', 'rm', 'publish', 'deploy', 'send']

function unique(values: string[]): string[] {
  return [...new Set(values)]
}

export function extractTargetPaths(value: unknown): string[] {
  const paths: string[] = []
  const visit = (current: unknown, key?: string): void => {
    if (typeof current === 'string') {
      if (PATH_KEYS.has(key ?? '')) paths.push(current)
      else paths.push(...(current.match(/(?:\/|\.\/|(?:src|tests|docs)\/)[A-Za-z0-9._*?\/-]*/g) ?? []))
      return
    }
    if (Array.isArray(current)) {
      current.forEach((item) => visit(item, key))
      return
    }
    if (typeof current === 'object' && current !== null) {
      Object.entries(current).forEach(([entryKey, item]) => visit(item, entryKey))
    }
  }
  visit(value)
  return unique(paths)
}

export function extractKnownTools(text: string): string[] {
  return KNOWN_TOOLS.filter((tool) => new RegExp(`(?:^|[^A-Za-z0-9_-])${tool}(?:$|[^A-Za-z0-9_-])`, 'i').test(text))
}

export function extractScopeContract(text: string): ScopeContract | undefined {
  const paths = extractTargetPaths(text)
  const allowedTools = extractKnownTools(text)
  if (paths.length === 0 && allowedTools.length === 0) return undefined
  return {
    scopeId: randomUUID(),
    version: 1,
    objective: text,
    inScope: paths,
    nonGoals: [],
    acceptanceCriteria: [],
    constraints: { allowedPaths: paths, allowedTools, externalSideEffects: [] },
    changeBudget: {},
    owner: 'user',
    status: 'active',
    contractRevision: 1,
  }
}

export function detectScopeChange(text: string): ScopeChange {
  if (/我的意思是|也就是说|澄清|换句话说/.test(text)) return { kind: 'none', text, paths: [] }
  if (/顺便|还有|另外|再加上/.test(text)) return { kind: 'addition', text, paths: extractTargetPaths(text) }
  if (/改成|换成|不要做了|改为/.test(text)) return { kind: 'replacement', text, paths: extractTargetPaths(text) }
  return { kind: 'none', text, paths: [] }
}

export function isPathAllowed(path: string, allowedPaths: readonly string[], cwd = process.cwd()): boolean {
  const target = resolve(cwd, path)
  return allowedPaths.some((allowed) => {
    const root = resolve(cwd, allowed.replace(/\/\*\*?$/, '') || sep)
    return target === root || target.startsWith(`${root}${sep}`)
  })
}
