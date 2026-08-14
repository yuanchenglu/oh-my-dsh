---
title: oh-my-dsh v0.2 技术架构文档
created: 2026-08-14
innovation_points: [I-06, I-07, I-11, I-12, I-14, model-router, constraint-interception]
kv_cache_stable: true
---

# oh-my-dsh v0.2 技术架构文档

> **TL;DR** — v0.2 新增 model-router 插件（挂 `agent/request` 瀑布改 `config.model`，官方先例 model-selection.ts:54-69）、constraint-immune 追加执行时拦截（挂 `tools/pre-execute` 返回 deny）与肯定型约束一次性"缺少执行"检查（复用 v0.1 pre-step 检查窗口）。所有 API 签名已从 dsh v0.1.0-rc.5 源码核实，行号引用见各节与附录 A。

## 核心结论

1. model-router 只改 `config.model` 不改 provider，避免跨 adapter 的 replayState 剥离
2. 执行时拦截选 `tools/pre-execute` 而非 `ctx.tools.guard`，deny reason 会喂回模型
3. 肯定型检查挂在 v0.1 已有的 pre-step 检查窗口上，每约束只查一次
4. token 估算用 chars/4 启发式（token-meter estimate.ts:12-19），不接 token-meter 服务
5. 三个插件的消息工具函数上收到 `src/shared/messages.ts`，消除三份拷贝

---

## 1. 架构总览

### 1.1 bundle 结构（v0.2）

```
用户 profile 配置树（cordis.yml）
  └── - include: oh-my-dsh/cordis.patch.yml   ← bundle 层（本仓库提供）
        ├── intent-router 插件（agent/request）              ← v0.1，不变
        ├── cognition-gate 插件（agent/pre-step）            ← v0.1，不变
        ├── constraint-immune 插件（agent/pre-step + tools/pre-execute）  ← v0.2 追加拦截
        └── model-router 插件（agent/request）               ← v0.2 新增
```

### 1.2 技术栈

与 v0.1 完全一致：TypeScript 5.x / Node 22.19+ / pnpm 11.7 / vitest / Schemastery / tsc → ESM。**零额外依赖**（只用 `@deepseek-ai/cordis` / `@deepseek-ai/dsh-tools` / `@deepseek-ai/schemastery` 三个 peerDependencies）。

### 1.3 仓库结构（v0.2，变更处带 ★）

```
oh-my-dsh/
├── package.json                # version → 0.2.0，其余不变
├── cordis.patch.yml            # ★ 追加 model-router 条目（置于 intent-router 之后）
├── src/
│   ├── shared/
│   │   ├── types.ts            # v0.1，不变
│   │   └── messages.ts         # ★ 新增：contentToText / extractLastUserMessage / estimateTokens
│   ├── intent-router/
│   │   ├── index.ts            # ★ 改为从 shared/messages.js 导入（行为不变）
│   │   ├── classifier.ts       # 不变
│   │   └── strategies.ts       # 不变
│   ├── cognition-gate/
│   │   ├── index.ts            # 不变
│   │   └── injector.ts         # 不变
│   ├── constraint-immune/
│   │   ├── index.ts            # ★ 追加 tools/pre-execute 拦截 + 肯定型一次性检查 + interception 配置
│   │   └── extractor.ts        # 不变（v0.1 已分 negative/positive）
│   └── model-router/           # ★ 新增插件
│       └── index.ts            #   入口（name/Config/apply）
├── tests/
│   ├── shared/
│   │   └── messages.test.ts    # ★ 新增
│   ├── model-router/
│   │   └── router.test.ts      # ★ 新增：升级条件纯函数测试
│   ├── integration/
│   │   ├── model-router.test.ts        # ★ 新增
│   │   └── constraint-immune.test.ts   # ★ 追加拦截与肯定型用例
│   └── ...（其余不变）
└── docs/v02/                   # 本套文档
```

## 2. 挂钩点 API 精确签名（dsh v0.1.0-rc.5 源码核实）

> 版本来源：`/Users/bluth/Code/deepseek-src/deepseek-harness/package.json:3` → `0.1.0-rc.5`。
> 以下行号均以该版本源码为准；Developer Preview 期间 API 可能漂移，实现前先核对行号处的签名文本。

