# 发布包瘦身：摘掉与 DSH/本插件无关的 docs（docs-packaging-trim）

状态：**设计已定（user 裁决 2026-10-03：档位 F）；待落实现**
｜ 规格路径：`docs/specs/docs-packaging-trim/spec.md`（仓库根 docs；`better-dsh/docs/` 是 `prebuild` 由 `../docs` 重建的产物，别写那里）

---

## 0. 动机（审计实证）

`better-dsh` 的 tarball 是 **20.2 MB**，而 `lib/`（真正的代码）只有 **2.5 MB**。差额几乎全在**随包发布的 docs 副本**上：`tar czf docs` = **20.3 MB**（含 tar 开销），即 tarball 基本等于 docs。

`scripts/copy-docs.mjs` 把仓库 `docs/` 拷进 `better-dsh/docs/`（`files: ["docs"]` 发布），已有 EXCLUDE 规则只挡了 `60_exploration-and-research/`、`superd/`、`dsh-sys-prompt_*.md`、`*_artifacts/`。逐目录盘点后，剩下的发布面里混着**与 DSH 和本插件都无关的东西**。

### 0.1 关键澄清：`80_upstream-docs-and-skills/` 不是"纯文档"

user 提问："`api-skills.json` 不是给人读的，那它存在的唯一意义就是作为技能放在 skills 目录让 harness 读取，对吧？既然是纯文档就不需要它？"

**比这更弱**——该目录自己的 `src-README.md` 写明：

> This stage only does the **fetching**; distillation into a skill is a separate follow-up

即 `hermes-dev-skill/` 是"抓取 → 蒸馏成技能"两阶段流水线的**第一阶段**，而**第二阶段从未执行**：整个目录没有 `SKILL.md`、没有 `skill/`。所以这 77 MB 是**没有被任何东西消费的流水线输入**——既不是技能，也不是文档。`api-skills.json` 是 `https://hermes-agent.nousresearch.com/docs/api/skills.json`（59 MB），**Hermes 自己那套技能的机器可读目录**，`grep` 全仓无引用。

### 0.2 归属：这是别人的框架说明书

`hermes-dev-skill` 是 **NousResearch/hermes-agent** 官方文档的完整镜像（`src-README.md` 记着 sparse clone commit `4e9d3c71…` 与抓取日期 2026-09-16），它自己声明的用途是：

> so agents that develop / integrate with **Hermes Agent** can work without hitting the live site

——一个**别的 agent 框架**的说明书。Hermes 有自己的文档站与仓库（该 README 自己就引了）。入库溯源：commit `d13c4a3`，提交信息为 *"rig(test123): remove profiles/node_modules symlink farm"*——一个与文档无关的 rig 提交把它捎带进来。

### 0.3 全树盘点（`copy-docs.mjs` 实际发布范围）

| 路径 | 磁盘 | 是什么 | 判定 |
|---|---|---|---|
| `00_adr/` `10_plans/` `20_specs/` `specs/` | 980 K | 本仓 ADR / 计划 / 规格 | ✅ 留 |
| `50_test-reports/` | 3.5 M | 本仓实测报告（已做 token 脱敏） | ✅ 留 |
| `superpowers/` | 40 K | 本仓两份 spec/plan | ✅ 留 |
| `80_.../hermes-dev-skill/` | **77 M** | 别家框架文档镜像；抓取阶段，无 `SKILL.md`，零引用 | ❌ **摘** |
| `80_.../dsh-dev-skill/pi-and-omp/` | **2.8 M** | OMP / Pi 第三方资料；**技能正文零引用**（`grep -rn "pi-and-omp" skill/` 为空） | ❌ **摘** |
| `80_.../dsh-dev-skill/src-scripts/` | **3.4 M** | 抓取工具 + `docs-tree.json`（3.5 M 构建清单） | ❌ **摘** |
| `80_.../dsh-dev-skill/skill/` | 304 K | DSH 开发知识库蒸馏稿（`SKILL.md` + 22 章）——**静态文档**，与技能运行时无关 | ✅ 留（DSH 相关） |
| `80_.../dsh-dev-skill/src/` | 4.0 M | DSH 官方文档快照——**被 `SKILL.md` 与 4 个章节明确引用** | ✅ 留 |
| `dsh-docs/`（包根） | 4.1 M | DSH 官方文档（较新），`dsh://docs` 主面 | ✅ 留 |
| `60_exploration-and-research/` `superd/` | — | 已在既有 EXCLUDE 内 | — |

> **不要整段摘 `80_upstream-docs-and-skills/`**：`dsh-dev-skill/` 的内容是**蒸馏过的官方 DSH 文档**，按本 change 的留置规则属「与 DSH 相关」的静态文档。**与技能运行时无关**：Harness 技能发现只扫四个根（`<project>/.dsh/skills`、`<project>/.agents/skills`、`~/.dsh/skills`、`~/.agents/skills`，见 `packages/skill/skill-filesystem/src`），插件 docs 树从来不在其中。`dsh://docs` 是纯静态资源——装了插件任何人都能读，里面的目录叫不叫 skill，与 Harness 加载什么技能毫无关系。早期版本的本节曾称它是「运行时真正加载的技能、整段摘会打断一个技能」，**那是错误推断**（把「文件存在」当成了「被运行时加载」），已撤回。

