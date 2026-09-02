# Dash RLM 插件「IPython kernel 互动界面」实测报告

> 实测日期（UTC）：2026-08-19
> 观测主体：Dash Agent 运行时自身（v0.1.5，`agent-preset/selected = rlm-mode`，模型 deepseek-v4-pro）
> 观测对象：RLM 模式唯一的模型直连界面 —— `ipython` 工具（即持久化 IPython kernel 的互动界面）
> 方式：在真实会话中以 agent 身份直接调用 `ipython`，覆盖「能不能用 / 心理摩擦 / 不一致」三个维度；所有结论均来自真实工具返回与源码证据。
> 与前序报告关系：本报告是《RLM-system-prompt-injection-gap-report.md》（2026-08-18，`dev/kernel-refactoring/`）的实测续篇。彼时接口名为 `run_cell`；v0.1.5 已更名为 `ipython`（`index.ts:211` `IPYTHON_NAME = 'ipython'`，`index.ts:32` 注明 `ipython (not run_code)`）。

---

## 1. 结论速览（TL;DR）

| 维度 | 结论 |
|---|---|
| 能不能用 | ✅ 能用。kernel 存活、工具全链路、并发、错误处理、返回值语义均正常 |
| 心理摩擦 | ⚠️ 存在。最大摩擦是「唯一界面」的心智模型：目录列出 ~40 个工具，但运行时只直接接受 `ipython` 一个函数 |
| 不一致 | ⚠️ 2 处：① 工具函数签名 `(*args, **kwargs)` 与运行时拒绝 kwargs 的行为不符；② 每次工具调用刷 1 条 `DeprecationWarning` 噪声 |
| 缺陷 | 🔴 1 个待修：`ipykernel.comm.Comm` 已弃用，源头 `bootstrap.ts:92/99`，每条工具调用都触发 |

---

## 2. 环境事实（实测基线）

| 项目 | 实测值 |
|---|---|
| 插件版本 | Dash RLM 插件 v0.1.5 |
| Python | 3.11.15 |
| ipykernel | 7.3.0（已弃用 `ipykernel.comm.Comm`） |
| comm 独立包 | 0.2.3（已安装，尚未被采用） |
| 接口工具名 | `ipython`（schema 仅 `cell` + `description` 两个必填参数） |
| 抽样绑定名 | 16 个全部真实存在：`ToolCallError` + `read/write/edit/grep/file_glob/bash/rlm/agent_list/agent_message/todo_write/memory_search/memory_add/web_search/job_output/job_list` |
| 工具函数形态 | `_dashr_make_callable.<locals>._dashr_callable`，`__main__` 模块，`iscoroutinefunction = True`，`inspect.signature = (*args, **kwargs)` |
| `ToolCallError` | `__main__.ToolCallError` 类，带 `toolName` 属性 |
| TypedDict 存根 | `ReadArgs`/`BashArgs`/`EditArgs` 等运行时**不存在**（与文档「存根」声明一致） |

---

## 3. 可用性验证（全部通过）

| 测试项 | 结果 | 说明 |
|---|---|---|
| kernel 存活 | ✅ | `platform.python_version() = 3.11.15` |
| 变量跨 cell 持久化 | ✅ | 上一轮定义的变量下一轮仍在（`_persist_check` 存活） |
| 文件工具链路 | ✅ | `write → read → edit → grep → file_glob` 全通，返回值结构符合文档 |
| 异步并发 | ✅ | `asyncio.gather` 两个独立 `read` 正确返回 |
| 错误处理 | ✅ | `ToolCallError.toolName = "edit"`，报错信息清晰（`old_string was not found`） |
| 返回值语义 | ✅ | 正常 JSON dict 原样返回；非 JSON 返回报 `invalid-output`（有明确报错） |
| 文档一致性 | ✅ | 「TypedDict 存根运行时不存在的存根」属实 |

**结论**：从「模型能否用起来」的角度，这个互动界面功能完整、契约清晰、可用。

---

## 4. 心理摩擦观测

### 4.1 摩擦 1：唯一界面的心智模型（影响最大）

运行时**只直接接受 `ipython` 一个函数**，其余 ~40 个「工具」必须在 cell 内以 `await name(args)` 调用。但 system prompt 的《The available tools》把 read/write/grep/bash 等列成了带完整 schema 的「原生工具」，读起来像可直接调用。

实测：本 agent 在测试中**两次**把 `grep` / `read` 当原生函数直接发起，均被拒：

```
Error: only `ipython` is callable directly — call `grep` from inside an `ipython` cell instead
```

「我有 N 个工具」vs「我有 1 个工具 + N 个 cell 内 callable」的认知税是持续的。虽然 `control-prompt.ts:32` 已写了 `accepts directly is `ipython``，但后续 20KB 的工具目录仍然压倒了这条纠偏。

### 4.2 摩擦 2：每次工具调用的 DeprecationWarning 噪声

每 `await` 一次工具，输出流就多一条：

```
DeprecationWarning: The `ipykernel.comm.Comm` class has been deprecated.
Please use the `comm` module instead... comm = Comm(target_name="dashr.host")
```

