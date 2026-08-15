import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'

const root = resolve(import.meta.dirname, '../..')

function run(command: string, args: string[], env: NodeJS.ProcessEnv = process.env): string {
  return execFileSync(command, args, { cwd: root, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
}

function block(message: string): never {
  console.error(`A0 BLOCKED: ${message}`)
  process.exit(77)
}

if (!process.env.DEEPSEEK_API_KEY) block('DEEPSEEK_API_KEY is absent; key is read only from the environment')
if (!process.env.DSH_BIN && !existsSync('/usr/local/bin/dsh')) block('dsh executable is absent; set DSH_BIN to the verified dsh 0.1.0-rc.5 binary')

const dsh = process.env.DSH_BIN ?? 'dsh'
const packagePath = run('corepack', ['pnpm', 'pack']).trim().split(/\r?\n/).at(-1)
if (!packagePath) throw new Error('pnpm pack did not return a tarball')
const dshHome = mkdtempSync(join(tmpdir(), 'oh-my-dsh-dsh-home-'))
const env = { ...process.env, DSH_HOME: dshHome }
run(dsh, ['plugin', 'add', resolve(root, packagePath)], env)
const dump = run(dsh, ['--dump-config'], env)
for (const plugin of ['intent-router', 'model-router', 'cognition-gate', 'checkpoint-trace', 'constraint-immune', 'scope-guard', 'review-router']) {
  if (!dump.includes(plugin)) throw new Error(`bundle config missing ${plugin}`)
}

const output = run(dsh, ['headless', '设计一个微服务架构，一句话回答'], env)
if (!output) throw new Error('headless session returned no output')
const factsRoot = join(process.cwd(), '.dsh', 'oh-my-dsh')
if (!existsSync(factsRoot)) throw new Error('sidecar fact directory was not created')
console.log(JSON.stringify({ dshHome, outputLength: output.length, factsRoot, packagePath, checked: readFileSync(resolve(root, 'cordis.patch.yml'), 'utf8').includes('checkpoint-trace') }))
