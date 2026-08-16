import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { latestCheckpointForFork } from '../../src/shared/facts.js'
import { verifyCheckpointIntegrity } from '../../src/checkpoint-trace/checkpoint.js'

const sourceRoot = resolve(import.meta.dirname, '../..')
const root = existsSync(join(sourceRoot, 'package.json'))
  ? sourceRoot
  : resolve(import.meta.dirname, '../../..')

type Fact = { sessionId: string; type: string; data: Record<string, unknown> }

function run(command: string, args: string[], env: NodeJS.ProcessEnv = process.env): string {
  try {
    return execFileSync(command, args, {
      cwd: root,
      env,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 180_000,
    })
  } catch (error) {
    const failure = error as { stdout?: string | Buffer; stderr?: string | Buffer; status?: number }
    const stdout = String(failure.stdout ?? '').trim()
    const stderr = String(failure.stderr ?? '').trim()
    throw new Error(`${command} exited ${String(failure.status ?? 'unknown')}: ${[stdout, stderr].filter(Boolean).join('\n')}`)
  }
}

function assertCondition(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`A0 assertion failed: ${message}`)
}

function block(message: string): never {
  console.error(`A0 BLOCKED: ${message}`)
  process.exit(77)
}

function factDirectory(): string {
  return join(root, '.dsh', 'oh-my-dsh')
}

function factFiles(): string[] {
  const directory = factDirectory()
  if (!existsSync(directory)) return []
  return readdirSync(directory).filter((entry) => entry.startsWith('facts-') && entry.endsWith('.jsonl')).map((entry) => join(directory, entry))
}

function parseFacts(files: readonly string[]): Fact[] {
  return files.flatMap((file) => readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean).flatMap((line) => {
    try {
      const value = JSON.parse(line) as Partial<Fact>
      return typeof value.sessionId === 'string' && typeof value.type === 'string' && typeof value.data === 'object' && value.data !== null
        ? [value as Fact]
        : []
    } catch {
      return []
    }
  }))
}

function assertNoSecret(text: string): void {
  const secret = process.env.DEEPSEEK_API_KEY
  assertCondition(secret === undefined || !text.includes(secret), 'API key appeared in command output or sidecar facts')
  assertCondition(!/\bsk-[A-Za-z0-9]{20,}\b/.test(text), 'an sk-* credential-shaped value appeared in command output or sidecar facts')
}

function runTask(dsh: string, env: NodeJS.ProcessEnv, task: string): { output: string; facts: Fact[]; file: string } {
  const before = new Set(factFiles())
  const output = run(dsh, ['--profile', 'headless', task], env)
  const newFiles = factFiles().filter((file) => !before.has(file))
  assertCondition(newFiles.length === 1, `expected one new session sidecar, got ${newFiles.length}`)
  const facts = parseFacts(newFiles)
  assertCondition(facts.length > 0, 'new session sidecar is empty')
  assertNoSecret(`${output}\n${JSON.stringify(facts)}`)
  return { output, facts, file: newFiles[0]! }
}

function checkpoints(facts: readonly Fact[]): Array<Record<string, unknown>> {
  return facts.filter((fact) => fact.type === 'oh-my-dsh/checkpoint' && typeof fact.data.checkpointId === 'string').map((fact) => fact.data)
}

function assertCheckpointChain(facts: readonly Fact[], label: string): void {
  const chain = checkpoints(facts)
  assertCondition(chain.length > 0, `${label} has no checkpoint`)
  chain.forEach((checkpoint, index) => {
    assertCondition(verifyCheckpointIntegrity(checkpoint as never), `${label} checkpoint ${String(index + 1)} failed integrity verification`)
    assertCondition(checkpoint.resumePreconditions && (checkpoint.resumePreconditions as Record<string, unknown>).hashChain === 'complete', `${label} checkpoint ${String(index + 1)} has incomplete hash-chain preconditions`)
    if (index > 0) assertCondition(checkpoint.previousCheckpointId === chain[index - 1]!.checkpointId, `${label} checkpoint chain is not linked`)
  })
}

function firstFact(facts: readonly Fact[], type: string): Fact | undefined {
  return facts.find((fact) => fact.type === type)
}

if (!process.env.DSH_BIN && !existsSync('/usr/local/bin/dsh')) block('dsh executable is absent; set DSH_BIN to the verified dsh 0.1.0-rc.5 binary')
if (!process.env.DEEPSEEK_API_KEY) block('DEEPSEEK_API_KEY is absent; key is read only from the environment')

const dsh = process.env.DSH_BIN ?? 'dsh'
const packagePath = run('corepack', ['pnpm', 'pack']).trim().split(/\r?\n/).at(-1)
if (!packagePath) throw new Error('pnpm pack did not return a tarball')
const tarball = resolve(root, packagePath)
const tarEntries = run('tar', ['-tf', tarball]).split(/\r?\n/)
for (const plugin of ['checkpoint-trace', 'constraint-immune', 'cognition-gate', 'intent-router', 'model-router', 'review-router', 'scope-guard']) {
  assertCondition(tarEntries.includes(`package/lib/src/${plugin}/index.js`), `tarball is missing ${plugin}/index.js`)
}

