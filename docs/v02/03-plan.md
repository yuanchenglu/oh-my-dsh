---
title: oh-my-dsh v0.2 技术规划
created: 2026-08-14
innovation_points: [model-router, constraint-interception, positive-constraint-check]
kv_cache_stable: true
---

# oh-my-dsh v0.2 技术规划

> **TL;DR** — 6 个里程碑：M0 抽取 shared/messages.ts（串行前置）→ M1 model-router 与 M2+M3 constraint-immune 扩展并行 → M4 bundle 打包 → M5 全量测试与文档收尾。每个任务自包含：输入、文件清单、完整代码、验收命令。验收标准逐条映射 PRD 的 AC 编号。

## 核心结论

1. M0 是唯一串行前置：shared/messages.ts 必须先落地，A/B 子代理才有共同依赖
2. M1（子代理 A）与 M2→M3（子代理 B）文件零重叠，可并行
3. constraint-immune/index.ts 先被子代理 C 改 import（M0），再被 B 加功能（M2/M3）——严格串行
4. 每个里程碑的验收命令相同：`pnpm run typecheck && pnpm vitest run`
5. M4 必须做真实安装验证（pack → plugin add → dump-config 看到 4 个插件）

---

## 1. 里程碑总览

| 里程碑 | 内容 | 执行者 | 依赖 | 预计 |
|---|---|---|---|---|
| M0 | shared/messages.ts 抽取 + 两处 import 切换 | 子代理 C | 无 | 0.5h |
| M1 | model-router 插件（agent/request 瀑布） | 子代理 A | M0 | 2h |
| M2 | constraint-immune 执行时拦截（tools/pre-execute） | 子代理 B | M0 | 1.5h |
| M3 | 肯定型约束"缺少执行"一次性检查 | 子代理 B | M2 | 1h |
| M4 | cordis.patch.yml + 版本号 + 真实安装验证 | 子代理 C | M1+M2+M3 | 1h |
| M5 | 全量测试补齐 + 文档收尾 | 子代理 C | M4 | 1h |

**依赖图**：

```
M0 (C)
 ├──> M1 (A) ──────────────┐
 └──> M2 (B) → M3 (B) ─────┴──> M4 (C) → M5 (C)
```

## 2. 全局约束（所有任务必读）

1. **零额外依赖**：只允许 `import type { Context } from '@deepseek-ai/cordis'` 和 `import Schema from '@deepseek-ai/schemastery'`；不新增任何 package。
2. **typecheck 门禁**：`pnpm run typecheck`（`tsc --noEmit`）必须 0 错误。
3. **测试门禁**：`pnpm vitest run` 必须全绿；新增功能必须带新测试，不允许靠删测试过门禁。
4. **API 签名核对**：实现前先打开引用的 dsh 源码文件核对行号处签名（dsh 是 Developer Preview，可能漂移）。核对清单：`packages/core/agent/src/runtime-types.ts:244`（agent/request）、`:231`（agent/pre-step）、`packages/core/tools/src/index.ts:152`（tools/pre-execute）。
5. **v0.1 行为回归**：M0/M2/M3 改动 constraint-immune 与 intent-router 后，v0.1 已有 74 个测试必须保持全绿（除明确允许修改断言的用例外）。
6. **中文注释优先**；commit 由主会话统一负责，子代理不 commit。

## 3. M0：shared/messages.ts 抽取（子代理 C）

**输入**：v0.1 修复后的 `src/intent-router/index.ts`、`src/constraint-immune/index.ts`、`src/cognition-gate/injector.ts`（三者各自私有拷贝了 contentToText）。

**输出文件**：
- 新增 `src/shared/messages.ts`
- 修改 `src/intent-router/index.ts`（删私有函数，改 import）
- 修改 `src/constraint-immune/index.ts`（删私有函数，改 import）
- 新增 `tests/shared/messages.test.ts`
- cognition-gate/injector.ts 的 contentToText 也改为从 shared 导入（injector.ts 内的私有副本删除）

**执行步骤**：

1. 创建 `src/shared/messages.ts`，完整内容：

```ts
/** 把消息 content 拍平为纯文本（string 直取，ContentBlock[] 拼接 text part） */
export function contentToText(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .map((part) => (part && typeof part === 'object' && 'text' in part ? String((part as { text: unknown }).text) : ''))
      .join('')
  }
  return ''
}

/** 从消息数组提取最后一条用户消息的纯文本 */
export function extractLastUserMessage(messages: readonly { role?: string; content?: unknown }[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i]
    if (msg.role === 'user') return contentToText(msg.content)
  }
  return ''
}

/**
 * 估算消息列表的 token 数：总字符数 / 4。
 * 启发式来源：官方 token-meter 固定比率估计器
 * （packages/llm/token-meter/src/estimate.ts:12-19，CHARS_PER_TOKEN = 4）。
 */
export function estimateTokens(messages: readonly { content?: unknown }[]): number {
  let chars = 0
  for (const msg of messages) chars += contentToText(msg.content).length
  return Math.ceil(chars / 4)
}
```

