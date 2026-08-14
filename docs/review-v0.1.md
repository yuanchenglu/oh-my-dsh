# oh-my-dsh v0.1 代码审查报告

> 审查日期：2026-08-14 | 审查范围：docs/01-04、src/（9 文件）、tests/（11 文件）、git log（11 commits）
> 验证基线：`tsc --noEmit` 0 错误；`vitest run` 59/59 通过

## 结论

**不通过（needs work）。** 表面门禁全绿（typecheck + 59 测试），但存在 5 个高危问题：P0 核心功能 reasoningEffort 改写大概率不生效、PRD AC-3（customPatterns）完全未实现、constraint-immune 违规检查每轮必然误报、E2E 测试与文档声称严重不符、PRD 验收标准引用的测试编号全部错位。59 个通过的测试中有相当部分断言薄弱，不构成对核心功能的有效验证。当前状态适合继续开发，**不适合对外发布**。

---

## 🔴 高优先级（功能不成立 / 验收未达成）

### R1. intent-router 的 reasoningEffort 改写大概率不生效（P0 核心功能）

**文件**：`src/intent-router/index.ts:50-53`

```ts
if (effort) {
  options = Object.freeze({ ...options, reasoningEffort: effort })
}
return next()
```

`options` 是 listener 的局部参数，重新赋值只改了局部绑定；`next()` 按架构文档自己的签名是 `next: () => AsyncIterable<StreamChunk>`（无参闭包），改写后的新对象没有任何通道传回框架。冰冻原对象 + 新建对象 + 无参 next = 改写被丢弃。架构文档 02-architecture.md:172-184 的"已验证写法"示例与"可改写 LLM 调用参数"的声称自相矛盾。

置信度：**大概率（80%）**——需对照 dsh v0.1.0-rc.5 的 waterfall 实现确认（若框架是 listener 返回值驱动或对 options 做浅拷贝后继续，则另当别论）。

**修复建议**：查 dsh `packages/llm/llm/src/index.ts` waterfall 实现，确认参数透传机制；若支持返回值携带 options 则 `return next(modifiedOptions)` 或直接 mutate（若未冻结）；然后在真实 dsh 环境发一条"设计一个微服务架构"，抓 API 请求体验证 `reasoningEffort: max`。

### R2. PRD AC-3（customPatterns 自定义约束关键词）完全未实现

**文件**：`src/constraint-immune/index.ts:22-23`（apply 只读 `config.enabled`）、`docs/01-prd.md:149`

`Config.customPatterns` 声明了但 `apply` 内从未读取，`extractHardConstraints` 也不接受自定义模式参数。PRD AC-3 声称"对应测试：extractor.test.ts #5"，但该文件第 5 个测试是"无约束返回空 Set"，与自定义关键词无关——**验收标准、实现、测试三者互不相干**。

**修复建议**：`apply` 中把 `config.customPatterns` 编译为正则并传入提取函数（如 `new RegExp('(?:' + patterns.join('|') + ')[^，。；、！？\\n]{2,60}', 'g')`），补一条"自定义关键词提取"测试。

### R3. constraint-immune 违规检查每轮必然误报，且自我永续

**文件**：`src/constraint-immune/index.ts:53-64`

检查范围 `allText` 是**全部消息**（含用户历史消息）的拼接。用户 turn 0 说了"不要修改 API 契约"之后，该原文永远留在历史里，`checkAgainstConstraints` 提取的关键词"修改 API 契约"在每轮 turn>0 都命中用户自己的约束原文 → 每轮都追加 `[约束提醒]`。追加的提醒文本本身也含"修改 API 契约"，下一轮继续命中 → 提醒无限自我复制。

已用 node 实测验证（turn=1 历史含约束原文 → `violated: true`）。架构文档 02-architecture.md:362 的设计意图是"若**模型上一轮输出**涉及硬约束关键词"，实现与意图不符。

