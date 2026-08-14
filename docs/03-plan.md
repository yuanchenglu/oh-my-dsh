# oh-my-dsh 技术规划文档（v2）

> 版本：v0.2.0 | 日期：2026-08-14 | 状态：待评审
> 面向弱 AI 执行者：**每个任务自包含**，拿着任务描述+文档就能独立完成，无需追问。
> **支持并行**：M1/M2/M3 三个插件互不依赖，可派 3 个子代理同时开发。

## 1. 执行策略：并行子代理

```
M0（仓库搭建，0.5天）
  │
  ├── 子代理 A ── M1（intent-router，1天）
  ├── 子代理 B ── M2（cognition-gate，1天）    ← 三个子代理并行
  └── 子代理 C ── M3（constraint-immune，0.5天）
  │
  └── M4（bundle 打包 + 安装验证，0.5天）← 等 A/B/C 全部完成
        └── M5（测试 + 文档，0.5天）
```

**并行前提**：M0 完成后，三个插件的文件路径互不重叠（各自独立目录），无共享状态。

## 2. M0：仓库搭建（0.5 天，串行）

### 任务 M0-1：创建仓库骨架

**输入**：无
**输出**：可运行的空插件项目

**执行步骤**（按顺序）：

1. 创建目录结构：
```sh
mkdir -p oh-my-dsh/{src/{intent-router,cognition-gate,constraint-immune,shared},tests/{intent-router,cognition-gate,constraint-immune,integration,e2e}}
cd oh-my-dsh && git init
```

2. 创建 `package.json`：
```json
{
  "name": "oh-my-dsh",
  "version": "0.1.0",
  "type": "module",
  "main": "src/index.ts",
  "files": ["src", "cordis.patch.yml"],
  "dsh": { "bundle": { "patch": "./cordis.patch.yml" } },
  "scripts": {
    "test": "vitest run",
    "typecheck": "tsc --noEmit",
    "build": "tsc"
  },
  "devDependencies": {
    "typescript": "^5.5.0",
    "vitest": "^3.0.0"
  },
  "peerDependencies": {
    "@deepseek-ai/cordis": "*",
    "@deepseek-ai/dsh-tools": "*",
    "@deepseek-ai/schemastery": "*"
  }
}
```

3. 创建 `tsconfig.json`：
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ES2022",
    "moduleResolution": "bundler",
    "strict": true,
    "noImplicitAny": true,
    "outDir": "lib",
    "declaration": true,
    "esModuleInterop": true,
    "skipLibCheck": true
  },
  "include": ["src", "tests"]
}
```

4. 创建 `vitest.config.ts`：
```ts
import { defineConfig } from 'vitest/config'
export default defineConfig({
  test: { include: ['tests/**/*.test.ts'] },
})
```

5. 创建 `src/shared/types.ts`（所有插件共享的类型）：
```ts
/** 意图类型（7+1） */
export type Intent =
  | 'refactor' | 'new' | 'medium' | 'collaboration'
  | 'architecture' | 'research' | 'simple' | 'spec_driven'

/** 意图分类结果 */
export interface Classification {
  intent: Intent
  confidence: number
}

/** 意图配置 */
export interface IntentConfig {
  description: string
  keywords: string[]
  common_creep: string[]
}

/** 策略表 */
export type Strategies = Record<Intent, IntentConfig>
```

6. 创建空 `cordis.patch.yml`（占位，M4 填充）：
```yaml
# oh-my-dsh bundle patch
- insert: []
```

7. `pnpm install`

**验收**：`pnpm run typecheck` 通过 + `pnpm vitest run` 通过（0 测试也算通过）

## 3. M1：intent-router 插件（子代理 A，1 天）

### 任务 M1-1：策略表（strategies.ts）

**输入**：无（数据在本文档中）
**输出**：`src/intent-router/strategies.ts`

**执行**：创建文件，内容如下（完整代码，直接复制）：

```ts
import type { Strategies } from '../shared/types.js'

