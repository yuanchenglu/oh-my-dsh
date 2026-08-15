import { describe, expect, it } from 'vitest'
import { resolveWorkspaceDigest, sha256 } from '../../src/checkpoint-trace/digest.js'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

describe('checkpoint workspace digest', () => {
  it('uses sha256 and falls back to path plus mtime outside git', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'oh-my-dsh-digest-'))
    const result = resolveWorkspaceDigest(cwd, ['src/a.ts'])
    expect(result.digestMethod).toBe('paths-mtime')
    expect(result.digest).toBe(sha256(`${cwd}\nsrc/a.ts`))
  })
})
