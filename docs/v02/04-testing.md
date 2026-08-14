---
title: oh-my-dsh v0.2 测试体系文档
created: 2026-08-14
innovation_points: [model-router, constraint-interception, positive-constraint-check]
kv_cache_stable: true
---

# oh-my-dsh v0.2 测试体系文档

> **TL;DR** — v0.2 新增 35 个测试（单元 17 + 集成 18），覆盖 15 条 AC（model-router AC-1~6、拦截 AC-1~5、肯定型 AC-1~4），全量总数 74 → 109。所有用例与 03-plan.md（审查后版本，含 F1"禁止删表"修复）逐字一致。E2E 沿用 v0.1 建立的真实安装验证流程。

## 核心结论

1. 新增 35 个测试：单元 17（shared 7 + router 10）+ 集成 18（model-router 9 + constraint-immune 追加 9）
2. 15 条 AC 每条都有同名测试用例，映射表见附录 A
3. v0.1 的 74 个测试零修改、零删除，必须保持全绿
4. E2E 静态断言自动兼容新插件条目，真实安装验证在 M4 执行
5. 不引入任何新测试库：只用 vitest 自带 describe/it/expect/vi

---

## 1. 测试金字塔

```
        ╱ E2E  ╲        ← 1 个文件：bundle 结构静态断言（v0.1 已有，自动兼容）+ M4 真实安装验证流程
       ╱ 集成测试 ╲      ← 5 个文件：插件入口（mock ctx 触发事件）——v0.2 新增 model-router 9 个用例、constraint-immune 追加 9 个用例
      ╱  单元测试   ╲    ← 4 个文件：纯函数无 mock——v0.2 新增 shared/messages 7 个、model-router/evaluateUpgrade 10 个
     ╱──────────────╲
```

**分层原则**（与 v0.1 一致）：

| 层 | 放什么 | v0.2 新增 |
|---|---|---|
| 单元 | 纯函数：contentToText / extractLastUserMessage / estimateTokens / evaluateUpgrade | 17 |
| 集成 | 插件入口：apply + 事件注册 + 事件触发后的行为断言 | 18 |
| E2E | bundle 结构 + 真实 dsh 安装 | 0（复用 v0.1 文件 + M4 手动流程） |

## 2. 测试工具

| 工具 | 用途 | 版本 |
|---|---|---|
| vitest | 测试运行器 | ^3.0.0 |
| tsc --noEmit | 类型检查门禁 | ^5.5.0 |

**不引入**：msw / supertest / testing-library / coverage 插件（覆盖率目标维持 v0.1 文档的"目标声明、暂无量测门禁"状态）。

## 3. 单元测试

### 3.1 tests/shared/messages.test.ts（新增，7 用例）

**被测函数**：`contentToText` / `extractLastUserMessage` / `estimateTokens`（`src/shared/messages.ts`，M0 产物）

完整文件（可直接复制）：

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

### 3.2 tests/model-router/router.test.ts（新增，10 用例）

**被测函数**：`evaluateUpgrade`（`src/model-router/index.ts`，M1 产物；纯函数，不依赖 ctx）

完整文件（可直接复制）：

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

**边界覆盖说明**：阈值恰等（30000 不升级）、条件独立关闭（三个 Config 开关各一条）、单轮不满意（< 2 不升级）均已覆盖；意图分类本身由 v0.1 的 28 个 classifier 测试覆盖，此处不重复。

## 4. 集成测试

### 4.1 tests/integration/model-router.test.ts（新增，9 用例）

**被测对象**：`apply`（agent/request 瀑布注册与改写行为）。挂钩点签名：`agent/request`（packages/core/agent/src/runtime-types.ts:244）。

完整文件（可直接复制）：

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

### 4.2 tests/integration/constraint-immune.test.ts（追加 9 用例）

**被测对象**：`apply` 新增的 `tools/pre-execute` 拦截（签名：packages/core/tools/src/index.ts:152）与 pre-step 肯定型检查。

**前置改动**：在现有 `createMockCtx` 返回对象中追加 `_preExecute` 辅助方法：

```ts
    /** 模拟 tools/pre-execute 瀑布 */
    _preExecute: async (exec: { name: string; arguments: unknown; agent?: { id?: string } }) => {
      const next = vi.fn().mockResolvedValue({ kind: 'allow' })
      const results = []
      for (const fn of listeners['tools/pre-execute'] || []) results.push(await fn(exec, next))
      return { next, results }
    },
```

**M2 追加用例（6 个，执行时拦截）**（可直接复制，与 03-plan.md 审查后版本一致）：

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

**M3 追加用例（3 个，肯定型"缺少执行"检查）**（可直接复制）：

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

**注意**：v0.1 已有的 9 个 constraint-immune 集成用例不传 `interception` 字段，`undefined === 'deny'` 为 false、不注册 tools listener——旧用例零影响，不需要改动。

## 5. E2E 测试

### 5.1 静态结构断言（复用 v0.1 文件，零改动）