这条警告会**混入每一个工具结果**，被模型反复读到，是持续的视觉噪声 + 误导（模型可能误以为自己的调用有问题）。详见 §6。

### 4.3 摩擦 3：非 JSON 返回值会让整个 cell 失败

`return` 一个不可 JSON 序列化的对象（如自定义类实例）会让整个 cell 报错：

```
Error: code run failed (invalid-output): program completion must be lossless JSON
```

不是静默丢弃，而是整体失败。报错信息尚可，但对「随手 return 一个中间对象」的新手是个隐性坑。

---

## 5. 不一致清单

### 5.1 不一致 1：工具函数签名与运行时行为不符

- **现象**：`inspect.signature(read)` / `bash` / `edit` / `rlm` 全部是 `(*args, **kwargs)`，看起来接受任意关键字参数；但实际 `read(file_path="...")` 会被拒绝：

```
ToolCallError: tool bindings take one positional arguments object, not keyword arguments — call e.g. name({"field": 1})
```

- **根因**：Python 侧 `_dashr_callable(*args, **kwargs)`（`bootstrap.ts:191`）不做校验，把 `{'args': [...], 'kwargs': {...}}` 打包发给 host；由 host 侧 `flatToolArgs`（`index.ts:473-482`）负责校验并拒绝 kwargs。于是「可内省的签名」与「运行时行为」脱节——若模型用 introspection 判断可调用形式，会被签名误导。

### 5.2 不一致 2：文档里工具的 `async def name(args: Args) -> Output` 签名 vs 运行时 `(*args, **kwargs)`

system prompt 用 `async def read(args: ReadArgs) -> ReadOutput` 这样的类型化签名描述工具，但运行时真实可内省到的只有 `(*args, **kwargs)`（类型信息完全丢失）。对依赖 `inspect` 或 IDE 式心智的模型，这是一处呈现与现实的落差。

### 5.3（呈现）工具目录 vs 唯一可调事实

已在 §4.1 展开，此处归入不一致范畴：目录的「工具」和运行时的「唯一可调函数」在呈现上是矛盾的。

---

## 6. 缺陷定位（源码证据）

**问题**：每次工具调用都触发 1 条 `DeprecationWarning`。

**机制**（`dashr/src/bootstrap.ts`）：

1. `_dashr_host_request(payload)`（第 91 行起）是每个工具调用的必经之路。
2. 第 92 行 `from ipykernel.comm import Comm` —— 已弃用的导入。
3. 第 99 行 `comm = Comm(target_name=${HOST_COMM_TARGET})` —— **每个 host request 都新建一个 Comm**，实例化 `ipykernel.comm.Comm` 即触发弃用警告。

**实测证据**：用 `warnings.catch_warnings(record=True)` 精确统计，2 次 `read` 调用 → 恰好捕获 2 条警告，每条指向 transpiled cell 第 81 行 `comm = Comm(target_name="dashr.host")`。

**环境佐证**：`ipykernel 7.3.0` 已弃用 `ipykernel.comm.Comm`，官方建议改用独立 `comm` 包（本环境已装 `comm 0.2.3`，但插件尚未采用）。

---

## 7. 修复建议（按优先级）

| 优先级 | 问题 | 建议 |
|---|---|---|
| 🔴 高 | §6 DeprecationWarning 噪声 | `bootstrap.ts:92` 改为 `from comm import create_comm`（comm 0.2.3 已在环境里），并按需复用/缓存 Comm 而非每个 request 新建；消除每条工具调用都刷的噪声 |
| 🟡 中 | §5.1 签名 vs 运行时脱节 | 让 Python 侧签名收敛（如 `def _dashr_callable(args=None, /)` 或 Python 侧先行校验），使 `inspect.signature` 与运行时一致；至少给 `_dashr_callable` 加 `__signature__` |
| 🟡 中 | §4.1 唯一界面心智 | prompt 层面：把「`ipython` 是唯一可直连界面」放到工具目录之前、并给一个完整示例 cell；弱化工具目录的「原生函数」观感（可参考前序报告的缺口 1 建议） |
| 🟢 低 | §4.3 非 JSON 返回值 | 保留报错，但在 prompt 里补一句「返回值必须是 lossless JSON；不确定就 `print` 而不是 `return`」 |

---

## 8. 附：复现方法

1. **唯一界面摩擦**：在会话里对任意工具（如 `grep`）发起原生调用 → 收到 `only ipython is callable directly`。
2. **DeprecationWarning**：`await bash({...})` 或 `await read({...})` 任一工具调用，观察结果文本末尾的 `DeprecationWarning: ipykernel.comm.Comm`。精确计数可用：
   ```python
   import warnings
   with warnings.catch_warnings(record=True) as w:
       warnings.simplefilter("always")
       await read({"file_path": "x", "limit": 1})
   print(len(w))  # 每条工具调用 = 1 条
   ```
3. **签名脱节**：`inspect.signature(read)` → `(*args, **kwargs)`；再 `await read(file_path="x")` → 被拒。
4. **非 JSON 返回值**：`class X: pass; return X()` → `invalid-output`。
