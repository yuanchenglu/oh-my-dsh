import { describe, expect, it } from 'vitest'
import { detectScopeChange, extractScopeContract, extractTargetPaths } from '../../src/scope-guard/contract.js'

describe('scope contract extraction', () => {
  it('extracts high-confidence paths and known tools', () => {
    const contract = extractScopeContract('请修改 src/app.ts，并使用 bash 运行测试')
    expect(contract?.constraints.allowedPaths).toContain('src/app.ts')
    expect(contract?.constraints.allowedTools).toContain('bash')
  })

  it('extracts tool argument paths from named keys and slash values', () => {
    expect(extractTargetPaths({ path: './src/a.ts', note: 'also /tmp/b.txt' })).toEqual(['./src/a.ts', '/tmp/b.txt'])
  })

  it('recognizes additions and replacements but ignores clarification', () => {
    expect(detectScopeChange('顺便加上 README 翻译').kind).toBe('addition')
    expect(detectScopeChange('把目标改成 docs/index.md').kind).toBe('replacement')
    expect(detectScopeChange('我的意思是保留原目标').kind).toBe('none')
  })
})
