# oh-my-dsh

> DeepSeek Harness (dsh) 认知与安全基线插件合集 —— 让 Agent「该省的省、该花的花、不乱来」

一条命令给你的 DeepSeek Harness 装上七个可组合插件：意图路由、模型路由、认知护栏、约束免疫、范围契约、checkpoint 追踪、风险审查。v0.3 的重点是可组合、可拒绝、可审计、可恢复，而不是增加更多提示词。

---

## 为什么值得装？三个真实场景

### 场景一：钱包在流血 —— 简单任务也烧深度推理

**你遇到的问题**：给 Agent 派个「把 1+1 算出来」「改个错别字」这种两秒钟的活，它照样启动满血深度推理，Token 哗哗烧。一个月下来，钱大多花在了本不该花的地方。

**装上之后**：**model-router** 默认让 Agent 用便宜的 Flash 模型，只有真遇到复杂任务才自动升级到 Pro。A1 桩测试已验证升级条件；A0 真实 dsh 运行需要外部 dsh 二进制和 API key。

### 场景二：Agent 智商不在线 —— 该深想的时候浅尝辄止

**你遇到的问题**：让它做系统架构设计、技术选型这种要深思熟虑的活，它却跟做普通问答一样浅想两下就交卷，方案漏洞百出。

**装上之后**：**intent-router** 识别任务意图，并把请求的推理强度与模型实际 capability 对账；不支持时记录降级原因，不假装请求已生效。

### 场景三：Agent 乱来 —— 说错话、做错事、越界串戏

**你遇到的问题**：Agent 偶尔跑偏——该诚实说不知道的时候瞎编;该收敛任务范围的时候擅自加戏;你明令「不许删数据库」它还敢动手。

**装上之后**：
- **cognition-gate** 每轮注入可配置的 L1/L2 与 I-02/I-08 认知提示，让 Agent 保持诚实、假设先行、主动质疑。
- **constraint-immune** 听懂你的硬约束（「不能删 X」「必须先备份」），违规就提醒，甚至能在工具执行前**直接拦截**——它想 `rm` 都会被拦下来。

---

## 包含的七个插件

| 插件 | 一句话 | 干的活 |
|------|--------|--------|
| **intent-router** | 意图路由 | 识别任务类型 → 自动设置推理强度 |
| **model-router** | 模型路由 | Flash-first，复杂任务自动升 Pro |
| **cognition-gate** | 认知护栏 | 每轮注入可配置认知提示，防跑偏 |
| **constraint-immune** | 约束免疫 | 听懂硬约束，违规提醒 + 工具拦截 |
| **scope-guard** | 范围契约 | 高置信范围变化需确认，越界工具 deny |
| **checkpoint-trace** | 存档追踪 | sidecar JSONL、workspace digest、SHA-256 链 |
| **review-router** | 风险审查 | 共享 R0-R4 风险模型，M0/M1/M4 裁决 |

---

## 安装

```sh
dsh plugin add oh-my-dsh
```

装完即用，七个插件默认全部开启。也可以只装其中几个（见下方「单独安装 / 配置」）。

## 配置

在 `cordis.yml` 里按插件 id 配置：

```yaml
# 禁用某个插件（比如不想要认知注入）
- id: cognition-gate
  disabled: true

# 只想拦截不想提醒 → 关闭 constraint-immune 的工具拦截，仅保留提醒
- id: constraint-immune
  config:
    interception: off

# 自定义意图 → 推理强度映射
- id: intent-router
  config:
    effortMap:
      architecture: max
      refactor: high

# 调模型路由：换模型 / 加升级条件
- id: model-router
  config:
    proModel: deepseek-v4-pro      # 复杂任务升级到 Pro
    upgradeIntents: [architecture, research]  # 哪些意图升 Pro
    tokenThreshold: 30000          # 上下文超此阈值也升 Pro
```

### 单独安装其中几个插件

oh-my-dsh 是**插件合集**，不是闭死的一整盒。每个插件都是独立的标准 Cordis 插件，可以自由选择装哪个、装几个。在 `cordis.yml` 里只保留你想装的条目即可：

```yaml
# 只装 model-router 和 constraint-immune
- insert:
    - id: model-router
      name: oh-my-dsh/lib/src/model-router/index.js
      config:
        enabled: true
        defaultModel: deepseek-v4-flash
        proModel: deepseek-v4-pro
        upgradeIntents: [architecture, research]
    - id: constraint-immune
      name: oh-my-dsh/lib/src/constraint-immune/index.js
      config:
        enabled: true
        interception: deny
```

> 注意：intent-router / model-router 共享 intent 分类器，cognition-gate / intent-router 共享 `shared/messages` 工具。单独装某个插件时，这些共享代码会自动带上，不会缺依赖。

---

## 各插件功能详解（场景 → 它解决什么）

### intent-router —— 意图路由

**功能清单**：识别 7+1 类意图（重构/新建/中等改动/协作/架构/调研/简单修改/兜底）→ 按意图设置 `reasoningEffort`。

