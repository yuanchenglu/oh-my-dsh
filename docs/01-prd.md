# oh-my-dsh PRD

> 版本：v0.1.0 | 日期：2026-08-13 | 状态：待评审
> 本 PRD 面向 AI 执行者设计：每个功能点都可直接映射为代码任务，不含模糊表述。

## 1. 产品定位

**oh-my-dsh 是一个 npm 包形式的 DeepSeek Harness (dsh) 插件 bundle**，用户执行 `dsh plugin add oh-my-dsh` 一条命令后，获得针对 DeepSeek 模型深度优化的"认知层"能力。

### 1.1 一句话定义

让 DeepSeek 模型在 dsh 平台上"该省的省、该花的花、不乱来"——按任务意图自动匹配推理强度、在模型输入前注入认知导航、在执行前检查硬约束。

### 1.2 与官方 dsh 的关系

| | 官方 dsh | oh-my-dsh |
|---|---|---|
| 定位 | 通用 Agent 平台（一切皆插件） | 认知层优化插件（bundle） |
| 提供 | 技术架构（模型/工具/会话/沙箱/UI） | 认知策略（意图路由/门控/约束） |
| 关系 | 宿主 | 寄生（注入官方平台） |

oh-my-dsh **不替代、不修改、不 fork** 官方 dsh，只通过官方插件 API（apply/inject/defineTool/事件）挂载能力。

### 1.3 与 oh-my-deepseek-harness 的关系

| | oh-my-deepseek-harness | oh-my-dsh |
|---|---|---|
| 宿主 | Hermes Agent (Python) | DeepSeek Harness (TypeScript) |
| 语言 | Python 3.10-3.12 | TypeScript (Node 22.19+) |
| 推理强度控制 | 文本提示注入（受限于 Hermes hook） | 直接设置 reasoningEffort API 参数 |
| 发布形式 | install.sh 脚本 | npm 包 + dsh plugin add |
| 关系 | 设计源头 | 平台移植（更强） |

## 2. 目标用户

### 2.1 主要用户

使用 dsh 作为 Agent 平台、以 DeepSeek 模型为主要 LLM 的开发者。特征：
- 已跑通 `npx @deepseek-ai/dsh web`
- 有 DEEPSEEK_API_KEY
- 希望模型"更聪明地花钱"（省 token）且"不乱来"（遵守约束）

### 2.2 用户故事

**US-1（省 token）**：作为 dsh 用户，我希望简单任务（改一个文件）不要触发 max 推理，复杂任务（架构设计）自动用 max 推理，这样 token 花在刀刃上。

**US-2（不乱来）**：作为 dsh 用户，我希望模型在收到"不要改 API 契约"这类指令后，真的不改——即使它认为改了更好。

**US-3（一条命令）**：作为 dsh 用户，我希望 `dsh plugin add oh-my-dsh` 之后不用配置就能用，想调优时改 cordis.yml 就行。

## 3. 功能需求

### 3.1 功能全景

oh-my-dsh bundle 内部包含 4 个小插件（小颗粒、可独立禁用）：

| 插件 | 一句话 | 优先级 |
|---|---|---|
| intent-router | 意图分类 → 自动设置 reasoningEffort | P0 |
| cognition-gate | 每轮模型调用前注入 L1/L2/L3 认知导航 | P0 |
| constraint-immune | 提取并强制执行用户硬约束（"不要 X"） | P1 |
| model-router | Flash-first 省钱，复杂任务自动升级 Pro | P2 |

### 3.2 P0-1：intent-router 插件

**功能**：在 LLM 调用前，对用户消息做意图分类（7+1 种），按意图自动设置 API 的 reasoningEffort 参数。

**意图分类规则**（从 oh-my-deepseek-harness 的 intent_router.py 1:1 移植）：

7 种意图 + 1 种兜底（spec_driven）：
- refactor：重构/拆分/迁移（关键词：重构,拆,拆分,迁移,restructure,refactor,模块拆分,重组,重写）
- new：从零构建（关键词：新建,从零,创建,new,create,项目,初始化,生成）
- medium：中等规模修改（关键词：添加,修改,更新,增加,add,modify,功能,扩展）
- collaboration：多 Agent 协作（关键词：协作,多人,分派,并行,collaborate,parallel,team,分工）
- architecture：架构设计（关键词：架构,设计,选型,architecture,design,system,系统,方案）
- research：探索性任务（关键词：调研,分析,探索,research,analyze,研究,对比,评估）
- simple：单文件明确修改（关键词：修复,改,bug,fix,typo,一行,小改）
- spec_driven：兜底（无匹配或置信度 < 0.5）

**分类算法**（CJK 关键词匹配，从 intent_router.py 移植）：
1. 对每个意图的关键词列表，逐词在文本中匹配
2. 匹配策略：精确子串 → 1.0；纯英文无 CJK → 0.0；短 CJK(≤2字) → 仅精确；长 CJK(≥3字) → 字符重叠比例 ≥ 0.5
3. 置信度 = best_score / (best_score + second_score)
4. 置信度 < 0.5 → 返回 spec_driven

**意图 → reasoningEffort 映射**（可配置）：

| 意图 | 默认 reasoningEffort |
|---|---|
| architecture / research / collaboration | max |
| refactor / new / medium | high |
| simple / spec_driven | （不设置，用模型默认） |

**DSH 挂钩点**：`llm/stream` 瀑布事件——在 `next()` 调用前改写 `options.reasoningEffort`。

