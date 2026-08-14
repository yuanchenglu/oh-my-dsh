# oh-my-dsh 创新点完整评估与产品规划

> 评估人：Codex（gpt-5.6-luna, xhigh）· 交付总监复核
> 日期：2026-08-14
> 结论基线：oh-my-dsh v0.2.0（4 插件，110/110 测试通过）
> 证据域：论文 18 篇创新点文章 + zh/theory + README + oh-my-dsh src/ + dsh v0.1.0-rc.5 源码

---

## 1. 执行摘要：一页价值地图

### 1.1 总判断

oh-my-dsh v0.2 已经形成四个可工作的“控制点插件”：

1. intent-router：在 agent/request 处按关键词把请求映射到 7+1 意图，并调整模型或 reasoning effort。
2. model-router：根据意图、估算 token 压力和不满意度，尝试把请求升级到更强模型。
3. cognition-gate：在 agent/pre-step 向用户消息追加 L1/L2 认知提示与部分创新点提示。
4. constraint-immune：从用户消息提取约束，在下一步提醒，并在 tools/pre-execute 对负面约束执行拒绝。

这四项是“请求路由、软提示、约束拒绝”的最小原型，不是 18 项创新点的完整运行时。当前最准确的状态是：

- 已做或接近已做：I-10 的关键词意图分类骨架；I-01 的约束拒绝子集；I-17 的模型与 reasoning effort 调整子集。
- 半做：I-01、I-03、I-04、I-08、I-10、I-17、I-18。
- 未做：I-02、I-05、I-06、I-07、I-09、I-11、I-12、I-13、I-14、I-15、I-16。
- 应该优先补的不是更多提示词，而是事件接缝正确性、风险审查、证据化 checkpoint、能力感知路由和范围变更治理。

### 1.2 价值地图

| 价值层 | 创新点 | oh-my-dsh 当前状态 | dsh 可用接缝 | v0.3 最小价值 | 主要风险 |
|---|---|---|---|---|---|
| 安全与可恢复 | I-01、I-07、I-08、I-11 | 约束拒绝已有，审查、范围契约、checkpoint缺失 | tools/pre-execute、agent/turn-stopping、session/event、session/flush、fork | 高风险操作先阻断或要求证据；可恢复、可审计 | 只做提示会产生“安全幻觉” |
| 决策与路由 | I-10、I-17、I-16 | 关键词路由和模型升级已有，能力探针缺失 | agent/request、llm/stream、模型 reasoning capability | 路由结果变成可解释、可验证的策略包 | 关键词误判；把 requested effort 当成 effective effort |
| 上下文与成本 | I-03、I-04、I-05、I-12、I-13、I-18 | token 粗估和静态注入已有 | system-prompt/assemble、request header、compaction、agent-instructions | 稳定区、活跃区、证据区分层；动态上下文有来源和TTL | 追加文本造成漂移、重复和缓存失效 |
| 计划与学习 | I-02、I-06、I-09、I-14 | 无可验证运行时 | goal、plan-mode、skills、reasoning blocks、session log | 计划、技能、推理策略均有审批和回滚边界 | 自动自演化扩大权限与不可控变更 |
| 实验研究 | I-15、I-16、I-13 | 无默认实现 | dsh 工具 schema、adapter、usage、header | 作为隔离实验验证编码、探针和缓存假设 | 未证协议、供应商兼容性和不可复现 |

### 1.3 三个必须修正的认识

第一，v0.2 的“12个创新点”是错误的历史说法。研究目录实际有 18 篇文章，当前研究仓库 README.md:64-87 明列 I-01 至 I-18。旧的 paper.md:8,116,288-313 和 oh-my-dsh docs/v02/03-plan.md:798 仍写“12”，应视为过时索引，不应作为当前规模结论。oh-my-dsh 中的未跟踪交接文档 docs/03-handoff-codex-innovation-assessment.md:17-36,58-83 已经意识到这一点，但本报告不写入该文件。

第二，I-07 不是“KV occupancy 驱动的简单模型切换”。原文 07-review-switching.md:15-34,80-152,156-302 的核心是 Review Router：变更或决策 → 风险等级 → 证据完整度 → 可逆性与爆炸半径 → 上下文健康 → Review Mode → 绑定证据的 Verdict。模型切换至多是审查策略中的一个执行动作，不能替代风险分类、证据规范和否决路径。

第三，I-11 不是“把摘要再存一次”，也不是 session/flush 的同义词。原文 11-checkpoint-review.md:15-28,34-91,95-168,181-280 要求版本化、可验证、可恢复的状态快照，包含 workspace hash、plan version、changeset、artifact hash、测试、审批、错误、恢复前提，并让 verdict 绑定 checkpoint 和 hash。dsh 的 session/flush 是持久化耐久点；compaction checkpoint 是压缩溯源标记；二者都是接缝，不等于 I-11 完成。

### 1.4 验证基线

已运行：

- pnpm vitest run --reporter=verbose：10 个测试文件、110 个测试通过。
- pnpm run typecheck：通过。
- 当前 e2e 不是运行时端到端：tests/e2e/install.test.ts:8-13 明确说明是静态 bundle 结构测试；docs/review-v0.1.md:49-55 也指出没有真实安装、对话、API 或 skipIf 验证。

因此，当前测试能证明函数和插件级行为在仓库测试替身中成立，不能证明四插件已在当前 dsh 主程序中按真实挂载顺序运行。这个边界不降低已有代码的价值，但必须降低“真实验证”“覆盖全部创新点”等宣传强度。

### 1.5 架构级首要发现

dsh 的 waterfall 事件要求插件调用 next()，否则后续监听器可能收不到控制流。架构文档 deepseek-harness/docs/architecture.md:53-90 明确了这一点；dsh 自带 agent-instructions packages/context/agent-instructions/src/index.ts:322-366、time-context packages/context/time-context/src/index.ts:139-208 也都按此模式工作。

