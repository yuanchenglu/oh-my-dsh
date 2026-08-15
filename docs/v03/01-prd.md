# oh-my-dsh v0.3 产品需求文档（PRD）

> 版本：v0.3.0 · 状态：已批准规划基线
> 作者：Prometheus（规划） · 日期：2026-08-15
> 上游依据：`docs/v03/innovation-assessment.md`（Codex 评估）+ 六篇创新点原文独立核验 + dsh @ `47f943859b` 源码核验

---

## TL;DR

v0.3.0 不追求实现更多创新点，而是把 v0.2 的四个"动作点插件"升级为**可组合、可拒绝、可审计、可恢复**的安全与证据基线：修复 constraint-immune 的 waterfall 截断（真实 P0），新增 scope-guard / review-router / checkpoint-trace 三个插件，硬化 intent-router / model-router 为能力感知路由，给上下文注入加四区软预算标签。配套真实 dsh 端到端验收（A0 级）。

## 核心结论

1. v0.2 的瀑布流问题已被 commit `e3cb44b` 部分修复（cognition-gate），**真正残留的截断点是 constraint-immune**（`src/constraint-immune/index.ts:80`、`:101` 违规提醒路径直接返回、不调用 `next()`）。v0.3 的 P0 修复对象据此修正。
2. Codex 的 v0.3 方向（I-07/I-08/I-11/I-10/I-17/I-03）经独立核验成立；其中 I-03 缩减为"四区标签 + pressure event"——原文未提出驱逐排序与压力信号，不做文章外扩展。
3. dsh 无 post-assistant review 接缝（`agent-loop/src/agent.ts:381-398` assistant 消息直连工具执行），I-07 审查只能落在 `tools/pre-execute` + `agent/turn-stopping` + 错误事件上。
4. 能力感知路由可行但需两步：`agent/request` 先 `next()` 拿到 `LlmCallConfig`，再 `ctx.llm.resolveModelInfo(provider, model, signal)` 查 `reasoning.efforts`（`llm/src/index.ts:619-625`、`llm/src/types.ts:252-280`）。
5. 插件持久化自定义事实的正确路径：**插件自有 sidecar JSONL**（按 sessionId 分文件，落在 `<session.header.cwd>/.dsh/oh-my-dsh/facts-<base64url(sessionId)>.jsonl`——SessionId 是 unvalidated branded string，禁止裸拼路径）。**禁止** `session.append()` 写自定义事件——dsh 持久化读路径 `assertEventsSupported`（`session-persistence/src/coordinator.ts:1063`）对未知事件类型抛 `SessionFormatUnsupportedError` 且 append 无 `ignorable` 写入 API，写入即毒化该 session 的重启 resume（评审实证）。`ctx.emit('session/event')` 仅作观测通知。
6. 消息有稳定 ID：`Message.id: MessageId`（`llm/src/message.ts:129-143`），`createMessage` 用 `crypto.randomUUID()` 赋值（`:178-185`），跨 pre-step 去重可用 `message.id`。
7. 验收等级 **A0**：本机具备可运行 dsh 与 API key，v0.3 必须包含真实安装、事件链、deny/ask 降级（fail-closed）、fork 恢复的端到端测试；allow-once 放行路径为 **A1 支线**（test answerer 插件，非发布门禁）。

---

## 1. 版本定位

### 1.1 v0.2 → v0.3 变化摘要

| 维度 | v0.2.0 | v0.3.0 |
|---|---|---|
| 插件数 | 4 | 7（新增 scope-guard、review-router、checkpoint-trace） |
| 事件链正确性 | constraint-immune 截断 waterfall | 全部 pre-step 监听器先 `next()` 再变换，组合顺序有回归测试 |
| 路由 | 关键词分类 + 模型升级骨架 | StrategyDecision 策略对象 + capability 对账 + requested/effective 记录 |
| 安全 | 负面约束工具拦截 | + 范围契约越界 ask/deny + 高风险操作 M4 用户确认 |
| 审计 | 无 | checkpoint 状态索引 + integrity hash 链 + Verdict 绑定 |
| 上下文 | 静态追加认知提示 | + 四区预算标签 + pressure event |
| 验收 | 桩测试 111 个（A1） | 桩测试 + 真实 dsh E2E（A0） |