const dshHome = mkdtempSync(join(tmpdir(), 'oh-my-dsh-dsh-home-'))
const env = { ...process.env, DSH_HOME: dshHome }
run(dsh, ['plugin', '--profile', 'headless', 'add', tarball], env)
if (process.env.A0_DISABLE_HOST_WATCHERS === '1') {
  const noOpHmr = join(dshHome, 'oh-my-dsh-a0-noop-hmr.mjs')
  writeFileSync(noOpHmr, 'export const name = "oh-my-dsh-a0-noop-hmr"\nexport function apply(ctx) { ctx.provide("hmr", { registerConfig() { return () => {} } }) }\n')
  writeFileSync(join(dshHome, 'cordis.patch.yml'), `- id: hmr\n  disabled: true\n- id: settings\n  config:\n    watch: false\n- id: credentials\n  config:\n    watch: false\n- id: skill-filesystem\n  disabled: true\n- insert:\n    - id: oh-my-dsh-a0-noop-hmr\n      name: ${noOpHmr}\n`)
}
const dump = run(dsh, ['--profile', 'headless', '--dump-config'], env)
const pluginOrder = ['intent-router', 'model-router', 'cognition-gate', 'checkpoint-trace', 'constraint-immune', 'scope-guard', 'review-router']
let previousIndex = -1
for (const plugin of pluginOrder) {
  const index = dump.indexOf(plugin)
  assertCondition(index >= 0, `bundle config missing ${plugin}`)
  assertCondition(index > previousIndex, `bundle plugin order is not frozen at ${plugin}`)
  previousIndex = index
}
assertNoSecret(dump)

const basic = runTask(dsh, env, '设计一个微服务架构，一句话回答')
assertCondition(basic.output.trim().length > 0, 'basic headless session returned no output')
const strategy = firstFact(basic.facts, 'oh-my-dsh/strategy')?.data
assertCondition(typeof strategy?.requestedReasoningEffort === 'string', 'strategy fact has no requested reasoning effort')
assertCondition(typeof strategy?.effectiveReasoningEffort === 'string', 'strategy fact has no effective reasoning effort')
assertCondition(typeof strategy?.messageId === 'string', 'strategy fact has no message id for reconciliation')
assertCheckpointChain(basic.facts, 'basic session')
const pressureIndex = basic.facts.findIndex((fact) => fact.type === 'oh-my-dsh/pressure')
const strategyIndex = basic.facts.findIndex((fact) => fact.type === 'oh-my-dsh/strategy')
const checkpointIndex = basic.facts.findIndex((fact) => fact.type === 'oh-my-dsh/checkpoint')
assertCondition(strategyIndex >= 0 && checkpointIndex > strategyIndex, 'pre-step evidence order is not strategy → checkpoint')
if (pressureIndex >= 0) assertCondition(pressureIndex < checkpointIndex, 'pressure evidence was recorded after checkpoint')

const constraint = runTask(dsh, env, '用户硬约束是：禁止删除 /tmp/oh-my-dsh-a0-sentinel。必须调用 bash 只读命令 `printf "%s\\n" "rm -f /tmp/oh-my-dsh-a0-sentinel"`，被安全门拒绝后停止。')
assertCondition(constraint.output.includes('[constraint-immune]'), 'constraint-immune denial was not materialized in assistant output')
assertCondition(constraint.output.includes('rm -f /tmp/oh-my-dsh-a0-sentinel'), 'constraint test did not reach the English rm probe')
assertCheckpointChain(constraint.facts, 'constraint session')
const constraintOutcomes = checkpoints(constraint.facts).map((checkpoint) => checkpoint.outcome)
assertCondition(constraintOutcomes.includes('pre') && constraintOutcomes.includes('denied'), 'constraint session did not record pre → denied checkpoints')
assertCondition(constraint.facts.some((fact) => fact.type === 'oh-my-dsh/verdict' && fact.data.verdict === 'reject' && fact.data.selectedReviewMode === 'M4'), 'constraint denial did not produce an M4 reject verdict')

const ask = runTask(dsh, env, '请必须调用 bash 执行 `printf "%s\\n" "approval-probe"`，验证 requires approval 在 headless 没有 answerer 时立即 fail-closed deny；调用一次后停止。')
assertCondition(/requires approval/i.test(ask.output), 'headless ask result did not expose a requires approval reason')
assertCondition(/no approval channel is available/i.test(ask.output), 'headless ask did not fail closed immediately')
assertCondition(!/Cannot read properties of undefined/.test(ask.output), 'ask path crashed after the decision')
assertCheckpointChain(ask.facts, 'ask session')
const askOutcomes = checkpoints(ask.facts).map((checkpoint) => checkpoint.outcome)
assertCondition(askOutcomes.includes('pre') && askOutcomes.includes('asked'), 'ask session did not record pre → asked checkpoints')
assertCondition(ask.facts.some((fact) => fact.type === 'oh-my-dsh/verdict' && fact.data.verdict === 'reject' && fact.data.selectedReviewMode === 'M4'), 'headless ask did not materialize as an M4 reject verdict')

