---
title: oh-my-dsh v0.2 PRD
created: 2026-08-14
innovation_points: [I-06, I-07, I-11, I-12, I-14, model-router, constraint-interception]
kv_cache_stable: true
---

# oh-my-dsh v0.2 PRD

> **TL;DR** — v0.2 解锁 v0.1 技术债务：新增 model-router 插件（Flash-first 省钱、复杂任务自动升 Pro）、constraint-immune 增加执行时拦截（tools/pre-execute deny）与肯定型约束"缺少执行"检查。12 个创新点的源码调研已完成，结论：I-04 官方已覆盖（不做）、I-14 不可靠（不做）、I-07/I-12 可行但列为 v0.2 备选、I-06/I-11 需新 API（推 v0.3）、I-03 推 v0.3 评估。

## 核心结论

1. model-router 用 `agent/request` 瀑布切 model，有官方先例（model-selection.ts）
2. 执行时拦截用 `tools/pre-execute` 返回 deny，参数只读不可改写
3. 肯定型约束检查只做"首次响应缺执行"一次性提醒，避免噪音
4. I-04/I-14 不做，I-06/I-11/I-03 推 v0.3，I-07/I-12 为 v0.2 备选
5. 零额外依赖：token 估算用 chars/4 启发式，不接 token-meter 服务

---

## 1. 版本定位

v0.2 = v0.1（已修复 review 全部 🔴/🟡 问题）+ 技术债务解锁。宿主仍是 dsh v0.1.0-rc.5，不替代、不修改、不 fork 官方 dsh。

### 1.1 v0.1 → v0.2 变化摘要

| 维度 | v0.1 | v0.2 |
|---|---|---|
| 插件数 | 3（intent-router / cognition-gate / constraint-immune） | 4（+ model-router） |
| 约束执行 | 仅生成前提醒（agent/pre-step） | 提醒 + 执行时拦截（tools/pre-execute） |
| 约束类型 | 否定型判定，肯定型只记录 | 肯定型增加"缺少执行"一次性检查 |
| 模型选择 | 固定用 profile 配置的模型 | Flash-first，满足条件自动升 Pro |
| reasoningEffort | intent-router 按意图设置（agent/request） | 不变；与 model-router 共存（见 3.1.5） |

## 2. 目标用户与用户故事

同 v0.1（dsh + DeepSeek 用户）。新增用户故事：

**US-4（省钱升级）**：作为 dsh 用户，我希望默认跑 deepseek-v4-flash，只有架构/研究/超长上下文/连续不满意时才自动切 deepseek-v4-pro，省下的 token 就是钱。

**US-5（真拦截）**：作为 dsh 用户，我说"禁止删除生产数据"后，模型调用 `delete_file` 且参数命中生产路径时，工具调用应被直接拒绝，而不是只收到一条提醒。

**US-6（必须执行）**：作为 dsh 用户，我说"必须先备份再操作"后，如果模型的首次响应完全没提备份，应收到一次性提醒。

## 3. 功能需求

### 3.1 P0-1：model-router 插件（新增）

**功能**：在每次 LLM 调用前评估升级条件，决定本次请求用 flash 还是 pro。

#### 3.1.1 升级条件（满足任一即升 Pro）

| # | 条件 | 判定方式 | 默认值 |
|---|---|---|---|
| C1 | 意图为 architecture 或 research | 复用 intent-router 的 `classifyIntent`（最后一条用户消息） | 开 |
| C2 | 估算 token 超阈值 | 全量消息字符数 / 4（启发式，来源见架构文档） | 30000 |
| C3 | 连续两轮用户不满意 | 用户消息命中"不满意"正则，连续 2 轮 | 开 |

以上条件均可通过 Config 调整或关闭。条件均不满足时使用 `defaultModel`。

#### 3.1.2 不满意判定正则

```
(?:不对|错了|重新|重来|不行|不符合|不是这样|再试|wrong|try again|not right)
```