> **重复发布（本 change 不处理）**：`dsh-docs/`（249 文件）与 `…/dsh-dev-skill/src/docs/`（241 文件）是同一套官方 DSH 文档的**两个修订版**（后者较旧）。摘后者需同时改写 `SKILL.md` 与 4 个章节里 `../src/docs/` 的指向——那是**文档内部交叉引用**问题（静态库里出现悬空指针），不是技能问题，另开 change 评估。

---

## 1. 目标态（硬契约）

1. **发布副本里不再出现**：`hermes-dev-skill/`、`dsh-dev-skill/pi-and-omp/`、`dsh-dev-skill/src-scripts/`。
2. **repo 的 `docs/` 一字不动**：`copy-docs.mjs` 只改写发布副本 `better-dsh/docs/`。本仓测试报告、技能源、任何交叉引用与本地技能（如引用 `site-pages-map.txt` 的 `.agents/skills/cordis-dsh-dev`）全不受影响。
3. **承重面完好**：`dsh-dev-skill/skill/`（含 `SKILL.md`）与其引用的 `src/docs/`、`src/site-pages-map.txt` 必须**全部保留**。
4. **无新的悬空引用**：发布副本内不得有指向被摘路径的活引用（见 §3 的已知例外）。
5. **不改语言/行为面**：本 change 纯打包面，不触碰任何源码或技能正文。

---

## 2. 改动

`scripts/copy-docs.mjs` 的 `EXCLUDE` 数组增加 3 条目录规则（沿用既有的"按源路径正则匹配"形式）：

```js
/(^|\/)hermes-dev-skill($|\/)/,
/(^|\/)dsh-dev-skill\/pi-and-omp($|\/)/,
/(^|\/)dsh-dev-skill\/src-scripts($|\/)/,
```

不删除任何仓库文件，只改变**进包集合**。

---

## 3. 已知例外（明示接受，不做过度工程）

`docs/80_upstream-docs-and-skills/dsh-dev-skill/src-README.md` 在正文里提到 `src-scripts/`（抓取清单的结构说明）。摘掉该目录后，**发布副本**里这份 fetch manifest 会描述一个不在包内的目录。

- 影响面：仅"文档自述"的措辞不一致，无功能影响；该 manifest 的价值在于说明 `src/` 是什么。
- 处置：**接受**。不改写正文（改写会让发布副本与 repo 副本分叉，违背 §1.2）。若日后要更干净，用发布期的占位替换，另开 change。

---

## 4. 验收

1. **量化**：`npm pack` 出的 tarball 从 **20.2 MB → ≈ 3.7 MB**（docs 贡献 20.3 → 3.7 MB）；安装后磁盘 sizeof(`docs/`) 从 **98 MB → ≈ 15 MB**。
2. **承重存活**：解包 tarball，`docs/80_upstream-docs-and-skills/dsh-dev-skill/skill/SKILL.md` 与 `src/docs/`、`src/site-pages-map.txt` 均在位；被摘三目录不存在。
3. **静态文档可读**：rig 上 `read dsh://docs/80_upstream-docs-and-skills/dsh-dev-skill/skill/SKILL.md` 能取回正文——它只是众多静态文档之一。~~会话技能目录仍列出 `dsh-dev-skill`、`skill://dsh-dev-skill` 可读~~ 该判据建立在错误模型上，撤回：技能是否被 Harness 加载取决于 user 本地 / per-workspace 安装，与本插件无关。
4. **零新增悬空引用**：在解包后的 `docs/` 内 `grep -rn "hermes-dev-skill\|pi-and-omp\|src-scripts"` 只剩 §3 那一处已知例外。
5. **`dsh://docs` 可读性不变**：`read dsh://docs` 列表与抽查若干路径仍正常。
6. 实测报告落 `docs/50_test-reports/`；发布仍需 user 明确放行。

---

## 5. 风险

| 风险 | 说明 | 处置 |
|---|---|---|
| 误摘承重目录 | `80_upstream-docs-and-skills/` 名字像"纯上游资料"，实则含承重技能 | §1.3 硬契约 + 验收第 2/3 条把关 |
| 规则误伤同名目录 | EXCLUDE 是正则，若将来别处出现同名目录会被一并摘 | 规则带路径前缀锚定（`dsh-dev-skill/…`），不做裸名匹配 |
| 与 ast-engine-deomp 同批发布 | 两者都改打包面，回归时互相遮蔽 | 验收分开做：先各自量化，再合并实测一次 |

---

## 6. 进展日志

- **2026-10-03 设计轮**：user 发现 Hermes 材料混入并质疑归属，要求"只要跟 DSH 不相关、跟我们这个插件不相关的，全部摘掉"。完成全树审计（见 §0.3），确认：`hermes-dev-skill` 是别家框架的**未消费抓取产物**（无 `SKILL.md`）；`pi-and-omp` 被技能正文零引用；`dsh-dev-skill/skill` + `src/` 承重不可摘。user 裁决**档位 F**（只摘未引用的外来物与构建机械）。实测数字：tarball 20.3 → **3.7 MB**；磁盘 98 → **15 MB**。
- 附带澄清（user 提问驱动）：`api-skills.json` 既非技能亦非文档，是未完成流水线的输入；"包内 gzip"被否决——npm tarball 本就是 gzip，包内再压只影响安装后磁盘，且 `dsh://docs` 读纯文本，需为**零引用**文件新增解压读路径，方向错误。
