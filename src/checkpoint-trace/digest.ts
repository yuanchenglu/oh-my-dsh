import { execFileSync } from 'node:child_process'
import { statSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join } from 'node:path'

export type DigestMethod = 'git' | 'paths-mtime'

export interface WorkspaceDigest {
  digest: string
  digestMethod: DigestMethod
}

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

export function resolveWorkspaceDigest(cwd: string, changedPaths: readonly string[] = []): WorkspaceDigest {
  try {
    const gitOptions = { cwd, encoding: 'utf8' as const, stdio: ['ignore', 'pipe', 'ignore'] as ['ignore', 'pipe', 'ignore'] }
    const head = execFileSync('git', ['rev-parse', 'HEAD'], gitOptions).trim()
    const status = execFileSync('git', ['status', '--porcelain'], gitOptions).trim()
    return { digest: sha256(`${head}\n${status}`), digestMethod: 'git' }
  } catch {
    const entries = changedPaths.map((path) => {
      try {
        return `${path}:${statSync(join(cwd, path)).mtimeMs}`
      } catch {
        return path
      }
    })
    return { digest: sha256([cwd, ...entries].join('\n')), digestMethod: 'paths-mtime' }
  }
}
