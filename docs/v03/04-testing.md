# oh-my-dsh v0.3 测试体系文档

> 基线：v0.2 的 111 个测试；v0.3 当前总计 151 个 A1 桩/单元测试。
> A0 真实 dsh smoke 已提供，但本机 dsh 不在 PATH 且 DEEPSEEK_API_KEY 缺失，真实运行状态是 blocked。

## TL;DR

v0.3 使用 TypeScript strict、vitest 和 Node 内置模块。每个 todo 先写失败测试再实现；全量 typecheck 与 vitest 都必须保持绿色。测试不会把提示词存在或静态 bundle 存在宣称为安全功能完成。

## 核心结论

1. 151 个 A1 测试全绿，v0.2 的 111 个基线测试没有删除。
2. waterfall 组合测试验证 next 委托；checkpoint-trace 集成测试验证 deny 也有成对 checkpoint。
3. R1 契约内 write 不会因为工具名 write 而无条件 ask；R3/R4 才进入 M4。
4. A0 必须真实安装 dsh、运行 headless、验证 fail-closed、fork 和 resume；当前环境不满足前提，故不编造结果。

## 1. 测试金字塔

~~~text
                 A0 真实 dsh
        安装、headless、deny、fork、resume
                    /      \
             A1 集成测试     A1 单元测试
       Cordis 桩与事件链      纯函数、hash、风险、契约
~~~

### 1.1 单元测试

| 文件 | 覆盖 |
|---|---|
| tests/intent-router/classifier.test.ts | 关键词分类 |
| tests/constraint-immune/extractor.test.ts | 硬约束提取 |
| tests/cognition-gate/injector.test.ts | 注入与层过滤 |
| tests/shared/messages.test.ts | 文本与 token 估算 |
| tests/shared/facts.test.ts | sidecar JSONL 与损坏行 |
| tests/shared/strategy.test.ts | 八意图默认策略 |
| tests/shared/risk.test.ts | R0-R4 三轴模型 |
| tests/shared/context-zones.test.ts | 四区和 pressure 构造 |
| tests/scope-guard/contract.test.ts | 高置信契约解析 |
| tests/checkpoint-trace/digest.test.ts | git/fallback digest |
| tests/checkpoint-trace/checkpoint.test.ts | canonical hash、链和脱敏 |

### 1.2 集成测试

| 文件 | 覆盖 |
|---|---|
| tests/constraint-immune/waterfall.test.ts | 下游调用、reject、abort |
| tests/integration/waterfall-composition.test.ts | 两种注册顺序与工具三态 |
| tests/integration/cognition-gate.test.ts | dsh context 保留 |
| tests/integration/constraint-immune.test.ts | 19 个既有约束用例 |
| tests/integration/intent-router.test.ts | v0.2 intent 行为 |
| tests/integration/model-router.test.ts | v0.2 model 行为 |
| tests/integration/intent-capability.test.ts | capability 对账和 fallback |
| tests/model-router/dedup.test.ts | message.id 去重和双写 |
| tests/cognition-gate/pressure.test.ts | pressure 事实与 stable 保留 |
| tests/scope-guard/governance.test.ts | deny、ask、revision |
| tests/checkpoint-trace/integration.test.ts | deny checkpoint 对、test-result |
| tests/review-router/routing.test.ts | M0/M1/M4 与 Verdict |

## 2. 测试工具与门禁

不新增测试库，只使用 vitest。dsh 的 tools/pre-execute 三态定义来自 packages/core/tools/src/index.ts:588-591；agent/pre-step waterfall 来自 packages/core/agent/src/runtime-types.ts:219-231。

标准门禁：

~~~sh
corepack pnpm run typecheck
corepack pnpm vitest run
~~~

本机在发布元数据变更后，corepack pnpm 触发网络受限的 pnpm 元数据预检；已用已有 node_modules/.bin/tsc 和 node_modules/.bin/vitest 完成等价本地验证。该环境差异不改变源码。

## 3. 关键单元断言

### 3.1 事实与 resume 安全

tests/shared/facts.test.ts 断言 session id 用 base64url 进入路径、六类事实逐行 JSON.parse、末行损坏跳过、父 session 能索引 checkpoint。src/shared/facts.ts:27-126 明确不调用 session.append。

### 3.2 风险与策略

tests/shared/risk.test.ts 断言：

| 输入 | 期望 |
|---|---|
| read | R0，两个轴为否 |
| allowedPaths 内 write | R1，checkpoint 是、approval 否 |
| 越界 edit | R3，两个轴为是 |
| rm | R3 |
| pnpm test | R2 |
| deploy | R4 |

tests/shared/strategy.test.ts 断言八意图全部覆盖，simple 为 auto:lowest，spec_driven 为 high。关键词只是骨架，不是完整策略空间。

### 3.3 checkpoint 完整性

tests/checkpoint-trace/checkpoint.test.ts 断言 canonical JSON key 排序、previousCheckpointId 链接、篡改 digest 后 verifyCheckpointIntegrity 失败，以及 token/key/secret/password 字段完全移除。checkpoint API 实现位于 src/checkpoint-trace/checkpoint.ts:1-112。

## 4. 集成测试

### 4.1 waterfall

tests/constraint-immune/waterfall.test.ts 先运行失败用例，再锁定：

