# oh-my-dsh 技术架构文档

> 版本：v0.1.0 | 日期：2026-08-13 | 状态：待评审
> 面向 AI 执行者：每个模块的文件路径、函数签名、事件挂钩点都已明确，可直接对照编码。

## 1. 架构总览

### 1.1 定位：dsh 平台的一个 bundle

oh-my-dsh 是 dsh（DeepSeek Harness）的一个 **bundle**——一个 npm 包，通过 `cordis.patch.yml` 声明它向平台插入哪些插件行。用户执行 `dsh plugin add oh-my-dsh` 后，bundle 的 patch 层被应用到用户 profile，内部 4 个小插件被挂载。

```
用户 profile 配置树（cordis.yml）
  └── - include: oh-my-dsh/cordis.patch.yml   ← bundle 层（本仓库提供）
        ├── intent-router 插件（agent/request）
        ├── cognition-gate 插件（agent/pre-step）
        ├── constraint-immune 插件（agent/pre-step；tools/* 拦截列入 v0.2）
        └── model-router 插件（v0.2）
```

### 1.2 技术栈

| 层 | 选型 | 理由 |
|---|---|---|
| 语言 | TypeScript 5.x | dsh 平台要求 |
| 运行时 | Node.js 22.19+ | dsh 引擎下限 |
| 包管理 | pnpm 11.7 | 与 dsh 官方一致 |
| 测试 | vitest | 与 dsh 官方一致 |
| Schema | @deepseek-ai/schemastery | 官方 Config 校验 |
| 构建 | tsc → ESM | 官方插件是 ESM 模块 |
| 发布 | npm（dsh.bundle manifest） | 官方插件分发形式 |

**零额外依赖**：除 dsh 官方包（@deepseek-ai/cordis / @deepseek-ai/dsh-tools / @deepseek-ai/schemastery）外，不引入任何第三方库。意图分类用纯正则+字符串操作，硬约束提取用正则，不需要 NLP 库。

### 1.3 仓库结构

```
oh-my-dsh/
├── package.json            # npm 包定义 + dsh.bundle manifest
├── tsconfig.json           # strict + noImplicitAny
├── cordis.patch.yml        # bundle 层：insert 4 个插件
├── src/
│   ├── intent-router/
│   │   ├── index.ts        # 插件入口（apply/inject/Config）
│   │   ├── classifier.ts   # 意图分类核心（从 intent_router.py 移植）
│   │   └── strategies.ts   # 7+1 意图策略绑定表（从 strategies.yaml 移植）
│   ├── cognition-gate/
│   │   ├── index.ts        # 插件入口
│   │   └── injector.ts     # 认知导航注入（从 gate.py 移植）
│   ├── constraint-immune/
│   │   ├── index.ts        # 插件入口
│   │   └── extractor.ts    # 硬约束提取+检查（从 gate.py/immune_audit.py 移植）
│   └── shared/
│       └── types.ts        # 共享类型（Intent / Strategy / Config）
├── tests/
│   ├── intent-router/
│   │   ├── classifier.test.ts   # 意图分类 fixture 测试
│   │   └── fixtures.ts          # 20+ 条中英文测试用例
│   ├── cognition-gate/
│   │   └── injector.test.ts
│   ├── constraint-immune/
│   │   └── extractor.test.ts
│   └── e2e/
│       └── install.test.ts      # 模拟 dsh plugin add 安装
├── docs/
│   ├── 01-prd.md
│   ├── 02-architecture.md
│   ├── 03-plan.md
│   └── 04-testing.md
└── README.md
```

## 2. 插件机制：官方 API 精确签名

以下 API 全部从 dsh v0.1.0-rc.5 源码验证，AI 执行者可按此编码。

### 2.1 插件入口

每个插件是一个 TS 模块，导出 `name` + `apply` + 可选 `inject` + 可选 `Config`：

```ts
import type { Context } from '@deepseek-ai/cordis'

export const name = 'intent-router'
// v0.1 不声明 inject：实测 inject: ['llm'] 会导致 profile 启动挂起
// （cordis 等待服务就绪与加载顺序死锁）。本 bundle 只用事件挂钩，
// 事件监听器在服务注册前挂上即可正常触发，无需 inject。

export function apply(ctx: Context, config: Config) {
  // 在这里注册事件监听
}
```

