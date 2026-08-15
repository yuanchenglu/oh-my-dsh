# oh-my-dsh v0.3 实施规划

> 计划基线：.omo/plans/oh-my-dsh-v03.md；代码基线：本仓库 main；
> dsh 接缝基线：commit 47f943859（0.1.0-rc.5）。

## TL;DR

本版本以安全与证据基线为目标，按 11 个 todo、7 个 wave 实施。先修复 waterfall 截断，再建立 shared 事实与风险契约，之后实现 capability 路由、软预算、scope-guard、checkpoint-trace、review-router，最后完成打包与文档。

## 核心结论

1. 约束提醒必须先 next，否则后续插件会被跳过；dsh agent/pre-step 契约见 packages/core/agent/src/runtime-types.ts:219-231。
2. 自定义事实只写 sidecar，不能调用 session.append；未知 session 事件读路径见 packages/session/session-persistence/src/coordinator.ts:1063。
3. checkpoint-trace 必须在裁决插件之前包裹 tools/pre-execute；tools 三态定义见 packages/core/tools/src/index.ts:588-591。
4. 风险表只有 src/shared/risk.ts 一个来源，R1 契约内 write 不触发人工确认。
5. A0 真实 dsh 是发布门禁；本机缺少 dsh 与 key 时只能交付 blocked 证据，不得以 A1 冒充 A0。

## 1. 里程碑与依赖图

~~~text
M0 todo1 → todo2
M1 todo4
M2 todo5 ─┐
M3 todo6 ─┼→ M5 todo8 → M6 todo9 → M7 todo10
M4 todo7 ─┘                         └→ 文档 todo11
文档 todo3 ─────────────────────────┘
~~~

| 里程碑 | todo | 产出 |
|---|---|---|
| M0 | 1、2 | waterfall 修复和组合测试 |
| 文档 P | 3 | PRD |
| M1 | 4 | facts、strategy、risk、类型桩 |
| M2 | 5 | capability 路由与 message.id 去重 |
| M3 | 6 | 四区标签和 pressure |
| M4 | 7 | ScopeContract 与确认状态机 |
| M5 | 8 | checkpoint、digest、hash、redaction |
| M6 | 9 | M0/M1/M4 review router |
| M7 | 10 | 0.3.0、7 插件、A0 smoke |
| 文档 D | 11 | architecture、plan、testing、README |

## 2. 全局约束

- TypeScript strict、无新增 npm 依赖。
- v0.2 基线 111 个测试不能删除或改变断言语义；v0.3 最终桩测试为 151 个。
- 事实类型只能通过 src/shared/facts.ts:1-126 的六类联合写入。
- 禁止 session.append 写 oh-my-dsh 自定义事件。
- 不改 dsh 源码，不做 post-assistant review hook；反面证据见 packages/core/agent-loop/src/agent.ts:381-398。
- token 只有估算语义；I-03 不做驱逐、压缩和字节布局。
- 关键词分类是骨架，不把 8 意图宣称为完整策略空间。
- A0 key 只从 DEEPSEEK_API_KEY 环境变量读取，不写文件。
- 每个 todo 一个原子 commit，标题中英双语，正文先 English 后简体中文。

## 3. M0：waterfall 与组合测试

### 目标与改动

todo 1 修改 src/constraint-immune/index.ts:42-108：await next 后检查 reject/abort，再在 decision.messages 上追加提醒；tools/pre-execute:111-139 不变。

todo 2 新增 tests/constraint-immune/waterfall.test.ts 与 tests/integration/waterfall-composition.test.ts，锁定 cognition-gate 和 constraint-immune 两种注册顺序，以及 tools allow/deny/ask。

### API 与测试

~~~ts
agent/pre-step(payload, next): Promise<PreStepDecision>
~~~

签名依据 packages/core/agent/src/runtime-types.ts:219-231。失败测试必须先证明违规分支没有调用 next；验收命令为：

~~~sh
corepack pnpm run typecheck
corepack pnpm vitest run
~~~

commit：fix(constraint-immune): delegate next() before appending violation reminders | 修复约束免疫：叠加违规提醒前先委托 next()

## 4. 文档 P：PRD

todo 3 将 .omo/drafts/v03-prd-content.md 落为 docs/v03/01-prd.md。AC-1 至 AC-33 必须保留，验收是文件 diff 仅排版差异且 AC- 数量不少于 30。

commit：docs(v03): add v0.3 PRD | 文档：新增 v0.3 产品需求文档

## 5. M1：shared 事实、策略、风险

