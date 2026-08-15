# oh-my-dsh v0.3 技术架构文档

> 版本：0.3.0；dsh 源码基线：commit 47f943859（0.1.0-rc.5）。
> 本文只把源码和测试已经证明的能力写成“已做”；源码版 dsh 已完成安装、配置解析与 headless 挂载，但 A0 模型会话因 API key 缺失仍为 blocked。

## TL;DR

v0.3 将四个提示与路由插件扩展为七个可组合控制点。事件链顺序固定为：

~~~text
intent-router → model-router → cognition-gate → checkpoint-trace
→ constraint-immune → scope-guard → review-router
~~~

checkpoint-trace 位于所有裁决插件之前，先保存 pre checkpoint，再委托 next，最后保存 allow、ask 或 deny 的 post checkpoint。事实不写 dsh session log，而写每个 session 独立的 sidecar JSONL；这是为了避开 dsh session-persistence coordinator.ts:1063 对未知事件类型的拒载。

## 1. 架构总览

### 1.1 Bundle 结构

bundle 由 cordis.patch.yml 声明，当前顺序可见 cordis.patch.yml:1-50。七个入口分别是：

| 插件 | 主要接缝 | v0.3职责 |
|---|---|---|
| intent-router | agent/request | 8 意图、推理强度请求与 capability 对账 |
| model-router | agent/request | Flash-first、升级条件、message.id 去重 |
| cognition-gate | agent/pre-step | 认知注入与 stable 区 pressure 信号 |
| checkpoint-trace | tools/pre-execute、tools/post-execute、生命周期 | 状态索引、digest、hash 链和测试证据 |
| constraint-immune | agent/pre-step、tools/pre-execute | 硬约束提醒与工具 deny |
| scope-guard | agent/pre-step、tools/pre-execute | ScopeContract、范围变化确认、越界 deny |
| review-router | tools/pre-execute、tools/post-execute、失败事件 | M0/M1/M4 风险与证据审查 |

### 1.2 技术栈与零依赖边界

运行时只依赖 dsh 提供的 cordis、dsh-tools、schemastery；package.json:22-26 将 peer 范围收窄为 0.1.0-rc.*。新增实现只使用 Node 内置的 fs、path、crypto、child_process；不新增 npm 依赖。

### 1.3 仓库结构

~~~text
src/
├── intent-router/             # 意图与 capability 对账
├── model-router/              # 模型升级与 message.id 去重
├── cognition-gate/            # 注入与软预算
├── constraint-immune/         # 约束提取与工具拦截
├── scope-guard/               # contract.ts + index.ts
├── checkpoint-trace/          # checkpoint.ts + digest.ts + index.ts
├── review-router/             # verdict.ts + index.ts
├── shared/
│   ├── facts.ts               # sidecar JSONL
│   ├── strategy.ts            # StrategyDecision 与默认表
│   ├── risk.ts                # 唯一 R0-R4 来源
│   ├── context-zones.ts       # 四区与 pressure
│   └── messages.ts            # 文本与估算工具
└── types/dsh.d.ts             # 本地 dsh Session/LLM 类型桩
~~~

## 2. 挂钩点 API 精确签名

以下签名以 dsh 0.1.0-rc.5 的源码行为为准；dsh 事件定义来自 packages/core/agent/src/runtime-types.ts:219-290 和 packages/core/tools/src/index.ts:142-175。

~~~ts
agent/pre-step(
  payload: { agent, messages: UserMessage[], turn, step, signal },
  next: () => Promise<PreStepDecision>
): Promise<PreStepDecision>
~~~

agent/pre-step 是 waterfall。constraint-immune 当前实现 src/constraint-immune/index.ts:42-108 与 cognition-gate 当前实现 src/cognition-gate/index.ts:29-51 都先 await next，再做变换。

~~~ts
agent/request(
  payload: { agent, turn, step, signal },
  next: () => Promise<LlmCallConfig>
): Promise<LlmCallConfig>
~~~

该 payload 不含 messages 和 capability，定义见 packages/core/agent/src/runtime-types.ts:232-244。intent-router 在 src/intent-router/index.ts:95-128 先拿配置，再调用 ctx.llm.resolveModelInfo；该解析 API 在 packages/llm/llm/src/index.ts:619-625，reasoning efforts 结构在 packages/llm/llm/src/types.ts:252-280。

~~~ts
tools/pre-execute(
  exec: ToolExecution,
  next: () => Promise<PreToolDecision>
): Promise<PreToolDecision>

PreToolDecision =
  | { kind: 'allow' }
  | { kind: 'deny'; reason: string }
  | { kind: 'ask'; reason?: string }
~~~

类型与 waterfall 位置见 packages/core/tools/src/index.ts:142-152、:588-591；deny 的错误结果物化见 packages/core/tools/src/index.ts:1486-1498。checkpoint-trace 在 src/checkpoint-trace/index.ts:86-121 使用此接缝捕获 downstream deny/ask。