### 1.2 不做什么

v0.3 不做 I-02/I-04/I-05/I-06/I-09/I-12/I-13/I-14/I-15/I-16 的运行时实现（排期见 `innovation-assessment.md` §4.2-4.5）。不在默认链路引入第二套工具调用协议。

---

## 2. 目标用户与用户故事

目标用户不变：使用 dsh + DeepSeek 模型、希望 Agent "该省的省、该花的花、不乱来" 的开发者。

- **US-1（安全）**：作为用户，我说过"不许动生产配置"，Agent 要删 `prod.yaml` 时，工具层直接 deny，且 event log 里能查到这次拒绝的证据。
- **US-2（范围）**：作为用户，任务做到一半我追加了"顺便把 README 翻译成英文"，系统能区分这是补充还是越界；越界时先问我，而不是默默扩大权限。
- **US-3（审查）**：作为用户，高风险操作（删除、外部发送、发布）在证据不足时不能放行；我能看到 RiskRecord 和 Verdict，而不是一句自然语言"我觉得可以"。
- **US-4（恢复）**：作为用户，会话中断或出错后，能从最近的 checkpoint 恢复，且恢复前校验 integrity hash 与 workspace digest。
- **US-5（路由可解释）**：作为用户，每次模型/推理强度决策都能从日志复原：意图、confidence、requested vs effective effort、降级原因。
- **US-6（预算）**：作为用户，上下文超预算时系统先发出 pressure event 并说明哪一区被压缩，稳定约束不会被静默丢弃。

---

## 3. 功能需求

### 3.1 P0-1：constraint-immune waterfall 修复

**问题**：`src/constraint-immune/index.ts:80`（否定型违规提醒）与 `:101`（肯定型缺失提醒）直接 `return { kind: 'enter', ... }`，不调用 `next()`，下游 pre-step 监听器被跳过。

**需求**：重构为统一委托模式——先 `await next()` 拿到下游决策，若下游 reject 则透传，否则在 `decision.messages` 上叠加约束提醒后返回。

**验收标准**：
- AC-1：constraint-immune 触发违规提醒时，排在其后的另一个 pre-step 插件仍收到控制流并被调用。
- AC-2：下游返回 reject 时，constraint-immune 不追加提醒、原样透传 reject。
- AC-3：无违规路径行为与 v0.2 完全一致（现有 19 个 constraint-immune 集成测试保持绿色）。
- AC-4：`signal.aborted` 路径直接 `return next()`，不做任何变换。

### 3.2 P0-2：事件链组合测试基建

**需求**：新增组合顺序测试，模拟多个 pre-step 插件同时加载；为真实 E2E 准备测试替身与夹具。

**验收标准**：
- AC-1：cognition-gate + constraint-immune 同时加载，后者先注册时前者仍被调用，反之亦然。
- AC-2：tools/pre-execute deny 时工具不执行，allow 时正常执行（桩环境断言 + 真实 E2E 复核）。
- AC-3：event log 中可观察到插件决策记录。

### 3.3 P0-3：I-10/I-17 能力感知路由（intent-router / model-router 硬化）

**需求**：定义并落地最小 `StrategyDecision`：

```
intent, confidence, model, requestedReasoningEffort,
effectiveReasoningEffort, budgetClass, riskClass,
fallbackReason, evidenceRefs
```

执行逻辑：
1. `agent/request` 中先 `next()` 拿到 `LlmCallConfig`；
2. 分类意图，读取 `ctx.llm.resolveModelInfo(config.provider, config.model, signal)` 的 `reasoning.efforts`；
3. 请求 effort 不在支持列表时自动降级到最近支持档，`fallbackReason` 记录原因；capability 查询失败/unknown 时不设置 effort（用 provider 默认）并记录 `fallbackReason: 'capability-unknown'`；
4. requested/effective 对账写入 sidecar 事实（`appendFact('oh-my-dsh/strategy', ...)`）；
5. model-router 的不满意度 streak 按 `message.id` 去重（同一消息只计一次，修复 v0.2 已承认的重复读取问题；进程内状态用 `WeakMap<Session, …>` 防长驻进程泄漏）；
6. effortMap 补齐 `simple`、`spec_driven` 默认策略——`simple` 用哨兵值 `'auto:lowest'`（运行时解析为 capability 列表最低档，StrategyDecision.requested 记哨兵、effective 记解析值），`spec_driven → 'high'`，8 类意图全部有显式默认。