### 目标与接口

todo 4 新增：

- src/shared/facts.ts:27-126：resolveFactsPath、appendFact、readFacts、latestFact、latestCheckpointForFork；
- src/shared/strategy.ts:1-49：StrategyDecision、BudgetClass、RiskClass、DEFAULT_STRATEGIES；
- src/shared/risk.ts:1-96：assessRisk 与 RiskAssessment；
- src/types/dsh.d.ts：本地 Session、Llm resolveModelInfo 类型。

sidecar 路径必须使用 base64url session id；事实每行包含 time、sessionId、type、data。readFacts 坏行跳过并计数。

### 测试与验收

tests/shared/facts.test.ts 覆盖 JSONL、六类事实、损坏行和 fork；tests/shared/strategy.test.ts 覆盖八意图；tests/shared/risk.test.ts 覆盖 R0、R1、R2、R3、R4。

commit：feat(shared): add sidecar fact store, strategy types, and shared risk table | 新能力：shared 层新增 sidecar 事实存储、策略类型与共享风险表

## 6. M2：capability 路由

### 目标与接口

todo 5 在 src/intent-router/index.ts:47-128 中执行 next、classifyIntent、ctx.llm.resolveModelInfo(provider, model, signal)，并落 source=intent-router 的 strategy 事实。

todo 5 在 src/model-router/index.ts:85-163 中用 WeakMap<Session, SessionState> 记录 message.id，升级时落 source=model-router 事实；不得用裸 Map 保存 session id。

API 依据：resolveModelInfo 在 packages/llm/llm/src/index.ts:619-625；efforts 结构在 packages/llm/llm/src/types.ts:252-280；Message.id 在 packages/llm/llm/src/message.ts:129-143。

### 测试与验收

tests/integration/intent-capability.test.ts：unsupported effort 最近档、auto:lowest、capability-unknown。tests/model-router/dedup.test.ts：重复 message.id 不重复计数、两 source 共享 messageId。所有 provider caveat 只写对账，不宣称 high/max 的 hosted 语义。

commit：feat(routing): capability-aware effort reconciliation and message-id dedup | 新能力：路由支持能力对账降级与按消息 ID 去重

## 7. M3：四区软预算

### 目标与接口

todo 6 新增 src/shared/context-zones.ts:1-39，定义 Zone、ZoneSection、PressureEvent、createZoneSection、buildPressureEvent。

src/cognition-gate/injector.ts:40-69 给 stable 注入加标签；src/cognition-gate/index.ts:29-51 在超过 threshold 时写 pressure 事实。dsh Message 不扩展；不做删除。

### 测试与验收

tests/shared/context-zones.test.ts 覆盖四区与建议动作；tests/cognition-gate/pressure.test.ts 覆盖超阈值和未超阈值，断言 stable 文本仍然存在。

commit：feat(cognition-gate): tag injections with four-zone budget and pressure events | 新能力：认知注入接入四区预算标签与压力事件

## 8. M4：scope-guard

### 目标与接口

todo 7 新增 src/scope-guard/contract.ts:1-102 与 src/scope-guard/index.ts:1-257。核心状态是 WeakMap<Session, ContractState>。

ScopeContract 字段包括 scopeId、version、objective、inScope、nonGoals、acceptanceCriteria、constraints、changeBudget、owner、status、contractRevision。tools 路径键约定与 dsh tools/pre-execute 的三态接口一致，后者见 packages/core/tools/src/index.ts:142-152、:588-591。

### 测试与验收

tests/scope-guard/contract.test.ts 覆盖高置信抽取、路径提取、澄清；tests/scope-guard/governance.test.ts 覆盖越界 deny、外部副作用 ask、pending/confirmed/rejected/expired。

commit：feat(scope-guard): add scope contract plugin with ask/deny governance | 新插件：范围契约治理（越界拦截与确认）

## 9. M5：checkpoint-trace

### 目标与接口

todo 8 新增：

- src/checkpoint-trace/digest.ts:1-35：sha256 与 git/paths-mtime digest；
- src/checkpoint-trace/checkpoint.ts:1-112：Checkpoint、canonicalize、redactValue、verifyCheckpointIntegrity；
- src/checkpoint-trace/index.ts:1-180：tools 前后包裹、test-result、生命周期。

checkpoint hash 是 canonical JSON 加 previousCheckpointId 的 sha256。pre/post 都写 sidecar；deny 不依赖 post-execute。

### 测试与验收