**来源**：dsh 官方文档 docs/user/develop/basic/index.md（第一个插件教程）

### 2.2 事件挂钩点

#### agent/pre-step（瀑布事件，可改写模型输入）

```ts
// 精确签名（packages/core/agent/src/runtime-types.ts:231）
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

// PreStepDecision 类型（runtime-types.ts:53）
type PreStepDecision =
  | { kind: 'reject' }
  | { kind: 'enter'; messages: UserMessage[] }
```

**注册方式已验证**（从 dsh 官方插件源码确认）：通过 `ctx.on('agent/pre-step', async (payload, next) => {...})` 注册。官方 compaction-basic（packages/compaction/compaction-basic/src/index.ts:147）、agent-instructions、time-context、tool-cordis 都是这么挂钩的。

**payload.turn 起始值**：从 0 开始（turn 0 是第一轮）。判断"首轮"用 `payload.turn === 0`。

**用法**：cognition-gate 和 intent-router 挂钩此事件，改写 `payload.messages`，返回 `{ kind: 'enter', messages: modified }` 或 `return next()`。

```ts
// cognition-gate 插件中的挂钩示例（已验证写法，参考 compaction-basic）
ctx.on('agent/pre-step', async ({ agent, messages, turn, signal }, next): Promise<PreStepDecision> => {
  if (signal.aborted) return next()
  const injected = injectCognition(messages, turn, config)
  return { kind: 'enter', messages: injected }
})
```

#### llm/stream（瀑布事件，包裹 LLM 调用流）

```ts
// 精确签名（packages/llm/llm/src/index.ts:64）
'llm/stream'(
  this: LlmRuntime,
  options: GenerateOptions,
  next: () => AsyncIterable<StreamChunk>
): AsyncIterable<StreamChunk>
```

**注册方式已验证**（从 dsh 官方插件源码确认）：通过 `ctx.on('llm/stream', (options, next) => {...})` 注册。官方 invariant.ts（packages/core/agent-loop/src/invariant.ts:21）就是这么挂钩的。listener 接收 `(options, next)` 两个参数，返回 `next()` 的结果或包装后的流。

**GenerateOptions 关键字段**（packages/llm/llm/src/call-config.ts）：
- `model: string` — 模型 ID
- `reasoningEffort?: ReasoningEffortId` — 推理强度（'max' | 'high' | 'medium' 等）
- `messages` — 消息数组（冻结的，不可直接修改，需创建新数组）
- `sessionId?: SessionId` — 会话 ID
- `system?: string` — system prompt
- `temperature?: number` / `maxTokens?: number` / `stop?: string[]`

**提取最后一条用户消息**（从 messages 数组）：
```ts
// messages 是冻结数组，元素为 UserMessage | AssistantMessage | ...
// UserMessage 有 role: 'user' 和 content: string | ContentPart[]
function extractLastUserMessage(messages: readonly unknown[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i] as { role?: string; content?: unknown }
    if (msg.role === 'user') {
      if (typeof msg.content === 'string') return msg.content
      if (Array.isArray(msg.content)) {
        return msg.content.map((p: any) => (p?.type === 'text' ? p.text : '')).join('')
      }
    }
  }
  return ''
}
```

**注意（v0.1 review R1 实测）**：agent-loop 派发前对 request 做 `deepFreeze`，且 cordis waterfall 的 `next()` 不透传参数（listener 共享同一个 options 引用，重新赋值会被丢弃，原地 mutate 会抛错）。**不能在此事件改写 reasoningEffort**——改写调用配置请用下面的 `agent/request`。

#### agent/request（瀑布事件，dsh 设计的调用配置改写通道）

```ts
// 精确签名（packages/core/agent/src/runtime-types.ts:244）
'agent/request'(
  this: Scoped<Agent>,
  payload: { agent: Agent; turn: number; step: number; signal: AbortSignal },
  next: () => Promise<LlmCallConfig>
): Promise<LlmCallConfig>
```

listener 在 unwind 阶段返回修改后的 config，agent-loop 会把变更记入 `request/header` 快照（packages/core/agent-loop/src/agent.ts buildRequest）。