/** 7+1 意图策略绑定表（从 oh-my-deepseek-harness strategies.yaml 移植） */
export const strategies: Strategies = {
  refactor: {
    description: '在已有代码基础上改变结构而不改变外部行为',
    keywords: ['重构', '拆', '拆分', '迁移', 'restructure', 'refactor', '模块拆分', '重组', '重写'],
    common_creep: ['不新增功能', '不修改 API 契约', '不引入新依赖', '不改数据库 schema'],
  },
  new: {
    description: '从零开始构建新项目或新功能',
    keywords: ['新建', '从零', '创建', 'new', 'create', '项目', '初始化', '生成'],
    common_creep: ['不加权限系统', '不加 OAuth', '不加多租户', '不加 CI/CD'],
  },
  medium: {
    description: '在现有项目中添加或修改中等规模功能',
    keywords: ['添加', '修改', '更新', '增加', 'add', 'modify', '功能', '扩展'],
    common_creep: [],
  },
  collaboration: {
    description: '多 Agent 或人机协作',
    keywords: ['协作', '多人', '分派', '并行', 'collaborate', 'parallel', 'team', '分工'],
    common_creep: ['不急的优化', '不要额外协调轮次'],
  },
  architecture: {
    description: '系统级架构设计和决策',
    keywords: ['架构', '设计', '选型', 'architecture', 'design', 'system', '系统', '方案'],
    common_creep: [],
  },
  research: {
    description: '探索性任务，产出知识和建议',
    keywords: ['调研', '分析', '探索', 'research', 'analyze', '研究', '对比', '评估'],
    common_creep: [],
  },
  simple: {
    description: '单文件或极少文件的明确修改',
    keywords: ['修复', '改', 'bug', 'fix', 'typo', '一行', '小改'],
    common_creep: [],
  },
  spec_driven: {
    description: '基于结构化 Spec 推导策略（兜底）',
    keywords: [],
    common_creep: [],
  },
}
```

**验收**：`pnpm run typecheck` 通过

### 任务 M1-2：意图分类器（classifier.ts）

**输入**：M1-1 的 strategies.ts + 本文档中的算法伪代码
**输出**：`src/intent-router/classifier.ts`

**算法**（精确伪代码，直接翻译为 TS）：

```
CJK_RE = /[\u4e00-\u9fff]+/g

function keywordMatchScore(keyword, text):
  // 1. 精确子串匹配
  if keyword.toLowerCase() in text.toLowerCase(): return 1.0
  // 2. 提取 CJK 字符
  cjkChars = keyword.match(CJK_RE) — 如果无匹配 return 0.0
  kwCJK = cjkChars.join('')
  cjkText = (text.match(CJK_RE) or []).join('')
  if cjkText is empty: return 0.0
  // 3. 短 CJK（≤2字）：仅精确匹配
  if kwCJK.length <= 2: return 0.0
  // 4. 长 CJK（≥3字）：字符重叠比例
  kwChars = unique chars in kwCJK
  matches = count of kwChars that appear in cjkText
  return matches / kwCJK.length

function classifyIntent(taskDescription, strategies):
  scores = {}
  for each (intentName, intentConfig) in strategies:
    if intentConfig.keywords is empty: continue
    score = 0
    for each keyword in intentConfig.keywords:
      match = keywordMatchScore(keyword, taskDescription)
      if match >= 0.5: score += match
    if score > 0: scores[intentName] = score

  if scores is empty: return { intent: 'spec_driven', confidence: 0.0 }

  ranked = sort scores entries by value descending
  best = ranked[0], second = ranked[1] or [null, 0]
  confidence = best[1] / (best[1] + second[1])

  if confidence < 0.5: return { intent: 'spec_driven', confidence }
  return { intent: best[0], confidence }
```

**验收**：`tests/intent-router/classifier.test.ts` 全部通过

### 任务 M1-3：意图分类测试

**输入**：M1-2 的 classifier.ts
**输出**：`tests/intent-router/fixtures.ts` + `tests/intent-router/classifier.test.ts`

**fixtures.ts**（20+ 条测试用例，直接复制）：

```ts
import type { Intent } from '../../src/shared/types.js'

export interface Fixture {
  input: string
  expectedIntent: Intent
  minConfidence: number
}

