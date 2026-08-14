import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))

/**
 * E2E 安装验证测试（静态部分）
 *
 * 验证 bundle 声明文件、npm 包结构与 patch 路径约定符合 dsh 插件规范。
 * 真实 dsh 安装 + 真实对话验证（reasoningEffort 断言）未实施，列入 v0.2
 * （见 docs/04-testing.md 5.1 节状态标注）。
 */

const ROOT = resolve(__dirname, '../..')

describe('E2E: bundle structure', () => {
  it('cordis.patch.yml exists and has insert entries', () => {
    const content = readFileSync(resolve(ROOT, 'cordis.patch.yml'), 'utf-8')
    expect(content).toContain('insert')
  })

  it('package.json has dsh.bundle manifest', () => {
    const pkg = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf-8'))
    expect(pkg.dsh).toBeDefined()
    expect(pkg.dsh.bundle).toBeDefined()
    expect(pkg.dsh.bundle.patch).toBe('./cordis.patch.yml')
  })

  it('package.json has correct name and type', () => {
    const pkg = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf-8'))
    expect(pkg.name).toBe('oh-my-dsh')
    expect(pkg.type).toBe('module')
  })

  it('patch entries point at lib/src/** and each maps to an existing src/** entry', () => {
    const patch = readFileSync(resolve(ROOT, 'cordis.patch.yml'), 'utf-8')
    const names = [...patch.matchAll(/name:\s*oh-my-dsh\/(lib\/src\/(\S+)\/index\.js)/g)]
    expect(names.length).toBeGreaterThanOrEqual(3)
    const tsconfig = JSON.parse(readFileSync(resolve(ROOT, 'tsconfig.json'), 'utf-8'))
    expect(tsconfig.compilerOptions.outDir).toBe('lib')
    for (const [, libPath, pluginDir] of names) {
      const srcEntry = resolve(ROOT, 'src', pluginDir, 'index.ts')
      expect(existsSync(srcEntry), `${libPath} 应对应存在的 src/${pluginDir}/index.ts`).toBe(true)
    }
  })
})