**修复建议**：`allText` 只拼接 `role === 'assistant'` 的消息；同时给提取到的约束记录"首次出现轮次"，跳过该轮之前的文本。

### R4. E2E 测试与 04-testing.md 声称严重不符

**文件**：`tests/e2e/install.test.ts` vs `docs/04-testing.md:220-236`

文档声称 E2E 会：`pnpm pack` → 真实 `dsh plugin add` → 启动 web → 发送消息 → **断言 reasoningEffort=high**，且无 key 时 `skipIf`。实际 install.test.ts 只做了 4 个静态断言：patch 文件含 'insert'、package.json 有 dsh.bundle 字段、name/type 正确、3 个入口文件存在。没有任何安装行为、没有 API 验证、没有 skipIf 逻辑。R1 那样的核心失效在当前测试体系下**永远不会被发现**。

**修复建议**：要么按文档实现真实 E2E（推荐，哪怕手动触发），要么把 04-testing.md 5.1 节降级标注为"未实施，v0.2 计划"。

### R5. PRD 验收标准引用的 fixtures 编号全部错位

**文件**：`docs/01-prd.md:97-101` vs `tests/intent-router/fixtures.ts`

| PRD 声称 | 实际位置 |
|---|---|
| AC-2 → fixtures[11]（architecture） | fixtures[11] 是 collaboration；architecture 在 fixtures[12] |
| AC-3 → fixtures[17]（simple） | fixtures[17] 是 research；simple 在 fixtures[18] |
| AC-4 → fixtures[19]（spec_driven） | fixtures[19] 是 simple；spec_driven 在 fixtures[20-22] |
| AC-5 → fixtures[19-21] | 应为 fixtures[20-22] |

fixtures.ts 自身注释和 03-plan.md 的编号是对的，只有 01-prd.md 错位（疑似按另一版排序写的）。

**修复建议**：按 fixtures.ts 实际索引改正 01-prd.md 的 4 处引用。

---

## 🟡 中优先级（逻辑缺陷 / 设计问题）

### Y1. `confidence < 0.5` 回退分支数学上不可达（死代码）

**文件**：`src/intent-router/classifier.ts:64-69`、`docs/01-prd.md:101`（AC-5）

`confidence = best / (best + second)`，排序后 best ≥ second 恒成立 → confidence ≥ 0.5 恒成立（已验证：best==second 时恰为 0.5）。`if (confidence < 0.5)` 分支永远不会执行，PRD AC-5 描述的"置信度 < 0.5 回退"边界不存在。从 Python 版 1:1 移植来的公式本身如此。

**修复建议**：二选一——① 接受现状，删掉死分支和 AC-5 的错误描述，把回退条件改为"无关键词命中"；② 若想保留"低置信回退"语义，改公式（如 `confidence = (best - second) / best` 或 best 绝对阈值）。

### Y2. cognition-gate 精简版按行过滤导致关任一层即整行消失

**文件**：`src/cognition-gate/injector.ts:22-33`（filterLayers）+ 第 8 行（BRIEF_INJECTION 是单行）

BRIEF_INJECTION 是**一行**内含 `[L1]…[L2]…[I-08]…` 三个层标记，`filterLayers` 按行过滤：只要 `layers.l2=false` 或 `i08=false`，整行被跳过 → 返回空串 → 该轮完全不注入。已实测验证（`l2=false` → `""`）。现有测试只覆盖了 turn=0（完整版是多行，恰好不触发）。

**修复建议**：BRIEF_INJECTION 拆成多行（每标记一行），或 filterLayers 改为按 `[标记]` 分段过滤而非按行。补测试：turn=1 + 单层关闭。

### Y3. "必须"类约束的违规判定方向错误

**文件**：`src/constraint-immune/extractor.ts:26-34`

`checkAgainstConstraints` 对"必须先备份再操作"提取关键词"先备份再操作"，模型若**遵守**约束说"我先备份再操作"同样 `violated: true`。"禁止 X"命中是违规，"必须 X"命中是遵守——两类约束共用一个 includes 判定，方向反了。