export const fixtures: Fixture[] = [
  // refactor（fixtures[0-3]）
  { input: '帮我重构这个模块，拆分成更小的函数', expectedIntent: 'refactor', minConfidence: 0.5 },
  { input: '把这个大类拆分成几个小类', expectedIntent: 'refactor', minConfidence: 0.5 },
  { input: 'refactor the authentication module', expectedIntent: 'refactor', minConfidence: 0.5 },
  { input: '迁移数据库到新的 schema', expectedIntent: 'refactor', minConfidence: 0.5 },
  // new（fixtures[4-6]）
  { input: '从零开始创建一个新的 API 服务', expectedIntent: 'new', minConfidence: 0.5 },
  { input: '新建一个 React 项目', expectedIntent: 'new', minConfidence: 0.5 },
  { input: 'create a new microservice', expectedIntent: 'new', minConfidence: 0.5 },
  // medium（fixtures[7-9]）
  { input: '在用户表中添加一个邮箱字段', expectedIntent: 'medium', minConfidence: 0.5 },
  { input: '修改登录页面的样式', expectedIntent: 'medium', minConfidence: 0.5 },
  { input: 'add a new endpoint to the API', expectedIntent: 'medium', minConfidence: 0.5 },
  // collaboration（fixtures[10-11]）
  { input: '把这个任务分派给多个 Agent 并行处理', expectedIntent: 'collaboration', minConfidence: 0.5 },
  { input: '协作完成这个功能开发', expectedIntent: 'collaboration', minConfidence: 0.5 },
  // architecture（fixtures[12-14]）
  { input: '设计一个微服务架构方案', expectedIntent: 'architecture', minConfidence: 0.5 },
  { input: '系统选型和架构设计', expectedIntent: 'architecture', minConfidence: 0.5 },
  { input: 'design the system architecture', expectedIntent: 'architecture', minConfidence: 0.5 },
  // research（fixtures[15-17]）
  { input: '调研一下市面上主流的 Agent 框架', expectedIntent: 'research', minConfidence: 0.5 },
  { input: '分析这个库的源码实现', expectedIntent: 'research', minConfidence: 0.5 },
  { input: 'compare different database solutions', expectedIntent: 'research', minConfidence: 0.5 },
  // simple（fixtures[18-19]）
  { input: '修复这个 typo', expectedIntent: 'simple', minConfidence: 0.5 },
  { input: 'fix this bug in line 42', expectedIntent: 'simple', minConfidence: 0.5 },
  // spec_driven 兜底（fixtures[20-22]）
  { input: '你好', expectedIntent: 'spec_driven', minConfidence: 0.0 },
  { input: 'the', expectedIntent: 'spec_driven', minConfidence: 0.0 },
  { input: '', expectedIntent: 'spec_driven', minConfidence: 0.0 },
]
```

**classifier.test.ts**：

```ts
import { describe, it, expect } from 'vitest'
import { classifyIntent, keywordMatchScore } from '../../src/intent-router/classifier.js'
import { strategies } from '../../src/intent-router/strategies.js'
import { fixtures } from './fixtures.js'

describe('keywordMatchScore', () => {
  it('exact substring match returns 1.0', () => {
    expect(keywordMatchScore('重构', '帮我重构代码')).toBe(1.0)
  })
  it('non-CJK keyword without match returns 0.0', () => {
    expect(keywordMatchScore('xyz', 'hello world')).toBe(0.0)
  })
  it('short CJK without exact match returns 0.0', () => {
    expect(keywordMatchScore('重构', '重新构造')).toBe(0.0)
  })
})

describe('classifyIntent', () => {
  for (const { input, expectedIntent, minConfidence } of fixtures) {
    it(`"${input.slice(0, 20)}..." → ${expectedIntent}`, () => {
      const result = classifyIntent(input, strategies)
      expect(result.intent).toBe(expectedIntent)
      expect(result.confidence).toBeGreaterThanOrEqual(minConfidence)
    })
  }
  it('empty input returns spec_driven', () => {
    expect(classifyIntent('', strategies).intent).toBe('spec_driven')
  })
  it('confidence is in [0, 1]', () => {
    const r = classifyIntent('帮我重构这个模块', strategies)
    expect(r.confidence).toBeGreaterThanOrEqual(0)
    expect(r.confidence).toBeLessThanOrEqual(1)
  })
})
```

**验收**：`pnpm vitest run tests/intent-router` 全部通过

### 任务 M1-4：插件入口（index.ts）

**输入**：M1-1 + M1-2 + 架构文档中的 agent/request 挂钩示例
**输出**：`src/intent-router/index.ts`

**执行**：创建文件，实现：
1. `export const name = 'intent-router'`
2. 不声明 inject（实测 inject: ['llm'] 导致加载顺序死锁；事件监听先于服务注册挂上即可触发）
3. `Config` interface + Schema（effortMap 可配置，默认值见 PRD 3.2 节映射表）
4. `apply(ctx, config)`：注册 `agent/request` 事件监听
   - `await next()` 拿到下游调用配置
   - 从 `payload.agent.session.deriveMessages()` 提取最后一条用户消息（用架构文档中的 `extractLastUserMessage` 函数）
   - 调用 `classifyIntent` 分类
   - 按 `config.effortMap` 返回 `{ ...callConfig, reasoningEffort: effort }`

**验收**：`pnpm run typecheck` 通过 + `tests/integration/intent-router.test.ts` 通过

## 4. M2：cognition-gate 插件（子代理 B，1 天）

### 任务 M2-1：认知注入器（injector.ts）

**输入**：本文档中的注入文本常量 + 算法
**输出**：`src/cognition-gate/injector.ts`

**注入文本常量**（完整版 + 精简版，直接复制）：

```ts
export const FULL_INJECTION = `[L1 荣辱观] 以知道自己的不足为荣、以提升认知为荣、以告诉实情为荣。不确定就说不确定。
[L2 思维方式] 第一性原理、Step by Step、假设先行、找盲区、科研严谨。
[I-02 双向原语] 可用 /propose_skill 提议固化 Skill，/trigger_self_review 请求审查。
[I-08 范围控制] 不得超出用户显式声明范围。"不加步骤能完成 = 范围蔓延，拒绝"。`