### 2.1 agent/request（瀑布：改写调用配置）

```ts
// packages/core/agent/src/runtime-types.ts:244
'agent/request'(
  this: Scoped<Agent>,
  payload: { agent: Agent; turn: number; step: number; signal: AbortSignal },
  next: () => Promise<LlmCallConfig>
): Promise<LlmCallConfig>
```

- listener 在 unwind 阶段返回修改后的 config 即生效；agent-loop 会把变更记入 `request/header` 快照（packages/core/agent-loop/src/agent.ts:437-469）。
- `LlmCallConfig` 字段：`provider / model / reasoningEffort? / temperature? / maxTokens? / stop?`（packages/llm/llm/src/call-config.ts:24-31）。
- `payload.agent.session.deriveMessages(): Message[]`（packages/core/session/src/index.ts:726-747）。
- `payload.agent.id` 即 `SessionId`（runtime-types.ts:64-66）。

**官方改模型先例**（model-router 的直接参照）：

```ts
// packages/core/agent/src/model-selection.ts:54-69（installModelSelection）
// 通过 agent/request 瀑布重定向 provider/model —— 证明运行时切模型是受支持的通道
```

### 2.2 agent/pre-step（瀑布：改写进入 step 的消息）

```ts
// packages/core/agent/src/runtime-types.ts:231
'agent/pre-step'(
  this: Scoped<Agent>,
  payload: {
    agent: Agent
    messages: UserMessage[]
    turn: number
    step: number
    signal: AbortSignal
  },
  next: () => Promise<PreStepDecision>
): Promise<PreStepDecision>

// runtime-types.ts:53-55
type PreStepDecision =
  | { kind: 'reject' }
  | { kind: 'enter'; messages: UserMessage[] }
```

- `payload.turn === 0` 是首轮。
- v0.1 的 constraint-immune 与 cognition-gate 已挂此事件，v0.2 沿用。

### 2.3 tools/pre-execute（瀑布：工具派发前门禁）

```ts
// packages/core/tools/src/index.ts:152
'tools/pre-execute'(
  this: Scoped<ToolRuntime>,
  exec: ToolExecution,
  next: () => Promise<PreToolDecision>
): Promise<PreToolDecision>
```

payload 类型：

```ts
// packages/core/tools/src/index.ts:314-338
export interface ToolExecutionInput {
  readonly callId: CallId
  readonly rootCallId?: CallId
  readonly name: string            // 工具名
  readonly arguments: unknown      // 工具参数（listener 拿到时已 deepFreeze，只读）
  readonly agent?: Agent
  readonly parent?: ToolExecutionToken
  readonly signal: AbortSignal
}

// packages/core/tools/src/index.ts:379-384
export interface ToolExecution extends ToolExecutionInput {
  readonly rootCallId: CallId
  readonly token: ToolExecutionToken
}
```

decision 类型：

```ts
// packages/core/tools/src/index.ts:588-591
export type PreToolDecision =
  | { kind: 'allow' }
  | { kind: 'deny'; reason: string }
  | { kind: 'ask'; reason?: string }
```

关键语义（全部源码核实）：

- **deny 的物化**：返回 `{ kind: 'deny', reason }` 后，dsh 把 reason 包装为 `{ content: [{ type: 'text', text: 'Error: <reason>' }], isError: true }` 的工具结果返回给模型（packages/core/tools/src/index.ts:1488-1498）。模型下一轮能看到被拒原因。
- **参数只读**：`exec.arguments` 在派发前经 `snapshotJsonValue` + `deepFreeze`（packages/core/tools/src/index.ts:1412-1416）；官方明确排除参数重写（注释，packages/core/tools/src/index.ts:583-586）。
- **作用域过滤**：listener 注册在普通根 ctx 上接收所有 agent 的工具调用；注册在 `agent.ctx` 上只接收该 agent 的（scope 路由：packages/core/scope/src/scoped-events.generated.ts:32-36）。本 bundle 一律用根 ctx。

**备选（不采用，记录备查）**：`ctx.tools.guard(guard: (execution: Readonly<ToolExecution>) => string | undefined)`（packages/core/tools/src/index.ts:1110-1116，ToolGuard 类型 :711）。guard 在 pre-execute 瀑布之后单调求值，任何守卫返回字符串即最终拒绝、不可翻案（:1119-1128）。不选它的原因见 PRD 3.2.2。

