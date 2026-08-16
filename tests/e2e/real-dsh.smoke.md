# V0.3 A0 真实 dsh 冒烟手册

运行前只设置环境变量 `DEEPSEEK_API_KEY`，不得把 key 写入文件：

```sh
corepack pnpm run build
DEEPSEEK_API_KEY="$DEEPSEEK_API_KEY" DSH_BIN=/path/to/dsh \
  node lib/tests/e2e/real-dsh.smoke.js
```

若 dsh 宿主机因既有 watcher 触发 `EMFILE`，可显式增加 `A0_DISABLE_HOST_WATCHERS=1`。该开关只隔离 dsh 宿主 watcher，不替换模型、工具、sidecar、resume 或 fork 链路；脚本会在临时 `DSH_HOME` 注入测试专用 no-op HMR provider。

脚本会创建临时 `DSH_HOME`，打包并执行 `dsh plugin add`，检查 7 插件配置，然后运行 headless 会话。真实环境还应检查：

- pre-step 顺序与 checkpoint-trace 的 deny/ask 成对事实；
- 中文约束拦截英文 `rm`，工具结果为 deny；
- strategy sidecar 中 requested/effective 与相同 messageId 的 source 对账；
- checkpoint integrity hash 链、digest 变化后的 invalidation；
- 无 approval answerer 时 ask 立即 fail-closed 为 deny，reason 含 `requires approval`；
- 在 checkpoint 边界 fork，子 session 通过 parentSession 找到最近 checkpoint；
- kill 后重启 dsh，resume 同一 session 成功。

本工作区最终证据：源码版 dsh 位于 `/Users/bluth/Code/deepseek-src/deepseek-harness`，commit `47f943859b`。使用环境变量提供 API key，并设置 `A0_DISABLE_HOST_WATCHERS=1` 后，完整 smoke 退出码为 0，覆盖 7 插件顺序、策略对账、约束 deny、headless ask fail-closed、hash 链、digest invalidation、resume、fork 父 checkpoint 索引和密钥扫描。
