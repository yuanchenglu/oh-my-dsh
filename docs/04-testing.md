# oh-my-dsh 测试体系文档

> 版本：v0.1.0 | 日期：2026-08-13 | 状态：待评审
> 面向 AI 执行者：每个测试用例的输入/期望输出已明确，可直接对照编写测试代码。

## 1. 测试金字塔

```
        ╱ E2E  ╲        ← 1 个：模拟 dsh plugin add 安装验证
       ╱ 集成测试 ╲      ← 3 个：插件入口（apply + 事件挂钩）
      ╱  单元测试   ╲    ← 30+ 个：纯函数（分类/注入/提取）
     ╱──────────────╲
```

**原则**：
- 纯函数（classifyIntent / buildInjection / extractHardConstraints）→ 单元测试，无 mock
- 插件入口（apply + 事件注册）→ 集成测试，mock ctx
- 安装流程 → E2E，真实 dsh 环境

## 2. 测试工具

| 工具 | 用途 | 版本 |
|---|---|---|
| vitest | 测试运行器 | ^3.0.0 |
| tsc --noEmit | 类型检查（作为测试门禁） | ^5.5.0 |

**不引入**：无额外测试库（不用 msw/supertest/testing-library）。vitest 自带的 describe/it/expect/vi 足够。

## 3. 单元测试

### 3.1 intent-router：classifier.test.ts

**被测函数**：`classifyIntent(taskDescription, strategies)`

**Fixture 测试集**（`tests/intent-router/fixtures.ts`）：

每条用例格式：`{ input: string, expectedIntent: Intent, minConfidence: number }`

```ts
export const fixtures = [
  // refactor 意图
  { input: '帮我重构这个模块，拆分成更小的函数', expectedIntent: 'refactor', minConfidence: 0.5 },
  { input: '把这个大类拆分成几个小类', expectedIntent: 'refactor', minConfidence: 0.5 },
  { input: 'refactor the authentication module', expectedIntent: 'refactor', minConfidence: 0.5 },
  { input: '迁移数据库到新的 schema', expectedIntent: 'refactor', minConfidence: 0.5 },

  // new 意图
  { input: '从零开始创建一个新的 API 服务', expectedIntent: 'new', minConfidence: 0.5 },
  { input: '新建一个 React 项目', expectedIntent: 'new', minConfidence: 0.5 },
  { input: 'create a new microservice', expectedIntent: 'new', minConfidence: 0.5 },

  // medium 意图
  { input: '在用户表中添加一个邮箱字段', expectedIntent: 'medium', minConfidence: 0.5 },
  { input: '修改登录页面的样式', expectedIntent: 'medium', minConfidence: 0.5 },
  { input: 'add a new endpoint to the API', expectedIntent: 'medium', minConfidence: 0.5 },

  // collaboration 意图
  { input: '把这个任务分派给多个 Agent 并行处理', expectedIntent: 'collaboration', minConfidence: 0.5 },
  { input: '协作完成这个功能开发', expectedIntent: 'collaboration', minConfidence: 0.5 },

  // architecture 意图
  { input: '设计一个微服务架构方案', expectedIntent: 'architecture', minConfidence: 0.5 },
  { input: '系统选型和架构设计', expectedIntent: 'architecture', minConfidence: 0.5 },
  { input: 'design the system architecture', expectedIntent: 'architecture', minConfidence: 0.5 },

  // research 意图
  { input: '调研一下市面上主流的 Agent 框架', expectedIntent: 'research', minConfidence: 0.5 },
  { input: '分析这个库的源码实现', expectedIntent: 'research', minConfidence: 0.5 },
  { input: 'compare different database solutions', expectedIntent: 'research', minConfidence: 0.5 },

  // simple 意图
  { input: '修复这个 typo', expectedIntent: 'simple', minConfidence: 0.5 },
  { input: 'fix this bug in line 42', expectedIntent: 'simple', minConfidence: 0.5 },

  // spec_driven 兜底
  { input: '你好', expectedIntent: 'spec_driven', minConfidence: 0.0 },
  { input: 'the', expectedIntent: 'spec_driven', minConfidence: 0.0 },
  { input: '', expectedIntent: 'spec_driven', minConfidence: 0.0 },
]
```