2. `src/intent-router/index.ts`：删除文件内私有的 `contentToText` 与 `extractLastUserMessage`，在头部加：

```ts
import { contentToText, extractLastUserMessage } from '../shared/messages.js'
```

（注意：intent-router 只用了 extractLastUserMessage 的话，按需导入，未用不导。当前 v0.1 实现里两者都有使用路径，以实际代码为准。）

3. `src/constraint-immune/index.ts`：同样处理（它只用了 contentToText）。

4. `src/cognition-gate/injector.ts`：同样处理（它只用了 contentToText）。

5. 创建 `tests/shared/messages.test.ts`：

```ts
import { describe, it, expect } from 'vitest'
import { contentToText, extractLastUserMessage, estimateTokens } from '../../src/shared/messages.js'

describe('contentToText', () => {
  it('string 直取', () => {
    expect(contentToText('你好')).toBe('你好')
  })
  it('ContentBlock[] 拼接 text part', () => {
    expect(contentToText([{ type: 'text', text: 'a' }, { type: 'image', url: 'x' }, { type: 'text', text: 'b' }])).toBe('ab')
  })
  it('其他类型返回空串', () => {
    expect(contentToText(undefined)).toBe('')
    expect(contentToText(42)).toBe('')
  })
})

describe('extractLastUserMessage', () => {
  it('取最后一条 user 消息', () => {
    const msgs = [
      { role: 'user', content: '第一条' },
      { role: 'assistant', content: '回复' },
      { role: 'user', content: '第二条' },
    ]
    expect(extractLastUserMessage(msgs)).toBe('第二条')
  })
  it('无 user 消息返回空串', () => {
    expect(extractLastUserMessage([{ role: 'assistant', content: 'x' }])).toBe('')
  })
})

describe('estimateTokens', () => {
  it('字符数 / 4 向上取整', () => {
    expect(estimateTokens([{ content: 'a'.repeat(100) }])).toBe(25)
    expect(estimateTokens([{ content: 'a'.repeat(101) }])).toBe(26)
  })
  it('空列表为 0', () => {
    expect(estimateTokens([])).toBe(0)
  })
})
```

**验收**：
- `pnpm run typecheck` 0 错误
- `pnpm vitest run` 全绿（v0.1 的 74 个测试 + 新增 7 个 = 81 个）
- `grep -rn "function contentToText" src/` 只剩 shared/messages.ts 一处

## 4. M1：model-router 插件（子代理 A）

**输入**：M0 完成；PRD 3.1 节；架构文档 2.1 / 3.2 节。

**输出文件**：
- 新增 `src/model-router/index.ts`
- 新增 `tests/model-router/router.test.ts`
- 新增 `tests/integration/model-router.test.ts`

**执行步骤**：

1. 创建 `src/model-router/index.ts`，完整内容（与架构文档 3.2 节一致）：

