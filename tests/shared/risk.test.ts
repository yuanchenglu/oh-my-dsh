import { describe, expect, it } from 'vitest'
import { assessRisk } from '../../src/shared/risk.js'

describe('shared three-axis risk table', () => {
  it('classifies read-only operations as R0', () => {
    expect(assessRisk({ toolName: 'read', arguments: { path: '/workspace/src/a.ts' } })).toEqual({
      level: 'R0', requiresCheckpoint: false, requiresApproval: false,
    })
  })

  it('classifies allowed write as R1 without approval', () => {
    expect(assessRisk({ toolName: 'write', arguments: { path: '/workspace/src/a.ts' }, allowedPaths: ['/workspace/src'] })).toEqual({
      level: 'R1', requiresCheckpoint: true, requiresApproval: false,
    })
  })

  it('classifies out-of-scope write and deletion conservatively', () => {
    expect(assessRisk({ toolName: 'edit', arguments: { path: '/other/a.ts' }, allowedPaths: ['/workspace/src'] }).level).toBe('R3')
    expect(assessRisk({ toolName: 'bash', command: 'rm -f /workspace/src/a.ts' }).level).toBe('R3')
  })

  it('classifies test commands as R2 and external side effects as R4', () => {
    expect(assessRisk({ toolName: 'bash', command: 'pnpm test' })).toEqual({
      level: 'R2', requiresCheckpoint: false, requiresApproval: false,
    })
    expect(assessRisk({ toolName: 'deploy', arguments: {} })).toEqual({
      level: 'R4', requiresCheckpoint: true, requiresApproval: true,
    })
  })
})