**修复建议**：提取时区分否定型（不能/不要/禁止…）与肯定型（必须），检查逻辑分开：否定型命中算违规，肯定型 v0.1 只记录不判定（或检查"缺少执行"——复杂，建议列入 v0.2）。

### Y4. 多模态 content 被 JSON.stringify 拍平，破坏 ContentPart[] 结构

**文件**：`src/cognition-gate/injector.ts:59-64`

非 string content（如含图片的 `ContentPart[]`）被 `JSON.stringify` 序列化成字符串后写回 `content`——消息结构被永久改变，图片 part 变成 JSON 文本。`tests/cognition-gate/injector.test.ts:95-101` 还把这个行为固化成了预期。真实 dsh 会话中用户发图即损坏。

**修复建议**：content 为数组时，向数组 push 一个 `{ type: 'text', text: injection }`，保持数组结构；测试同步修改。

### Y5. constraint-immune 的 sessionId 生成不可靠，且无视 payload.agent

**文件**：`src/constraint-immune/index.ts:37`

`JSON.stringify(messages[0]).slice(0, 50)` 当会话 key：不同会话首条消息相同（如都以同一句 system/问候开头）会串约束；架构文档 02-architecture.md:104 明确 payload 有 `agent: Agent` 字段，实现却没用。

**修复建议**：用 `agent` 的 session 标识（查 runtime-types.ts 确认字段名）做 key；拿不到就退化为"单会话不隔离"并注释说明。

### Y6. inject=['llm'] 被移除但文档未同步，时序问题绕开未根治

**文件**：`src/intent-router/index.ts:7`（注释）vs `docs/02-architecture.md:85`、`docs/03-plan.md:328`

commit `ee3a3c2` 移除了 inject 声明（"causing load-order issue"），但架构文档和 plan 仍把它作为规范写法要求。没有 inject 意味着 apply 执行时 llm 服务可能未就绪——这个风险现在完全没有防护，只有一行注释。

**修复建议**：定位当时的 load-order 报错根因（是 llm 服务名不对还是声明语法问题），恢复正确的 inject 声明；同时在两份文档中同步最终结论。

### Y7. package.json 缺 peerDependencies，main 指向不存在的文件

**文件**：`package.json:5`、缺失的 peerDependencies vs `docs/03-plan.md:56-60`

plan M0-1 明确要求声明 `@deepseek-ai/cordis / dsh-tools / schemastery` 三个 peerDependencies，实际 package.json 完全没有——npm 安装时不会校验宿主环境，`src/types/dsh.d.ts` 的 stub 掩盖了这一点。另外 `"main": "src/index.ts"` 指向一个**不存在的文件**（src/ 下无 index.ts），且指向 .ts 源码而非 lib/ 产物，对 npm 消费方无效。

**修复建议**：补回三个 peerDependencies（`"*"` 与 plan 一致）；main 删除或改为 `lib/src/index.js` 并补一个桶文件（若 bundle 机制不需要 main，直接删字段）。

### Y8. strategies 关键词"完成"误报风险

**文件**：`src/intent-router/strategies.ts:22`

collaboration 关键词里的"完成"是超高频词："帮我完成这个函数"→ collaboration → reasoningEffort=max，与"协作"语义无关。该词不在 PRD 3.2 的关键词清单里（是开发期为 fixture 加分私加的，且实测删掉它 fixtures[11] 仍通过——'协作'单独即可命中）。

**修复建议**：删除"完成"；同理审视"改"（simple）这类单字高泛化关键词，确认 fixtures 仍全绿。

---

## 🟢 低优先级（文档 / 测试质量）

