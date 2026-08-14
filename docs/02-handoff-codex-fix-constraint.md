# oh-my-dsh v0.2 Codex 复现验证 + 修复任务

## 背景
你是 oh-my-dsh 的研发执行者。v0.2 已实现（4 插件，109/109 测试通过，真实安装验证通过）。交付总监（主会话）在**真实 LLM 对话 E2E 验证**中发现了一个 constraint-immune 的疑似缺陷，需要你**先复现验证、分析根因，再修复**。

## 已确认真实生效的部分（不用动）
- model-router：真实对话中，简单任务→deepseek-v4-flash，架构任务→deepseek-v4-pro（dsh session 日志铁证）
- intent-router：真实对话中 reasoningEffort 按意图设置（max 等）
- cognition-gate：真实对话中注入 [L1]/[L2] 认知导航文本，模型实际响应

## 疑似缺陷（需要你验证）
### constraint-immune 执行时拦截对英文工具命令失效
**观察**：真实 headless 对话中，立约束"禁止删除 /tmp/constraint-test.txt"，随后模型发起 `bash` 工具执行 `rm -f /tmp/constraint-test.txt`，**文件被成功删除**——tools/pre-execute 的 deny 拦截未触发。

**你的任务**：
1. **复现**：用 headless 真实对话复现（注意 headless 每轮独立 session，约束需在同一 session 内立+触发；或改用 dsh web 交互模式，或读 dsh 源码确认 exec.agent 在 pre-step 与 tools/pre-execute 间的一致性）
2. **分析根因**：核心疑点是 `src/constraint-immune/extractor.ts` 提取的关键词是中文（约束"禁止删除 X"→ keyword="删除 X"），而 `src/constraint-immune/index.ts` 的 tools/pre-execute 用 `text.includes(keyword)` 匹配工具名+参数 JSON——工具调用是英文命令（rm/delete/remove），**语义等价但字面不包含中文关键词 → 必然 miss**。请验证这个根因是否成立，并指出是否还有别的因素（如 session 定位 exec.agent?.id）
3. **修复**：设计并实现修复。候选方向（你来判断哪个最优）：
   - a. 否定型约束拦截时，同时匹配命令别名（rm/delete/remove/unlink 等 → 影射"删除"）——但过度工程风险
   - b. 拦截不依赖关键词，而是对"危险工具+危险参数模式"做守卫（如 bash 命令含 rm -rf / 等）——但会偏离"约束驱动"
   - c. 明确约束匹配的边界：工具拦截只对有明确语义映射的约束生效，其余靠提醒——诚实降级
   - d. 其他你认为正确且最小改动的方案
4. **验收**：修复后提供证据——mock 测试 + 真实对话（能证明命中约束的英文工具调用被 deny）

## 硬约束
- 零额外依赖
- typecheck 0 错误、测试全绿（v0.1 的 74 个 + v0.2 新增不得靠删测试过门禁）
- 只改 constraint-immune 相关文件（除非根因牵涉其他）
- 中文注释优先
- 你的分析要基于 dsh 源码证据（~ /Code/deepseek-src/deepseek-harness），不要猜

## 交付
1. 复现验证结论（问题是否成立、根因）
2. 修复方案 + 实现
3. 验收证据（测试 + 真实对话）
4. 修改的文件清单

先验证，再动手。不要直接改。