tools/post-execute、agent/turn-stopping、agent/request-error、agent/error 的定义分别见 packages/core/tools/src/index.ts:164-175、packages/core/agent/src/runtime-types.ts:262-290。checkpoint-trace 在 src/checkpoint-trace/index.ts:123-180 注册测试结果和生命周期 checkpoint。

session/event 是 post-commit 观测 feed，见 packages/core/session/src/index.ts:66-76；session/flush 是耐久刷新，见 packages/core/session/src/index.ts:78-85。它们不是本插件事实的写入路径。SessionStore.fork 的边界约束见 packages/core/session/src/index.ts:1068-1095。

Message.id 的稳定身份与 UUID 生成见 packages/llm/llm/src/message.ts:129-143、:178-185；model-router 的 WeakMap 去重实现见 src/model-router/index.ts:88-129。

dsh 没有通用 post-assistant review waterfall；assistant 到工具的直接路径见 packages/core/agent-loop/src/agent.ts:381-398。因此 review-router 不实现不存在的 post-assistant hook。

## 3. 模块设计

### 3.1 facts.ts：sidecar 事实存储

src/shared/facts.ts:1-126 提供 resolveFactsPath、appendFact、readFacts、latestFact、latestCheckpointForFork。路径为：

~~~text
session.header.cwd/.dsh/oh-my-dsh/facts-base64url(session.header.id).jsonl
~~~

appendFact 同步追加 time、sessionId、type、data；目录 0700，文件 0600。readFacts 对末行截断、损坏 JSON 和未知事实类型跳过，并由 getLastSkippedFactCount 暴露最近一次跳过数量。事实类型有 strategy、scope-change、verdict、checkpoint、pressure、test-result 六类。

禁止使用 session.append 写这些事实：dsh 的未知事件读路径在 packages/session/session-persistence/src/coordinator.ts:1063 会抛 SessionFormatUnsupportedError；sidecar 使 session resume 不被毒化。

### 3.2 strategy.ts 与 intent/model router

src/shared/strategy.ts:1-49 定义 StrategyDecision、BudgetClass、RiskClass 和八意图默认表。simple 的请求值是 auto:lowest，spec_driven 的请求值是 high。

src/intent-router/index.ts:64-127 的 capability 对账规则：

1. 请求值在 advertised efforts 中，effective 等于请求值；
2. 不支持时在 low、medium、high、max 顺序中选择最近值并写 fallbackReason；
3. resolver 抛错或没有 reasoning.efforts 时删除 reasoningEffort，交给 provider 默认值，并写 capability-unknown；
4. 真实 Session 才写 strategy sidecar 事实。

src/model-router/index.ts:102-163 只改 model，不改 provider。真实 Session 使用 WeakMap，message.id 重复出现不会重复增加不满意 streak；模型实际升级时写 source=model-router 的第二条 strategy 事实。两条事实共享 messageId，消费者按 messageId 和 time 归并。

### 3.3 cognition-gate 与四区软预算

src/shared/context-zones.ts:1-39 定义 stable、evidence、active、external 和 ZoneSection。src/cognition-gate/injector.ts:40-69 在原始注入文本后增加 stable 标签，包含 source、ttl、estimatedTokens。src/cognition-gate/index.ts:29-51 估算四区总量，超过 pressureThreshold 就写 pressure 事实。

这只是软预算和压力信号：stable 与 active 不被删除，不重写 compaction，不把估算当精确计费。

### 3.4 scope-guard 与 ScopeContract

ScopeContract 的类型和高置信抽取见 src/scope-guard/contract.ts:1-102；运行时状态和事件处理见 src/scope-guard/index.ts:1-257。

- 首条用户消息只抽取路径片段和已知工具名；抽不出时插件惰性。
- 顺便、还有、另外、再加上识别为增加范围；改成、换成、改为识别为替换。
- pending 期间模型重试继续 ask；确认后 revision 才递增；拒绝不递增；三轮未确认过期。
- tools/pre-execute 的路径参数按 path、file、filePath、target、dest、destination、cwd 以及含斜杠字符串抽取。
- 越界路径 deny；requiresApproval 风险 ask；低置信澄清不落事实。

### 3.5 risk.ts 与 review-router

src/shared/risk.ts:1-96 是唯一风险表。三轴映射如下：

| level | 典型动作 | requiresCheckpoint | requiresApproval | review |
|---|---|---:|---:|---|
| R0 | read、grep、ls | 否 | 否 | M0 |
| R1 | allowedPaths 内 write/edit | 是 | 否 | M1 |
| R2 | build、test 白名单 | 否 | 否 | M0 |
| R3 | rm、delete、move、越界写 | 是 | 是 | M4 |
| R4 | send、publish、deploy | 是 | 是 | M4 |

