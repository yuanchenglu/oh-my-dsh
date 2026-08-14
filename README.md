# oh-my-dsh

> DeepSeek Harness (dsh) 认知层插件合集 —— 让 DeepSeek 模型「该省的省、该花的花、不乱来」

一条命令给你的 DeepSeek Harness 装上四层「认知脑」：**意图路由、模型路由、认知护栏、约束免疫**。装之前，你的 Agent 无论任务大小都一个样；装之后，它知道什么时候图便宜、什么时候下血本、什么时候闭嘴不乱来。

---

## 为什么值得装？三个真实场景

### 场景一：钱包在流血 —— 简单任务也烧深度推理

**你遇到的问题**：给 Agent 派个「把 1+1 算出来」「改个错别字」这种两秒钟的活，它照样启动满血深度推理，Token 哗哗烧。一个月下来，钱大多花在了本不该花的地方。

**装上之后**：**model-router** 默认让 Agent 用便宜的 Flash 模型，只有真遇到复杂任务才自动升级到 Pro。简单任务省 Token，复杂任务保质量——钱花在刀刃上。（真实验证：简单问答走 `deepseek-v4-flash`，架构设计任务自动切 `deepseek-v4-pro`。）

### 场景二：Agent 智商不在线 —— 该深想的时候浅尝辄止

**你遇到的问题**：让它做系统架构设计、技术选型这种要深思熟虑的活，它却跟做普通问答一样浅想两下就交卷，方案漏洞百出。

**装上之后**：**intent-router** 自动识别任务意图——架构设计、深度调研这类任务自动把推理强度拉满（`reasoningEffort: max`），简单修改变成轻推理。**该深想的时候绝不敷衍。**

### 场景三：Agent 乱来 —— 说错话、做错事、越界串戏

**你遇到的问题**：Agent 偶尔跑偏——该诚实说不知道的时候瞎编;该收敛任务范围的时候擅自加戏;你明令「不许删数据库」它还敢动手。

**装上之后**：
- **cognition-gate** 每轮注入三层认知护栏（荣辱观/思维方式/三省吾身），让 Agent 保持诚实、假设先行、主动质疑。
- **constraint-immune** 听懂你的硬约束（「不能删 X」「必须先备份」），违规就提醒，甚至能在工具执行前**直接拦截**——它想 `rm` 都会被拦下来。

---

## 包含的四个插件

| 插件 | 一句话 | 干的活 |
|------|--------|--------|
| **intent-router** | 意图路由 | 识别任务类型 → 自动设置推理强度 |
| **model-router** | 模型路由 | Flash-first，复杂任务自动升 Pro |
| **cognition-gate** | 认知护栏 | 每轮注入三层认知导航，防跑偏 |
| **constraint-immune** | 约束免疫 | 听懂硬约束，违规提醒 + 工具拦截 |

---

## 安装

```sh
dsh plugin add oh-my-dsh
```

装完即用，四个插件默认全部开启。也可以只装其中几个（见下方「单独安装 / 配置」）。

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

**功能清单**：识别 7+1 类意图（重构/新建/中等改动/协作/架构/调研/简单修改/兜底）→ 按意图设置 `reasoningEffort` 和 token 预算。

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

**功能清单**：每轮向模型注入三层认知导航——L1 荣辱观（诚实、不忽悠）、L2 思维方式（假设先行、第一性原理）、L3 三省吾身（反思改进）。

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

## v0.2 Release Notes

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