`tests/e2e/install.test.ts` 的「patch entries point at lib/src/**」用例用 `matchAll` 遍历 patch 条目并断言每条都有对应 `src/**/index.ts`。M1 新建 `src/model-router/index.ts`、M4 把 model-router 加入 cordis.patch.yml 后，该用例**自动覆盖**新条目，无需修改。

### 5.2 真实安装验证（M4 手动流程）

沿用 v0.1 修复期建立并验证过的流程（详见 03-plan.md M4 节）：

1. `pnpm run build && pnpm pack`
2. `rm -rf ~/.dsh/profiles/headless/node_modules/oh-my-dsh`（pnpm 不重装同路径旧 tarball）
3. `dsh plugin --profile headless add` 新 tarball
4. `--dump-config` 确认 4 个插件条目
5. 冒烟 import 编译产物：4 个插件 name/apply 导出 + model-router 架构输入返回 `model: deepseek-v4-pro`
6. （有 DEEPSEEK_API_KEY 时）真实 headless 对话，session 日志 `request/header` 应含 `"model":"deepseek-v4-pro"`；拦截的 isError 物化（PRD 3.2.5 AC-1 的 dsh 侧行为）也在此兜底验证

无 key 时跳过第 6 步并在交付说明中明示。

## 6. 覆盖目标与回归

### 6.1 数量目标

| 范围 | v0.1 | v0.2 新增 | 合计 |
|---|---|---|---|
| 单元测试 | 50（classifier 28 + injector 11 + extractor 11） | 17（shared 7 + router 10） | 67 |
| 集成测试 | 20（intent-router 6 + cognition-gate 5 + constraint-immune 9） | 18（model-router 9 + constraint-immune 9） | 38 |
| E2E | 4 | 0 | 4 |
| **全量总数** | **74** | **35** | **109** |

（总数 109 为验收基准；各层小计以 `pnpm vitest run` 输出为准。）

### 6.2 覆盖率目标

维持 v0.1 文档状态：目标声明、暂无量测门禁。新增模块目标：shared/messages.ts 100%（纯函数）、evaluateUpgrade 100%（分支全覆盖）、插件入口 80%+（mock ctx 事件验证）。

### 6.3 回归检查清单（每个里程碑验收时逐项打勾）

- [ ] `pnpm run typecheck` 0 错误
- [ ] `pnpm vitest run` 全绿，且总数与当前里程碑预期一致（M0 后 81；M1 后 81+19=100；M2 后 100+6=106；M3 后 106+3=109）
- [ ] v0.1 的 74 个用例零修改、零删除
- [ ] `grep -rn "function contentToText" src/` 只剩 shared/messages.ts 一处（M0 后）
- [ ] 新用例名与本文档用例名逐字一致（便于按名验收）
- [ ] 没有为让测试变绿而删断言、改预期（v0.1 review 教训）

## 7. 测试文件清单（v0.2 完成后）

```
tests/
├── shared/
│   └── messages.test.ts          # ★ 新增 7
├── intent-router/
│   ├── fixtures.ts               # 不变
│   └── classifier.test.ts        # 不变（28）
├── cognition-gate/
│   └── injector.test.ts          # 不变（11）
├── constraint-immune/
│   └── extractor.test.ts         # 不变（11）
├── model-router/
│   └── router.test.ts            # ★ 新增 10
├── integration/
│   ├── intent-router.test.ts     # 不变（6）
│   ├── cognition-gate.test.ts    # 不变（5）
│   ├── constraint-immune.test.ts # ★ 追加 9（→ 18）
│   └── model-router.test.ts      # ★ 新增 9
├── e2e/
│   └── install.test.ts           # 不变（4，自动兼容新 patch 条目）
└── stubs/                        # 不变
```

---

## 附录 A：AC → 测试用例映射总表

| PRD 条目 | AC | 测试文件 | 用例名 |
|---|---|---|---|
| 3.1.7 model-router | AC-1 | integration/model-router.test.ts | 「AC-1：简单任务保持 flash」 |
| | AC-2 | 同上 | 「AC-2：架构意图升级 pro」 |
| | AC-3 | 同上 | 「AC-3：token 超阈值升级 pro」 |
| | AC-4 | 同上 | 「AC-4：连续两轮不满意升级，随后正常消息回落 flash」 |
| | AC-5 | 同上 | 「AC-5：enabled=false 不注册 listener」 |
| | AC-6 | 同上 | 「AC-6：provider 永远不被修改」 |
| 3.2.5 执行时拦截 | AC-1 | integration/constraint-immune.test.ts | 「AC-1：命中否定型约束的工具调用被 deny」 |
| | AC-2 | 同上 | 「AC-2：不命中约束的工具调用放行」 |
| | AC-3 | 同上 | 「AC-3：interception='off' 不注册 tools/pre-execute」 |
| | AC-4 | 同上 | 「AC-4：关键词 < 4 字符的否定型约束不触发拦截」（"禁止删表"用例） |
| | AC-5 | 同上 | 「AC-5：拦截状态按 agent 隔离」 |
| 3.3.3 肯定型检查 | AC-1 | 同上 | 「AC-1：肯定型约束被遵守（含关键词）→ 不提醒」 |
| | AC-2 | 同上 | 「AC-2：肯定型约束缺执行 → 追加一次"未执行"提醒」 |
| | AC-3 | 同上 | 「AC-3：提醒只出现一次」 |
| | AC-4 | 同上 | 「肯定型约束不触发拦截」 |

单元测试对 AC 的辅助覆盖：router.test.ts 的 10 个用例覆盖 AC-1/2/3/4 的纯函数判定面与 Config 开关边界。

## 附录 B：变更记录

| 日期 | 内容 | 来源 |
|---|---|---|
| 2026-08-14 | 初版：35 个新用例、15 条 AC 映射、回归检查清单 | v0.2 规划任务（测试文档阶段） |
