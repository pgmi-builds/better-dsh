# 上游 DSH Code Mode 与 Dash RLM（ipython）对比调研

> 调研日期（UTC）：2026-08-19
> 上游源码：`upstream/deepseek-harness`（已从 rc.5 更新到 `dsh-v0.1.0-rc.7`，commit `99f6f02fec`）
> 对比对象：DSH 原生 Code Mode（`run_code`）vs Dash RLM 插件（`ipython`）
> 方式：读上游源码 + 设计 Agent Note + 本会话实测 dashr 运行时，全部结论均有文件/行号/引文支撑。

---

## 1. 结论速览（TL;DR）

| 问题 | 结论 |
|---|---|
| ① DSH Code Mode 是否也是「单一顶层工具 + 代码块」？ | ✅ 是。`run_code` 就是唯一顶层工具，形状与 `ipython` 完全同构 |
| ② 沙箱逃逸是否等价？ | ✅ 是。上游自己也写明「containment, not a security boundary」，信任姿态 = bash；任何图灵完备模式都会逃逸，只是快慢/直接间接之别 |
| ③ 最关键差异 | 🔴 **DSH 明确「拒绝」了持久化 kernel（REPL 式），而 Dash RLM 恰恰是持久化 IPython kernel**。这是二者最根本的分歧，根因是「可重建性」（reconstructability） |

---

## 2. 上游版本与源码定位

- 远程：`https://github.com/deepseek-ai/deepseek-harness.git`
- 更新：本地 rc.5 → `dsh-v0.1.0-rc.7`（tag 即 `origin/master`，`git merge --ff-only` 完成）
- 核心文件：
  - `packages/core/tools/src/code-mode.ts` —— `run_code` 工具定义 + dispatch bridge
  - `packages/core/tools/src/py-types.ts` / `ts-types.ts` —— SDK 生成（Python/TS 两套）
  - `packages/code-runtime/code-runtime/` —— 执行能力 seam（`ctx.codeRuntime`）
  - `packages/code-runtime/code-runtime-worker-thread/` —— 唯一 shipped 后端
  - `.agents/notes/implemented/feature/2026-06-15-code-mode.md` —— 权威设计文档
  - `.agents/notes/implemented/feature/2026-07-31-code-mode-language-dispatch.md` —— Python 呈现层

---

## 3. 表面形状对比：是不是「单一顶层工具」

**是。** 两者都把「工具调用界面」归一化成一个顶层工具：

| | DSH Code Mode | Dash RLM |
|---|---|---|
| 顶层工具名 | `run_code`（`RUN_CODE_NAME`） | `ipython` |
| 必填参数 | `code` + `description` 两个 | `cell` + `description` 两个 |
| 代码块语义 | 「async 函数的 body」，顶层 `await`/`return` 可用 | 一个 IPython cell，顶层 `await`/`return` 可用 |
| 输出契约 | 只 `print`/`return` 的才进模型上下文 | 只 `print`/`return` 的才回来 |
| 模式开关 | `tools: { mode: 'native'|'code'|'both' }` | `agent-preset: rlm-mode` |

在 `mode: 'code'` 下，wire 上只挂 `run_code` 一个工具 + 一段生成的 SDK `.d.ts`。这与 dashr 的「只有 `ipython` 可直连」是同一形态。

---

## 4. 执行基底对比（最根本差异）

| 维度 | DSH Code Mode | Dash RLM |
|---|---|---|
| 执行载体 | 每次 run 起一个**全新** `worker_threads.Worker` | **持久化** IPython/Jupyter kernel 进程 |
| 状态 | **无状态**（每次 fresh，进程世界随 worker 销毁） | **有状态**（变量/import 跨 cell 存活，实测确认） |
| 语言 | TypeScript（唯一 shipped 后端） | Python（真实 IPython） |
| 隔离 | worker 线程：空 env、heap 上限、可硬终止 | 真实 kernel 进程（无 worker 级 containment） |

DSH 把 TS 程序 host-side 做 `stripTypeScriptTypes`（去类型），再包成 `AsyncFunction` 在 worker 里执行；绑定经 message port 桥接。**每次都是纯函数调用，无跨 run 状态。**

Dash RLM 则是在一个长期存活的内核里逐 cell `exec`，变量天然累积——这就是我在本会话里直接验证过的「上一轮变量下一轮还在」。

---

## 5. 语言对比

| | DSH | Dash RLM |
|---|---|---|
| 实际可运行语言 | **TypeScript**（`language = 'typescript'`，`isolation = 'worker-thread'`） | **Python**（IPython） |
| Python 支持 | **仅呈现层**：`py-types.ts` + `renderToolsSdkPy` + `PYTHON_FLAVOR` 都在，但**没有 published Python 后端**——设计文档原话：「The Python branch of both tables is unreachable in the shipped tree」 | 原生 Python，真跑 |

即：DSH 把 Python 的「schema/SDK/描述」都准备好了，但还没有能执行 Python 的后端；dashr 则是反过来的——直接实现了 Python 执行（IPython），走的是 DSH 预留的「future Python backend」那条路。

---