## 3. 模块设计

### 3.1 shared/messages.ts（新增）

三个插件各自拷贝了 `contentToText` / `extractLastUserMessage`，v0.2 上收为共享模块，并新增 token 估算。

```ts
// src/shared/messages.ts —— 完整实现，可直接复制

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
 * 启发式来源：官方 token-meter 的固定比率估计器
 * （packages/llm/token-meter/src/estimate.ts:12-19，CHARS_PER_TOKEN = 4）。
 * 不接 token-meter 服务，保持零服务依赖、可单测。
 */
export function estimateTokens(messages: readonly { content?: unknown }[]): number {
  let chars = 0
  for (const msg of messages) chars += contentToText(msg.content).length
  return Math.ceil(chars / 4)
}
```

intent-router/index.ts 与 constraint-immune/index.ts 中对应的私有函数删除，改为 `import { contentToText, extractLastUserMessage } from '../shared/messages.js'`（行为不变，v0.1 测试应保持全绿）。

### 3.2 model-router/index.ts（新增插件）

**职责**：`agent/request` 每步评估升级条件，改写 `config.model`（不动 provider / reasoningEffort / 其他字段）。

**与 intent-router 的顺序**：cordis.patch.yml 中 model-router 排在 intent-router 之后。waterfall 先注册先执行，model-router 的 `await next()` 拿到的是 intent-router 已改过的 config，展开后只覆盖 `model` 字段，两者修改并存。