```ts
// src/model-router/index.ts
import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import { classifyIntent } from '../intent-router/classifier.js'
import { strategies } from '../intent-router/strategies.js'
import { extractLastUserMessage, estimateTokens } from '../shared/messages.js'

export const name = 'model-router'
// 不声明 inject：与 intent-router 同理，事件监听器先于服务注册挂上即可触发

export interface Config {
  enabled: boolean
  defaultModel: string
  proModel: string
  upgradeIntents: string[]
  tokenThreshold: number
  dissatisfactionEnabled: boolean
  dissatisfactionPatterns: string[]
}

export const Config: Schema<Config> = Schema.object({
  enabled: Schema.boolean().default(true),
  defaultModel: Schema.string().default('deepseek-v4-flash'),
  proModel: Schema.string().default('deepseek-v4-pro'),
  upgradeIntents: Schema.array(Schema.string()).default(['architecture', 'research']),
  tokenThreshold: Schema.number().default(30000),
  dissatisfactionEnabled: Schema.boolean().default(true),
  dissatisfactionPatterns: Schema.array(Schema.string()).default([]),
})

/** 内置"不满意"判定正则（PRD 3.1.2） */
const BUILTIN_DISSATISFACTION_RE =
  /(?:不对|错了|重新|重来|不行|不符合|不是这样|再试|wrong|try again|not right)/i

/** agent/request 调用配置的最小形状（与 dsh LlmCallConfig 对齐） */
interface CallConfig {
  provider: string
  model: string
  reasoningEffort?: string
  [key: string]: unknown
}

interface RequestPayload {
  agent: {
    id?: unknown
    session: {
      deriveMessages(): Array<{ role?: string; content?: unknown }>
    }
  }
  turn: number
  step: number
  signal: AbortSignal
}

/** 升级评估结果（纯函数，便于单测） */
export interface UpgradeDecision {
  upgrade: boolean
  reason: 'intent' | 'tokens' | 'dissatisfaction' | 'none'
}

/**
 * 升级条件评估（PRD 3.1.1，满足任一即升 Pro）
 * 纯函数：不读 ctx、不读状态，调用方负责传入连续不满意轮数。
 */
export function evaluateUpgrade(params: {
  intent: string
  estimatedTokens: number
  consecutiveDissatisfied: number
  config: Pick<Config, 'upgradeIntents' | 'tokenThreshold' | 'dissatisfactionEnabled'>
}): UpgradeDecision {
  const { intent, estimatedTokens, consecutiveDissatisfied, config } = params
  if (config.upgradeIntents.includes(intent)) return { upgrade: true, reason: 'intent' }
  if (config.tokenThreshold > 0 && estimatedTokens > config.tokenThreshold) {
    return { upgrade: true, reason: 'tokens' }
  }
  if (config.dissatisfactionEnabled && consecutiveDissatisfied >= 2) {
    return { upgrade: true, reason: 'dissatisfaction' }
  }
  return { upgrade: false, reason: 'none' }
}

export function apply(ctx: Context, config: Config) {
  if (!config.enabled) return

  // 每 agent 连续不满意轮数：agentId → count
  const dissatisfactionStreak = new Map<string, number>()

  const customRes = config.dissatisfactionPatterns
    .filter((p) => p.length > 0)
    .map((p) => new RegExp(p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'))

  ctx.on('agent/request', async (payload: RequestPayload, next: () => Promise<CallConfig>): Promise<CallConfig> => {
    const callConfig = await next()
    if (payload.signal.aborted) return callConfig

    const messages = payload.agent.session.deriveMessages()
    const lastUser = extractLastUserMessage(messages)

    // C3：更新连续不满意计数（命中 +1，否则清零）
    const agentId = payload.agent.id != null ? String(payload.agent.id) : 'default'
    const prev = dissatisfactionStreak.get(agentId) ?? 0
    const dissatisfied =
      lastUser.length > 0 &&
      (BUILTIN_DISSATISFACTION_RE.test(lastUser) || customRes.some((re) => re.test(lastUser)))
    const streak = dissatisfied ? prev + 1 : 0
    dissatisfactionStreak.set(agentId, streak)

    const { intent } = lastUser
      ? classifyIntent(lastUser, strategies)
      : { intent: 'spec_driven' as const }

    const decision = evaluateUpgrade({
      intent,
      estimatedTokens: estimateTokens(messages),
      consecutiveDissatisfied: streak,
      config,
    })

    // 只改 model，provider 与其余字段原样保留（PRD AC-6）
    return { ...callConfig, model: decision.upgrade ? config.proModel : config.defaultModel }
  })
}
```

2. 创建 `tests/model-router/router.test.ts`（纯函数单测，覆盖 PRD 3.1.7 的 AC-1/2/3 判定逻辑）：

```ts
import { describe, it, expect } from 'vitest'
import { evaluateUpgrade } from '../../src/model-router/index.js'

const baseConfig = {
  upgradeIntents: ['architecture', 'research'],
  tokenThreshold: 30000,
  dissatisfactionEnabled: true,
}

describe('evaluateUpgrade', () => {
  it('spec_driven + 低 token + 无不满意 → 不升级（AC-1 判定面）', () => {
    const d = evaluateUpgrade({ intent: 'spec_driven', estimatedTokens: 100, consecutiveDissatisfied: 0, config: baseConfig })
    expect(d).toEqual({ upgrade: false, reason: 'none' })
  })
  it('architecture 意图 → 升级（AC-2 判定面）', () => {
    const d = evaluateUpgrade({ intent: 'architecture', estimatedTokens: 100, consecutiveDissatisfied: 0, config: baseConfig })
    expect(d).toEqual({ upgrade: true, reason: 'intent' })
  })
  it('research 意图 → 升级', () => {
    expect(evaluateUpgrade({ intent: 'research', estimatedTokens: 0, consecutiveDissatisfied: 0, config: baseConfig }).upgrade).toBe(true)
  })
  it('token 超阈值 → 升级（AC-3 判定面）', () => {
    const d = evaluateUpgrade({ intent: 'simple', estimatedTokens: 30001, consecutiveDissatisfied: 0, config: baseConfig })
    expect(d).toEqual({ upgrade: true, reason: 'tokens' })
  })
  it('token 恰等于阈值 → 不升级（边界）', () => {
    expect(evaluateUpgrade({ intent: 'simple', estimatedTokens: 30000, consecutiveDissatisfied: 0, config: baseConfig }).upgrade).toBe(false)
  })
  it('连续 2 轮不满意 → 升级（AC-4 判定面）', () => {
    const d = evaluateUpgrade({ intent: 'simple', estimatedTokens: 0, consecutiveDissatisfied: 2, config: baseConfig })
    expect(d).toEqual({ upgrade: true, reason: 'dissatisfaction' })
  })
  it('仅 1 轮不满意 → 不升级', () => {
    expect(evaluateUpgrade({ intent: 'simple', estimatedTokens: 0, consecutiveDissatisfied: 1, config: baseConfig }).upgrade).toBe(false)
  })
  it('upgradeIntents 为空数组 → 意图条件关闭', () => {
    const d = evaluateUpgrade({ intent: 'architecture', estimatedTokens: 0, consecutiveDissatisfied: 0, config: { ...baseConfig, upgradeIntents: [] } })
    expect(d.upgrade).toBe(false)
  })
  it('tokenThreshold 为 0 → token 条件关闭', () => {
    const d = evaluateUpgrade({ intent: 'simple', estimatedTokens: 999999, consecutiveDissatisfied: 0, config: { ...baseConfig, tokenThreshold: 0 } })
    expect(d.upgrade).toBe(false)
  })
  it('dissatisfactionEnabled=false → 不满意条件关闭', () => {
    const d = evaluateUpgrade({ intent: 'simple', estimatedTokens: 0, consecutiveDissatisfied: 5, config: { ...baseConfig, dissatisfactionEnabled: false } })
    expect(d.upgrade).toBe(false)
  })
})
```