## 6. 工具绑定形式对比

| | DSH | Dash RLM |
|---|---|---|
| 调用形式 | `await tools.name(args)`（命名空间对象 `tools`） | `await name(args)`（扁平顶层函数） |
| 错误类 | `ToolCallError`，带 `toolName` | `ToolCallError`，带 `toolName` |
| 参数契约 | 单个 args 对象，必须 lossless JSON | 单个位置 args 对象，拒绝 kwargs |
| 命名防护 | null-prototype + `defineProperty` 防 `__proto__`/`constructor` 撞名 | 扁平 `user_ns[global_name]` 绑定 |

`ToolCallError` + `toolName` 这个契约是 dashr 从上游「搬」过来的（上游 `code-mode.ts` 里 `errorClass: { name: 'ToolCallError', memberNameProperty: 'toolName' }` 与 dashr bootstrap 完全一致）。差异在命名空间：DSH 用 `tools.` 前缀统一收敛，dashr 用扁平全局名（这是我在实测里注意到的「工具目录像原生函数」摩擦的根源之一）。

---

## 7. 并发模型对比

- **DSH**：每个 run 一个调度队列，严格按提交顺序启动，逐调用走 `registry.executionMode`（`isConcurrencySafe`）分类 parallel/exclusive；连续的 parallel 调用最多重叠 `maxParallelSubCalls`（默认 10，1 即串行）；exclusive 调用排空池后单独跑。承诺「只读调用可用 `Promise.all`/`asyncio.gather` 重叠，写调用按提交顺序单独跑」。
- **Dash RLM**：cell 内用 `asyncio.gather` 扇出，同样有重叠上限；底层同样走「并发安全分类 + 顺序提交」的契约。

二者并发语义高度同构——dashr 的「submission-order + overlap cap」直接继承自上游这套设计。

---

## 8. 隔离与沙箱逃逸（安全性）

**上游自己就把话说透了。** `code-runtime-worker-thread` README 第一段：

> **Containment, not a security boundary**: trust posture is bash-equivalent by design ... model code can reach Node APIs and has authority comparable to the bash tool.

设计文档 §Trust posture（第 84 行）：

> The worker runtime provides containment, not a security boundary ... `worker.terminate()` stops the thread but not OS processes it spawned. Code Mode uses the same `tools/pre-execute` policy gate as bash ...

**结论**：DSH Code Mode 的 worker 只是「资源隔离」（isolate、空 env、heap 上限、硬终止），**不是安全边界**；信任姿态等价于 bash（bash 本就能执行任意 shell 命令）。所以：

- **Code Mode 逃逸**：模型代码能直接 reach Node API，等价于 bash。
- **RLM/ipython 逃逸**：kernel 进程原生 `open()` 可写任意路径（本会话已实测复现）。
- **普通 native 模式逃逸**：bash + write 组合先写脚本再执行，同样图灵完备。

三者本质等价——都是「图灵完备的代码执行能力」，差别只在**实现步骤的快慢/直接间接**，不在是否可能。这与你（用户）的判断完全一致。

---

## 9. 关键分歧：DSH 明确拒绝了「持久化 kernel」

设计文档「Alternatives considered」第 119 行，一字不差：

> **A REPL-style persistent kernel** (state survives across `run_code` calls). **Rejected for the MVP**: cross-call state would be invisible to the session log, breaking the **reconstructability guarantee that every request is a pure function of the log**; fresh-per-run keeps it. A kernel-style backend remains expressible behind the seam later, with its own logging story.

**这正是 dashr 现在的做法。** 上游为了「每个请求是日志的纯函数、会话可完整重建」这个保证，主动放弃了持久化 kernel；dashr 反其道而行，选了持久化 IPython kernel，因此：

- **得到**：对偏好编程/强化编程训练的模型更直接、状态可累积（不需要每次重新声明变量/import）、真正的交互式内核体验。
- **失去**：跨 cell 状态对 session log 不可见 → 破坏了「纯函数 of log」的可重建性；任何一次会话回放都无法仅凭日志重建出与当时一致的 kernel 内存态。

这不是对错问题，而是 **capability（能力）与 reproducibility/security（可重建性/安全）的取舍**——dashr 站在了「能力/直接性」这一侧，上游站在了「可重建/可审计」这一侧。

---

## 10. 对 dashr 的启示（可选下一步）

1. **接口命名**：上游用 `tools.name()` 命名空间，dashr 用扁平 `name()`。命名空间能显著缓解「工具目录像原生函数、被模型直接调用」的心智摩擦（本会话实测两次直接调 `grep`/`read` 被拒）。
2. **无状态 vs 有状态**：dashr 的持久化 kernel 需要补「状态可见化」——至少把关键状态（如写入过的变量、已安装的包）显式记录进 log，否则回放/审计会失真。上游的 fresh-per-run 是零成本的这一面。
3. **沙箱叙事**：上游已经把「containment ≠ security boundary」写进 README 和设计文档；dashr 的文档可以对齐这个表述，把「kernel 原生 I/O 可写工作区外」从「隐患」重新定性为「bash 等价信任姿态」。
