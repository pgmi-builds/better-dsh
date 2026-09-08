## Context

- June 报告（`docs/repl-kernel-provisioning-test-report.md`）R1.1–R1.6 已给出验收框架：安装期供给钩子、环境 profile、cache 独立、验证门、CI 覆盖、文档。R1.3 的手工修法（`UV_CACHE_DIR`/`UV_PYTHON_INSTALL_DIR` 重定向）当时只修了宿主，没修代码。
- 本轮 user 裁决（2026-09-02）：kernel 必须由插件负责装好、能用；**独占**——不依赖用户真实环境里的全局 Python 库 kernel；装在 web profile 内属于我们自己的位置（venv 边界 = profile 边界）；装「测试跑通的版本」。
- **2026-09-03 user 细化裁决**：①默认安装、不 ask for approval（审批没有意义）；②每级失败直接 pass、只给提示信息，绝不产生阻断性影响；③**运行时提前检查**——插件随宿主 daemon 在 host 平面被带动起来时就检查/补装 iKernel，绝不等 agent session 真正发起运行时才发现缺 kernel 现场装（体验不可接受）。
- 现有实现盘点（`dashr/src/kernel-env.ts`）：`PACKAGE_ROOT/.venv-kernel` 默认位、`kernelEnvDir` 覆盖、`kernelPythonVersion`（默认 3.11）、`kernelAutoInstall`（默认 true）、uv 优先 + venv 兜底、幂等 `ensureVenv`、probe 隔离。
- prod 部署事实：插件经 pnpm 装进 `~/.dsh/profiles/web/node_modules/@pgmi-builds/better-dsh/`——包目录即插件领地，venv 落包内 = web profile 内独占，边界天然成立；包重装/升级时 pnpm 重建包目录，venv 随之干净重来（视为特性）。

## Goals / Non-Goals

- Goals：任意环境安装后，kernel 要么已就位、要么首用时可靠供给成功；版本确定；状态可见；全程不越出插件领地。
- Non-Goals：不随 npm 包分发 venv；不支持多 kernel 并存/用户级 kernel 注册表；不做 uv 的捆绑分发（宿主无 uv 走 venv+ensurepip）。

## Decisions

- **D1 随包 = 供给能力，不是供给结果**：npm 包只装 JS 产物；venv 由 postinstall（best-effort）或首用（可靠兜底）在现场生成。理由：平台二进制、体积、包卫生；同型先例 = node-pty/esbuild 的 install-script 模式。
- **D2 三级触发，daemon spin-up 为主路径（2026-09-03 修订）**：供给触发点分三级，全部收敛到同一个 `<venvDir>`、全部 fail-open——
  1. **postinstall（加速器，非依赖）**：包管理器跑了就预置；被 allowBuilds 门跳过也无妨（warn 级，安装永不失败）。设计上**零交互**：不存在任何向用户请求批准的路径——批不批准是包管理器与部署方的事，插件不参与。
  2. **daemon spin-up ensure（主路径）**：插件在 host 平面启动（挂载/激活阶段）即异步触发 `ensureVenv`——检查路径 → 缺则按梯子（uv → `python3 -m venv`+ensurepip → 显式 `python` 配置）安装。此路径在宿主进程内执行，**不经过任何包管理器审批门**，「默认安装、无需批准」在这里真正成立。异步执行不阻塞插件挂载与 daemon 启动。
  3. **首用 lazy（最后兜底）**：`kernelAutoInstall` 默认 true 保持——覆盖「spin-up 检查失败/被跳过」的残余场景。
  供给梯子说明：pnpm/npm 只负责交付我们的 npm 包，不参与 kernel venv 创建；解释器侧梯子 = uv → python3-venv → 显式配置。
- **D3 cache 邻位重定向**：`UV_CACHE_DIR`/`UV_PYTHON_INSTALL_DIR` → `<venvDir>/../.uv-cache`（包内领地），`UV_LINK_MODE=copy`；venv 兜底路径天然无 cache 问题（ensurepip 用 venv 内资源）。只读 home 从此无关。
- **D4 版本锁三件套**：`KERNEL_PYTHON_VERSION='3.11'`（已有）+ `IPYKERNEL_VERSION`/`DILL_VERSION` 常量（初始取 June 实测跑通值 7.3.0 / 0.4.1），单测断言安装命令携带精确 pin；升版本 = 显式 change + 回归。
- **D5 状态可观测，错误带出路**：供给各阶段 log；失败信息列三条修复路（`npm run kernel:venv` / `kernelAutoInstall: true` / 显式 `python`）；REPL 卡片错误透传该信息（现状已透传 `eval` 错误，保持）。
- **D6 postinstall 失败语义**：postinstall 内任何异常都捕获降级为日志（非零退出码仅在「连兜底都声明不可用」时也不使用——安装永远成功，供给问题留给首用/手动路径暴露）。理由：npm/pnpm 安装失败的用户心智成本远大于「首用多等几秒」。

## Risks / Trade-offs

- postinstall 被 skip 的主机上「装完即有」不成立——由 D2 的 spin-up 主路径覆盖（daemon 起来数秒内补齐）；plugin market 安装链路的 build-script 批准 UX 仅影响加速器一级，不再影响正确性。
- **多实例/并发（2026-09-03 user 裁决）**：非问题，不做任何设计。venv 是一串 binary，运行期各 daemon/各 session spawn 独立解释器进程，与多个 App 调系统全局 python3 的物理逻辑相同；kernel/venv 自身不记录不持久化。安装是**预期一次性**的事件（任何真实安装器——macOS pkg、MSI——都不为「两个安装器同时跑」设计），运行时检查是幂等的「在就 pass」；千次百次的 spin-up 面对的是早已装好的 venv。无锁、无原子发布、无并发条款。

## Open Questions

- CPython 3.11 pin 与宿主默认 3.14 的矩阵（June open item 续）：uv 可拉 3.11，无 uv 且系统只有 3.14 时 venv 兜底装出 3.14 + pinned ipykernel——是否需要对 3.14 跑通一遍测试矩阵再放宽 pin？（实现时回答）
- plugin market 安装链路对 postinstall 的实际批准/跳过形态？（首个发布版装机时观察）
