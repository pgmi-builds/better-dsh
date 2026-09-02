# DASHR Kernel 供给（iKernel Provisioning）

> One page（June R1.6 落实地）：dashr REPL 的 IPython kernel 由插件**全责供给**——位置、版本、触发时机、修复出路。对应 spec：`openspec/specs/kernel-provisioning/`（change `2026-09-02-kernel-provisioning-completeness`）。

## 原则

- **完全体**：不提供"只有 REPL 界面没有解析引擎"的形态。kernel 装好、能用是插件的责任。
- **独占**：kernel 只活在插件自有 venv（`<packageRoot>/.venv-kernel`，prod 即 web profile 内插件领地；`kernelEnvDir` 可显式覆盖）。永不写用户全局 Python，probe 永不 import 用户 site 模块。
- **不随包分发 venv**：npm 包只带 JS 产物；"随包"= 随包携带**供给能力**，供给结果在现场生成。
- **fail-open**：任何一级供给失败只留提示（含修复出路），绝不阻断 npm 安装、daemon 启动或插件挂载。

## 版本锁定（测试跑通值）

| 组件 | 版本 | 出处 |
|---|---|---|
| CPython | 3.11（uv 拉取；无 uv 时宿主 python3 亦验证兼容——3.14.4 实测通过） | `DEFAULT_KERNEL_PYTHON_VERSION` |
| ipykernel | 7.3.0 | `IPYKERNEL_VERSION` |
| dill | 0.4.1 | `DILL_VERSION` |

升级 = 显式 change + 回归跑通后再改常量。

## 三级触发（全部幂等、全部 fail-open）

1. **postinstall（加速器）**：`npm install` 后 best-effort 预置（`scripts/kernel-provision.mjs`）。包管理器未跑 build script 则静默跳过——零交互，不存在向用户请求批准的路径。
2. **daemon spin-up（主路径）**：插件随宿主 daemon 在 host 平面启动即异步检查/补装。**agent session 永远不会在首用时才发现缺 kernel**。在就 pass（毫秒级 probe），缺才装（数十秒）。
3. **首用 lazy（最后兜底）**：`kernelAutoInstall` 默认 true，覆盖前两级失败/被跳过的残余场景。

## 供给梯子与环境加固

- 有 `uv`：`uv venv --python 3.11` + `uv pip install ipykernel==7.3.0 dill==0.4.1`，且 **`UV_CACHE_DIR`/`UV_PYTHON_INSTALL_DIR` 重定向到 `<packageRoot>/.uv-cache`**、`UV_LINK_MODE=copy`——只读 `~/.cache`/只读 home 的主机不再被阻断（2026-09-03 实测：HOME chmod 555 下供给成功）。
- 无 `uv`：`python3 -m venv` + `pip install`（ensurepip，无 cache 依赖；3.14.4 实测通过）。

## 各 profile 速查

| Profile | venv 位置 | 验证 | 修复 |
|---|---|---|---|
| prod（web profile 插件） | `~/.dsh/profiles/web/node_modules/@pgmi-builds/better-dsh/.venv-kernel` | daemon 日志见 `kernel ready`；REPL 首 cell 即时响应 | 在包目录跑 `npm run kernel:venv`；或设 `python` 指向已备解释器 |
| dev/test 4999（monorepo 副本） | `packages/better-dsh/better-dsh/.venv-kernel` | 同上（stdout 可见 provisioning→ready） | 同上；rsync 后照常（.venv-kernel 在排除清单，不被 --delete 清掉） |
| 显式覆盖 | config `kernelEnvDir` | — | — |

## 状态与错误

供给各阶段有日志（provisioning / ready / degraded-dill / failed）；失败信息列三条出路：`npm run kernel:venv`（手动）、`kernelAutoInstall: true`（首用自动装）、config `python` 指向已备解释器。