review-router 的选择和 RiskRecord 定义见 src/review-router/verdict.ts:1-50，执行见 src/review-router/index.ts:1-146。M1 只消费最近 checkpoint 的 testResults；M4 返回 ask，reason 包含 requires approval。没有 approval answerer 时，dsh tools 接缝按 packages/core/tools/src/index.ts:1679-1730 的默认值立即 fail-closed deny；user-approval 的 turn 内 race、无超时语义见 packages/interaction/user-approval/src/index.ts:304-344。

### 3.6 checkpoint-trace

checkpoint 对象、脱敏、canonical JSON、integrity 校验见 src/checkpoint-trace/checkpoint.ts:1-112；workspace digest 见 src/checkpoint-trace/digest.ts:1-35。hash 计算为脱敏后的递归 key 排序 JSON 加 previousCheckpointId，再做 SHA-256。

src/checkpoint-trace/index.ts:50-121 在 requiresCheckpoint 工具前后成对写 checkpoint；src/checkpoint-trace/index.ts:123-144 生产 test-result；digest 改变时追加 kind=invalidation 事实。artifact 只保存引用字段，不复制内容。redaction 会移除 key 名匹配 token、key、secret、password 的字段。

## 4. 与 v0.2 的差异

| 维度 | v0.2 | v0.3 |
|---|---|---|
| 插件数 | 4 | 7 |
| waterfall | constraint-immune 在提醒分支截断 | 先 next 再叠加，tests/constraint-immune/waterfall.test.ts 锁定 |
| 路由 | 关键词和模型切换骨架 | capability 对账、strategy 事实、message.id 去重 |
| 安全 | 约束工具 deny | ScopeContract + 共享 R0-R4 + M0/M1/M4 |
| 证据 | 无插件事实账本 | sidecar JSONL、checkpoint hash 链、Verdict |
| 上下文 | 静态认知注入 | 四区标签和 pressure，不做驱逐 |
| 真实验收 | 静态 bundle | dsh 安装、配置解析、headless 挂载通过；模型会话当前 blocked |

## 5. 风险与对策

| 风险 | 对策 |
|---|---|
| dsh rc 漂移 | peerDependencies 收窄 0.1.0-rc.*，源码引用固定文件:行号 |
| 事件链顺序敏感 | cordis.patch.yml 固定顺序，tests/integration/waterfall-composition.test.ts 覆盖两种注册顺序 |
| capability 查询失败 | 不设置 effort，记录 capability-unknown |
| 关键词误判 | 意图只作关键词骨架；scope 仅高置信模式；风险未知归高档 |
| sidecar 损坏 | readFacts 跳过坏行并计数；session log 不写自定义事件 |
| 无 git digest | paths+mtime fallback，并写 digestMethod |
| approval 缺失 | ask 在 dsh 默认路径立即 fail-closed deny，不挂起 |

## 附录 A：18 个创新点状态

| 编号 | 状态 | 说明 |
|---|---|---|
| I-01 | 半做 | 约束提醒、工具 deny；诊断/灰度/回滚未做 |
| I-02 | 未做 | 仅保留原提示，不实现元请求工具 |
| I-03 | 半做 | 四区软预算与 pressure |
| I-04 | 未做 | 不实现稳定前缀压缩 |
| I-05 | 未做 | 不实现文档编译器 |
| I-06 | 未做 | 不实现 PlanGraph |
| I-07 | 半做 | M0/M1/M4 风险证据路由 |
| I-08 | 半做 | 高置信 ScopeContract |
| I-09 | 未做 | 不实现 skill 供应链 |
| I-10 | 半做 | 8 意图策略与 capability 对账 |
| I-11 | 半做 | checkpoint 状态索引、hash、redaction |
| I-12 | 未做 | 不实现 scoped memory |
| I-13 | 研究中 | 不做字节级布局 |
| I-14 | 未做 | 不实现 reasoning replay policy |
| I-15 | 研究中 | 不进入默认工具协议 |
| I-16 | 研究中 | capability 查询只作为路由依赖 |
| I-17 | 半做 | requested/effective effort 对账 |
| I-18 | 未做 | 不实现动态索引编译 |

证据等级：当前代码与仓库内桩测试为 A1；真实 dsh 已通过安装、配置解析和帮助挂载预检，完整 A0 因 API key 缺失而 blocked，证据文件见 .omo/evidence/task-10-oh-my-dsh-v03.md。

## 附录 B：变更记录

2026-08-15：冻结 sidecar、风险三轴、scope 状态机和 checkpoint wrap 契约。

2026-08-16：完成 v0.3 代码、151 个 A1 测试、发布工程；真实 dsh 预检通过，A0 模型会话待 DEEPSEEK_API_KEY。
