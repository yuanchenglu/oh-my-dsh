# oh-my-dsh

> DeepSeek Harness (dsh) 认知层优化插件 bundle

让 DeepSeek 模型在 dsh 平台上"该省的省、该花的花、不乱来"。

## 安装

```sh
dsh plugin add oh-my-dsh
```

## 包含插件

| 插件 | 功能 | 挂钩点 |
|------|------|--------|
| **intent-router** | 意图分类 → 自动设置 reasoningEffort | `agent/request` |
| **model-router** | Flash-first，复杂任务自动升级 Pro | `agent/request` |
| **cognition-gate** | 每轮注入认知导航（L1/L2/L3） | `agent/pre-step` |
| **constraint-immune** | 提取、提醒并拦截用户硬约束 | `agent/pre-step` + `tools/pre-execute` |

## 配置

在 `cordis.yml` 中按插件 id 配置：

```yaml
# 禁用某个插件
- id: cognition-gate
  disabled: true

# 关闭 constraint-immune 的工具拦截，仅保留提醒
- id: constraint-immune
  config:
    interception: off

# 自定义意图映射
- id: intent-router
  config:
    effortMap:
      architecture: max
      refactor: high
```

## v0.2 Release Notes

- `constraint-immune` 默认行为从仅提醒变为提醒 + 工具执行拦截（`interception: deny`）；如需保持 v0.1 行为，配置 `interception: off`。
- `model-router` 默认优先使用 `deepseek-v4-flash`，架构、研究、超长上下文或连续不满意时升级到 Pro。

## 开发

```sh
pnpm install
pnpm run typecheck
pnpm vitest run
```

## License

MIT
