# oh-my-dsh v0.3 P0：修 cognition-gate 的 agent/pre-step waterfall 问题

## 背景
你是 oh-my-dsh 的研发执行者。交付总监（主会话）结合 dsh 源码发现一个 P0 架构问题，需要你**先复现验证、分析根因，再修复**。

## 问题描述
`src/cognition-gate/index.ts:32` 的 `agent/pre-step` 监听器**不调用 `next()`**，直接 `return { kind: 'enter', messages: injected }`。

dsh 源码证据（`~/Code/deepseek-src/deepseek-harness`）：
- `packages/core/agent-loop/src/agent.ts:226-239`：`agent/pre-step` 用 `dispatch.waterfall` 触发，基础决策（最内层）是 `{ kind: 'enter', messages: [...claimed, context] }`，其中 **context 是 `systemPrompt.assemble` 组装的 dsh 系统上下文**（时间、计划、文件指令等）。
- waterfall 语义：每个监听器**必须调 `next()`** 才能拿到内层（含基础）决策并叠加；不调 next() 直接返回 = 截断基础决策及所有内层监听器。

**疑点**：cognition-gate 不调 next() 直接返回 enter，可能**每次丢弃 dsh 的系统上下文**（context），只留用户消息 + 认知提示。需验证这是否真发生。

## 你的任务
1. **复现验证**：
   - 读 dsh 源码确认 `agent/pre-step` 的 waterfall 契约（agent-loop/src/agent.ts preStep 方法 + dispatch.waterfall 实现）
   - 确认 cognition-gate 不调 next() 是否真的丢弃 dsh 基础决策里的 context
   - 对照 constraint-immune（它 index.ts:106 有 return next()，是正确范例）验证两者差异
   - 用 dsh 官方 interception.spec.ts 的 NativeGuard 模式（worked example）确认正确写法
2. **分析根因**：cognition-gate 的 inject 逻辑是否要求"替换"还是"叠加"消息？正确做法是调 next() 拿到底层决策再改 messages，还是可以安全直接返回？
3. **修复**：最小改动修复 cognition-gate 的 pre-step，使其正确委托 next()（或等价地保留 dsh 系统上下文）。给出修复后代码。
4. **验收**：typecheck + 全量测试通过；新增/修改一个测试证明修复后 dsh 系统上下文不被丢弃。

## 硬约束
- 零额外依赖；typecheck 0 错误；测试全绿（不得删测试过门禁）
- 只改 cognition-gate 相关文件（根因若牵涉其他插件再说明）
- 中文注释
- 分析基于 dsh 源码证据，不要猜
- **只分析验证 + 给修复代码；修复文件改动请用相对路径写入（workdir 是 ~/Code/oh-my-dsh），不要用绝对路径**

## 交付
1. 复现验证结论（问题是否成立、根因）
2. 修复方案 + 实现（代码）
3. 验收证据
4. 修改文件清单