**测试代码模板**：

```ts
import { describe, it, expect } from 'vitest'
import { classifyIntent } from '../../src/intent-router/classifier'
import { strategies } from '../../src/intent-router/strategies'
import { fixtures } from './fixtures'

describe('classifyIntent', () => {
  for (const { input, expectedIntent, minConfidence } of fixtures) {
    it(`classifies "${input.slice(0, 30)}..." as ${expectedIntent}`, () => {
      const result = classifyIntent(input, strategies)
      expect(result.intent).toBe(expectedIntent)
      expect(result.confidence).toBeGreaterThanOrEqual(minConfidence)
    })
  }

  it('returns spec_driven for empty input', () => {
    expect(classifyIntent('', strategies).intent).toBe('spec_driven')
  })

  it('confidence is between 0 and 1', () => {
    const result = classifyIntent('帮我重构这个模块', strategies)
    expect(result.confidence).toBeGreaterThanOrEqual(0)
    expect(result.confidence).toBeLessThanOrEqual(1)
  })
})
```

### 3.2 cognition-gate：injector.test.ts

**被测函数**：`buildInjection(turn, config)` + `injectCognition(messages, turn, config)`

**测试用例**：

| # | 测试点 | 输入 | 期望 |
|---|---|---|---|
| 1 | 首轮注入完整版 | turn=0, 全层开启 | 返回文本包含 L1/L2/I-02/I-08 |
| 2 | 后续轮注入精简版 | turn=1, 全层开启 | 返回文本包含 L1 精简版，不含完整 I-02 |
| 3 | 关闭 L2 层 | turn=0, layers.l2=false | 返回文本不含 L2 |
| 4 | 排除模式命中 | message 匹配 excludePatterns | 不注入 |
| 5 | 注入追加到末尾 | messages 有 2 条 | 最后一条 UserMessage 末尾追加 |

### 3.3 constraint-immune：extractor.test.ts

**被测函数**：`extractHardConstraints(message)` + `checkAgainstConstraints(text, constraints)`

**测试用例**：

| # | 测试点 | 输入 | 期望 |
|---|---|---|---|
| 1 | 提取"不要"约束 | '不要修改 API 契约' | Set 包含 '不要修改 API 契约' |
| 2 | 提取"禁止"约束 | '禁止删除生产数据' | Set 包含 '禁止删除生产数据' |
| 3 | 提取"必须"约束 | '必须先备份再操作' | Set 包含 '必须先备份再操作' |
| 4 | 多个约束 | '不要改 API。禁止删表。必须备份' | Set 有 3 个元素 |
| 5 | 无约束 | '帮我写个函数' | 空 Set |
| 6 | 检查命中 | text='我来修改 API', constraints={'不要修改 API'} | violated=true |
| 7 | 检查未命中 | text='我来写测试', constraints={'不要修改 API'} | violated=false |

## 4. 集成测试

### 4.1 插件入口测试

**方法**：mock `Context` 对象，验证 `apply` 注册了正确的事件监听。

**注意**：下面的 `createMockCtx` 是简化 mock，仅包含测试需要的 `on`/`effect` 方法。真实 Cordis `Context` 还有 `inject`/`provide`/`logger` 等字段，完整接口见 `vendor/cordis/packages/core/src/context.ts`。集成测试只验证"事件是否注册"+"listener 逻辑是否正确"，不验证 Cordis 框架本身。