而 oh-my-dsh：

- src/cognition-gate/index.ts:24-33 的 agent/pre-step 直接返回，不调用 next()。
- src/constraint-immune/index.ts:36-107 的 agent/pre-step 分支也不是统一的 waterfall 委托模式。

如果这些监听器处在会截断链路的位置，plan、时间、文件指令或其他上下文插件可能被跳过。该问题是 v0.3 的 P0，不应通过增加更多 prompt 文案掩盖。

---

## 2. 18个创新点逐条评估表

表中“能否做进 oh-my-dsh”指产品归属判断；“已做”只统计 oh-my-dsh，不把 dsh 底座算作已完成。

| 编号 | 核心 | 能否做进 oh-my-dsh | 是否已做：代码对照 | dsh源码接缝：文件:行号 | 优先级 |
|---|---|---|---|---|---|
| I-01 Agent Immune System | 事件→保留证据→诊断→提出修复→验证→审批→灰度→监控→回滚的闭环；重点是边界、审计和恢复，不是单纯拒绝。 | 能；应作为安全控制平面 | 半做。src/constraint-immune/index.ts:36-107 保存约束、提醒违反；:109-137 在 tools/pre-execute 拒绝负面约束；但没有事件账本、诊断、修复提案、验证、审批、灰度、回滚。 | packages/core/tools/src/index.ts:1463-1505；packages/core/agent/src/runtime-types.ts:246-290；packages/core/session/src/index.ts:66-85 | P0 |
| I-02 Meta Requests / 双向代理 | 模型或用户可提出“请求技能、请求自检、请求升级”等元请求；每项请求必须结构化、可策略判定、可审计、可拒绝。 | 能；适合做成工具与事件协议 | 半做。src/cognition-gate/injector.ts:3-12 只在提示词中写 /propose_skill、/trigger_self_review；没有同名工具、schema、执行器、审批或结果事件。 | packages/core/agent/src/runtime-types.ts:232-244；packages/core/tools/src/index.ts:142-175,582-600；packages/core/agent/src/runtime-types.ts:135-143 | P1 |
| I-03 Attention Budget | 把上下文预算分成稳定约束、额外证据、活跃工作集、外部索引，并按任务风险和阶段分配；不是简单截断历史。 | 能；应先做软预算再做硬裁剪 | 半做。src/shared/messages.ts:21-29 只按字符除以4估算；src/model-router/index.ts:54-78 用 token 估算触发升级；cognition-gate 只做 full/brief；没有四区预算、淘汰策略或效果测量。 | packages/core/system-prompt/src/index.ts:457-542；packages/llm/token-meter/src/estimate.ts:12-87；packages/llm/token-meter/src/projection.ts:30-75；packages/compaction/compaction/src/index.ts:87-169 | P0 |
| I-04 Stable Constraints / Compressible History | 稳定约束进入稳定前缀，历史压缩必须保持结构与可追溯性，以降低缓存抖动和约束丢失。 | 能；依赖 dsh 的 canonical header 和 compaction 底座 | 半做。constraint-immune 保存约束并在运行时提醒或拒绝，但没有稳定区编译、约束版本、压缩前后校验和缓存命中指标。 | packages/core/agent-loop/src/agent.ts:407-494；packages/core/session/src/request-header.ts:1-70；packages/compaction/compaction/src/index.ts:119-169 | P1 |
| I-05 Agent-readable Docs | 将文档编译成任务可消费的结构：触发条件、输入、输出、边界、证据和恢复；不是把 README 全塞进 prompt。 | 能；但应是文档编译器或 provider，不宜堆在四插件中 | 未做。当前没有文档 section 编译、触发索引、版本和证据字段。dsh 的 agent-instructions 是相关动态上下文能力，不等于 oh-my-dsh 已有文档编译。 | packages/core/system-prompt/src/index.ts:373-455,457-542；packages/context/agent-instructions/src/index.ts:1-7,322-366 | P2 |
| I-06 PlanGraph / 计划级联 | 目标、计划、步骤、依赖、验收和证据形成可暂停、可恢复、可重排的图，而不是线性 TODO 文本。 | 能；可复用 dsh goal/plan 底座 | 未做。dsh 有 goal 和 plan-mode，但 oh 没有 PlanGraph、typed edge、step evidence、依赖失效传播或验收状态。 | packages/goal/goal/src/types.ts:15-83；packages/goal/goal/src/domain.ts:61-67；packages/plan/plan-mode/src/index.ts:46-54,180-265,425-460 | P1 |
| I-07 Risk / Evidence Review Router | 按风险 R0-R4、爆炸半径、可逆性、证据完整度、上下文健康选择 M0-M5 审查模式，输出绑定证据的结构化 Verdict。 | 能；是 v0.3 的核心价值，但不能简化为模型切换 | 未做。当前没有风险分类、blast radius、evidence spec、independent review、human approval、reject/defer 或 hash-bound verdict；四插件也没有通用审查编排器。 | packages/core/agent/src/runtime-types.ts:232-290；packages/core/tools/src/index.ts:1463-1505；packages/core/agent-loop/src/agent.ts:381-399；packages/core/agent/src/runtime-types.ts:262-278 | P0 |
| I-08 Scope Change Governance | 对范围变化分类为澄清、补充、替换、越界；比较目标、成本、风险、证据和验收影响，要求用户确认或自动拒绝。 | 能；应与 constraint 和 review 共用账本 | 半做。constraint-immune 能识别约束和负面工具风险；cognition-gate/injector.ts:3-12 仅提示 I-08；没有 Scope Contract、变更提案、预算影响和 verdict。 | packages/core/agent/src/runtime-types.ts:219-244；packages/core/tools/src/index.ts:142-175；packages/core/session/src/index.ts:66-76；packages/core/agent/src/runtime-types.ts:262-278 | P0 |
| I-09 Governed Skill Supply Chain | 技能从候选→草案→测试→审批→灰度→观测→撤销，供应链每一步都有权限与证据。 | 能；但不能默认自动自演化 | 未做。dsh 有 ctx.skills、filesystem provider 和 change 事件，但 oh 没有候选生成、草案、测试、审批、灰度、撤销或能力边界。 | packages/skill/skill/src/index.ts:38-101,284-297；packages/skill/skill-filesystem/src/index.ts:1-7,129-143；packages/core/tools/src/index.ts:142-175 | P2 |
| I-10 Intent→Strategy | 用意图、风险、复杂度、约束和能力把请求映射到可解释策略包，而不是只匹配一个关键词；7+1 是策略空间，不是完成度证明。 | 能；现有插件是直接入口 | 半做，接近骨架已做。src/intent-router/classifier.ts:13-68 有 7+1 关键词分类和 confidence；strategies.ts:3-44 有策略表；index.ts:47-66 在 agent/request 改 effort。但缺少多轴特征、策略包、可解释证据、动态降级和结果反馈；也没有真正设置 token budget。 | packages/core/agent/src/runtime-types.ts:232-244；packages/core/agent-loop/src/agent.ts:407-455；packages/llm/llm/src/call-config.ts:1-59 | P0 |
| I-11 Traceable Checkpoint | 版本化、可验证、可恢复的状态快照；checkpoint 绑定 workspace、plan、changeset、artifact、test、approval 和恢复前提；摘要只是索引。 | 能；必须先做最小可恢复账本 | 未做。oh 没有 checkpoint schema、hash chain、artifact index、restore precondition、review verdict 或 invalidation。dsh session/flush 仅是耐久刷新，compaction/checkpoint 仅是压缩溯源。 | packages/core/session/src/index.ts:66-85,1068-1095；packages/session/session-checkpoint-policy/src/index.ts:1-83；packages/compaction/compaction/src/checkpoint.ts:19-50 | P0 |
| I-12 Scoped Memory | 记忆按作用域、时效、可信度、可撤销性和证据分层；不同任务不得把局部经验污染为全局事实。 | 能；可落在 session/plugin provider | 未做。当前没有 memory schema、scope、TTL、provenance、confidence、forget/revoke 或检索策略。dsh skills 和 system prompt 可提供接缝，但不是 memory 实现。 | packages/core/session/src/types.ts:252-335；packages/core/session/src/index.ts:66-76；packages/skill/skill/src/index.ts:55-101；packages/core/system-prompt/src/index.ts:392-407 | P1 |
| I-13 Constrained Byte Stability | 对稳定前缀、动态区、证据区进行字节级布局约束；明确哪些变化会使缓存失效，并用命中率、延迟和成本验证。 | 能；但属于实验性基础设施，不应先做表面优化 | 未做。dsh 有 canonical request header 和 header equality，可作为底座；oh 没有 segment compiler、byte layout、invalidation reason 或 cache hit measurement。 | packages/core/session/src/request-header.ts:1-70；packages/core/system-prompt/src/index.ts:457-542；packages/llm/token-meter/src/estimate.ts:56-87 | P2 |
| I-14 Reasoning Replay Policy | 将推理内容按策略分为保留、压缩、脱敏、重放或不暴露；关注可审计性、隐私和供应商差异，不等于无条件把 reasoning 剥掉。 | 能；应做 provider-neutral policy 层 | 未做。oh 只在 intent/model router 中写 reasoning effort；没有 reasoning block policy、replay metadata、脱敏、可见性和证据绑定。 | packages/llm/llm/src/types.ts:53-63,127-141,252-280；packages/llm/llm/src/index.ts:51-65；packages/llm/llm-deepseek/src/translate.ts:1-8,45-75 | P1 |
| I-15 DSML Tool-call Optimization | 研究一种工具调用编码或中间表示以降低 token 和解析成本，同时保留 schema、错误和安全边界；需要真实协议、模型和基准，不应把研究编码硬塞进默认客户端。 | 可做隔离研究适配；不建议做进默认 oh-my-dsh 执行链 | 未做；产品默认路径不做。dsh 已有标准 ToolCall/ToolResult 和工具 schema，DeepSeek adapter 负责 SSE 翻译；没有 DSML 协议证据和端到端收益基准。 | packages/llm/llm/src/types.ts:77-105；packages/core/tools/src/index.ts:703-711；packages/llm/llm-deepseek/src/translate.ts:1-75 | 不做（默认路径） |
| I-16 Quick Instruction Capability Probe | 用低成本、可验证的探针发现模型对快速指令路由、结构化输出或特定能力的真实支持，并缓存结果；失败要安全降级。 | 能；仅作独立探针插件 | 未做。当前没有 probe schema、版本化能力缓存、支持/拒绝/不确定状态或 fallback；不能假设某 provider 暴露未证的快捷接口。 | packages/llm/llm/src/index.ts:227-338；packages/llm/llm/src/types.ts:252-280；packages/core/agent/src/runtime-types.ts:232-244；packages/llm/llm-deepseek/src/adapter.ts:95-105 | P2（仅探针） |
| I-17 Reasoning Effort Control | 将任务策略、模型能力、请求 effort、实际 effective effort、token/延迟/质量证据连接起来；unsupported effort 必须降级并记录。 | 能；是当前路由的硬化方向 | 半做。intent-router/index.ts:47-66 覆写 reasoningEffort；model-router/index.ts:81-120 选择 model；但未检查 capability、未记录 requested/effective、未使用 usage 反馈，且 effortMap 不覆盖 simple/spec_driven。 | packages/llm/llm/src/call-config.ts:1-59；packages/llm/llm/src/types.ts:252-280；packages/llm/llm-deepseek/src/adapter.ts:95-105；packages/llm/llm-pi-ai/src/adapter.ts:130-165,276-317 | P0 |
| I-18 Dynamic Context Position Experiment | 动态上下文应按任务阶段、信任级别、时效和位置实验注入；要比较前置、后置、工具结果附近的效果，并记录来源。 | 能；当前注入可升级为安全上下文 provider | 半做。cognition-gate/injector.ts:39-75 每步向最后用户消息追加 full/brief 静态提示；缺少 source、TTL、scope、position experiment、重复检测和效果指标。dsh time-context 与 agent-instructions 已展示正确的动态上下文模式。 | packages/core/system-prompt/src/index.ts:392-407,457-542；packages/context/time-context/src/index.ts:139-208；packages/context/agent-instructions/src/index.ts:322-366；packages/core/agent/src/runtime-types.ts:135-143 | P1 |