```ts
// intent-router 插件中的挂钩示例（已验证写法）
ctx.on('agent/request', async ({ agent, signal }, next) => {
  const callConfig = await next()
  if (signal.aborted) return callConfig
  const lastMsg = extractLastUserMessage(agent.session.deriveMessages())
  const { intent } = classifyIntent(lastMsg, strategies)
  const effort = config.effortMap[intent]
  return effort ? { ...callConfig, reasoningEffort: effort } : callConfig
})
```

#### tools 注册（inject 服务）

```ts
// 工具注册 DSL（docs/user/develop/basic/tool.md）
import { defineTool } from '@deepseek-ai/dsh-tools'

ctx.tools.register(defineTool({
  name: 'tool-name',
  description: 'Tool description.',
  parameters: { /* schema */ },
  output: {
    schema: { type: 'string' },
    render: (_args, value) => [{ type: 'text', text: value }],
  },
  async execute(args) { return result },
}))
```

v0.1 不注册新工具，仅使用事件挂钩。constraint-immune 的检查通过 `agent/pre-step` 中改写 messages 实现（在模型生成前注入约束提醒）。

### 2.3 Config Schema（Schemastery）

每个插件的可调参数通过同名 `Config` 导出（类型 + Schema）：

```ts
import Schema from '@deepseek-ai/schemastery'

export interface Config {
  enabled: boolean
  effortMap: Record<string, string>
}

export const Config: Schema<Config> = Schema.object({
  enabled: Schema.boolean().default(true),
  effortMap: Schema.dict(Schema.string()).default({
    architecture: 'max',
    research: 'max',
    collaboration: 'max',
    refactor: 'high',
    new: 'high',
    medium: 'high',
  }),
})
```

**来源**：dsh 官方文档 docs/user/develop/basic/config.md

### 2.4 生命周期与清理

通过 `ctx` 注册的所有内容（事件监听、工具）在插件卸载时自动清理。需要手动清理的资源用 `ctx.effect()`：

```ts
ctx.effect(() => {
  const timer = setInterval(() => { /* ... */ }, 5000)
  return () => clearInterval(timer)  // 卸载时执行
})
```

## 3. 核心模块设计

### 3.1 intent-router 插件

**文件**：`src/intent-router/classifier.ts`

**核心函数**（从 intent_router.py 1:1 移植）：

```ts
// 意图类型（7+1）
export type Intent =
  | 'refactor' | 'new' | 'medium' | 'collaboration'
  | 'architecture' | 'research' | 'simple' | 'spec_driven'

// 分类结果
export interface Classification {
  intent: Intent
  confidence: number  // [0.0, 1.0]
}

// 关键词匹配得分（从 keyword_match_score 移植）
export function keywordMatchScore(keyword: string, text: string): number

// 意图分类（从 classify_intent 移植）
export function classifyIntent(
  taskDescription: string,
  strategies: Strategies
): Classification
```

**分类算法**（精确伪代码，AI 可直接翻译为 TS）：

```
function classifyIntent(text, strategies):
  scores = {}
  for each (intentName, intentConfig) in strategies.intents:
    score = 0
    for each keyword in intentConfig.keywords:
      match = keywordMatchScore(keyword, text)
      if match >= 0.5: score += match
    if score > 0: scores[intentName] = score

  if scores is empty: return { intent: 'spec_driven', confidence: 0.0 }

  ranked = sort scores by value descending
  best = ranked[0], second = ranked[1] or 0
  confidence = best / (best + second)  // 恒 ≥ 0.5，仅作观测值

  return { intent: best.name, confidence }

function keywordMatchScore(keyword, text):
  if keyword.toLowerCase() in text.toLowerCase(): return 1.0
  cjkChars = extract CJK characters from keyword
  if cjkChars is empty: return 0.0
  kwCJK = join cjkChars
  cjkText = extract CJK characters from text, joined
  if cjkText is empty: return 0.0
  if kwCJK.length <= 2: return 0.0
  kwChars = unique chars in kwCJK
  matches = count of kwChars that appear in cjkText
  return matches / kwCJK.length
```

**策略绑定表**（`src/intent-router/strategies.ts`，从 strategies.yaml 移植）：