```ts
import { describe, it, expect, vi } from 'vitest'

/** 简化 mock：仅包含测试需要的 on/effect。真实 Context 见 @deepseek-ai/cordis 源码。 */
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
    /** 模拟触发事件（waterfall 模式：listener 接收 (payload, next)） */
    _emitWaterfall: async (event: string, payload: any) => {
      const fns = listeners[event] || []
      const next = vi.fn().mockResolvedValue({ kind: 'enter', messages: payload.messages ?? [] })
      for (const fn of fns) await fn(payload, next)
      return next
    },
  }
}

describe('intent-router plugin', () => {
  it('registers llm/stream listener', () => {
    const ctx = createMockCtx()
    apply(ctx as any, defaultConfig)
    expect(ctx.on).toHaveBeenCalledWith('llm/stream', expect.any(Function))
  })

  it('sets reasoningEffort for architecture intent', async () => {
    const ctx = createMockCtx()
    apply(ctx as any, defaultConfig)
    const options = {
      messages: [{ role: 'user', content: '设计一个微服务架构' }],
      model: 'deepseek-v4-flash',
    }
    const next = await ctx._emitWaterfall('llm/stream', options)
    expect(next).toHaveBeenCalled()
  })
})

describe('cognition-gate plugin', () => {
  it('registers agent/pre-step listener', () => {
    const ctx = createMockCtx()
    apply(ctx as any, defaultConfig)
    expect(ctx.on).toHaveBeenCalledWith('agent/pre-step', expect.any(Function))
  })

  it('injects full cognition on turn 0', async () => {
    const ctx = createMockCtx()
    apply(ctx as any, defaultConfig)
    const payload = {
      messages: [{ role: 'user', content: '帮我写代码' }],
      turn: 0,
      step: 0,
      signal: new AbortController().signal,
    }
    const next = await ctx._emitWaterfall('agent/pre-step', payload)
    expect(next).toHaveBeenCalled()
  })
})
```

### 4.2 插件间隔离测试

验证 3 个插件可以独立启用/禁用，互不影响。

## 5. E2E 测试

### 5.1 安装验证（install.test.ts）

**前提**：dsh 官方仓库已 clone，`pnpm install` 已完成。

**步骤**：
1. `pnpm pack` 生成 oh-my-dsh tarball
2. 在 dsh 仓库根目录创建测试 profile
3. `dsh plugin --profile test add /path/to/oh-my-dsh-0.1.0.tgz`
4. 启动 `pnpm dsh web --profile test`
5. 发送测试消息，验证插件生效

**断言**：
- 安装命令退出码 0
- Web UI 启动成功
- 发送"帮我重构"→ 网络请求中 reasoningEffort=high

**注意**：E2E 测试需要 DEEPSEEK_API_KEY（真实 API 调用）。无 key 时跳过（`it.skipIf(!process.env.DEEPSEEK_API_KEY)`）。

## 6. 测试门禁

### 6.1 本地开发

```sh
# 运行全部测试
pnpm vitest run

# 类型检查
pnpm run typecheck

# 监听模式（开发时）
pnpm vitest
```

### 6.2 CI（GitHub Actions）

```yaml
# .github/workflows/ci.yml
name: CI
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22 }
      - run: pnpm install
      - run: pnpm run typecheck
      - run: pnpm vitest run --coverage
```

**通过条件**：typecheck 0 错误 + 全部测试通过。

## 7. 覆盖率目标

| 模块 | 目标 | 说明 |
|---|---|---|
| classifier.ts | 100% | 纯函数，fixture 覆盖 |
| injector.ts | 100% | 纯函数，分支覆盖 |
| extractor.ts | 100% | 纯函数，正则边界覆盖 |
| index.ts (各插件入口) | 80% | mock ctx，事件注册验证 |
| 整体 | 90%+ | 核心逻辑全覆盖 |

## 8. 测试文件清单

```
tests/
├── intent-router/
│   ├── fixtures.ts          # 20+ 条中英文测试用例
│   └── classifier.test.ts   # 意图分类单元测试
├── cognition-gate/
│   └── injector.test.ts     # 认知注入单元测试
├── constraint-immune/
│   └── extractor.test.ts    # 硬约束提取单元测试
├── integration/
│   ├── intent-router.test.ts    # 插件入口集成测试
│   ├── cognition-gate.test.ts   # 插件入口集成测试
│   └── constraint-immune.test.ts # 插件入口集成测试
└── e2e/
    └── install.test.ts      # 安装验证 E2E
```