export const BRIEF_INJECTION = `[L1] 不确定就说不确定。[L2] 假设先行。[I-08] 不加步骤能完成 = 拒绝。`
```

**核心函数**：

```ts
export interface InjectionConfig {
  layers: { l1: boolean; l2: boolean; i02: boolean; i08: boolean }
  excludePatterns: string[]
}

export function buildInjection(turn: number, config: InjectionConfig): string {
  // turn === 0 → 返回 FULL_INJECTION（按 layers 过滤）
  // turn > 0 → 返回 BRIEF_INJECTION（按 layers 过滤）
}

export function injectCognition(
  messages: readonly unknown[],
  turn: number,
  config: InjectionConfig
): unknown[] {
  // 找到最后一条 role === 'user' 的消息
  // 在其 content 末尾追加 '\n\n' + buildInjection(turn, config)
  // 返回新数组（不修改原数组）
}
```

**验收**：`tests/cognition-gate/injector.test.ts` 全部通过

### 任务 M2-2：插件入口（index.ts）

**输入**：M2-1 + 架构文档中的 agent/pre-step 挂钩示例
**输出**：`src/cognition-gate/index.ts`

**执行**：
1. `export const name = 'cognition-gate'`
2. `Config` interface + Schema（layers 开关 + excludePatterns）
3. `apply(ctx, config)`：注册 `agent/pre-step` 事件监听
   - 检查 signal.aborted → return next()
   - 调用 injectCognition 改写 messages
   - return { kind: 'enter', messages: injected }

**验收**：`pnpm run typecheck` 通过 + `tests/integration/cognition-gate.test.ts` 通过

## 5. M3：constraint-immune 插件（子代理 C，0.5 天）

### 任务 M3-1：硬约束提取器（extractor.ts）

**输入**：本文档中的正则 + 算法
**输出**：`src/constraint-immune/extractor.ts`

**正则**（从 gate.py 移植）：
```ts
const HARD_CONSTRAINT_RE = /(?:不能|不要|不得|禁止|严禁|不允许|千万别|绝对不|必须)[^，。；、！？\n]{2,60}/g
```

**核心函数**：
```ts
export function extractHardConstraints(message: string): Set<string> {
  const matches = message.match(HARD_CONSTRAINT_RE)
  return new Set(matches ?? [])
}