3. 创建 `tests/integration/model-router.test.ts`（mock ctx，覆盖 AC-1~AC-6 的端到插件面）：

```ts
import { describe, it, expect, vi } from 'vitest'
import { apply } from '../../src/model-router/index.js'

function createMockCtx() {
  const listeners: Record<string, Function[]> = {}
  return {
    on: vi.fn((event: string, fn: Function) => {
      listeners[event] = listeners[event] || []
      listeners[event].push(fn)
    }),
    effect: vi.fn(),
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    _listeners: listeners,
    _dispatchRequest: async (
      messages: Array<{ role: string; content: unknown }>,
      seed: Record<string, unknown> = { provider: 'deepseek-official', model: 'deepseek-v4-flash' },
      agentId = 's1',
    ) => {
      const payload = {
        agent: { id: agentId, session: { deriveMessages: () => messages } },
        turn: 0,
        step: 0,
        signal: new AbortController().signal,
      }
      const fns = listeners['agent/request'] || []
      const next = vi.fn().mockResolvedValue(seed)
      let result: any = seed
      for (const fn of fns) result = await fn(payload, next)
      return { result, next }
    },
  }
}

const defaultConfig = {
  enabled: true,
  defaultModel: 'deepseek-v4-flash',
  proModel: 'deepseek-v4-pro',
  upgradeIntents: ['architecture', 'research'],
  tokenThreshold: 30000,
  dissatisfactionEnabled: true,
  dissatisfactionPatterns: [] as string[],
}

describe('model-router plugin', () => {
  it('registers agent/request listener', () => {
    const ctx = createMockCtx()
    apply(ctx as any, defaultConfig)
    expect(ctx.on).toHaveBeenCalledWith('agent/request', expect.any(Function))
  })

  it('AC-1：简单任务保持 flash', async () => {
    const ctx = createMockCtx()
    apply(ctx as any, defaultConfig)
    const { result } = await ctx._dispatchRequest([{ role: 'user', content: '修复这个 typo' }])
    expect(result.model).toBe('deepseek-v4-flash')
  })

  it('AC-2：架构意图升级 pro', async () => {
    const ctx = createMockCtx()
    apply(ctx as any, defaultConfig)
    const { result } = await ctx._dispatchRequest([{ role: 'user', content: '设计一个微服务架构方案' }])
    expect(result.model).toBe('deepseek-v4-pro')
  })

  it('AC-3：token 超阈值升级 pro', async () => {
    const ctx = createMockCtx()
    apply(ctx as any, defaultConfig)
    // 30000 token 阈值 → 需要 > 120000 字符
    const { result } = await ctx._dispatchRequest([
      { role: 'user', content: '继续' },
      { role: 'assistant', content: 'x'.repeat(120001) },
    ])
    expect(result.model).toBe('deepseek-v4-pro')
  })

  it('AC-4：连续两轮不满意升级，随后正常消息回落 flash', async () => {
    const ctx = createMockCtx()
    apply(ctx as any, defaultConfig)
    await ctx._dispatchRequest([{ role: 'user', content: '不对，重来' }])              // streak=1
    const second = await ctx._dispatchRequest([
      { role: 'user', content: '不对，重来' },
      { role: 'assistant', content: '...' },
      { role: 'user', content: '还是不对' },
    ])                                                                                 // streak=2 → pro
    expect(second.result.model).toBe('deepseek-v4-pro')
    const third = await ctx._dispatchRequest([
      { role: 'user', content: '不对，重来' },
      { role: 'assistant', content: '...' },
      { role: 'user', content: '还是不对' },
      { role: 'assistant', content: '...' },
      { role: 'user', content: '好的，继续' },
    ])                                                                                 // 清零 → flash
    expect(third.result.model).toBe('deepseek-v4-flash')
  })

  it('AC-5：enabled=false 不注册 listener', () => {
    const ctx = createMockCtx()
    apply(ctx as any, { ...defaultConfig, enabled: false })
    expect(ctx.on).not.toHaveBeenCalled()
  })

  it('AC-6：provider 永远不被修改', async () => {
    const ctx = createMockCtx()
    apply(ctx as any, defaultConfig)
    const { result } = await ctx._dispatchRequest([{ role: 'user', content: '设计一个微服务架构方案' }])
    expect(result.provider).toBe('deepseek-official')
  })

  it('不满意计数按 agent 隔离', async () => {
    const ctx = createMockCtx()
    apply(ctx as any, defaultConfig)
    await ctx._dispatchRequest([{ role: 'user', content: '不对' }], undefined, 's1')
    // s2 第一次不满意不应升级到 streak=2
    const r = await ctx._dispatchRequest([{ role: 'user', content: '重新来' }], undefined, 's2')
    expect(r.result.model).toBe('deepseek-v4-flash')
  })

  it('自定义不满意关键词生效', async () => {
    const ctx = createMockCtx()
    apply(ctx as any, { ...defaultConfig, dissatisfactionPatterns: ['离谱'] })
    await ctx._dispatchRequest([{ role: 'user', content: '太离谱了' }])
    const r = await ctx._dispatchRequest([
      { role: 'user', content: '太离谱了' },
      { role: 'assistant', content: '...' },
      { role: 'user', content: '离谱' },
    ])
    expect(r.result.model).toBe('deepseek-v4-pro')
  })
})
```