**验收标准**：
- AC-1：8 类意图（refactor/new/medium/collaboration/architecture/research/simple/spec_driven）均有显式默认策略。
- AC-2：模型不支持所请求 effort 时不静默假装成功——effective 为降级值且 `fallbackReason` 非空。
- AC-3：路由决策可从 sidecar 事实日志复原（StrategyDecision 字段齐全）。
- AC-4：现有 classifier、model-router 单元测试继续通过。
- AC-5：同一 message ID 的不满意度只计算一次（桩测试构造重复 pre-step 场景验证）。
- AC-6：provider caveats 写入文档：`high` 可能被忽略、`max` 可能仅为 prompt injection（17-reasoning-effort-control.md:129-130）——本版本只保证"对账可见"，不承诺 hosted endpoint 语义。

### 3.4 P0-4：I-08 范围契约（新插件 scope-guard）

**需求**：新增 `scope-guard` 插件，实现结构化 ScopeContract（字段对齐原文 `08-scope-creep.md:92-122` 的 YAML）：

```
scopeId, version, objective, inScope, nonGoals,
acceptanceCriteria, constraints: { allowedPaths, allowedTools, externalSideEffects },
changeBudget, owner, status, contractRevision
```

在 pre-step 只识别三类高置信变化：增加范围、替换目标、越过 allowedPaths/allowedTools。**处置映射（安全语义）**：增加范围与替换目标 → ask 提醒，用户确认后才 bump contractRevision 并落 scope-change 事实；越界 → 工具层 deny + 落事实；外部副作用（send/publish/delete 类，requiresApproval=true）→ ask（无 answerer 时 fail-closed 降级 deny）；低置信变化只提示确认，不自动扩大权限、不落事实。路径提取约定：参数键名属于 `path|file|filePath|target|dest|destination|cwd` 的值 + 任何含 `/` 的字符串参数值，normalize 后与 allowedPaths 前缀匹配。

**验收标准**：
- AC-1：用户要求删除不在 allowedPaths 的文件时，工具层 deny。
- AC-2：新增外部发送/发布/删除等副作用时进入 ask。
- AC-3：contractRevision 变化可追踪（sidecar 事实日志有版本序列，且仅在用户确认后递增）。
- AC-4：普通澄清不被误判为越界（桩测试：澄清类输入不产生 ScopeChange deny/ask）。
- AC-5：显式承认本版不做完整自然语言范围推理——只有结构化契约 + 高置信模式识别。

### 3.5 P0-5：I-07 审查路由（新插件 review-router，M0/M1/M4 最小集）

**需求**：新增 `review-router` 插件，实现三模式：

- **M0**：低风险，无需额外审查；
- **M1**：自动验证，要求 test/static/tool result 证据；
- **M4**：requiresApproval=true 的操作（R3 删除/越界写、R4 不可逆外部副作用），要求用户确认。风险判定三轴正交：`riskLevel`（R0-R4）/ `requiresCheckpoint` / `requiresApproval`——契约内 write/edit 是 R1（要 checkpoint 证据，**不要** 用户确认），只有 R3/R4 才进 M4。

最小 `RiskRecord`：`riskLevel, blastRadius, reversibility, changedPaths, requestedTools, requiredEvidence, contextHealth, selectedReviewMode`。

最小 `Verdict`：`verdict: pass|ask|reject|defer, checkpointRef, evidenceRefs, reason, policyVersion`。

接缝：tools/pre-execute（风险门）、tools/post-execute（结果记录）、agent/turn-stopping（回合完整性）、agent/request-error 与 agent/error（失败路径）。**不依赖不存在的 post-assistant hook。**