"连续两轮"定义：同一 agent 会话中，最近两条用户消息都命中正则。第三轮用户消息不命中则清零并重置为 flash。

#### 3.1.3 模型切换方式

挂 `agent/request` 瀑布：`await next()` 拿到调用配置，满足升级条件则返回 `{ ...callConfig, model: proModel }`，否则返回 `{ ...callConfig, model: defaultModel }`。**provider 不变**（flash 与 pro 同属一个 provider，避免跨 adapter 的 replayState 剥离问题）。

官方先例：`installModelSelection` 通过 `agent/request` 重定向 provider/model（packages/core/agent/src/model-selection.ts:54-69）。

#### 3.1.4 每步重评估

`agent/request` 每个 step 触发一次（含工具循环内的后续 step）。因此模型选择是逐步动态的：条件消失后下一步自动回落 flash。无需显式"降级"逻辑。

#### 3.1.5 与 intent-router 的共存

两个插件都挂 `agent/request`，职责正交：intent-router 改 `reasoningEffort`，model-router 改 `model`。cordis waterfall 按注册顺序串联（先注册者先执行），patch 中 model-router 排在 intent-router 之后，最终 config 同时携带两者的修改。两者不读对方的修改结果。

#### 3.1.6 Config

```yaml
- id: model-router
  config:
    enabled: true
    defaultModel: deepseek-v4-flash
    proModel: deepseek-v4-pro
    upgradeIntents: [architecture, research]   # C1，空数组 = 关闭
    tokenThreshold: 30000                      # C2，0 = 关闭
    dissatisfactionEnabled: true               # C3
    dissatisfactionPatterns: []                # 追加自定义"不满意"关键词
```

#### 3.1.7 验收标准

- AC-1：全新会话输入"帮我改个 typo"→ 请求 config.model = deepseek-v4-flash（对应测试：model-router 集成测试「简单任务保持 flash」）
- AC-2：输入"设计一个微服务架构方案"→ config.model = deepseek-v4-pro（对应测试：「架构意图升级 pro」）
- AC-3：构造 messages 总字符数 > tokenThreshold×4 → config.model = pro（对应测试：「token 超阈值升级」）
- AC-4：连续两条用户消息命中"不对/重新"→ 第三次请求 config.model = pro；随后一条正常消息 → 回到 flash（对应测试：「连续不满意升级与回落」）
- AC-5：`enabled: false` 时不注册任何 listener（对应测试：「禁用不注册」）
- AC-6：provider 字段在任何情况下不被修改（对应测试：每个用例断言 `config.provider` 与 seed 一致）

### 3.2 P0-2：constraint-immune 执行时拦截

**功能**：v0.1 只在生成前追加提醒（预防）；v0.2 增加执行时拦截——工具调用派发前检查 `工具名 + 参数`，命中否定型硬约束关键词则返回 `deny`，工具体不执行。

#### 3.2.1 拦截机制

挂 `tools/pre-execute` 瀑布（签名见架构文档）：对每个会话已记录的**否定型**约束，检查 `exec.name + '\n' + JSON.stringify(exec.arguments)` 是否包含约束关键词；命中则返回 `{ kind: 'deny', reason: '[constraint-immune] 命中硬约束："<原文>"' }`。

dsh 会把 deny 的 reason 物化为 `isError: true` 的工具结果返回给模型（packages/core/tools/src/index.ts:1488-1498），模型下一轮能看到被拒原因并自我修正。

**注意**：`exec.arguments` 已 deepFreeze，只读不可改写（tools/src/index.ts:1412-1416）；`tools/pre-execute` 不支持参数重写（官方注释，tools/src/index.ts:583-586）。

#### 3.2.2 与 guard 的取舍

`ctx.tools.guard()` 是单调守卫（任何守卫返回字符串即最终拒绝，tools/src/index.ts:1100-1128），更适合"绝不允许"场景。v0.2 选择 `tools/pre-execute` 而非 guard，原因：① 与现有插件同用事件模式，测试基建复用；② deny reason 会被物化为工具结果喂回模型，可解释性好；③ guard 的同步单调语义对"关键词误伤"没有回旋余地。架构文档记录 guard 为备选方案。

