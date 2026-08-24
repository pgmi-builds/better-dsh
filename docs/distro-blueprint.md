# DASHR Distro Blueprint — 完整体规划

Status: planning (2026-08-24)
前置: [`repositioning-and-rebranding.md`](repositioning-and-rebranding.md)
证据基础: omp-research.md · dsh-ptc-tools-research.md(含 §8 二轮实证)

---

## 1. 模式调整(对官方 bundle 的替换/删除)

| 官方模式 | DASHR 处置 | 理由 |
|---|---|---|
| PTC(`code` preset,编码模式) | **删除**,不设任何继任的单入口编码模式 | 单写者 = 单点故障 + 最大化转义摩擦(调研 §6/§8.5,见 §4) |
| RLM 模式(自研,现 dsh-rlm-mode) | **演化为 Code 模式(编程模式)**,即 RLM 模式就是编程模式 | 持久 kernel 是既有资产;改造点见 §2.2 |
| — | **新增 Work 模式(工作模式)** | Office 文档编辑、邮件、研究等办公场景 |

## 2. 从 OMP 借鉴的核心内容(从大到小)

### 2.1 URL Schema(基础设施层)

- 采纳 OMP 的"工具 × 资源"二维划分:呈现给运行时大模型的可寻址对象分为
  **工具(tools)** 与**资源(resources:文档、各类 facility 等)**两个维度。
  这是 OMP 上游 Agent 运行时最独特、最具创新性的一点。
- 以 `agent://` 这类 **资源寻址 Schema** 为代表:Agent 运行时把内部对象
  (子 agent 输出、技能、规则、PR/diff 等)暴露为可读可 grep 的 URL。
- OMP 上游共 **12 个 schema**;DASHR 后续做裁剪(初期 3–4 个 + read 万能
  工具即已构成主要杠杆)。
- URL Schema 面向**所有模式**开放(Code / Work),作为底层基础设施,
  不属于任何单一模式。

### 2.2 Code 模式 = RLM 模式演化 + 工具双面暴露(基于 OMP 模式设计)

- **原则:REPL 永远不是单一入口。** DASHR 方案中不存在任何"一切必须
  经 REPL"的编码模式;工具双面暴露(dual exposure)是硬性设计约束:
  - **直连面**:原生工具(read/write/edit 等)保留为普通工具直接调用;
  - **REPL 转接面**:持久 Python kernel(Scratchpad)内,工具映射为
    REPL 对象,挂在 `tool.*` 命名空间下。
- 落地开关:双层在 dsh 侧是现成配置 — `tool-presentation` 的
  `mode: "both"` 即"原生目录与 SDK 并存"。改造 = rlm-mode preset
  从现单层(catalog masked)切到 `both`,kernel 由唯一入口变为转接面。
- **正交二维组合性**:工具维度 × URL 资源维度,再放进 REPL 自由写脚本 —
  `tool.read('agent://child/output')` 这类组合全部可达,可组合性与能力
  显著强于单写者 PTC。
- 双面暴露的第二结构性理由(调研 §8.5):避免语法嵌套的实时转义摩擦 —
  payload 形调用(长文本/多引号)走直连,logic 形调用(循环/条件/组合)
  走 REPL。

## 3. Distro bundle 组成(自研 + 社区插件)

1. **HashEdit 的 PluginMarket 插件**(它本身也是一个插件)— 保证 DASHR
   完整版用户仍可无缝使用官方/社区插件市场(rebranding 文档 §3 的承诺)。
2. **Better Sidebar** — 社区侧栏插件,补全 Web UI 体验。
3. **GUI App 社区插件**。
4. **Messaging Channel 插件**(自研)— Agent 的消息面接入:
   **Telegram / Slack / 飞书(Feishu/Lark)/ 微信(WeChat)** 四通道,
   即此四个,不加。

自研插件(Code 模式 / Work 模式 / Messaging Channel)+ 上述社区插件
bundle 进去,即构成完整体(complete App)→ distro 成立。

## 4. 风险与边界(继承自调研的实测结论)

- **REPL 无沙箱是结构事实**:dsh 沙箱(bwrap+Landlock)只包工具执行路径;
  持久 kernel / REPL 底座即宿主进程,代码面图灵完备与受限不可兼得。
  Work 模式(邮件、文档编辑)尤其要按"模型即宿主用户"威胁模型评估,
  必要时把 code runtime 改为 bwrap 包裹的子进程。
- **双层消除单点故障**:PTC 单写者下 run_code 编译挂 → 全工具下线
  (已两次复现);both 模式下单工具坏只坏一个。
- **URL Schema 移植成本**:要求每个 FS 形工具都懂 URL 解析(OMP 里
  read/grep 透明解析 12 scheme),比 LSP 更"架构级",需在 dsh 插件层
  设计统一的 resolver 注入点。
- 兼容性矩阵与打包形态的风险清单见 rebranding 文档 §5,不重复。

## 5. 建设顺序(叠加在 rebranding 文档 §7 之上)

1. rlm-mode preset 切 `mode: both`,kernel 从唯一入口变为转接面,即得
   Code 模式(编程模式) — 立即可做。
2. URL Schema 最小集(3–4 个 scheme)+ read 万能工具 resolver。
3. Work 模式(办公场景插件组合)。
4. 社区插件 bundle(PluginMarket / Better Sidebar / GUI App)+ 兼容矩阵。
5. 打包为 dir+launcher App(rebranding 文档 §7 第 3 步)。