exec
/bin/zsh -lc "printf '%s\\n' '
## 3. 差异分析：已做、半做、未做

### 3.1 已做：可运行的基础能力，但不是完整创新闭环

严格按“完整创新点”定义，18项中没有一项可以直接标为完整已做。以下是已经有代码和测试支撑的子能力：

| 已有子能力 | 代码证据 | 证据等级 | 边界 |
|---|---|---|---|
| 约束提取与负向工具拒绝 | src/constraint-immune/extractor.ts:1-98；src/constraint-immune/index.ts:109-137 | A1 | 具备提醒和拒绝，不具备事件账本、风险级别、审批、恢复和回滚 |
| 7+1 意图分类骨架 | src/intent-router/classifier.ts:13-68；src/intent-router/strategies.ts:3-44 | A1 | 关键词分类，不是多轴策略决策；未验证语义误判和跨语言鲁棒性 |
| agent/request 路由接缝 | src/intent-router/index.ts:47-66 | A1 | 接缝选对了；没有 live dsh E2E，不能宣称当前运行时全部成立 |
| 模型升级和 effort 修改骨架 | src/model-router/index.ts:54-120；src/intent-router/index.ts:61-65 | A1 | 没有 capability-aware、requested/effective 对账和实际质量反馈 |
| full/brief 认知提示 | src/cognition-gate/injector.ts:3-12,39-75 | A1 | 属于静态提示注入；不是动态证据上下文，也不是 I-02 的真正元请求 |
| 插件打包和挂载配置 | cordis.patch.yml:1-30；package.json:1-29 | A1/A2 | 证明构建和配置声明存在，不证明真实 dsh 安装与事件链正确 |

