import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))

/**
 * E2E 安装验证测试
 *
 * 验证 bundle 声明文件和 npm 包结构是否符合 dsh 插件规范。
 * 真实 dsh 安装测试需要 DEEPSEEK_API_KEY，此处仅做静态验证。
 */

describe('E2E: bundle structure', () => {
  it('cordis.patch.yml exists and has insert entries', () => {
    const patchPath = resolve(__dirname, '../../cordis.patch.yml')
    const content = readFileSync(patchPath, 'utf-8')
    expect(content).toContain('insert')
  })

  it('package.json has dsh.bundle manifest', () => {
    const pkgPath = resolve(__dirname, '../../package.json')
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'))
    expect(pkg.dsh).toBeDefined()
    expect(pkg.dsh.bundle).toBeDefined()
    expect(pkg.dsh.bundle.patch).toBe('./cordis.patch.yml')
  })

  it('package.json has correct name and type', () => {
    const pkgPath = resolve(__dirname, '../../package.json')
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'))
    expect(pkg.name).toBe('oh-my-dsh')
    expect(pkg.type).toBe('module')
  })

  it('all plugin entry files exist', () => {
    const entries = [
      'src/intent-router/index.ts',
      'src/cognition-gate/index.ts',
      'src/constraint-immune/index.ts',
    ]
    for (const entry of entries) {
      const path = resolve(__dirname, '../..', entry)
      expect(existsSync(path), `${entry} should exist`).toBe(true)
    }
  })
})