export function checkAgainstConstraints(
  text: string,
  constraints: Set<string>
): { violated: boolean; matched?: string } {
  for (const constraint of constraints) {
    // 提取约束关键词（去掉"不要"/"必须"等前缀）
    const keyword = constraint.replace(/^(?:不能|不要|不得|禁止|严禁|不允许|千万别|绝对不|必须)/, '')
    if (text.includes(keyword)) {
      return { violated: true, matched: constraint }
    }
  }
  return { violated: false }
}
```

**验收**：`tests/constraint-immune/extractor.test.ts` 全部通过

### 任务 M3-2：插件入口（index.ts）

**输入**：M3-1 + 架构文档中的 agent/pre-step 挂钩示例
**输出**：`src/constraint-immune/index.ts`

**执行**：
1. `export const name = 'constraint-immune'`
2. `Config` Schema（enabled + customPatterns）
3. 插件内部状态：`Map<string, Set<string>>`（sessionId → constraints）
4. `apply(ctx, config)`：注册 `agent/pre-step`
   - 从新消息提取硬约束，合并到会话状态
   - 检查历史消息是否违反约束，违反则在 messages 末尾追加提醒

**验收**：`pnpm run typecheck` 通过 + `tests/integration/constraint-immune.test.ts` 通过

## 6. M4：bundle 打包 + 安装验证（0.5 天，等 M1/M2/M3 完成）

### 任务 M4-1：cordis.patch.yml

**输入**：M1/M2/M3 全部完成
**输出**：`cordis.patch.yml`

```yaml
# oh-my-dsh bundle patch：一次 insert 全部插件
- insert:
    - id: intent-router
      name: oh-my-dsh/lib/src/intent-router/index.js
      config:
        enabled: true

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
```

### 任务 M4-2：npm 打包 + dsh 安装验证

**执行**：
1. `pnpm run build`（tsc 编译到 lib/）
2. `pnpm pack` 生成 tarball
3. 在 dsh 仓库根目录：`pnpm dsh plugin --profile test add /path/to/oh-my-dsh-0.1.0.tgz`
4. 启动 `pnpm dsh web --profile test`
5. 发送"帮我重构这个模块"→ 验证 reasoningEffort 被设置为 high

**验收**：安装成功 + 3 个插件全部生效

## 7. M5：测试 + 文档（0.5 天）

### 任务 M5-1：全量测试

**执行**：`pnpm vitest run` + `pnpm run typecheck` 全部通过

### 任务 M5-2：README

**输出**：`README.md`（安装/配置/使用说明，中英文）

## 8. 子代理任务分配卡

### 子代理 A：intent-router（M1）

**输入文件**：
- 本文档 M1 节（任务 M1-1 到 M1-4）
- 架构文档 2.2 节（agent/request 挂钩示例）
- 架构文档 3.1 节（分类算法伪代码）

**输出文件**：
- `src/shared/types.ts`（M0 已创建，A 不需要改）
- `src/intent-router/strategies.ts`
- `src/intent-router/classifier.ts`
- `src/intent-router/index.ts`
- `tests/intent-router/fixtures.ts`
- `tests/intent-router/classifier.test.ts`
- `tests/integration/intent-router.test.ts`

**验收**：`pnpm vitest run tests/intent-router tests/integration/intent-router` 全部通过

### 子代理 B：cognition-gate（M2）

**输入文件**：
- 本文档 M2 节（任务 M2-1 到 M2-2）
- 架构文档 2.2 节（agent/pre-step 挂钩示例）
- 架构文档 3.2 节（注入逻辑）

**输出文件**：
- `src/cognition-gate/injector.ts`
- `src/cognition-gate/index.ts`
- `tests/cognition-gate/injector.test.ts`
- `tests/integration/cognition-gate.test.ts`

**验收**：`pnpm vitest run tests/cognition-gate tests/integration/cognition-gate` 全部通过

### 子代理 C：constraint-immune（M3）

**输入文件**：
- 本文档 M3 节（任务 M3-1 到 M3-2）
- 架构文档 2.2 节（agent/pre-step 挂钩示例）
- 架构文档 3.3 节（提取+检查逻辑）

**输出文件**：
- `src/constraint-immune/extractor.ts`
- `src/constraint-immune/index.ts`
- `tests/constraint-immune/extractor.test.ts`
- `tests/integration/constraint-immune.test.ts`

**验收**：`pnpm vitest run tests/constraint-immune tests/integration/constraint-immune` 全部通过

## 9. 风险与对策

| 风险 | 概率 | 对策 |
|---|---|---|
| dsh API 在 Developer Preview 期间变更 | 中 | 锁定 v0.1.0-rc.5 开发，peerDependencies 用 `*` |
| options.messages 冻结导致修改失败 | 低 | 架构文档已注明需创建新数组 |
| 意图分类准确率不足 | 中 | fixture 覆盖，Config 允许自定义关键词 |
| 子代理间文件冲突 | 低 | 各自独立目录，shared/types.ts 由 M0 预先创建 |

## 10. 技术债务（已知未覆盖）

以下 12 个创新点未纳入 v0.1 规划，原因分三类：

| 类别 | 创新点 | 原因 | 解锁条件 |
|---|---|---|---|
| dsh 已有等价物 | I-03 注意力预算 / I-04 KV Cache / I-13 Byte Stability | 官方已做，需想清楚差异化再动手 | 读完官方 compaction/prefix 源码后评估 |
| 需要 dsh 深层 API | I-06 PlanGraph / I-11 Checkpoint / I-12 Memory 编译 | 官方开发文档未覆盖 plan/memory/session 服务的插件接口 | 读 dsh 源码中对应服务的 inject/provide 接口 |
| 平台能力差异 | I-14 Reasoning Replay / I-07 审查路由 | Hermes 特有 hook，需确认 dsh 等价挂钩点 | 读 dsh 源码确认是否有等价事件 |

**处理策略**：v0.1 先跑通 3 个插件（intent-router / cognition-gate / constraint-immune），同时并行读 dsh 源码补全剩余 12 个的映射规划，出 v0.2 规划文档。