**验收标准**（每条 AC 对应测试文件+用例编号，见测试体系文档）：
- AC-1：输入"帮我重构这个模块"→ intent=refactor, reasoningEffort=high（对应测试：classifier.test.ts fixtures[0]）
- AC-2：输入"设计一个微服务架构"→ intent=architecture, reasoningEffort=max（对应测试：classifier.test.ts fixtures[11]）
- AC-3：输入"修复这个 typo"→ intent=simple, reasoningEffort 不设置（对应测试：classifier.test.ts fixtures[17]）
- AC-4：输入无关键词文本 → intent=spec_driven, reasoningEffort 不设置（对应测试：classifier.test.ts fixtures[19]）
- AC-5：置信度 < 0.5 时回退 spec_driven（对应测试：classifier.test.ts fixtures[19-21] + 专项测试）

### 3.3 P0-2：cognition-gate 插件

**功能**：每轮 LLM 调用前，在模型输入中注入认知导航（L1 荣辱观 / L2 思维方式 / L3 反省），首轮注入完整版，后续轮注入精简版。

**注入内容**（从 gate.py 移植，可配置）：

首轮注入（完整）：
```
[L1 荣辱观] 以知道自己的不足为荣、以提升认知为荣、以告诉实情为荣。不确定就说不确定。
[L2 思维方式] 第一性原理、Step by Step、假设先行、找盲区、科研严谨。
[I-02 双向原语] 可用 /propose_skill 提议固化 Skill，/trigger_self_review 请求审查。
[I-08 范围控制] 不得超出用户显式声明范围。"不加步骤能完成 = 范围蔓延，拒绝"。
```

后续轮注入（精简）：
```
[L1] 不确定就说不确定。[L2] 假设先行。[I-08] 不加步骤能完成 = 拒绝。
```

**DSH 挂钩点**：`agent/pre-step` 瀑布事件——改写 `payload.messages`，在用户消息后追加认知导航（作为新的 UserMessage 或拼接到最后一条消息末尾）。

**验收标准**：
- AC-1：第一轮 LLM 调用 → 注入完整版（含 L1/L2/I-02/I-08）
- AC-2：第二轮及以后 → 仅注入精简版
- AC-3：可通过 Config 关闭某一层（如只保留 L1）
- AC-4：可通过 Config 设置排除清单（某些消息不注入）

### 3.4 P1：constraint-immune 插件

**功能**：从用户消息中提取硬约束（"不要 X" / "必须 Y" / "禁止 Z"），会话内记忆，工具执行前检查是否违反。

**硬约束提取**（从 gate.py 的 extract_hard_constraints 移植）：
正则模式：`(?:不能|不要|不得|禁止|严禁|不允许|千万别|绝对不|必须)[^，。；、！？\n]{2,60}`

**执行前检查**（从 immune_audit.py 移植）：
工具调用前，将工具参数文本与硬约束集合比对，命中则拦截并返回违规提示。

**DSH 挂钩点**（已从 dsh v0.1.0-rc.5 源码验证）：
- `agent/pre-step`：提取硬约束（写入插件内部状态）
- `agent/pre-step`：生成前预防——检查历史消息是否违反约束，违反则在 messages 末尾追加约束提醒

**注意**：官方 dsh 的 tools 事件是 `tools/*` 管道（非独立的 pre-execute/post-execute 钩子），v0.1 通过 agent/pre-step 在模型生成前注入约束提醒实现"预防"，而非执行时"拦截"。拦截需要 tools/* 事件的深入适配，列入 v0.2。

**验收标准**：
- AC-1：用户说"不要修改 API 契约"→ 提取硬约束（对应测试：extractor.test.ts #1）
- AC-2：后续 agent/pre-step 检测到涉及 API 修改 → 在 messages 末尾追加约束提醒（对应测试：extractor.test.ts #6 + integration test）
- AC-3：可通过 Config 添加自定义约束关键词（对应测试：extractor.test.ts #5）

### 3.5 P2：model-router 插件（v0.1 不实现，仅规划）

Flash-first 省钱策略：默认用 deepseek-v4-flash，满足升级条件时自动切 deepseek-v4-pro。
升级条件（从 deepseekagent model_router 移植）：token 数超阈值 / 意图为 architecture/research / 连续两轮不满意。

## 4. 非功能需求

### 4.1 性能
- intent-router 分类延迟 < 1ms（纯文本关键词匹配，无 LLM 调用）
- cognition-gate 注入延迟 < 0.1ms（字符串拼接）
- 硬约束提取延迟 < 1ms（正则匹配）

### 4.2 兼容性
- dsh 版本：v0.1.0-rc.5+（Developer Preview）
- Node.js：22.19+（官方引擎下限）
- TypeScript：strict + noImplicitAny

### 4.3 可配置性
- 所有可调参数通过 Config Schema（Schemastery）暴露
- 每个插件可独立禁用（cordis.yml 中 disabled: true）

### 4.4 可测试性
- 每个插件有独立测试文件（vitest）
- 意图分类有 fixture 测试集（20+ 条中英文输入 → 期望意图）
- 安装流程有 E2E 测试（模拟 dsh plugin add）

## 5. 范围外（v0.1 不做）

- ❌ 不做 UI（dsh Web UI 的自定义组件）
- ❌ 不做 model-router（P2，v0.2）
- ❌ 不做 prefix-stabilizer / context-layout（P2，v0.2）
- ❌ 不做 Python 桥接（全 TS 重写）
- ❌ 不做多模型支持（仅 DeepSeek）

## 6. 发布形式

- npm 包：`oh-my-dsh`（dsh.bundle manifest）
- 安装：`dsh plugin add oh-my-dsh`
- 配置：cordis.yml 中按插件 id 配置
- 仓库：GitHub `yuanchenglu/oh-my-dsh`，topic `dsh-plugin`