现有测试是重要正证据，但其范围必须准确描述。110 个测试通过说明这些本地函数、插件接口替身和配置静态检查没有回归；它不能证明：

- 当前 dsh 主程序已经真实加载四插件；
- waterfall 监听器没有截断其他插件；
- tool call、session flush、turn stopping、provider capability 组合在真实运行中正确；
- README 中的“真实验证”覆盖了全部创新点。

### 3.2 半做：有单点实现，但缺乏机制闭环

#### A. I-01：从“约束免疫”到“事件免疫系统”还差六层

现有 constraint-immune 解决的是一个必要的安全基元：在工具执行前拒绝明确违反负约束的调用。它没有实现：

1. 事件和违规证据的持久索引；
2. 违规原因和根因分类；
3. 修复提案及其风险；
4. 修复后的独立验证；
5. 审批、灰度、监控；
6. 回滚和恢复前提。

因此把插件名或提示词称为完整 immune system 会过度宣传。最小路线应先做违规事件记录、风险级别和可证明的恢复点，再考虑自动修复。

#### B. I-03/I-04/I-18：当前是“追加文本”，不是上下文编译器

现有 cognition-gate 在 pre-step 中把内容追加到最后一条 user message。它没有：

- 稳定约束、证据、活跃工作集、外部索引四区；
- 来源、版本、可信度、TTL 和 scope；
- 位置实验；
- 与 compaction 或 canonical request header 的一致性；
- 追加前后的重复检测和收益指标。

dsh 已提供更合适的能力：system-prompt/assemble 负责 canonical section/context/tool assembly，agent-instructions 和 time-context 用 projection 及 source metadata 注入动态内容。oh-my-dsh 应把 cognition-gate 从“字符串追加器”改成小型 context provider，而不是继续增加提示词长度。

#### C. I-10/I-17：路由有了动作，没有形成策略闭环

当前 intent-router 的正确之处是使用 agent/request，而不是尝试在 deep-frozen 的 llm/stream 请求中直接改参数。dsh agent-loop/src/agent.ts:407-455 和 llm/llm/src/call-config.ts:1-59 证明了这一接缝选择。

不足有四点：

1. classifier 只看关键词，confidence 只是 best 与 second 分数的比例；
2. strategy 表没有同时管理 model、reasoning effort、上下文预算、工具审查、验收和回退；
3. requested reasoning effort 没有和 provider/model 的 supported capability 对账；
4. model-router 的不满意度 streak 可能在工具循环中反复读取相同的最后用户消息，v0.2 文档也承认应按 message ID 优化。

此外，当前 effortMap 只覆盖 architecture、research、collaboration、refactor、new、medium 等部分意图，不覆盖 simple 和 spec_driven。README 若声称 7+1 都有 reasoning effort/token budget 策略，源码并不完全支持；该说法应降为“部分意图有 effort 路由骨架”。

#### D. I-08：约束不是范围契约

负面约束能阻断 rm/delete/remove/unlink/rmdir 等工具别名，这是安全价值；但范围治理还需要一个最小 Scope Contract：