**它解决什么**：
- **场景**：你同时派「重构 Module A」和「改个 typo」两个任务。以前都一个强度，重构本该深思熟虑却浅做，typo 本该秒回却深度推理。
- **解决**：识别出「重构」→ 深度推理（high/max）；「typo」→ 轻推理。每个任务用匹配的脑力，不浪费也不敷衍。
- **自定义**：`effortMap` 可调每种意图的推理强度。

### model-router —— 模型路由

**功能清单**：Flash-first（默认便宜模型）+ 三路自动升 Pro（复杂意图 / 上下文超阈值 / 连续不满意）。

**它解决什么**：
- **场景**：日常 90% 的任务其实不需要最强模型，但固定用 Pro 很贵；反过来，复杂任务固定用 Flash 又答不好。
- **解决**：先都用便宜的 Flash 跑，一旦识别到**架构/调研**这类重活、或**上下文超 3 万 token**、或**你连续两次说"不对/重来"**（说明它答砸了），自动升级 Pro。**平时省钱，关键时刻不拉胯。**
- **三个升级开关可独立开/关**。

### cognition-gate —— 认知护栏

**功能清单**：每轮向模型注入可配置认知提示——L1/L2（诚实、假设先行、第一性原理）与 I-02/I-08（主动质疑、复盘改进）。

**它解决什么**：
- **场景**：Agent 明明不确定却装懂、不先讲假设就动手、从不反思自己的失误。
- **解决**：每轮提醒它「不确定就说不确定」「假设先行」「做完反思」。让 Agent 像靠谱的工程师一样思考，而不是像个嘴硬的实习生。
- **可配置**：想关掉某一层（比如只要诚实不要反思）就改 `layers`。

### constraint-immune —— 约束免疫

**功能清单**：提取硬约束（否定型"不能/禁止"+ 肯定型"必须"）→ 违规自动提醒 → `tools/pre-execute` 工具执行前拦截。

**它解决什么**：
- **场景**：你下了硬约束「禁止删除生产数据」「必须先备份再操作」，但 Agent 聊着聊着就忘了，真去 `rm`、真不备份就动手。
- **解决**：
  - **否定型**（不能/禁止/不要）：Agent 一旦在输出里提到违反约束的内容，自动追加一条提醒；更关键的是，在**工具执行前**检查——它发起 `rm`/`delete` 这类命令时直接拦截 deny，工具根本不执行。
  - **肯定型**（必须）：要求"必须先备份再操作"，Agent 没备份就动手？自动提醒"检测到未执行"。
- **可配置**：`interception: deny`（默认，拦截）或 `off`（只提醒不拦截）。

---

## v0.3 Release Notes

- 版本升级到 0.3.0，兼容声明收窄到 dsh 0.1.0-rc.*；已按 dsh 源码基线 47f943859 做真实 A0 与 A1 验证。
- 新增 scope-guard、checkpoint-trace、review-router 三个插件；checkpoint 事实只写 sidecar，不写 session.append。
- intent-router 增加 capability 对账；model-router 按 message.id 去重并记录 strategy 事实。
- cognition-gate 增加 stable/evidence/active/external 四区软预算与 pressure 事实；不做驱逐或精确计费。
- headless 无 approval answerer 时，M4 ask 按 fail-closed 语义降级 deny；真实 dsh A0 已验证安装、headless 会话、工具拒绝、sidecar hash 链、resume 与 fork。若宿主 watcher 触发 `EMFILE`，烟测支持显式 `A0_DISABLE_HOST_WATCHERS=1` 资源隔离。

### 创新点状态与证据等级

| 创新点 | 状态 | 证据 |
|---|---|---|
| I-03 Attention Budget | 半做 | A1：四区标签与 pressure，不含驱逐 |
| I-07 Risk / Evidence Review | 半做 | A1：M0/M1/M4；A0：真实 headless fail-closed |
| I-08 Scope Change Governance | 半做 | A1：高置信契约与确认状态机 |
| I-10 Intent to Strategy | 半做 | A1：8 意图与事实对账 |
| I-11 Traceable Checkpoint | 半做 | A1：digest、hash 链、redaction；A0：resume/fork |
| I-17 Reasoning Effort Control | 半做 | A1/A0：capability 对账；供应商语义不承诺 |
| I-01 Agent Immune System | 半做 | A1/A0：约束提醒与真实工具 deny，完整闭环未做 |
| 其余创新点 | 未做/研究中 | 不在 v0.3 运行时范围 |

### 兼容声明

已按 dsh commit 47f943859（0.1.0-rc.5）源码接缝验证；peerDependencies 为 0.1.0-rc.*。rc 版本间可能存在破坏性 API 变化，升级前请重新运行真实 dsh smoke。

## v0.2 历史 Release Notes

- `constraint-immune` 默认行为从仅提醒变为**提醒 + 工具执行拦截**（`interception: deny`）；如需保持 v0.1 行为，配置 `interception: off`。
- `model-router` 默认优先使用 `deepseek-v4-flash`，架构、研究、超长上下文或连续不满意时升级到 Pro。
- 中文「删除」约束现在能拦住英文 `rm`/`delete` 命令（工具别名匹配）。

## 开发

```sh
pnpm install
pnpm run typecheck
pnpm vitest run
```

## License

MIT