**验收**（映射 PRD 3.1.7）：
- AC-1~AC-6 各有上述对应测试且通过
- `pnpm run typecheck` 0 错误
- `pnpm vitest run tests/model-router tests/integration/model-router` 全绿
- `pnpm vitest run` 全量全绿

## 5. M2：constraint-immune 执行时拦截（子代理 B）

**输入**：M0 完成；PRD 3.2 节；架构文档 2.3 / 3.3.4 节。

**输出文件**：
- 修改 `src/constraint-immune/index.ts`（Config 加 interception；apply 追加 tools/pre-execute listener）
- 修改 `tests/integration/constraint-immune.test.ts`（追加拦截用例）

**执行步骤**：

1. Config 变更（架构文档 3.3.1）：

```ts
export interface Config {
  enabled: boolean
  customPatterns: string[]
  interception: 'off' | 'deny'   // v0.2 新增，默认 'deny'
}

export const Config: Schema<Config> = Schema.object({
  enabled: Schema.boolean().default(true),
  customPatterns: Schema.array(Schema.string()).default([]),
  interception: Schema.string().default('deny'),
})
```

2. 在 `apply` 内 pre-step listener 之后追加（架构文档 3.3.4，完整可复制）：

```ts
  // 执行时拦截（PRD 3.2）：工具派发前检查 工具名+参数 是否命中否定型约束关键词
  // 签名见 packages/core/tools/src/index.ts:152；deny 物化见 :1488-1498
  if (config.interception === 'deny') {
    ctx.on('tools/pre-execute', (exec: {
      name: string
      arguments: unknown
      agent?: { id?: unknown }
    }, next: () => Promise<{ kind: 'allow' } | { kind: 'deny'; reason: string } | { kind: 'ask'; reason?: string }>) => {
      const sessionId = exec.agent?.id != null ? String(exec.agent.id) : 'default'
      const session = sessions.get(sessionId)
      if (!session || session.constraints.size === 0) return next()

      const argsText = typeof exec.arguments === 'string'
        ? exec.arguments
        : JSON.stringify(exec.arguments ?? '')
      const text = exec.name + '\n' + argsText

      for (const stored of session.constraints.values()) {
        if (stored.kind !== 'negative') continue   // 肯定型永远不拦截（PRD AC-4）
        if (stored.keyword.length < 4) continue    // 短关键词误伤控制（PRD 3.2.3）
        if (text.includes(stored.keyword)) {
          return Promise.resolve({
            kind: 'deny' as const,
            reason: `[constraint-immune] 命中硬约束："${stored.raw}"`,
          })
        }
      }
      return next()
    })
  }
```

3. mock ctx 增加 `_preExecute` 辅助方法，向 `tests/integration/constraint-immune.test.ts` 追加用例：

```ts
    /** 模拟 tools/pre-execute 瀑布 */
    _preExecute: async (exec: { name: string; arguments: unknown; agent?: { id?: string } }) => {
      const next = vi.fn().mockResolvedValue({ kind: 'allow' })
      const results = []
      for (const fn of listeners['tools/pre-execute'] || []) results.push(await fn(exec, next))
      return { next, results }
    },
```