**验收标准**：
- AC-1：rm/delete 或外部副作用在证据不足时不能放行（deny 或 ask）。
- AC-2：自动测试证据满足 M1 时直接 pass。
- AC-3：M4 触发 ask 决议——有 approval answerer 时在同一工具调用内闭环（allowed-once/rejected/cancelled）；无 answerer 时**立即** fail-closed 降级 deny（reason 含 "requires approval"），不挂起、不存在跨轮次等待的 ask（dsh approval 无超时概念，request 强制 turn 内闭环）。
- AC-4：Verdict 绑定本次请求或 checkpointRef，非纯自然语言输出（经 `oh-my-dsh/verdict` sidecar 事实落盘）。
- AC-5：风险分级保守——不确定时向更高风险档归并（对齐 07-review-switching.md 不对称阈值原则）。

### 3.6 P0-6：I-11 最小可追溯 checkpoint（新插件 checkpoint-trace）

**需求**：新增 `checkpoint-trace` 插件，做状态索引（非全工作区快照）：

```
checkpointId, taskId, sequence, sessionId, turn, step,
contractRevision, strategyDecisionRef,
workspaceDigest, planDigest, changesetRefs,
evidenceRefs, testResults, approvals,
openIssues, resumePreconditions,
integrityHash, previousCheckpointId
```

- workspaceDigest：git 可用时 = sha256(HEAD + `git status --porcelain`)；不可用时 = sha256(changedPaths + mtime 列表) 并标注 digestMethod。只用 Node 内置模块（crypto/child_process/fs），不新增依赖。
- planDigest：当前 contract + strategy 引用的 hash。
- integrityHash = sha256(canonical JSON（递归 key 排序）+ previousCheckpointId)，形成 hash 链。
- 触发点：requiresCheckpoint=true 的操作执行前后（判定取自共享 `src/shared/risk.ts` 三轴模型：R1 契约内写、R3、R4）、turn-stopping 前、request error / 重试耗尽、pause/handoff/exit。
- 存储：**sidecar JSONL**（`appendFact('oh-my-dsh/checkpoint', ...)`），禁止写 session.append；恢复前验证 integrityHash 与 workspaceDigest；workspace 或 plan 变化后旧 verdict 自动失效（追加 invalidation 事实）。**不把 session/flush 命名为 checkpoint。**

**验收标准**：
- AC-1：任一 requiresCheckpoint 动作（含契约内 write/edit）都能从 sidecar 事实日志找到最近 checkpoint。
- AC-2：checkpoint 能指出所依据的测试与 artifact 引用。
- AC-3：workspace/plan digest 变化后，绑定旧 digest 的 verdict 标记为 invalidated。
- AC-4：fork 后可从 checkpoint 继续（判据：fork 在 checkpoint 边界成功 + 子 session 能按 parentSessionId 从 sidecar 索引到 fork 前最近 checkpoint；fork 不切开 open turn，遵守 `session/src/index.ts:1068-1095` 约束）。
- AC-6：resume 哨兵——含本插件事实的 session 在 kill 进程、重启 dsh 后 resume 必须成功（sidecar 设计的直接验证；事实若误入 session log 此条必红）。
- AC-5：redaction——checkpoint 不写入密钥/凭证类字段（对齐 11-checkpoint-review.md redaction 要求）。

### 3.7 P0-7：I-03 软注意力预算

**需求**：不做驱逐排序、不重写 compaction。给上下文注入加四区预算标签：

- `stable`：约束、策略版本、不可变指令；
- `evidence`：测试、工具结果、引用；
- `active`：当前目标与正在修改的文件；
- `external`：可重新检索的索引。

每个 section 携带 `estimatedTokens, priority, ttl, source`。超预算（可配置阈值）时输出 pressure event（含哪一区、估算值、建议动作）；stable 与未完成 active 不自动丢弃。cognition-gate 的注入接入该标签体系（其认知提示标记为 `stable` 区）。

**验收标准**：
- AC-1：pressure event 能解释哪段内容触发压力、建议压缩哪区。
- AC-2：stable 约束不会因 pressure 被静默删除（桩测试断言）。
- AC-3：token 估算只作压力信号——文档与日志措辞不得冒充精确计费。
- AC-4：同一任务两种预算策略的回归样例各一。

---

## 4. 非功能需求

