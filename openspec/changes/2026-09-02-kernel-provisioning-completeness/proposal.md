## Why

「不能只提供 REPL 界面，却不管解析引擎在哪。」alpha.5 实测（实测报告 §4 第 4 项，源自 `docs/repl-kernel-provisioning-test-report.md` 的 R1 forward requirement）：安装完成后 IPython kernel 并没有安装到位，首次使用在受限主机（只读 `~/.cache`）直接 EROFS 失败。

现状（`dashr/src/kernel-env.ts`）已经对了大半：managed venv 默认 `<packageRoot>/.venv-kernel`——**prod 部署形态下就落在 `~/.dsh/profiles/web/node_modules/@pgmi-builds/better-dsh/.venv-kernel`，即 web profile 内、插件独占**，不碰用户全局 Python；probe 不 import 用户模块；`kernelAutoInstall` 默认 true（首用供给）；uv 优先、`python3 -m venv` 兜底；幂等可修复。

剩余缺口（本 change 收口）：

1. **供给环境不健壮**：`createVenv`/`installDeps` 未重定向 `UV_CACHE_DIR`/`UV_PYTHON_INSTALL_DIR`，uv 默认写 `~/.cache/uv`——只读 home 直接失败（六月实测根因，至今未修）。
2. **版本不锁**：`ipykernel`/`dill` 安装不钉版本（只有 CPython 钉 3.11），不满足「安装我们测试跑通的版本」——用户全局环境是什么版本与我们无关，但我们的 venv 里是什么版本必须确定。
3. **安装期不预置**：纯 lazy 首用供给，"装完即有"不成立；供给状态也不可见（失败只从 `eval` 错误里冒出来）。

## What Changes

- **cache 独立**：uv 缓存/Python 安装目录重定向到 venv 邻位（`<venvDir> 同级 .uv-cache`），只读 home 不再阻断供给；`python3 -m venv` + ensurepip 兜底路径保留。
- **版本锁定**：`ipykernel`/`dill` 钉到测试跑通版本（June 实测：ipykernel 7.3.0 / dill 0.4.1），常量 + 单测锁定，升级走显式 change。
- **三级触发供给（2026-09-03 user 裁决修订）**：①安装期 postinstall best-effort（包管理器未批准 build script 则静默跳过，**绝不 ask for approval、绝不阻断安装**）→ ②**daemon spin-up 检查（主路径）**：插件随宿主守护进程在 host 平面启动时即异步执行「检查 kernel 在不在 → 不在就用供给梯子装好」（uv → `python3 -m venv` → 显式配置），不阻塞挂载、失败只留状态与提示——agent session 开始时 kernel 已就绪，**绝不让 agent 现场发现缺 kernel 再装**；③首用 lazy 仅作最后兜底。三级写同一个独占 venv，幂等合并，全部 fail-open（任何一级失败都只降级提示，不产生阻断性影响）。
- **状态可观测**：供给的 provisioning/ready/degraded/failed 状态进插件日志；失败信息带可执行修复指引（`npm run kernel:venv` / `kernelAutoInstall` / 显式 `python` 三条路）。
- **spec 化边界**：独占性（只在插件自有 venv、永不写用户全局环境）与「随包不分发 venv」的裁决落 spec。

## 明确不做（design D1 详述）

- **不把 venv 打进 npm 包**：平台二进制差异（CPython/uv 装的是宿主平台产物）、体积（venv 数十 MB）、npm 包卫生（pack 应只含 JS 产物）；「随包」的正确形态 = 随包携带**供给能力**（postinstall + lazy 两级），而非携带**供给结果**。
- 不动 `~/.dsh/plugins`（那是上游的另一套插件机制，`dsh-better-edit` 在用；我们走 profile 依赖部署线，边界不越）。

## Capabilities

### New Capabilities

- `kernel-provisioning`: REPL kernel 解释器的独占供给契约（位置、版本锁、两级策略、cache 独立、状态可观测）。

### Modified Capabilities

（无）

## Impact

- **代码**：`dashr/src/kernel-env.ts`（cache env、版本常量、postinstall 入口、状态上报）、`dashr/package.json`（postinstall script + `kernel:venv` 保留）。
- **测试**：EROFS 模拟（HOME 指向只读目录）、版本锁单测、幂等修复路径、postinstall 跳过语义。
- **文档**：供给一页说明（June R1.6：各 profile 如何供给/验证/修复）；AGENTS.md 对应条目。