- 目标和非目标；
- 允许的目录、工具和外部系统；
- 变更类型；
- 验收条件；
- 超出时的确认和证据要求。

没有这个契约，系统无法区分用户新增要求、任务澄清、合理补充和越界工作。当前提示词中的 I-08 标签不等于治理机制。

#### E. I-07：dsh 有接缝，但执行顺序限制必须正视

dsh agent-loop/src/agent.ts:332-400 显示，模型完成 assistant message 后，如果存在 tool calls，就直接进入 executeToolCalls。源码没有一个通用的“assistant 输出先经过 Review Router 再决定是否执行工具”的中间 waterfall。

因此 v0.3 的最低可行 I-07 不能假设有一个不存在的 post-assistant hook，应该选择：

- 工具层：在 tools/pre-execute 对工具、参数、目标和风险进行确定性拦截；
- 回合层：在 agent/turn-stopping 做回合结束前的 evidence completeness 检查；
- 错误层：在 agent/request-error 和 agent/error 记录失败并生成复审任务；
- 如需对 assistant 决策本身做独立审查，再向 dsh 增加明确的 plugin seam，而不是在 oh-my-dsh 中偷偷依赖事件顺序。

#### F. I-11：dsh 的 flush 和 compaction 只能作为底座

dsh 的 session-checkpoint-policy 在 llm/stream、tools/execute、agent/pre-step 前后调用 sessions.flush，目标是耐久性；compaction 的 checkpoint 记录压缩来源和 compaction ID。这些是有价值的底座，但缺少 I-11 的业务字段：

- checkpoint ID、task ID、sequence；
- workspace、plan、changeset、artifact 的 hash；
- tests、approvals、open issues；
- resume preconditions；
- integrity hash/hash chain；
- reviewer verdict 与 checkpoint 绑定；
- 状态变化后的 invalidation。

因此 I-11 应设计成独立的可持久 session event 和恢复服务，不应把 flush 包装成完成。

### 3.3 未做或明确不做

| 分组 | 创新点 | 判断与原因 |
|---|---|---|
| v0.3 以后再做 | I-02、I-05、I-06、I-09、I-12、I-13、I-14、I-16 | dsh 有接缝，但每项都要求新 schema、持久状态或实验验证；直接塞进当前四插件会扩大范围并削弱可验证性 |
| 研究隔离 | I-15 | DSML 没有足够的真实协议和端到端收益证据；默认链路应保持标准 ToolCall/ToolResult 和 provider adapter |
| 现有实现不可称完整 | I-01、I-03、I-04、I-08、I-10、I-17、I-18 | 只有局部动作，没有闭环、证据或指标 |
| 需要 dsh 接缝增强才完整 | I-07、I-11 | 当前接缝足以做最小版，但完整的独立审查、恢复、verdict 需要更明确的协议 |

### 3.4 关键差异的优先级判断

P0 不是“最有趣”的创新，而是会影响其他插件正确性或安全边界的最小基础设施：

- pre-step waterfall 不中断；
- I-10/I-17 能力感知路由；
- I-07 高风险工具和证据审查；
- I-08 范围契约；
- I-11 最小 checkpoint；
- I-03 预算压力信号。

P1 是建立可扩展控制平面：

- I-02 元请求工具；
- I-04 稳定约束和可压缩历史；
- I-06 PlanGraph；
- I-12 scoped memory；
- I-14 reasoning replay policy；
- I-18 有来源的动态上下文。

P2 是高成本、研究性或依赖真实基准的能力：

- I-05 文档编译；
- I-09 技能供应链；
- I-13 byte stability；
- I-16 capability probe；
- I-15 DSML 默认路径明确不做。

---

## 4. v0.3 及以后产品规划：具体到最小落地形态

### 4.1 v0.3.0：安全与证据基线

目标不是实现全部 18 项，而是使四插件在真实 dsh 事件链上可组合、可拒绝、可审计、可恢复。

#### 里程碑 A：修正事件链

最小落地形态：

- 提取一个统一的 pre-step helper：每个监听器都先调用 next，拿到下游 messages 后再做最小、可声明的变换。
- 对 cognition-gate、constraint-immune、未来 review/context 插件做顺序测试。
- 明确哪些内容进入 model-visible message，哪些只进入 session event。
- 加一条真实 dsh smoke test：启动 session，触发 user message、pre-step、request、tool pre-execute、tool result、turn-stopping，检查事件顺序和结果。

验收条件：

- 至少两个独立 pre-step 插件同时加载时，后一个仍收到上一个的结果；
- deny 决策不会执行工具；
- allow 路径仍能执行；
- event log 中能看到 plugin decision。

#### 里程碑 B：I-10/I-17 策略决策最小形态

定义一个最小 StrategyDecision 对象，字段只有：

- intent；
- confidence；
- model；
- requestedReasoningEffort；
- effectiveReasoningEffort；
- budgetClass；
- riskClass；
- fallbackReason；
- evidenceRefs。

最小执行逻辑：

1. 在 agent/request 读取最后用户消息；
2. 先分类，再读取模型 capability；
3. unsupported effort 自动降级；
4. 返回请求配置；
5. 在 assistant/message 或 request/header 事件中记录 requested/effective 对账；
6. 同一 message ID 只计算一次 dissatisfaction；
7. 不把 token budget 宣称为已实现，先以 budgetClass 驱动软阈值。

验收条件：

- simple、spec_driven、research 等 8 类都有显式默认策略；
- 不支持的 effort 不会静默假装成功；
- 路由决策可以从日志复原；
- 现有 classifier、model-router 单元测试继续通过。

#### 里程碑 C：I-08 范围契约最小形态

先不做完整自然语言范围推理，只实现结构化的 ScopeContract：

- taskId；
- objective；
- nonGoals；
- allowedPaths；
- allowedTools；
- externalSideEffects；
- acceptanceChecks；
- contractRevision。