#### 3.2.3 误伤控制

拦截只针对否定型约束。关键词匹配在"工具名+参数 JSON"上比在自然语言上噪音更大，因此：

- 约束关键词长度 < 4 字符时不参与拦截（如"改"），只参与提醒
- Config 提供 `interception` 开关：`'off' | 'deny'`（默认 `deny`）；`off` 时退化为 v0.1 纯提醒行为

#### 3.2.4 Config（在 v0.1 基础上追加）

```yaml
- id: constraint-immune
  config:
    enabled: true
    customPatterns: []
    interception: deny        # v0.2 新增：'off' | 'deny'
```

#### 3.2.5 验收标准

- AC-1：用户说"禁止删除生产数据"→ 模型发起 `delete_file`（arguments 含"删除生产数据"路径文本）→ 返回 deny，工具结果 `isError: true` 且文本含约束原文（对应测试：integration「命中约束的工具调用被 deny」）
- AC-2：同一约束下，模型发起 `read_file`（参数不含关键词）→ 正常 `next()` 放行（对应测试：「不命中放行」）
- AC-3：`interception: 'off'` 时不注册 `tools/pre-execute` listener（对应测试：「off 不注册拦截」）
- AC-4：关键词 < 4 字符的约束不触发拦截（对应测试：「短关键词只提醒不拦截」）
- AC-5：不同 agent 会话的拦截状态隔离（对应测试：「会话隔离」，复用 v0.1 会话 key 机制）

### 3.3 P1：肯定型约束"缺少执行"检查

**功能**：肯定型约束（"必须 X"）在 v0.1 只记录不判定。v0.2 增加一次性检查：约束首次出现后，模型的**第一段新 assistant 输出**若不含约束关键词，则追加一次提醒；只提醒一次，之后不再检查该约束。

#### 3.3.1 判定规则

- 检查窗口：约束首次出现之后、上一轮检查之后的新 assistant 消息（复用 v0.1 的 checkedUpTo 窗口机制）
- 只检查该约束首次出现后的**第一次**非空 assistant 输出；无论结果如何，该约束标记为 `positiveChecked`，后续轮不再检查
- 提醒文案与否定型区分：`[约束提醒] 检测到可能未执行硬约束："必须先备份再操作"。请确认已执行。`

#### 3.3.2 为什么只做一次性

肯定型约束的"遵守"不代表每轮都要复述关键词。持续检查会把正常对话打成误报（review Y3 已指出方向问题）。一次性检查覆盖最高价值场景：模型拿到约束后的第一反应就无视它。

#### 3.3.3 验收标准

- AC-1：用户说"必须先备份再操作"→ 下一段 assistant 输出含"备份"→ 无提醒（对应测试：「肯定型遵守不提醒」）
- AC-2：同一约束 → 下一段 assistant 输出完全不含"先备份再操作"关键词 → 追加一条"未执行"提醒（对应测试：「肯定型缺执行提醒」）
- AC-3：提醒过后第二轮仍不提备份 → 不再提醒（对应测试：「只提醒一次」）
- AC-4：肯定型约束永远不触发 tools/pre-execute 拦截（对应测试：「肯定型不拦截」）

### 3.4 技术债务解锁评估结论（12 创新点源码调研）

调研基于 dsh v0.1.0-rc.5 源码，证据（文件：行号）收录于 `docs/v02/02-architecture.md` 附录 A。