```ts
  it('AC-1：命中否定型约束的工具调用被 deny', async () => {
    const ctx = createMockCtx()
    apply(ctx as any, { enabled: true, customPatterns: [], interception: 'deny' })
    const agent = { id: 's1' }
    await ctx._preStep({ agent, messages: [{ role: 'user', content: '禁止删除生产数据' }], turn: 0 })
    const { next, results } = await ctx._preExecute({
      name: 'delete_file',
      arguments: { path: '/生产数据/users.db', note: '删除生产数据' },
      agent,
    })
    expect(next).not.toHaveBeenCalled()
    expect(results[0].kind).toBe('deny')
    expect(results[0].reason).toContain('禁止删除生产数据')
  })

  it('AC-2：不命中约束的工具调用放行', async () => {
    const ctx = createMockCtx()
    apply(ctx as any, { enabled: true, customPatterns: [], interception: 'deny' })
    const agent = { id: 's1' }
    await ctx._preStep({ agent, messages: [{ role: 'user', content: '禁止删除生产数据' }], turn: 0 })
    const { next } = await ctx._preExecute({ name: 'read_file', arguments: { path: '/tmp/a.txt' }, agent })
    expect(next).toHaveBeenCalled()
  })

  it("AC-3：interception='off' 不注册 tools/pre-execute", () => {
    const ctx = createMockCtx()
    apply(ctx as any, { enabled: true, customPatterns: [], interception: 'off' })
    const events = (ctx.on as any).mock.calls.map((c: any[]) => c[0])
    expect(events).toContain('agent/pre-step')
    expect(events).not.toContain('tools/pre-execute')
  })

  it('AC-4：关键词 < 4 字符的否定型约束不触发拦截', async () => {
    const ctx = createMockCtx()
    apply(ctx as any, { enabled: true, customPatterns: [], interception: 'deny' })
    const agent = { id: 's1' }
    // "禁止删表"→ 关键词 "删表"（2 字符，能过提取正则进入约束表），<4 守卫应放行；
    // 若守卫被删，此用例会返回 deny 变红——真正的回归测试（review F1 修复）
    await ctx._preStep({ agent, messages: [{ role: 'user', content: '禁止删表' }], turn: 0 })
    const { next } = await ctx._preExecute({ name: 'execute_sql', arguments: { sql: 'DROP TABLE t -- 删表' }, agent })
    expect(next).toHaveBeenCalled()
  })

  it('AC-5：拦截状态按 agent 隔离', async () => {
    const ctx = createMockCtx()
    apply(ctx as any, { enabled: true, customPatterns: [], interception: 'deny' })
    await ctx._preStep({ agent: { id: 's1' }, messages: [{ role: 'user', content: '禁止删除生产数据' }], turn: 0 })
    const { next } = await ctx._preExecute({
      name: 'delete_file',
      arguments: { note: '删除生产数据' },
      agent: { id: 's2' },
    })
    expect(next).toHaveBeenCalled()
  })

  it('肯定型约束不触发拦截（PRD 3.3 AC-4）', async () => {
    const ctx = createMockCtx()
    apply(ctx as any, { enabled: true, customPatterns: [], interception: 'deny' })
    const agent = { id: 's1' }
    await ctx._preStep({ agent, messages: [{ role: 'user', content: '必须先备份再操作' }], turn: 0 })
    const { next } = await ctx._preExecute({ name: 'run', arguments: { cmd: '先备份再操作' }, agent })
    expect(next).toHaveBeenCalled()
  })
```

**验收**（映射 PRD 3.2.5）：
- AC-1~AC-5 各有上述对应测试且通过
- `pnpm run typecheck` 0 错误；`pnpm vitest run` 全量全绿（v0.1 用例不回归）
- 注：AC-1 中"deny 的 reason 被物化为 `isError: true` 工具结果喂回模型"属 dsh 运行时行为（tools/src/index.ts:1488-1498），mock 环境不覆盖，由 M4 真实安装验证兜底（review F3）

## 6. M3：肯定型约束"缺少执行"检查（子代理 B）

**输入**：M2 完成；PRD 3.3 节；架构文档 3.3.2 / 3.3.3 节。

**输出文件**：
- 修改 `src/constraint-immune/index.ts`（StoredConstraint 加 positiveChecked；pre-step 追加检查段）
- 修改 `tests/integration/constraint-immune.test.ts`（追加 3 个用例）

**执行步骤**：

1. StoredConstraint 类型变更（架构文档 3.3.2）：

```ts
/** 约束 + 首次出现的消息下标 + 肯定型一次性检查标记 */
type StoredConstraint = Constraint & { messageIndex: number; positiveChecked?: boolean }
```

2. 在 pre-step listener 的否定型检查循环之后、`session.checkedUpTo = messages.length` 之前插入（架构文档 3.3.3，完整可复制）：

```ts
    // 3. 肯定型约束"缺少执行"一次性检查（PRD 3.3）：
    //    只看约束首次出现后的第一段新 assistant 输出；无论结果如何只查一次
    for (const stored of constraints.values()) {
      if (stored.kind !== 'positive' || stored.positiveChecked) continue
      const scope = messages
        .slice(Math.max(stored.messageIndex + 1, session.checkedUpTo))
        .filter((m) => m.role === 'assistant')
        .map((m) => contentToText(m.content))
        .join('\n')
      if (!scope.trim()) continue // 还没有新的 assistant 输出，等下一轮
      stored.positiveChecked = true
      if (!scope.includes(stored.keyword)) {
        session.checkedUpTo = messages.length
        const reminder = {
          role: 'user' as const,
          content: `[约束提醒] 检测到可能未执行硬约束："${stored.raw}"。请确认已执行。`,
        }
        return { kind: 'enter', messages: [...messages, reminder] }
      }
    }
```