在 pre-step 从用户变更中只识别三类高置信变化：

- 增加范围；
- 替换目标；
- 越过 allowedPaths 或 allowedTools。

其中越界和外部副作用默认转为 ask 或 deny，并产生 ScopeChange 事件。低置信变化只提示确认，不自动扩大权限。

验收条件：

- 用户要求删除不在 allowedPaths 的文件时，工具层 deny；
- 新增外部发送、发布、删除等副作用时，进入 ask；
- contractRevision 变化可以追踪；
- 不把普通澄清误判为越界。

#### 里程碑 D：I-07 Review Router 的 M0/M1/M4 最小集

先实现三个模式，不实现完整多代理审查：

- M0：低风险、无需额外审查；
- M1：自动验证，要求 test/static/tool result 等证据；
- M4：高风险或不可逆副作用，要求用户确认。

最小 RiskRecord：

- riskLevel；
- blastRadius；
- reversibility；
- changedPaths；
- requestedTools；
- requiredEvidence；
- contextHealth；
- selectedReviewMode。

最小 Verdict：

- verdict：pass、ask、reject、defer；
- checkpointRef；
- evidenceRefs；
- reason；
- policyVersion。

接缝选择：

- tools/pre-execute 做工具调用风险门；
- tools/post-execute 记录结果和补充上下文；
- agent/turn-stopping 做回合完整性检查；
- agent/request-error、agent/error 做失败路径；
- 不依赖不存在的 post-assistant review hook。

验收条件：

- rm/delete 或外部副作用在证据不足时不能直接放行；
- 自动测试证据能满足 M1；
- M4 能暂停并等待用户确认；
- Verdict 能绑定本次请求或 checkpoint，而不是只输出自然语言。

#### 里程碑 E：I-11 最小 Traceable Checkpoint

最小 checkpoint 不做全工作区快照，先做状态索引：

- checkpointId、taskId、sequence；
- sessionId、turn、step；
- contractRevision、strategyDecision；
- workspaceDigest、planDigest、changesetRefs；
- evidenceRefs、testResults、approvals；
- openIssues、resumePreconditions；
- integrityHash、previousCheckpointId。

触发点：

- 高风险工具执行前；
- 工具执行后；
- turn stopping 前；
- request error 或 retry exhaustion；
- compaction 前后；
- pause、handoff、exit。

存储方式：

- 通过 session/event 持久化；
- 通过 session/flush 保证耐久；
- 利用 session fork 做分支恢复；
- 不把 flush 本身命名为 checkpoint；
- 恢复前先验证 integrityHash 和 workspaceDigest。

验收条件：

- 任一高风险动作都能找到最近 checkpoint；
- checkpoint 能指出所依据的测试和 artifact；
- workspace 或 plan 变化后旧 verdict 自动失效；
- fork 后可以从 checkpoint 继续，而不是只读摘要。

#### 里程碑 F：I-03 软 Attention Budget

最小形态不是重写 compaction，而是给四区加预算标签：

- stable：约束、策略版本、不可变指令；
- evidence：测试、工具结果、引用；
- active：当前目标和正在修改的文件；
- external：可重新检索的索引。

每个 section 有 estimatedTokens、priority、ttl、source。超预算时：

1. 先输出 pressure event；
2. 再降低 external；
3. 再压缩 stale evidence；
4. 最后才建议 compaction；
5. stable 和未完成 active 不自动丢弃。

验收条件：

- 能解释为什么某段内容被压缩；
- stable 约束不会因为 pressure 被静默删掉；
- token 估算只作为压力信号，不冒充精确计费；
- 有同一任务不同预算策略的回归样例。

### 4.2 v0.3.1：上下文与元请求

最小落地形态：

- I-02：注册两个真实工具或 command handler：propose_skill、request_review；工具参数必须是 schema，结果写 session event；默认只能提出请求，不能自授权。
- I-04：把约束保存为版本化 stable section；compaction 后检查约束摘要和版本是否一致。
- I-18：动态上下文改为 section/context provider，带 source、scope、ttl、position，不再每步无条件追加到最后 user message。
- 补充系统 prompt assemble 的重复检测和来源标记。

交付门槛：

- 真实安装测试；
- 事件顺序测试；
- 模型可见内容和 session-only 证据分离测试；
- 同一消息重复 pre-step 不重复注入。

### 4.3 v0.4：计划、记忆、推理策略

#### I-06 PlanGraph

最小对象：

- nodeId、kind、status、dependsOn；
- acceptanceChecks；
- evidenceRefs；
- invalidatedBy；
- revision。

先使用 dsh goal 和 plan-mode 作为存储及边界事件，oh-my-dsh 只增加 dependency/evidence/invalidation 层。第一版不自动重排全图，只在依赖失效时把下游节点标为 blocked，要求重新确认。

#### I-12 Scoped Memory

最小对象：

- memoryId；
- scope：session/task/project/global；
- value；
- source；
- confidence；
- createdAt、expiresAt；
- evidenceRefs；
- revokedAt。

第一版只允许显式写入和显式检索，不允许模型自行把任意对话写成 global memory。撤销和过期优先于召回。

#### I-14 Reasoning Replay Policy

最小策略：

- keep：只保留 provider-neutral metadata；
- compress：保留摘要和证据引用；
- redact：删除敏感内容但保留结构；
- replay：仅在同 provider、同 policy version、同 request header 条件满足时；
- deny：不满足条件则不重放。

第一版不承诺还原供应商内部思维链，只管理 harness 可见的 reasoning blocks、usage、metadata 和审计索引。

### 4.4 v0.5：文档与技能供应链

#### I-05 Agent-readable Docs

最小编译结果：

