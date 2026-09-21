# dsh-test1 — Dev/Test 1 rig（4988/4999 源码级实例）

对应运行态 home：`~/.dsh-test`（= `/home/u1/workspaces/dashr/.dsh-test`，gitignored，
`.env` 为真实 key）。拉起：`bash .tests/dsh-test1/start-4999.sh`（`PORT=` / `LAN=` 可覆盖）。
机制与红线见根 `AGENTS.md` §二；本 README 只记 home 再生。

## 测试 home 再生（`.dsh-test/` 丢失/换机时）

1. `mkdir -p ~/.dsh-test/profiles/web && cp .tests/dsh-test1/profiles/web/* ~/.dsh-test/profiles/web/`
2. `~/.dsh-test/profiles/web/node_modules/` 内三个 symlink 指向 monorepo build 产物
   （**不是 registry 包**）：
   - `better-dsh` → `upstream/deepseek-harness/packages/better-dsh/better-dsh`
   - `@deepseek-ai/dsh-base` → `upstream/deepseek-harness/packages/bundle/base`
   - `@deepseek-ai/dsh-web-app` → `upstream/deepseek-harness/packages/bundle/web-app`
   其余 host 依赖由 `~/.dsh-test/profiles/node_modules/`（全 symlink → 全局 harness 树）与
   module-fallback 机制供给——见 AGENTS.md §一"依赖解析"分层。
3. `.env` 从 `~/.dsh/.env` 拷贝（真实 key）。
4. **勿在测试 profile 跑 `pnpm install`**——会把上述 symlink 换成 registry 包。
5. `dependencies.better-dsh` 版本条目**不可删**：0.1.6 plugin-manager 以 profile
   dependencies 判定"已安装 bundle"，缺条目 = 插件页卡片不出现。
