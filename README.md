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
| **cognition-gate** | 每轮注入认知导航（L1/L2/L3） | `agent/pre-step` |
| **constraint-immune** | 提取并强制执行用户硬约束 | `agent/pre-step` |

## 配置

在 `cordis.yml` 中按插件 id 配置：

```yaml
# 禁用某个插件
- id: cognition-gate
  disabled: true

# 自定义意图映射
- id: intent-router
  config:
    effortMap:
      architecture: max
      refactor: high
```

## 开发

```sh
pnpm install
pnpm run typecheck
pnpm vitest run
```

## License

MIT