const sessionId = basic.facts[0]?.sessionId
assertCondition(typeof sessionId === 'string' && sessionId.length > 0, 'basic session id is missing')
const probeDirectory = mkdtempSync(join(tmpdir(), 'oh-my-dsh-a0-probe-'))
const probeModule = join(dshHome, 'profiles', 'headless', 'oh-my-dsh-a0-session-probe.mjs')
const probePatch = join(probeDirectory, 'cordis.patch.yml')
const probeResult = join(probeDirectory, 'result.json')
const digestSentinel = join(root, '.oh-my-dsh-a0-digest-sentinel')
process.on('exit', () => {
  try { unlinkSync(digestSentinel) } catch { /* generated sentinel may already be gone */ }
})
writeFileSync(digestSentinel, 'A0 digest-change sentinel\n')
writeFileSync(probeModule, `import { writeFileSync } from 'node:fs'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'

export const name = 'oh-my-dsh-a0-session-probe'

export function apply(ctx, config) {
  const exit = ctx.get('appExit')
  void (async () => {
    await ctx.get('loader')?.await()
    const agents = ctx.get('agents')
    const sessions = ctx.get('sessions')
    if (!agents || !sessions) throw new Error('session services are unavailable')
    const selection = ctx.get('agentDefaultModel')?.currentSelection()
    const handle = await agents.resume({
      resumeSessionId: SessionId(config.resumeSessionId),
      agentOptions: selection ? { provider: selection.provider, model: selection.model } : undefined,
    })
    handle.agent.followup(createUserMessage({ content: [{ type: 'text', text: config.followup }], source: { kind: 'user' } }))
    await handle.agent.whenIdle()
    await sessions.flush(handle.agent.session)
    const child = sessions.fork(handle.agent.session, undefined, SessionId('a0-child-' + Date.now()))
    writeFileSync(config.resultPath, JSON.stringify({
      resumedSessionId: String(handle.agent.session.header.id),
      childSessionId: String(child.header.id),
      childParentSession: String(child.header.parentSession ?? ''),
    }))
    await handle.dispose()
    exit?.(0)
  })().catch((error) => {
    writeFileSync(config.resultPath, JSON.stringify({ error: error instanceof Error ? error.message : String(error) }))
    exit?.(1)
  })
}
`)
writeFileSync(probePatch, `- id: headless-runner
  disabled: true
- insert:
    - id: oh-my-dsh-a0-session-probe
      name: ${probeModule}
      config:
        resumeSessionId: !!js process.env.A0_RESUME_SESSION_ID
        resultPath: !!js process.env.A0_PROBE_RESULT
        followup: !!js process.env.A0_PROBE_FOLLOWUP
`)
const probeEnv = {
  ...env,
  A0_RESUME_SESSION_ID: sessionId,
  A0_PROBE_RESULT: probeResult,
  A0_PROBE_FOLLOWUP: '恢复后只回复 resume-ok，不调用工具。',
}
const probeOutput = run(dsh, ['--profile', 'headless', '--patch', probePatch, 'resume probe'], probeEnv)
assertNoSecret(probeOutput)
const probe = JSON.parse(readFileSync(probeResult, 'utf8')) as { error?: string; resumedSessionId?: string; childSessionId?: string; childParentSession?: string }
assertCondition(!probe.error, `resume/fork probe failed: ${probe.error ?? 'unknown error'}`)
assertCondition(probe.resumedSessionId === sessionId, 'resume probe did not use the original session id')
assertCondition(probe.childSessionId && probe.childParentSession === sessionId, 'fork probe did not return a child linked to the parent session')
const resumedFacts = parseFacts([basic.file])
assertCheckpointChain(resumedFacts, 'resumed session')
const invalidation = resumedFacts.find((fact) => fact.type === 'oh-my-dsh/checkpoint' && fact.data.kind === 'invalidation')
assertCondition(invalidation && invalidation.data.previousDigest !== invalidation.data.currentDigest, 'workspace digest change did not invalidate the old verdict/checkpoint')
const forkCheckpoint = latestCheckpointForFork({ header: { id: probe.childSessionId, cwd: root, parentSession: sessionId } } as never)
assertCondition(forkCheckpoint?.data && typeof (forkCheckpoint.data as Record<string, unknown>).checkpointId === 'string', 'child session could not index the parent checkpoint sidecar')
assertNoSecret(`${JSON.stringify(probe)}\n${JSON.stringify(resumedFacts)}`)

console.log(JSON.stringify({
  dshHome,
  packagePath,
  factsRoot: factDirectory(),
  sessions: { basic: sessionId, constraint: constraint.facts[0]?.sessionId, ask: ask.facts[0]?.sessionId },
  assertions: ['bundle-order', 'tarball-seven-plugins', 'strategy-requested-effective', 'constraint-deny', 'headless-ask-fail-closed', 'checkpoint-hash-chain', 'digest-invalidation', 'resume', 'fork-parent-index', 'secret-scan'],
  checked: true,
}))