每个意图包含：description / keywords[] / strategy{interview_depth, plan_granularity, review_standard, execution_mode} / common_creep[]。v0.1 仅使用 keywords（分类）和 common_creep（排除清单），strategy 字段保留供 v0.2 使用。

### 3.2 cognition-gate 插件

**文件**：`src/cognition-gate/injector.ts`

**核心函数**（从 gate.py 移植）：

```ts
export interface InjectionConfig {
  layers: {
    l1: boolean   // 荣辱观
    l2: boolean   // 思维方式
    i02: boolean  // 双向原语
    i08: boolean  // 范围控制
  }
  excludePatterns: string[]  // 匹配这些模式的消息不注入
}

// 首轮完整注入文本（从 _I02_FULL / _I08_FULL / L1/L2 移植）
const FULL_INJECTION = `[L1 荣辱观] ...`

// 后续轮精简注入文本（从 _I02_BRIEF / _I08_BRIEF 移植）
const BRIEF_INJECTION = `[L1] ...`

export function buildInjection(turn: number, config: InjectionConfig): string
```

**注入逻辑**：`turn === 0` 注入完整版，`turn > 0` 注入精简版。注入方式：在最后一条 UserMessage 末尾追加注入文本（`\n\n${injection}`），不新增消息（避免消息数膨胀）。

### 3.3 constraint-immune 插件

**文件**：`src/constraint-immune/extractor.ts`

**核心函数**（从 gate.py extract_hard_constraints + immune_audit.py 移植）：

```ts
// 约束分两类：否定型（不能/不要/禁止…）命中算违规；肯定型（必须…）只记录不判定
export interface Constraint {
  raw: string      // 约束原文（含前缀）
  keyword: string  // 去掉前缀后的关键词
  kind: 'negative' | 'positive'
}

// customPatterns：用户自定义约束前缀，按否定型处理
export function extractHardConstraints(
  userMessage: string,
  customPatterns?: string[]
): Constraint[]

// 只判定否定型约束
export function checkAgainstConstraints(
  text: string,
  constraints: Iterable<Constraint>
): { violated: boolean; matched?: string }
```

**插件内部状态**：`Map<sessionId, { constraints, checkedUpTo }>`；sessionId 取 `payload.agent.id`（拿不到则退化为单桶）。每条约束记录首次出现的消息下标。

**检查逻辑**：在 `agent/pre-step` 中，只把"约束首次出现之后、上一轮检查之后"的新 assistant 消息与否定型约束比对，命中则在 messages 末尾追加约束提醒。不拼全部历史（用户约束原文会自我触发），提醒文本不参与再提取（避免自我复制）。

### 3.4 bundle 层：cordis.patch.yml

```yaml
# oh-my-dsh bundle：一次 insert 全部插件
- insert:
    - id: intent-router
      name: oh-my-dsh/lib/src/intent-router/index.js   # 指向编译产物（tsconfig include 含 src+tests，输出落在 lib/src/）
      config:
        enabled: true

    - id: cognition-gate
      name: oh-my-dsh/lib/src/cognition-gate/index.js
      config:
        layers: { l1: true, l2: true, i02: true, i08: true }

    - id: constraint-immune
      name: oh-my-dsh/lib/src/constraint-immune/index.js
      config:
        enabled: true
```

用户可通过 profile 的 cordis.yml 覆盖任何插件的 config 或禁用（`disabled: true`）。

## 4. 与 oh-my-deepseek-harness 的关键差异

| 维度 | oh-my (Python/Hermes) | oh-my-dsh (TS/dsh) |
|---|---|---|
| 推理强度控制 | 文本提示注入（hook 限制） | agent/request 瀑布改写 reasoningEffort 调用配置 |
| 认知注入位置 | pre_llm_call hook | agent/pre-step 瀑布事件 |
| 硬约束检查 | immune_audit.py（执行后） | agent/pre-step（生成前预防） |
| 安装方式 | install.sh 脚本 | dsh plugin add（npm 包） |
| 配置方式 | YAML 文件 | Config Schema + cordis.yml |

**DSH 版更强的原因**：dsh 的 `agent/request` 瀑布允许直接改写调用配置（reasoningEffort），而 Hermes 的 pre_llm_call hook 只能注入文本。这是平台能力差异带来的升级。