tests/checkpoint-trace/digest.test.ts、checkpoint.test.ts、integration.test.ts 覆盖 fallback、hash 链、篡改失败、redaction、deny 成对 checkpoint 和测试结果。

commit：feat(checkpoint-trace): add hash-chained state-index checkpoints with invalidation | 新插件：哈希链状态索引存档点与失效传播

## 10. M6：review-router

### 目标与接口

todo 9 新增 src/review-router/verdict.ts:1-50 与 src/review-router/index.ts:1-146。风险直接调用 shared/risk.ts:43-96，不重复清单。

M0 对应 R0/R2；M1 对应 R1 且要求最近 checkpoint testResults；M4 对应 R3/R4，一律 ask。Verdict 包含 verdict、selectedReviewMode、checkpointRef、evidenceRefs、reason、policyVersion 和 RiskRecord。

### 测试与验收

tests/review-router/routing.test.ts 覆盖 R0 pass、R1 有证据 pass、R1 无证据 ask、R3/R4 ask。headless 无 answerer 的立即 deny 由 dsh tools packages/core/tools/src/index.ts:1679-1730 提供。

commit：feat(review-router): add M0/M1/M4 risk-evidence review routing | 新插件：风险证据审查路由（M0/M1/M4）

## 11. M7：发布与真实 E2E

### 发布工程

todo 10 修改 package.json:1、:22-26 为 0.3.0 和 0.1.0-rc.*；cordis.patch.yml:1-50 扩为七插件，并确保 checkpoint-trace 位于裁决插件之前。

### A0 流程

~~~sh
corepack pnpm run build
corepack pnpm pack
DSH_HOME=临时目录 dsh plugin add oh-my-dsh-0.3.0.tgz
DSH_HOME=临时目录 dsh --dump-config
~~~

tests/e2e/real-dsh.smoke.ts 会检查 key、dsh、7 插件配置和 headless 输出；缺少环境以 77 阻断。tests/e2e/real-dsh.smoke.md 列出 deny、ask 降级、strategy、checkpoint、fork、resume 的断言。

### 已知环境结果

本仓库当前源码版 dsh 位于 `/Users/bluth/Code/deepseek-src/deepseek-harness`，不在 PATH；已完成 tarball 安装、7 插件配置解析和 headless 帮助挂载。DEEPSEEK_API_KEY 未设置，因此完整 A0 会话仍 blocked；静态 bundle 与 151 个 A1 测试已通过。

commit：feat(v03): seven-plugin bundle, real-dsh e2e, version 0.3.0 | 新能力：七插件合集、真实 dsh 端到端验证、版本 0.3.0

## 12. 文档 D

todo 11 产出本文件、docs/v03/02-architecture.md、docs/v03/04-testing.md 和 README。所有创新点标记已做、半做、未做或研究中，并带 A0/A1 证据等级。

commit：docs(v03): add architecture/plan/testing docs and refresh README | 文档：新增 v0.3 架构/规划/测试文档并更新 README

## 附录 A：验收命令速查

~~~sh
corepack pnpm run typecheck
corepack pnpm vitest run
corepack pnpm run build
corepack pnpm pack
~~~

当前网络受限时，可使用仓库已有 node_modules/.bin/tsc、node_modules/.bin/vitest 做同等本地验证；这不是发布环境替代。

## 附录 B：PRD AC 映射总表

| PRD | 测试文件 | 主要用例 |
|---|---|---|
| 3.1 AC-1~4 | tests/constraint-immune/waterfall.test.ts | next、reject、abort、提醒 |
| 3.2 AC-1~3 | tests/integration/waterfall-composition.test.ts | 顺序、三态、可观测 |
| 3.3 AC-1~6 | tests/integration/intent-capability.test.ts、tests/model-router/dedup.test.ts | 8 意图、降级、事实、去重 |
| 3.4 AC-1~5 | tests/scope-guard/contract.test.ts、governance.test.ts | 契约、越界、确认、澄清 |
| 3.5 AC-1~5 | tests/review-router/routing.test.ts | M0、M1、M4、Verdict |
| 3.6 AC-1~6 | tests/checkpoint-trace/*.test.ts | hash、digest、redaction、deny |
| 3.7 AC-1~4 | tests/shared/context-zones.test.ts、tests/cognition-gate/pressure.test.ts | 四区、pressure、不丢 stable |

## 附录 C：变更记录

2026-08-15：冻结实施依赖、sidecar 选型与 A0 边界。

2026-08-16：完成 11 个 todo 中的代码、测试与文档；真实 dsh 留为环境阻断。