3. 追加测试用例：

```ts
  it('AC-1：肯定型约束被遵守（含关键词）→ 不提醒', async () => {
    const ctx = createMockCtx()
    apply(ctx as any, { enabled: true, customPatterns: [], interception: 'deny' })
    const agent = { id: 's1' }
    await ctx._preStep({ agent, messages: [{ role: 'user', content: '必须先备份再操作' }], turn: 0 })
    const { next, results } = await ctx._preStep({
      agent,
      messages: [
        { role: 'user', content: '必须先备份再操作' },
        { role: 'assistant', content: '好的，我先备份再操作。' },
      ],
      turn: 1,
    })
    expect(next).toHaveBeenCalled()
    expect(results[0].messages).toHaveLength(2)
  })

  it('AC-2：肯定型约束缺执行 → 追加一次"未执行"提醒', async () => {
    const ctx = createMockCtx()
    apply(ctx as any, { enabled: true, customPatterns: [], interception: 'deny' })
    const agent = { id: 's1' }
    await ctx._preStep({ agent, messages: [{ role: 'user', content: '必须先备份再操作' }], turn: 0 })
    const { results } = await ctx._preStep({
      agent,
      messages: [
        { role: 'user', content: '必须先备份再操作' },
        { role: 'assistant', content: '我直接开始改代码。' },
      ],
      turn: 1,
    })
    const messages = results[0].messages as Array<{ role: string; content: string }>
    expect(messages).toHaveLength(3)
    expect(messages[2].content).toContain('可能未执行硬约束')
    expect(messages[2].content).toContain('必须先备份再操作')
  })

  it('AC-3：提醒只出现一次', async () => {
    const ctx = createMockCtx()
    apply(ctx as any, { enabled: true, customPatterns: [], interception: 'deny' })
    const agent = { id: 's1' }
    await ctx._preStep({ agent, messages: [{ role: 'user', content: '必须先备份再操作' }], turn: 0 })
    const first = await ctx._preStep({
      agent,
      messages: [
        { role: 'user', content: '必须先备份再操作' },
        { role: 'assistant', content: '我直接开始改代码。' },
      ],
      turn: 1,
    })
    const withReminder = first.results[0].messages as Array<{ role: string; content: string }>
    const second = await ctx._preStep({
      agent,
      messages: [...withReminder, { role: 'assistant', content: '继续改。' }],
      turn: 2,
    })
    expect(second.next).toHaveBeenCalled()
    expect(second.results[0].messages).toHaveLength(4)
  })
```

**验收**（映射 PRD 3.3.3）：
- AC-1~AC-4（含 M2 的"肯定型不拦截"）全部通过
- `pnpm run typecheck` 0 错误；`pnpm vitest run` 全量全绿

## 7. M4：bundle 打包与真实安装验证（子代理 C）

**输入**：M1+M2+M3 全部完成。

**输出文件**：
- 修改 `cordis.patch.yml`（追加 model-router，constraint-immune 加 interception）
- 修改 `package.json`（version → 0.2.0）
- 修改 `README.md`（插件表加 model-router，配置示例更新）

**执行步骤**：

1. `cordis.patch.yml` 全量替换为架构文档 3.4 节内容（model-router 置于 intent-router 之后）。
2. `package.json` version 改为 `0.2.0`。
3. README 插件表加一行：`| **model-router** | Flash-first，复杂任务自动升级 Pro | \`agent/request\` |`。
4. 构建 + 打包：

```sh
cd ~/Code/oh-my-dsh && pnpm run build && pnpm pack
```

5. 真实安装验证（沿用 v0.1 修复期流程）：

```sh
rm -rf ~/.dsh/profiles/headless/node_modules/oh-my-dsh
cd ~/Code/deepseek-src/deepseek-harness
node --import tsx/esm apps/cli/src/bin.ts plugin --profile headless add ~/Code/oh-my-dsh/oh-my-dsh-0.2.0.tgz
node --import tsx/esm apps/cli/src/bin.ts --profile headless --dump-config | grep -A3 oh-my-dsh
```

6. 冒烟：直接 import 编译产物，验证 4 个插件的 name/apply 导出 + model-router 在"设计一个微服务架构"输入下返回 `model: deepseek-v4-pro`（脚本复用 v0.1 冒烟模式，见 v0.1 提交 73f6652 后的验证记录）。

7. 有 DEEPSEEK_API_KEY 时跑真实 headless 对话，并在 session 日志 grep `request/header` 确认 model 切换：

```sh
source ~/.env && export DEEPSEEK_API_KEY="${DEEPSEEK_API_KEY_AGENT:-$DEEPSEEK_API_KEY_CODEX}"
node --import tsx/esm apps/cli/src/bin.ts --profile headless headless "设计一个微服务架构，一句话回答"
# 找最新 session.jsonl.zstd，zstd -dc 后 grep '"model":"deepseek-v4-pro"'
```

无 key 时跳过第 7 步并在交付说明中明示。

