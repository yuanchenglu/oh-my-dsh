# oh-my-dsh v0.2 实现任务（Codex 研发小组专属交接）

> 你是 oh-my-dsh v0.2 的研发执行者。这是一个 DeepSeek Harness (dsh) 的 TypeScript 插件 bundle，v0.1 已完成并发布。你的任务是按 v0.2 规划实现 3 个新功能并交付。

## 为什么你能独立执行
本仓库 docs/v02/ 下四套文档**完全自包含**：所有 API 签名、完整代码片段、测试用例、验收命令都已内联。你不需要读 dsh 源码，不需要猜，直接照文档执行即可。文档与源码冲突时**以文档为准**（文档已从 dsh v0.1.0-rc.5 源码逐一验证）。

## 项目背景（30 秒理解）
- **git 仓库**：`~/Code/oh-my-dsh`（= /Volumes/Doc/Code/oh-my-dsh），branch main，HEAD 已含 v0.1 全部代码 + v0.2 全部文档
- **技术栈**：TypeScript strict + noImplicitAny，pnpm，vitest，ESM。零额外依赖（只用 @deepseek-ai/cordis / dsh-tools / schemastery，均为 peerDependencies，已装）
- **v0.1 已有**：3 个插件（intent-router / cognition-gate / constraint-immune），74 个测试全绿
- **v0.2 要做**：新增 model-router 插件 + constraint-immune 加执行时拦截 + constraint-immune 加"肯定型缺少执行"检查（详见文档）

## 必读文档（按此顺序，全部读完再动手）
仓库 `~/Code/oh-my-dsh/docs/v02/`：
1. **01-prd.md** — 产品需求。v0.2 做什么、AC 验收标准（model-router AC-1~6、拦截 AC-1~5、肯定型 AC-1~4）
2. **02-architecture.md** — 技术架构。API 签名 + dsh 源码行号 + 模块设计。**实现前必须核对行号处签名**
3. **03-plan.md** — ⭐你的执行清单。M0-M5 里程碑、子代理分配卡、完整可复制代码、验收命令。**这是你的主文档**
4. **04-testing.md** — 测试体系。测试金字塔、35 个新用例、代码模板
5. **review-03-plan.md** — 03-plan 的审查报告（已修复 F1/F2，了解已修正项，避免回退）

参考（备查，一般不用读）：`docs/01-prd.md`~`docs/04-testing.md`（v0.1 文档）、`docs/00-handoff-prompt.md`。

## 执行顺序（严格按 03-plan.md）
- **M0**：抽取 `src/shared/messages.ts`（contentToText / extractLastUserMessage / estimateTokens）+ 3 处 import 切换 + 新建 tests/shared/messages.test.ts（7 用例）
- **M1**：新建 model-router 插件（agent/request 瀑布改 config.model）
- **M2**：constraint-immune 加 tools/pre-execute 执行时拦截（返回 deny）
- **M3**：constraint-immune 加肯定型约束"缺少执行"一次性检查
- **M4**：更新 cordis.patch.yml（加 model-router 条目）、版本号 → 0.2.0、真实安装验证
- **M5**：全量测试补齐 + 文档收尾

**依赖**：M0 是唯一串行前置。M1 与 M2→M3 可并行（文件零重叠）。M4 需 M1+M2+M3 全完成。M5 最后。

## 硬约束（违反即返工）
1. **零额外依赖**：只允许 `import type { Context } from '@deepseek-ai/cordis'` 和 `import Schema from '@deepseek-ai/schemastery'`。不新增任何 package。
2. **typecheck 门禁**：`pnpm run typecheck`（tsc --noEmit）必须 0 错误。
3. **测试门禁**：`pnpm vitest run` 必须全绿。新增功能必须带新测试，**不允许靠删测试过门禁**。
4. **回归**：v0.1 的 74 个测试必须保持全绿（M2/M3 改 constraint-immune 时尤其注意）。
5. **API 签名**：实现前打开引用源码核对行号（03-plan 第 2 节有核对清单）。
6. **中文注释优先**。
7. **最小改动**：一行能修就一行，不顺手重构。

## 验收命令（每个里程碑完成后跑）
```bash
cd ~/Code/oh-my-dsh
pnpm run typecheck && pnpm vitest run
```
- M0 后应 81 个测试全绿（74+7）
- M1 后 100 个（81+19）
- M2 后 106 个（100+6）
- M3 后 109 个（106+3）
- M4 需真实安装验证：`pnpm pack` → dsh plugin add → dump-config 看到 4 个插件
- M5 全量 109 个全绿 + README 更新到 v0.2（里程碑累计基准以 04-testing.md 第 485 行为准）

## Commit 规范（如你被要求提交时）
- 原子粒度：一个 commit 一件事
- 双语：标题 `English title | 简体中文标题`，正文分 English:/简体中文: 两块
- 若未明确要求提交，**只改代码不 commit**，交付后由主会话统一提交

## 交付要求
完成后报告：
1. 每个里程碑的验收结果（typecheck / vitest 数字）
2. 新增/修改的文件清单
3. 测试总数（应 109）
4. 任何与文档预期不符的地方（如实报告，不隐瞒）

## 开始
先读完 docs/v02/ 全部 5 份文档，再按 03-plan.md 的 M0 开始。遇到文档里没写清楚的地方，先声明假设再动手，不要猜。开始吧。