- docId、version；
- trigger；
- inputs；
- outputs；
- boundaries；
- evidenceRequired；
- recovery；
- sourceRefs。

先支持显式 doc section 注册，不做全仓库自动理解。编译结果进入 system-prompt section/context，原文仍可按 sourceRefs 检索。

#### I-09 Governed Skill Supply Chain

最小状态机：

candidate → draft → tested → approved → canary → active → revoked。

每次转移必须有：

- actor；
- policyVersion；
- testRefs；
- permissionDiff；
- observedFailures；
- rollbackRef。

默认不允许模型直接把自己生成的 skill 设为 active；至少需要用户或策略引擎审批。技能权限变化应触发 I-07 review。

### 4.5 研究支线：I-13、I-16、I-15

#### I-13 Byte Stability

仅在有基准后做：

- 固定 stable header；
- 对 prompt segments 做 deterministic serialization；
- 记录 invalidation reason；
- 记录 cache read/write、latency、token、cost；
- 用相同任务、相同模型、不同布局做对照。

没有命中率、延迟和成本数据前，不应把 byte stability 写成性能收益。

#### I-16 Capability Probe

探针必须是独立、低成本、可超时、可缓存的请求，返回 supported、unsupported、unknown 三态。缓存键至少包含 provider、model、version、probeVersion。失败和 unknown 必须走保守 fallback，不能阻断正常任务。

#### I-15 DSML

保留为研究分支或外部实验包。只有在真实模型、真实 adapter、真实工具 schema、错误恢复和基准均通过时，才考虑产品化；默认 oh-my-dsh 不引入第二套工具调用协议。

### 4.6 产品验收总门槛

v0.3 不能只以“测试数量增加”验收，应同时满足：

- 真实 dsh 安装和启动；
- 事件顺序与 waterfall 组合测试；
- 高风险工具 deny/ask/pass 三态测试；
- requested/effective model 与 reasoning effort 对账；
- checkpoint integrity 和旧 verdict invalidation；
- scope contract 越界测试；
- 运行失败、重试、暂停、fork、恢复测试；
- 每个创新点的文档状态只能写“已做、半做、未做、研究中”，不得用提示词存在替代运行时完成。

---

## 5. 附录：dsh源码接缝证据索引

证据基线：dsh 仓库当前工作树，HEAD 为 47f943859b；以下路径均相对于 /Users/bluth/Code/deepseek-src/deepseek-harness。

### 5.1 事件生命周期接缝

| 接缝 | 源码位置 | 语义 | 直接支持的创新点 |
|---|---|---|---|
| agent/session-start | packages/core/agent/src/runtime-types.ts:206-217 | session 启动生命周期 | I-11、I-12、I-18 |
| agent/pre-step | packages/core/agent/src/runtime-types.ts:219-231 | waterfall，可替换 model-visible messages；payload 有 agent、messages、turn、step、signal | I-03、I-04、I-07、I-08、I-18 |
| agent/request | packages/core/agent/src/runtime-types.ts:232-244 | waterfall，可替换 request config；模型请求配置在这里可路由 | I-02、I-10、I-16、I-17 |
| agent/request-error | packages/core/agent/src/runtime-types.ts:246-260 | 失败恢复、重试或终止 | I-01、I-07、I-11、I-14 |
| agent/turn-stopping | packages/core/agent/src/runtime-types.ts:262-278 | 串行、回合收尾前；可 steer 继续 | I-07、I-08、I-11 |
| agent/error | packages/core/agent/src/runtime-types.ts:279-290 | 统一错误证据与异常控制 | I-01、I-07、I-11 |
| agent.inject | packages/core/agent/src/runtime-types.ts:135-143 | 排队进入下一次 pre-step 的 model-facing context，不唤醒 agent | I-02、I-05、I-18 |
| agent.steer | packages/core/agent/src/runtime-types.ts:127-133 | 影响当前回合控制流 | I-02、I-07、I-11 |

### 5.2 模型请求与参数接缝

| 接缝 | 源码位置 | 语义 | 直接支持的创新点 |
|---|---|---|---|
| buildRequest | packages/core/agent-loop/src/agent.ts:407-455 | 组装 prompt、调用 agent/request、生成最终请求 | I-03、I-10、I-17、I-18 |
| request header | packages/core/agent-loop/src/agent.ts:458-494 | canonical header、request/header、request/context、deep-freeze | I-04、I-13、I-17 |
| header equality/fold | packages/core/session/src/request-header.ts:1-70 | 从最新 request/header 折叠 canonical 配置并判断变化 | I-04、I-13 |
| llm/stream | packages/llm/llm/src/index.ts:51-65 | 供应商无关的流事件；loop request 是只读/冻结对象 | I-13、I-14、I-16、I-17 |
| call config | packages/llm/llm/src/call-config.ts:1-59 | provider、model、reasoning effort、sampling 属于 request-header 状态 | I-10、I-17 |
| model capability | packages/llm/llm/src/types.ts:252-280 | reasoning effort 与 model info 的能力描述 | I-16、I-17 |
| usage/reasoning blocks | packages/llm/llm/src/types.ts:53-63,127-141 | text/reasoning/tool blocks 与 cache、reasoning usage | I-03、I-13、I-14、I-17 |

### 5.3 工具执行接缝

