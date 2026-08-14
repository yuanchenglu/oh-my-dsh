# oh-my-dsh 创新点完整评估 + 产品规划任务

## 背景
你是 oh-my-dsh 的研发负责人。这是一个基于论文《LLM + Harness = Agent》的 DeepSeek Harness (dsh) TypeScript 插件 bundle，当前 v0.2.0（含 intent-router / model-router / cognition-gate / constraint-immune 四个插件，110/110 测试通过，真实安装验证通过）。

产品定位：让 DeepSeek 模型在 dsh 平台上"该省的省、该花的花、不乱来"。

## 论文与创新点原料（全部在本机，先读完再评估）

### 论文理论框架
- `~/Code/deepseek-src/llm-harness-agent/README.md`（中文总纲）
- `~/Code/deepseek-src/llm-harness-agent/README_en.md`（英文）
- `~/Code/deepseek-src/llm-harness-agent/zh/theory/`（理论章节）
- `~/Code/deepseek-src/llm-harness-agent/zh/blueprint/`（蓝图）
- `~/Code/deepseek-src/llm-harness-agent/zh/prd-tech-plan/`（已有 PRD/技术规划）

### 18 篇创新点深度文章（核心原料）
`~/Code/deepseek-src/llm-harness-agent/zh/innovations/` 下 01~18：
- 01-agent-immune-system（Agent 免疫系统）
- 02-bidirectional-agent（双向 Agent）
- 03-attention-budget（注意力预算）
- 04-kv-cache-prefix（KV Cache 前缀复用）
- 05-document-kv-cache（文档级 KV Cache）
- 06-okr-planstep-cascade（OKR 计划步骤级联）
- 07-review-switching（审查切换）
- 08-scope-creep（范围蔓延控制）
- 09-skills-self-evolution（Skill 自进化）
- 10-intent-routing（意图路由）
- 11-checkpoint-review（检查点审查）
- 12-memory-granularity（记忆粒度）
- 13-byte-stable-prefix-architecture（字节稳定前缀架构）
- 14-reasoning-content-stripping（推理内容剥离）
- 15-dsml-tool-call-optimization（工具调用优化）
- 16-quick-instruction-routing（快捷指令路由）
- 17-reasoning-effort-control（推理强度控制）
- 18-latest-reminder-injection（最新提醒注入）

## oh-my-dsh 现状（要评估的对象）
- 代码：`~/Code/oh-my-dsh/src/`（intent-router / model-router / cognition-gate / constraint-immune 四个插件 + shared/messages.ts）
- 文档：`~/Code/oh-my-dsh/docs/01-prd.md`（v0.1）、`~/Code/oh-my-dsh/docs/v02/01-prd.md`（v0.2，含 3.4 节技术债务评估）
- 测试：`~/Code/oh-my-dsh/tests/`（110 个用例）
- 现有插件功能概览：
  - intent-router：按意图（7+1 类）设置 reasoningEffort / maxTokens
  - model-router：Flash-first，架构/研究/超长上下文/连续不满意自动升 Pro
  - cognition-gate：每轮注入三层认知导航（荣辱观/思维方式/三省吾身）
  - constraint-immune：提取硬约束（否定型/肯定型），提醒违规 + tools/pre-execute 拦截

## 你的任务（完整评估 + 产品规划）

### 第一部分：逐条映射评估
对 18 个创新点，每一条给出：
1. **一句话核心**：该创新点解决什么问题
2. **能否做进 oh-my-dsh**：能 / 部分能 / 不能（结合 dsh 源码接缝，dsh 在 `~/Code/deepseek-src/deepseek-harness`）
3. **是否已做**：oh-my-dsh v0.1/v0.2 是否已实现（对照现有插件代码，给出对应文件/功能）
4. **dsh 源码支撑**：挂钩点/接缝在哪（文件:行号），能不能落地
5. **优先级**：P0（高价值可做）/ P1 / P2 / 不做（附理由）

注意：v0.2 PRD 3.4 节只评估了部分创新点（I-03/04/13/06/11/12/14/07），且措辞是"12 个创新点"——实际是 18 篇。你要**完整评估全部 18 条**，并可指出 v0.2 评估是否有遗漏或误判。

### 第二部分：差异分析
- 论文 18 创新点中，oh-my-dsh 已实现的（对照插件代码逐一确认，不要只看文档）
- 已实现但实现得不够/可加强的
- 完全没做、但按论文重要且 dsh 支持可落地的

### 第三部分：产品规划（结论）
基于评估，给出 oh-my-dsh 接下来的产品规划：
1. **v0.3 建议**：明确该做哪几个创新点（按价值/可行性/成本排序），每个给出最小落地形态
2. **架构演进**：当前 4 插件 → 未来是否要扩展/重构（如共享认知层、记忆编译等）
3. **风险与取舍**：哪些创新点在 dsh 上做不了或有副作用，明确砍掉
4. **一页总结**：oh-my-dsh 基于论文的完整价值地图——哪些创新点已收编、哪些 v0.3 收、哪些永远不做

## 硬约束
- 每个论断基于论文原文 + oh-my-dsh 代码 + dsh 源码，三层证据，不要猜
- 中文输出
- 结论要落到"能做的都做了吗"这个核心问题：能做的做没做、没做的为什么、接下来做哪些

## 交付
写一份完整评估报告到 `~/Code/oh-my-dsh/docs/v03/innovation-assessment.md`（自建目录），结构：
1. 执行摘要（一页价值地图）
2. 18 创新点逐条评估表 + 详细分析
3. 差异分析（已做/半做/未做）
4. v0.3 及以后产品规划
5. 附录：dsh 源码接缝证据索引

先读完论文和 18 篇创新点，再对照代码，再写报告。不要直接写。