| 创新点 | 结论 | 依据（一句话） |
|---|---|---|
| I-03 注意力预算 | **推 v0.3 评估** | token-meter 只有 contextPressure 投影，无强制预算机制；可做但价值待证 |
| I-04 KV Cache | **不做（官方已覆盖）** | request/header 快照 + 冻结请求 + compaction 摘要复用前缀已实现 |
| I-13 Byte Stability | **不做** | dsh 无此概念；spill-policy 的字节预算是工具结果内联上限，语义不同 |
| I-06 PlanGraph | **推 v0.3** | plan-mode 只是状态开关（ctx.planMode.get/set），无图 API；需新增 SessionEventMap 事件 + projection |
| I-11 Checkpoint | **推 v0.3** | session-checkpoint-policy 只是持久化 flush，无快照/回滚 API；需新 Session 语义 |
| I-12 Memory 编译 | **v0.2 备选（stretch）** | `ctx.systemPrompt.section/context/variable` + `agent/pre-step` 注入的接缝都在，可实现 |
| I-14 Reasoning Replay | **不做** | replayState 是 adapter 私有的响应续传状态，跨 adapter 被剥离；类型上可塞 reasoning block 但 adapter 是否转发无保证 |
| I-07 审查路由 | **v0.2 备选（stretch）** | 无 post-output/pre-tool 挂钩；可用 `agent/turn-stopping` + `agent.steer()` + `agent/request` 两步舞实现间接审查 |

**备选（stretch）项规则**：P0/P1 全部完成且验收通过后，才允许启动 I-12 或 I-07；二者都进 v0.2 则各砍到最小形态（I-12：一个 systemPrompt.section 静态编译记忆；I-07：turn-stopping 观察 + steer 审查指令，不切模型）。

## 4. 非功能需求

### 4.1 性能
- model-router 评估延迟 < 2ms（复用分类器 + 字符计数，无 LLM 调用）
- 拦截检查延迟 < 1ms（字符串 includes）
- 肯定型检查延迟 < 1ms

### 4.2 兼容性
- dsh 版本：v0.1.0-rc.5（Developer Preview），peerDependencies 维持 `*`
- Node.js 22.19+；TypeScript strict + noImplicitAny
- v0.1 配置向后兼容：constraint-immune 不写 `interception` 字段时按默认值 `deny` 生效（行为变化在 Release Notes 中声明）

### 4.3 可配置性
- model-router 三个升级条件独立开关
- constraint-immune 拦截可整体关闭
- 每个插件可独立 disabled

### 4.4 可测试性
- 每个新功能有单元测试 + 集成测试（mock ctx）
- E2E 沿用 v0.1 修复期建立的真实安装验证流程（pnpm pack → dsh plugin add → dump-config → 冒烟 → 真实 headless 对话）

## 5. 范围外（v0.2 不做）

- ❌ UI 自定义组件
- ❌ Python 桥接
- ❌ 多模型 provider 支持（仅 DeepSeek 官方 provider 内的 flash/pro 切换）
- ❌ tools 参数改写（官方不支持，tools/src/index.ts:583-586）
- ❌ I-03 / I-06 / I-11 / I-13 / I-14（结论见 3.4）
- ❌ guard 形式的拦截（备选，不实现）

## 6. 发布形式

- npm 包 `oh-my-dsh` v0.2.0（dsh.bundle manifest 不变）
- 安装：`dsh plugin add oh-my-dsh`（覆盖 v0.1 需先删 `~/.dsh/profiles/<profile>/node_modules/oh-my-dsh`，pnpm 不重装同路径旧 tarball）
- 配置：cordis.yml 按插件 id 配置

---

## 附录 A：术语

| 术语 | 含义 |
|---|---|
| 否定型约束 | "不能/不要/不得/禁止/严禁/不允许/千万别/绝对不"开头的约束，命中 = 违规 |
| 肯定型约束 | "必须"开头的约束，命中 = 遵守，v0.2 只查"首次响应缺执行" |
| 两步舞 | I-07 的间接实现：turn-stopping 观察 → steer 注入审查指令 → 下一步 agent/request 切模型 |

## 附录 B：变更记录

| 日期 | 内容 | 来源 |
|---|---|---|
| 2026-08-14 | 初版，基于 v0.1 修复后代码 + 4 路 dsh 源码调研 | v0.2 规划任务 |