| 接缝 | 源码位置 | 语义 | 直接支持的创新点 |
|---|---|---|---|
| tools/pre-execute | packages/core/tools/src/index.ts:142-152,1463-1505 | waterfall，可 allow、deny、ask；否决会物化为工具错误结果 | I-01、I-02、I-07、I-08、I-09 |
| tools/execute | packages/core/tools/src/index.ts:153-163 | 实际执行阶段 | I-01、I-07、I-11 |
| tools/post-execute | packages/core/tools/src/index.ts:164-175 | 可接受、替换、阻断或追加上下文 | I-01、I-07、I-08、I-18 |
| tools/result | packages/core/tools/src/index.ts:191-197 | 观察最终工具结果 | I-01、I-03、I-07、I-11 |
| ToolGuard | packages/core/tools/src/index.ts:703-711 | 单调收敛到最终 deny 的守卫 | I-01、I-07、I-08 |
| assistant→tool 顺序 | packages/core/agent-loop/src/agent.ts:332-400 | assistant message 后若有 tool call 就直接执行，没有通用 post-assistant review waterfall | I-07、I-11 的边界证据 |

### 5.4 会话、持久化与恢复接缝

| 接缝 | 源码位置 | 语义 | 直接支持的创新点 |
|---|---|---|---|
| session/event | packages/core/session/src/index.ts:66-76 | post-commit append feed，适合追加可审计事实 | I-01、I-07、I-08、I-11、I-12、I-14 |
| session/flush | packages/core/session/src/index.ts:78-85 | durability checkpoint，无通用 waterfall | I-11 的持久化底座，但不等于完整 checkpoint |
| SessionStore.fork | packages/core/session/src/index.ts:1068-1095 | 从稳定前缀生成子 session，边界不能切开 open turn | I-06、I-07、I-11、I-12 |
| durable SessionEventMap | packages/core/session/src/types.ts:252-335 | turn、step、message、tool、todo、request header/context 等持久事件 | I-01、I-06、I-07、I-08、I-11、I-12 |
| checkpoint policy | packages/session/session-checkpoint-policy/src/index.ts:1-83 | 在 llm/stream、tools/execute、agent/pre-step 等路径 flush | I-11 的底座证据，不能替代业务 checkpoint |
| compaction engine | packages/compaction/compaction/src/index.ts:87-169 | 压力触发、压缩区域、替换为 summary node | I-03、I-04、I-11 |
| compaction checkpoint | packages/compaction/compaction/src/checkpoint.ts:19-50 | 记录压缩来源和 compaction ID | I-04、I-11 |

### 5.5 Prompt、计划、技能与动态上下文接缝

| 接缝 | 源码位置 | 语义 | 直接支持的创新点 |
|---|---|---|---|
| system-prompt/assemble | packages/core/system-prompt/src/index.ts:18-37,457-542 | 汇总 global/scoped sections、context、tool schemas，canonical sort 后 waterfall 组装 | I-03、I-04、I-05、I-12、I-13、I-18 |
| system prompt section/context | packages/core/system-prompt/src/index.ts:373-407 | 注册结构化 section 和 context | I-04、I-05、I-12、I-18 |
| plan mode | packages/plan/plan-mode/src/index.ts:46-54,180-265,425-460 | durable plan/mode，accepted pre-step 后应用；是软指导，不是完整 PlanGraph | I-06 |
| goal | packages/goal/goal/src/types.ts:15-83；packages/goal/goal/src/domain.ts:61-67 | goal revision、phase、snapshot、goal/change | I-06、I-11 |
| skills | packages/skill/skill/src/index.ts:38-101,284-297 | SkillSource、InvocationPolicy、SkillDefinition、registry 和 change 事件 | I-02、I-09、I-12 |
| filesystem skill provider | packages/skill/skill-filesystem/src/index.ts:1-7,45-89,129-143 | 文件技能 provider、配置和 watch | I-09 |
| agent-instructions | packages/context/agent-instructions/src/index.ts:1-7,322-366 | 文件触碰后生成 projection，在 pre-step 组合 context | I-05、I-18 |
| time-context | packages/context/time-context/src/index.ts:139-208 | 带 source/plugin/form/sections 的动态快照；调用 next 后按时效注入 | I-18 |

### 5.6 评估中的接缝使用原则

1. 需要改请求配置的能力用 agent/request；不要在 llm/stream 中尝试改已 deep-freeze 的 loop request。
2. 需要阻断工具的能力用 tools/pre-execute 或 ToolGuard；不要只在 prompt 中警告。
3. 需要追加 model-visible 上下文的能力优先用 system-prompt/assemble、context provider 或 agent.inject；每次注入必须有来源、scope、TTL 和重复策略。
4. 需要审计的能力写 session/event；需要保证落盘再调用 session/flush；不要把 flush 叫作 checkpoint。
5. 需要回合级审查的能力用 agent/turn-stopping；需要对 assistant 决策做工具执行前审查时，必须先确认 dsh 是否提供对应 hook。
6. 需要恢复或分支的能力使用 fork 加 checkpoint integrity；不要依赖自然语言摘要作为唯一恢复状态。
7. 对 provider 专属能力先读取 model capability 和 adapter 支持，再决定 effort、探针或 replay；unknown 必须保守降级。
8. waterfall listener 统一调用 next；否则插件组合行为不能从单插件测试外推。

## 6. 最终交付结论

确定：oh-my-dsh v0.2 已有一个有价值的插件骨架，价值集中在约束拒绝、请求路由、模型升级和认知提示四个动作点。

确定：它尚未实现 18 项创新点的完整闭环；按完整定义计，当前应标为“8项半做、10项未做或默认不做”，而不是“12项已评估”或“18项已实现”。

确定：v0.3 的最小正确方向是 I-07 风险与证据审查、I-08 范围契约、I-11 可追溯 checkpoint、I-10/I-17 能力感知路由、I-03 软预算，以及先修正 pre-step waterfall。I-15 保留研究隔离，I-13/I-16 先做基准和探针，不进入默认核心路径。

不确定：四插件在用户实际 dsh 安装中的监听器顺序和所有组合路径；需补一条真实 dsh 安装、启动、工具调用、失败、flush、暂停、fork、恢复的 A0 级 smoke/E2E 测试后，才能把当前若干 A1 结论提升为 A0。

