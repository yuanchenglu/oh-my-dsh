# V0.3 A0 真实 dsh 冒烟手册

运行前只设置环境变量 `DEEPSEEK_API_KEY`，不得把 key 写入文件：

```sh
corepack pnpm run build
DEEPSEEK_API_KEY="$DEEPSEEK_API_KEY" DSH_BIN=/path/to/dsh \
  node lib/tests/e2e/real-dsh.smoke.js
```

脚本会创建临时 `DSH_HOME`，打包并执行 `dsh plugin add`，检查 7 插件配置，然后运行 headless 会话。真实环境还应检查：

- pre-step 顺序与 checkpoint-trace 的 deny/ask 成对事实；
- 中文约束拦截英文 `rm`，工具结果为 deny；
- strategy sidecar 中 requested/effective 与相同 messageId 的 source 对账；
- checkpoint integrity hash 链、digest 变化后的 invalidation；
- 无 approval answerer 时 ask 立即 fail-closed 为 deny，reason 含 `requires approval`；
- 在 checkpoint 边界 fork，子 session 通过 parentSession 找到最近 checkpoint；
- kill 后重启 dsh，resume 同一 session 成功。

本工作区当前证据：源码版 dsh 位于 `/Users/bluth/Code/deepseek-src/deepseek-harness` 但不在 PATH；其 tarball 安装、7 插件配置解析和 headless 帮助挂载已通过。`DEEPSEEK_API_KEY` 未设置，完整 smoke 以退出码 77 标记 A0 blocked；没有伪造模型会话结果。