- 违规提醒之前必须调用 next；
- 下游 reject 原样透传，不追加提醒；
- abort 返回下游结果。

tests/integration/waterfall-composition.test.ts 以两种注册顺序执行 cognition-gate 和 constraint-immune，并验证两者效果同时存在。工具三态桩验证 deny 不执行、allow 执行、ask 物化为 fail-closed deny 结果。

### 4.2 路由与事实

intent capability 测试使用 resolver 返回 efforts low/high，确认 max 降为 high 并记录 fallbackReason；resolver 抛错时去掉 reasoningEffort。model dedup 测试使用稳定 Session 对象和两个 message.id，确认重复消息不提前升级。两插件的 strategy 事实共享 messageId，source 不同。

### 4.3 scope、checkpoint、review

scope-guard 测试确认：

- defaultContract 外路径工具返回 deny；
- publish 返回 ask，reason 含 requires approval；
- 顺便增加范围先 pending，确认后 contractRevision 递增；
- 我的意思是等澄清文本不产生 ScopeChange。

checkpoint-trace 测试确认 tools/pre-execute 先后两条事实，哪怕 downstream 返回 deny；test command 在 tools/post-execute 产生 test-result。该实现不依赖不存在的 post-assistant hook，反面证据见 packages/core/agent-loop/src/agent.ts:381-398。

review-router 测试确认 R0 pass、R1 有 exitCode 0 的 testResults 时 pass、R1 无证据 ask、R3/R4 ask。M4 reason 含 requires approval。

## 5. E2E 测试

### 5.1 A0 真实流程

真实脚本 tests/e2e/real-dsh.smoke.ts 只从环境读取 DEEPSEEK_API_KEY，并创建临时 DSH_HOME。手册见 tests/e2e/real-dsh.smoke.md。预期流程：

~~~sh
corepack pnpm run build
corepack pnpm pack
DSH_HOME=临时目录 dsh plugin add oh-my-dsh-0.3.0.tgz
DSH_HOME=临时目录 dsh --dump-config
~~~

然后依次检查：

1. dump-config 中 7 个插件存在，顺序为 intent、model、cognition、checkpoint、constraint、scope、review；
2. pre-step 顺序可观测，中文约束能拦英文 rm；
3. 越界路径 deny；requiresApproval 的 ask 在 headless 无 answerer 时立即变成 deny，reason 匹配 requires approval；
4. strategy sidecar 有 requested/effective，双写按 messageId 归并；
5. checkpoint sidecar 有完整 hash 链，digest 变化写 invalidation；
6. checkpoint 边界 fork 成功，子 session 用 parentSession 查到父 checkpoint；
7. kill 后重启 dsh，resume 同一 session 成功；
8. key 不出现在文件或输出。

### 5.2 A1 支线

allow-once 不是发布门禁。测试 profile 可以注册 test-only approval answerer，验证 ask 到 allowed-once 的工具执行和 approval/asked、approval/decided 审计对。该支线不能替代 A0。

### 5.3 当前 A0 结果

本工作区实际检查结果：

~~~text
dsh executable: absent
DEEPSEEK_API_KEY: absent
real-dsh.smoke.js: exit 77, A0 BLOCKED
~~~

因此安装、headless、fork、resume 没有被声称为通过。静态 package tarball 已验证 7 个 lib/src 插件入口。

## 6. 覆盖目标与回归

- 新插件核心分支必须有 A1 用例；当前全量 151/151 通过。
- v0.2 的 111 个测试全保留；constraint-immune 的 19 个集成测试仍通过。
- A0 与 A1 分开标注，不以静态文件检查替代运行时行为。
- 所有 sidecar 事实测试使用临时目录，不写用户工作区和密钥。

## 7. 测试文件清单

新增文件包括：

~~~text
tests/constraint-immune/waterfall.test.ts
tests/integration/waterfall-composition.test.ts
tests/shared/facts.test.ts
tests/shared/strategy.test.ts
tests/shared/risk.test.ts
tests/integration/intent-capability.test.ts
tests/model-router/dedup.test.ts
tests/shared/context-zones.test.ts
tests/cognition-gate/pressure.test.ts
tests/scope-guard/contract.test.ts
tests/scope-guard/governance.test.ts
tests/checkpoint-trace/digest.test.ts
tests/checkpoint-trace/checkpoint.test.ts
tests/checkpoint-trace/integration.test.ts
tests/review-router/routing.test.ts
tests/e2e/real-dsh.smoke.ts
~~~

## 附录 A：AC 到用例映射

| PRD | 用例 |
|---|---|
| 3.1 AC-1~4 | waterfall.test.ts |
| 3.2 AC-1~3 | waterfall-composition.test.ts |
| 3.3 AC-1~6 | intent-capability.test.ts、dedup.test.ts |
| 3.4 AC-1~5 | scope-guard/contract.test.ts、governance.test.ts |
| 3.5 AC-1~5 | review-router/routing.test.ts |
| 3.6 AC-1~6 | checkpoint-trace 三个测试文件 |
| 3.7 AC-1~4 | context-zones.test.ts、pressure.test.ts |

## 附录 B：变更记录

2026-08-15：确定 A0/A1 分层、sidecar resume 哨兵和 approval fail-closed 语义。

2026-08-16：A1 151/151 全绿；A0 因外部运行条件缺失保持 blocked。