**完整参考实现**（可直接复制）：

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

  // 每 agent 连续不满意轮数：agentId → count（与 constraint-immune 同款的会话 key 约定）
  const dissatisfactionStreak = new Map<string, number>()

  const customRes = config.dissatisfactionPatterns
    .filter((p) => p.length > 0)
    .map((p) => new RegExp(p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'))

  ctx.on('agent/request', async (payload: RequestPayload, next: () => Promise<CallConfig>): Promise<CallConfig> => {
    const callConfig = await next()
    if (payload.signal.aborted) return callConfig

    const messages = payload.agent.session.deriveMessages()
    const lastUser = extractLastUserMessage(messages)

    // C3：更新连续不满意计数（最近一条用户消息命中则 +1，否则清零）
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

    // 只改 model，provider 与其余字段原样保留（PRD 3.1.3 / AC-6）
    return { ...callConfig, model: decision.upgrade ? config.proModel : config.defaultModel }
  })
}
```

**注意点**：

1. `streak` 用的是"本次请求前"的计数语义：第二条连续不满意消息所在的请求即达到 2，满足 PRD"连续两轮不满意 → 升级"（第三条用户消息不命中则清零回落，PRD 3.1.2）。
2. 工具循环内的后续 step 没有新用户消息时，`lastUser` 仍是同一句话。简化处理：v0.2 接受"同一句话在多 step 重复计数"——一句"不对，重来"在多 step 回合里可能直接达到 2 → 升 Pro。该行为与"用户不满意时给更强模型"的意图一致，属于可接受的近似；精确去重需要记录已见消息 id，列入 v0.3 优化。

### 3.3 constraint-immune v0.2 扩展

v0.1 文件结构不变，只改 `src/constraint-immune/index.ts`（extractor.ts 不动）。

#### 3.3.1 Config 追加 interception 字段

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

#### 3.3.2 StoredConstraint 追加 positiveChecked 标记

```ts
/** 约束 + 首次出现的消息下标 + 肯定型一次性检查标记 */
type StoredConstraint = Constraint & { messageIndex: number; positiveChecked?: boolean }
```

#### 3.3.3 肯定型"缺少执行"一次性检查（追加在 v0.1 否定型检查之后）

位置：`agent/pre-step` listener 内，否定型检查循环之后、`session.checkedUpTo = messages.length` 之前。逻辑：

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

#### 3.3.4 执行时拦截（新增 listener）

位置：`apply` 内，pre-step listener 之后追加：

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

**注意**：`sessions` Map 与 pre-step listener 共享同一个闭包变量——约束在 pre-step 提取，拦截在 tools/pre-execute 读取，两个 listener 通过闭包自然共享会话状态，无需额外机制。

### 3.4 cordis.patch.yml 变更

```yaml
# oh-my-dsh bundle patch：一次 insert 全部插件（v0.2）
- insert:
    - id: intent-router
      name: oh-my-dsh/lib/src/intent-router/index.js
      config:
        enabled: true

    - id: model-router              # v0.2 新增；置于 intent-router 之后（同挂 agent/request，先注册先执行）
      name: oh-my-dsh/lib/src/model-router/index.js
      config:
        enabled: true
        defaultModel: deepseek-v4-flash
        proModel: deepseek-v4-pro
        upgradeIntents: [architecture, research]
        tokenThreshold: 30000
        dissatisfactionEnabled: true
        dissatisfactionPatterns: []

    - id: cognition-gate
      name: oh-my-dsh/lib/src/cognition-gate/index.js
      config:
        layers: { l1: true, l2: true, i02: true, i08: true }
        excludePatterns: []

    - id: constraint-immune
      name: oh-my-dsh/lib/src/constraint-immune/index.js
      config:
        enabled: true
        customPatterns: []
        interception: deny          # v0.2 新增
```

## 4. 与 v0.1 架构的差异

| 维度 | v0.1 | v0.2 | 原因 |
|---|---|---|---|
| 插件数 | 3 | 4（+model-router） | PRD P0-1 |
| 挂钩点 | agent/request、agent/pre-step | + tools/pre-execute | PRD P0-2 |
| 消息工具函数 | 三个插件各自私有拷贝 | 上收 src/shared/messages.ts | model-router 也需要，三份拷贝变四份前收编 |
| constraint-immune Config | enabled / customPatterns | + interception（默认 deny） | 行为变化，Release Notes 需声明 |
| StoredConstraint | raw/keyword/kind/messageIndex | + positiveChecked | PRD P1 一次性检查 |
| 模型选择 | profile 固定 | 每步动态（flash ⇄ pro） | PRD P0-1 |
| 插件执行顺序 | 无敏感顺序 | patch 中 model-router 必须在 intent-router 之后（约定，非强制） | 便于阅读最终 config 的形成顺序 |

**v0.1 行为兼容性**：intent-router / cognition-gate 零行为变化；constraint-immune 默认从"纯提醒"变为"提醒 + 拦截"，是唯一的行为变化点。

## 5. 风险与对策

| 风险 | 概率 | 对策 |
|---|---|---|
| dsh rc 版本 tools/* 事件签名漂移 | 中 | 实现前先核对 tools/src/index.ts:152 签名文本；peerDependencies 维持 `*` |
| 关键词拦截误伤正常工具调用 | 中 | 仅否定型 + 关键词 ≥4 字符 + `interception: 'off'` 逃生门 |
| model-router 与 intent-router 同挂 agent/request 的顺序敏感 | 低 | 两者改不同字段，展开合并不互相覆盖；patch 顺序仅作阅读约定 |
| 不满意正则误判正常对话 | 中 | 需连续 2 轮才升级；patterns 可配置；single 轮命中不升级 |
| estimateTokens 启发式偏差（CJK 文本 chars/4 偏高估） | 低 | 阈值默认 30000 留有裕量；可在 Config 调阈值 |

---

## 附录 A：12 创新点源码调研证据（dsh v0.1.0-rc.5）

### A.1 I-03 注意力预算 → 推 v0.3 评估

- token-meter 只提供测量与投影，无强制预算：
  - `measure(session, requestHeader?)`：packages/llm/token-meter/src/index.ts:116-147
  - contextPressure 投影（pressureTokens / projectedTokens / contextWindow，只读投影不强制）：packages/llm/token-meter/src/projection.ts:30-48
  - 估算启发式常量 CHARS_PER_TOKEN=4 等：packages/llm/token-meter/src/estimate.ts:12-19
- 结论：可做"预算感知"插件，但价值未证，推 v0.3。

### A.2 I-04 KV Cache → 不做（官方已覆盖）

- request/header 快照只在 initial/resume/change 时记录：packages/core/agent-loop/src/agent.ts:464-470；canonical 化与相等性：packages/core/session/src/request-header.ts:21-54
- 请求体构建即冻结：packages/core/agent-loop/src/agent.ts:486-493（markAgentLoopRequest + deepFreeze）
- system prompt 装配顺序稳定（section/context 升序、工具字典序）：packages/core/system-prompt/src/index.ts:467-542
- compaction 摘要复用本会话 system/tools/消息前缀：packages/compaction/compaction-basic/src/region.ts:498-514
- DeepSeek adapter 的 cache 命中记账：packages/llm/llm-deepseek/src/translate.ts:53-62

### A.3 I-13 Byte Stability → 不做

- dsh 无此概念。spill-policy 的 maxInlineBytes 是工具结果内联字节上限，语义不同：packages/spill/spill-policy/src/index.ts:60-119

### A.4 I-06 PlanGraph → 推 v0.3

- plan 域只有 plan-mode 状态开关，无图 API：
  - `ctx.planMode` 服务声明：packages/plan/plan-mode/src/index.ts:57-61
  - `get(agent)` / `set(agent, active)`：packages/plan/plan-mode/src/index.ts:403-407、425-445
  - `plan/mode` 会话事件：packages/plan/plan-mode/src/index.ts:46-55
- 实现 PlanGraph 需新增 SessionEventMap 事件 + session projection（projection 注册机制：packages/session/session-projection/src/index.ts；plan-mode 的注册示例：plan-mode/src/index.ts:244-266）。

### A.5 I-11 Checkpoint → 推 v0.3

- session-checkpoint-policy 是持久化 flush 策略，不是快照/回滚：
  - 触发点 llm/stream、tools/execute、agent/pre-step → `ctx.sessions.flush(session)`：packages/session/session-checkpoint-policy/src/index.ts:14-83
- 无 createCheckpoint/restoreCheckpoint API；最接近的是前缀分叉 `SessionStore.fork(...)`：packages/core/session/src/index.ts:1081-1095
- 回滚需要新的 Session 语义（快照事件 + 重放边界），超出 v0.2。

### A.6 I-12 Memory 编译 → v0.2 备选（stretch）

可用接缝（全部源码核实）：
- system prompt 贡献：`ctx.systemPrompt.section/context/variable`：packages/core/system-prompt/src/index.ts:381-390、398-407、446-455
- 消息态注入：`agent/pre-step`（runtime-types.ts:231）；官方示例 time-context：packages/context/time-context/src/index.ts:170-208
- 历史压缩：`ctx.compaction`（CompactionEngine）：packages/compaction/compaction/src/index.ts:81-84、96-170
- 最小形态：一个静态 `systemPrompt.section` 把"记忆要点"编译进系统提示。

### A.7 I-14 Reasoning Replay → 不做

- reasoning 在类型上是 ContentBlock 的一种：packages/llm/llm/src/types.ts:59-63（ReasoningBlock）、:99-105（ContentBlockMap）、:294（reasoning-delta）
- `replayState` 是 adapter 私有的响应续传状态，跨 adapter 被剥离：packages/llm/llm/src/types.ts:299-303；packages/llm/llm/src/message.ts:8-19；剥离逻辑 packages/llm/llm/src/index.ts:822-836
- 类型上可向 messages 塞 reasoning block，但 adapter 是否转发无保证 → 不可靠，放弃。

### A.8 I-07 审查路由 → v0.2 备选（stretch）

- 无 post-output / pre-tool 挂钩；step 内 assistant 消息一落盘就执行工具：packages/core/agent-loop/src/agent.ts:373-399
- 可用事件清单：runtime-types.ts:159-290（agent/created、agent/status、agent/inbox/*、agent/session-start:217、agent/pre-step:231、agent/request:244、agent/request-error:260、agent/turn-stopping:278、agent/error:290）
- 间接实现（两步舞）：`agent/turn-stopping`（runtime-types.ts:278）观察 → `agent.steer(...)`（runtime-types.ts:117-143）注入审查指令 → 下一 step 的 `agent/request` 切审查模型。

## 附录 B：变更记录

| 日期 | 内容 | 来源 |
|---|---|---|
| 2026-08-14 | 初版，基于 v0.1 修复后代码 + 4 路 dsh 源码调研 | v0.2 规划任务 |