### G1. 集成测试断言薄弱，测试名与断言不符
- `tests/integration/intent-router.test.ts:43-52`：测试名 "sets reasoningEffort for architecture intent"，断言只有 `next` 被调用，没验证 reasoningEffort。应捕获 listener 改写后的 options 断言 `reasoningEffort === 'max'`（这也会顺带暴露 R1）。
- `tests/integration/cognition-gate.test.ts:66-76`："injects brief cognition on turn 1" 没有任何 expect。
- `tests/integration/constraint-immune.test.ts:32-43`：只断言 next 被调用，未验证约束提取或提醒追加。

### G2. plan M4-1 的 patch 路径未同步
`docs/03-plan.md:459` 写 `oh-my-dsh/src/intent-router/index.js`，实际 cordis.patch.yml 是 `oh-my-dsh/lib/src/...`（commit `aa840cb` 只改了 yml 没改文档）。

### G3. 架构图与实际挂钩点不符
`docs/02-architecture.md:15-17`：intent-router 标注挂 `agent/pre-step + llm/stream`（实际只有 llm/stream）；constraint-immune 标注 `tools/pre-execute`（v0.1 未实现，PRD 3.4 已声明列入 v0.2，架构图应同步降级）。

### G4. CI 不存在
`docs/04-testing.md:254-270` 给了完整 ci.yml 模板，但仓库无 `.github/` 目录。要么补上，要么文档标注"待建"。

### G5. 覆盖率目标无门禁
`docs/04-testing.md:274-282` 声称 90%+ 覆盖率目标，vitest 未配置 coverage，CI 也不存在，目标无法度量。

### G6. 架构文档 patch 示例三种写法
`docs/02-architecture.md:369` 写 `name: oh-my-dsh/intent-router`，plan 写 `oh-my-dsh/src/...`，实际 `oh-my-dsh/lib/src/...`——统一到实际值。

### G7. e2e 测试验证对象错位
`tests/e2e/install.test.ts:37-47` 验证 `src/*.ts` 存在，但 patch 指向 `lib/`——应验证编译产物存在或 patch 路径与 tsconfig outDir 一致。

---

## 提交历史审查

11 个 commit，双语标题+正文 ✓、原子粒度 ✓（docs/feat/fix/chore 分离清晰）。两处瑕疵：

1. `ee3a3c2`（移除 inject）和 `aa840cb`（patch 指向 lib/）都是"改了实现没同步文档"，直接造成 Y6/G2 两处漂移——实现类 fix 的 commit 应附带文档更新。
2. `2a077d0` 记录了 12 个未覆盖创新点的技术债 ✓（良好实践），但 Y6 的 inject 时序问题没有同等的技术债记录。

仓库卫生：`.gitignore` 正确排除了 `lib/`、`*.tgz`、`node_modules/`，git ls-files 确认编译产物未入库 ✓。

---

## 验证记录

| 项 | 命令 | 结果 |
|---|---|---|
| 类型检查 | `pnpm run typecheck` | 0 错误 |
| 全量测试 | `pnpm vitest run` | 7 文件 59/59 通过 |
| R3 误报复现 | node 内联脚本模拟 turn=1 历史消息 | `violated: true`（复现） |
| Y2 单行过滤复现 | node 内联脚本 `filterLayers(BRIEF, l2=false)` | 返回 `""`（复现） |
| Y1 死代码证明 | confidence = best/(best+second)，best≥second | 最小值 0.5，`< 0.5` 不可达 |
| 产物入库检查 | `git ls-files \| grep -E "^(lib/\|.*\.tgz)"` | 空（未入库） |

## 修复顺序建议

1. **R1**（先确认 dsh waterfall 语义，这决定 P0 功能是否存在）→ 2. **R3 + Y3**（constraint-immune 检查逻辑重写）→ 3. **R2**（customPatterns 接线）→ 4. **Y1/Y2**（分类器死代码 + 精简版过滤）→ 5. **R5 + G2/G3/G6**（文档同步）→ 6. **R4 + G1**（测试有效性）→ 7. **Y6/Y7**（包完整性）。
