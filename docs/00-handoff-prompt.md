# oh-my-dsh 交接提示词（新 Hermes 会话专用）

> 把这个提示词完整粘贴到新的 Hermes 会话中，即可开始写代码。

---

## 任务：实现 oh-my-dsh v0.1.0

你是 oh-my-dsh 项目的开发者。这是一个 DeepSeek Harness (dsh) 的 TypeScript 插件 bundle，包含 3 个认知层插件。

### 项目仓库

GitHub: https://github.com/yuanchenglu/oh-my-dsh
本地路径: ~/Code/oh-my-dsh

### 文档（全部在 ~/Code/oh-my-dsh/docs/ 下，先全部读完再动手）

| 文件 | 内容 | 你要用的部分 |
|---|---|---|
| docs/01-prd.md | 产品需求 | 功能定义、验收标准（AC-1~AC-5） |
| docs/02-architecture.md | 技术架构 | API 签名、挂钩示例、模块设计、仓库结构 |
| docs/03-plan.md | 技术规划 | **你的任务清单**、子代理分配卡、完整代码片段 |
| docs/04-testing.md | 测试体系 | fixture 测试用例、测试代码模板 |

### 执行策略

**M0 已完成**（仓库已建好，docs/ 已有，.gitignore 已有）。你从 M1 开始。

```
M1（intent-router）──┐
M2（cognition-gate）──┼── 三个可并行（文件路径互不重叠）
M3（constraint-immune）┘
         │
         ▼
M4（bundle 打包 + cordis.patch.yml）
M5（全量测试 + README）
```

### 具体步骤

**Step 1：读文档**
```
read_file ~/Code/oh-my-dsh/docs/01-prd.md
read_file ~/Code/oh-my-dsh/docs/02-architecture.md
read_file ~/Code/oh-my-dsh/docs/03-plan.md
read_file ~/Code/oh-my-dsh/docs/04-testing.md
```

**Step 2：M0 补全（如果还没做）**
按 03-plan.md 的 M0-1 创建 package.json / tsconfig.json / vitest.config.ts / src/shared/types.ts / cordis.patch.yml，然后 pnpm install + pnpm run typecheck。

**Step 3：并行开发三个插件**
按 03-plan.md 的子代理任务分配卡（A/B/C），每个插件的文件清单和验收命令都在文档里。文档中有完整的 strategies.ts、fixtures.ts、注入文本常量、正则——直接复制，不需要去其他文件找数据。

**Step 4：M4 打包**
按 03-plan.md 的 M4-1 填 cordis.patch.yml，M4-2 做安装验证。

**Step 5：M5 收尾**
全量测试 + README + git commit + push。

### 关键约束

1. **全部 TypeScript**，strict + noImplicitAny，零额外依赖（只用 @deepseek-ai/cordis / @deepseek-ai/dsh-tools / @deepseek-ai/schemastery）
2. **Commit 信息中英双语**，格式：`type: english description / 中文描述`
3. **每个插件独立完成后再合并**，不要跨插件改文件
4. **API 签名以架构文档为准**（已从 dsh v0.1.0-rc.5 源码验证），不要猜
5. **测试先行**：每个插件写完核心逻辑后立刻写测试，全部通过再写插件入口

### 参考路径（备查，正常流程不要读）

四套文档已自包含：所有代码片段、测试用例、API 签名都已内联，**直接复制即可，不需要读以下任何文件**。以下路径仅用于两种异常场景：
1. M4 安装验证时，需要对 dsh 仓库**执行命令**（`pnpm dsh web --patch ...`），不是阅读
2. 行为与文档预期不符时，对照 dsh 官方示例调试

如果文档与以下源码冲突，**以文档为准**（文档已从 dsh v0.1.0-rc.5 源码逐一验证）。

dsh 官方仓库：~/Code/deepseek-src/deepseek-harness
oh-my 设计源头：~/Code/deepseek-src/oh-my-deepseek-harness

---

开始吧。先读文档，再动手。
