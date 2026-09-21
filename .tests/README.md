# .tests/ — 测试脚本与 profile 种子（tracked）

本目录收拢 dashr 的测试资产；运行态数据一律落 gitignored 的 `.dsh-test*/`，这里只放**可再生的正本**。

```
.tests/
├── start-4999.sh        # Dev/Test 1 实例拉起脚本（唯一入口，AGENTS.md §二）
└── profiles/
    └── web/             # 测试 profile 种子（tracked 正本）
        ├── package.json         # dsh.profile.bundles + dependencies.better-dsh（插件页卡片必需）
        ├── cordis.patch.yml     # profile 用户层 patch（dashr-repl config / fs-sandbox 重指 / mobile 开关）
        ├── cordis.yml           # 空入口列表 []（树由 patch 组成；勿编辑此文件）
        └── pnpm-workspace.yaml  # allowBuilds: node-pty
```

## start-4999.sh

```bash
bash .tests/start-4999.sh              # canonical 4999，loopback only
PORT=4988 bash .tests/start-4999.sh    # 端口被占时覆盖
LAN=1 bash .tests/start-4999.sh        # 加用户态 socat 中继暴露 LAN IP
```

脚本自带：端口预检（外来进程拒绝）、停旧 + 等端口真释放、本 boot token 水位提取、
`DSH_TRUSTED_HOSTS` + `UnsetEnvironment=DISPLAY WAYLAND_DISPLAY` 两行 prod 对齐环境。
关停：`systemctl --user stop dsh-<port>-test [dashr-lan-<port>-relay]`（勿 kill）。
细节与原理见根 `AGENTS.md` §二。

## 测试 home 再生（`.dsh-test/` 丢失/换机时）

`.dsh-test/` 是 gitignored 运行态；种子在本目录 `profiles/web/`。再生步骤：

1. `mkdir -p .dsh-test/profiles/web && cp .tests/profiles/web/* .dsh-test/profiles/web/`
2. `.dsh-test/profiles/web/node_modules/` 内三个 symlink 指向 monorepo build 产物
   （**不是 registry 包**）：
   - `better-dsh` → `upstream/deepseek-harness/packages/better-dsh/better-dsh`
   - `@deepseek-ai/dsh-base` → `upstream/deepseek-harness/packages/bundle/base`
   - `@deepseek-ai/dsh-web-app` → `upstream/deepseek-harness/packages/bundle/web-app`
   其余 host 依赖由 `.dsh-test/profiles/node_modules/`（全 symlink → 全局 harness 树）与
   module-fallback 机制供给——见 AGENTS.md §一"依赖解析"分层。
3. `.env` 从 `~/.dsh/.env` 拷贝（真实 key）。
4. **勿在测试 profile 跑 `pnpm install`**——会把上述 symlink 换成 registry 包。
5. `dependencies.better-dsh` 版本条目**不可删**：0.1.6 plugin-manager 以 profile
   dependencies 判定"已安装 bundle"，缺条目 = 插件页卡片不出现。

## 约定

- 新增测试脚本放本目录根（`.tests/<name>.sh`）；涉及独立 dsh home 的实验线
  用独立 gitignored 目录（`.dsh-<name>/`），其种子若需长期保留，同样在
  `.tests/profiles/<name>/` 放正本。
- 本目录内容入库（tracked）；`.dsh-test*` 运行态永不入库。
