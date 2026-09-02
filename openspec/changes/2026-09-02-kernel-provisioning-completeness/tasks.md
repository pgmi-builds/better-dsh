## 1. 供给加固（cache 独立）

- [x] 1.1 `createVenv`/`installDeps` 注入 `UV_CACHE_DIR`/`UV_PYTHON_INSTALL_DIR`（→ venv 邻位 `.uv-cache`）+ `UV_LINK_MODE=copy`；验证：单测断言 env 注入（`test/kernel-env.spec.ts`）✓；EROFS 模拟 ✓——`HOME` 指向 chmod 555 目录下冷供给成功（uv 全程未触 home，76M cache 落包内 `.uv-cache`）
- [x] 1.2 venv 兜底路径（无 uv）确认无 cache 依赖；验证：假 `uv`（exit 1）强制 `python3 -m venv` 兜底——3.14.4 + pinned ipykernel 7.3.0/dill 0.4.1 装成且 import 通过，全程只读 HOME；顺带回答 design open question（3.14 兼容，见 5.1 文档）

## 2. 版本锁定

- [x] 2.1 `IPYKERNEL_VERSION`/`DILL_VERSION` 常量（7.3.0 / 0.4.1），uv 与 pip 双路径安装命令均携带精确 pin；验证：单测断言 `ipykernel==<pin>`/`dill==<pin>` 形态（`test/kernel-env.spec.ts`）✓
- [x] 2.2 pin 值在 4999 实例真实供给三轮跑通（冷 venv：daemon spin-up 一轮、脚本直跑两轮、无 uv 兜底一轮）；验证：venv python `import ipykernel, dill` 报 7.3.0 / 0.4.1 ✓

## 3. 三级触发供给（2026-09-03 修订）

- [x] 3.1 postinstall 加速器：`package.json` 增 postinstall + `kernel:venv` 双职指向 `scripts/kernel-provision.mjs`（复用 `lib/kernel-env.js`，异常全捕获降级日志，零交互、永不使安装失败）；验证：happy path 0.41s exit 0（幂等 probe pass）✓、lib 缺失分支（dev 未构建）跳过 exit 0 ✓、monorepo allowBuilds 已加 `'@pgmi-builds/better-dsh': true`；pnpm 安装链路两态（批准/跳过）待下次 monorepo install 与首个发布版装机观察（关联 design open question）
- [x] 3.2 **daemon spin-up ensure（主路径）**：`apply()` 挂载即异步触发 `resolveKernelEnv`（不阻塞挂载；在就 pass、缺才装，幂等）；验证：删 venv 后冷启动 daemon → venv 自动重建（pinned）且 daemon 正常监听（供给未阻塞启动）✓；再次运行脚本秒过（0.41s）✓
- [x] 3.3 首用 lazy 兜底回归（`kernelAutoInstall` 默认 true 不变，spin-up 与首用共用 `resolveKernelEnv`/`ensureVenv` 幂等路径）；验证：全量 vitest 403/403（含 real-kernel 用例）✓
- [x] 3.4 agent 体验验收：冷启动后 venv 在场**先于任何 agent session**；验证：daemon 起后未开任何 session，venv 已就绪（实证）✓；cell 即时性由 run-cell 测试族覆盖

## 4. 状态可观测

- [x] 4.1 供给阶段日志 + 失败三出路；验证：stdout 实证 `provisioning kernel venv at …` → `kernel ready: python 3.11.15 at …` 两阶段 ✓；脚本 fail 分支 warn 文本含三条修复路（`npm run kernel:venv` / spin-up·首用兜底 / 显式 `python`）✓

## 5. 文档与回归收口

- [x] 5.1 供给一页文档 `docs/kernel-provisioning.md`（原则/版本锁/三级触发/梯子/各 profile 速查/错误出路）+ AGENTS.md 对应条目（本地 patch 第 3 条 + 已验证清单）
- [ ] 5.2 全量 `npx vitest run`（**403/403 ✓**）+ `tsc --noEmit`（**0 错误 ✓**）+ 4999 冷启动冒烟（**✓**）；剩余：prod 装机路径核验（发布时：pnpm add 精确版本 → daemon 日志见 `kernel ready` → REPL 首 cell 即时）