**验收**：
- `--dump-config` 输出含 4 个插件条目（intent-router / model-router / cognition-gate / constraint-immune）
- 冒烟脚本输出 model-router 的 pro 切换断言通过
- （有 key 时）session 日志含 `"model":"deepseek-v4-pro"`

## 8. M5：全量测试与文档收尾（子代理 C）

**输入**：M4 完成。

**执行步骤**：

1. 全量门禁：`pnpm run typecheck && pnpm vitest run` 全绿。
2. 更新 `docs/04-testing.md` 或新增 v0.2 测试文档（由主会话规划，本计划不含其内容）。
3. Release Notes：声明 constraint-immune 默认行为从"纯提醒"变为"提醒 + 拦截"（interception 默认 deny），给出 `interception: 'off'` 的回退配置。
4. 把 v0.2 的 12 创新点评估结论表（PRD 3.4）同步进主 README 或 roadmap 段（可选）。

**验收**：
- 门禁全绿；文档与代码一致（抽查：patch yml、Config 字段、README 插件表）

## 9. 子代理任务分配卡

### 子代理 A：model-router（M1）

**输入文件**：本文档 M1 节；docs/v02/02-architecture.md 2.1 / 3.2 节；docs/v02/01-prd.md 3.1 节。

**输出文件**（不与 B/C 重叠）：
- `src/model-router/index.ts`
- `tests/model-router/router.test.ts`
- `tests/integration/model-router.test.ts`

**禁止**：改 shared/、intent-router/、constraint-immune/、cordis.patch.yml；commit。

### 子代理 B：constraint-immune 扩展（M2 → M3）

**输入文件**：本文档 M2/M3 节；docs/v02/02-architecture.md 2.3 / 3.3 节；docs/v02/01-prd.md 3.2 / 3.3 节。

**输出文件**：
- `src/constraint-immune/index.ts`
- `tests/integration/constraint-immune.test.ts`

**前置**：必须等子代理 C 的 M0 落地后再开始（M0 会改同一文件的 import）。

**禁止**：改 extractor.ts（v0.1 已分 negative/positive，无需动）；commit。

### 子代理 C：基建与收尾（M0 → M4 → M5）

**输入文件**：本文档 M0/M4/M5 节；docs/v02/02-architecture.md 3.1 / 3.4 节。

**输出文件**：
- M0：`src/shared/messages.ts`、`tests/shared/messages.test.ts`、`src/intent-router/index.ts`（仅 import）、`src/constraint-immune/index.ts`（仅 import）、`src/cognition-gate/injector.ts`（仅 import）
- M4：`cordis.patch.yml`、`package.json`、`README.md`
- M5：文档收尾

**禁止**：在 M0 之外碰 src/ 下其他逻辑；commit。

## 10. 风险与对策

| 风险 | 概率 | 对策 |
|---|---|---|
| dsh rc 版本 tools/* 事件签名漂移 | 中 | M2 开工前核对 tools/src/index.ts:152 签名文本（全局约束 4） |
| 拦截误伤正常工具调用 | 中 | 仅否定型 + 关键词 ≥4 字符 + interception:'off' 逃生门（PRD 3.2.3） |
| A/B/C 文件冲突 | 低 | 分配卡已隔离；constraint-immune/index.ts 的 C→B 串行已显式声明 |
| 不满意计数在多 step 重复累加 | 已知近似 | 架构文档 3.2 注意点 2 已记录，列 v0.3 优化 |
| M4 安装验证无 API key | 中 | 前 6 步无需 key；第 7 步跳过并明示 |

---

## 附录 A：验收命令速查

```sh
# 每个里程碑的静态门禁
cd ~/Code/oh-my-dsh
pnpm run typecheck && pnpm vitest run

# M4 真实安装验证
pnpm run build && pnpm pack
rm -rf ~/.dsh/profiles/headless/node_modules/oh-my-dsh
cd ~/Code/deepseek-src/deepseek-harness
node --import tsx/esm apps/cli/src/bin.ts plugin --profile headless add ~/Code/oh-my-dsh/oh-my-dsh-0.2.0.tgz
node --import tsx/esm apps/cli/src/bin.ts --profile headless --dump-config | grep -A3 oh-my-dsh
```

## 附录 B：AC 映射总表

| PRD 条目 | AC | 里程碑 | 测试位置 |
|---|---|---|---|
| 3.1.7 model-router | AC-1~AC-6 | M1 | tests/integration/model-router.test.ts（同名用例） |
| 3.2.5 执行时拦截 | AC-1~AC-5 | M2 | tests/integration/constraint-immune.test.ts（同名用例） |
| 3.3.3 肯定型检查 | AC-1~AC-4 | M2（AC-4）+ M3（AC-1~3） | tests/integration/constraint-immune.test.ts（同名用例） |

## 附录 C：变更记录

| 日期 | 内容 | 来源 |
|---|---|---|
| 2026-08-14 | 初版，M0-M5 + 子代理分配卡 + 完整代码片段 | v0.2 规划任务 |