- **零运行时依赖**：仅三个 peerDependencies（`@deepseek-ai/cordis`、`@deepseek-ai/dsh-tools`、`@deepseek-ai/schemastery`）。Node 内置模块（crypto/child_process）允许使用。
- **TypeScript strict**：`strict: true` + `noImplicitAny: true`，typecheck 0 错误为门禁。
- **测试先行**：每个里程碑先写失败测试再实现；v0.2 的 111 个测试全程保持绿色，不得删测试过门禁。
- **版本兼容声明**：peerDependencies 收窄为 `0.1.0-rc.*`；README 声明已验证 dsh @ `47f943859b`（0.1.0-rc.5），rc 间破坏性变更由用户自查。
- **resume 不毒化**：插件事实一律落 sidecar JSONL，禁止向 session log 写自定义事件（dsh 读路径拒绝未知事件类型）；E2E 含 kill→重启→resume 哨兵断言。
- **进程内状态防泄漏**：跨步骤的会话状态用 `WeakMap<Session, …>` 或挂在 `agent/disposed` 上清理，禁止裸 `Map<sessionId>`。
- **双语 commit**：标题 `English title | 简体中文标题`，正文 `English:` / `简体中文:` 双块，原子粒度。
- **文档真实性强约束**：创新点状态只许写"已做/半做/未做/研究中"；禁止用提示词存在替代运行时完成；证据等级（A0 真实运行 / A1 桩测试）逐条标注。

## 5. 范围外（v0.3 明确不做）

- I-02/I-04/I-18（排 v0.3.1）、I-06/I-12/I-14（v0.4）、I-05/I-09（v0.5）、I-13/I-16（研究支线）、I-15（默认路径不做）。
- 不重写 compaction、不做字节级布局、不做 I-03 驱逐排序与压力驱逐。
- 不做 post-assistant review hook（dsh 无此接缝；如需要，向 dsh 提 seam 需求，不在 oh-my-dsh 内绕事件顺序）。
- 不用 `ctx.emit('session/event')` 当持久化写入路径；**不用 `session.append()` 写自定义事件**（毒化 resume，`coordinator.ts:1063`）。
- 不改 dsh 源码、不动官网、不新增 npm 依赖。
- 不做完整自然语言范围推理（I-08 仅结构化契约 + 高置信模式）。

## 6. 发布形式

- `package.json` 版本 0.2.0 → 0.3.0；`cordis.patch.yml` insert 列表扩为 7 个插件。
- README 更新：三插件介绍、v0.3 Release Notes、创新点状态表（含证据等级）。
- GitHub 发布 v0.3.0 tag；真实 E2E 通过后官网更新版本说明。

---

## 附录 A：术语

| 术语 | 含义 |
|---|---|
| waterfall | dsh 事件模式：监听器必须调用 `next()` 委托下游，否则截断链路 |
| A0 / A1 | 证据等级：A0=真实 dsh 运行时验证；A1=仓库内桩测试验证 |
| StrategyDecision | I-10/I-17 的路由决策对象（见 3.3） |
| ScopeContract | I-08 的范围契约（见 3.4） |
| RiskRecord / Verdict | I-07 的风险记录与审查裁决（见 3.5） |
| checkpoint（本版） | I-11 的状态索引快照，非全量工作区拷贝（见 3.6） |
| 四区 | I-03 的 stable / evidence / active / external 上下文分区 |
| sidecar | 插件自有事实日志（`<session.header.cwd>/.dsh/oh-my-dsh/facts-<base64url(sessionId)>.jsonl`），strategy/scope-change/verdict/checkpoint/pressure/test-result 六类事实的持久化载体 |

## 附录 B：变更记录

| 日期 | 变更 |
|---|---|
| 2026-08-15 | 初版。基于 innovation-assessment + 六篇原文独立核验 + dsh 源码核验；修正 waterfall P0 指向 constraint-immune；I-03 缩减；验收定级 A0 |
| 2026-08-15 | 双评审修订：持久化从 session.append 改道 sidecar JSONL（append 自定义事件毒化 resume，coordinator.ts:1063）；新增 resume 哨兵 AC；scope-guard 处置映射与路径提取约定补齐；effortMap 哨兵语义；WeakMap 防泄漏 |

