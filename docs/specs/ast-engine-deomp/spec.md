# AST 去 OMP 化：内置 WASM 引擎（ast-engine-deomp）

状态：**设计已定（user 裁决 2026-10-03：路线 A + 14 语法全部随包）；spike 已证；待落实现**
｜ 规格路径：`docs/specs/ast-engine-deomp/spec.md`（仓库根 docs；`better-dsh/docs/` 是 `prebuild` 由 `../docs` 重建的产物，别写那里）

---

## 0. 动机（实证）

`dvc://ast_grep` / `dvc://ast_edit` 是插件里**最后一个还需要 OMP 二进制的组件**。`zero-npm-runtime-deps`（0.2.5-a/b）已把 `@oh-my-pi/pi-natives-<platform>` 从 `dependencies` 摘掉，改为首次使用 lazy 自装——安装不再背它，但**第一次用 AST 仍要付**：

| 项 | 实测 |
|---|---|
| 自装下载量 | `@oh-my-pi/pi-natives-linux-x64@18.0.6` = **70.8 MB**（registry `content-range: bytes 0-1/70791219`） |
| 自装落盘量 | `dist.unpackedSize` **328 MB**（本机 18.2.11 实测 352 MB：`pi_natives.*-modern.node` 183 MB + `-baseline.node` 183 MB） |
| 前提 | 必须联网 + npm registry 可达（否则 AST 设备整个不可用） |

三点归属澄清（避免误伤）：

1. **better-dsh 声明的 OMP 依赖 = 0 条**（`package.json` 实证）。
2. prod profile 里那 352 MB `@oh-my-pi/*` **不是我们的**——来自 `super-dsh@0.1.9` → `@oh-my-pi/pi-coding-agent@18.2.11`。
3. 这条自装路径是 0.2.5-a 的**有意的临时态**（`zero-npm-runtime-deps` 第 2 节表格最后一行），不是终态。

**为什么可以自己实现**：`@oh-my-pi/pi-natives` 的 ast 面（`crates/pi-ast` 4,448 行 + `crates/pi-natives/src/ast.rs` 1,509 行）分两层——

- **引擎**（唯一真 native）：ast-grep 结构匹配/改写 + ~70 个 tree-sitter 语法。**OMP 自己也是抄的**：`Cargo.toml` 里 `ast-grep-core 0.39` + `tree-sitter 0.25`，全 MIT。上游 ast-grep 官方就发布**纯 WASM 构建**。
- **底盘**（全是胶水，TS 可写）：`.gitignore` 感知遍历（`ignore` crate）、glob 过滤（`globset`）、扩展名→语言推断、`maxFiles`/`maxReplacements`、dryRun、parseError 收集、meta 变量、分页、聚合统计。

**投入上限的负证据**：`docs/60_exploration-and-research/07-omp-usage-telemetry/omp-lsp-ast-device-usage-telemetry.md` —— 3 周、288 个 session、21,666 次 toolCall 的真实 OMP 语料里，`ast_edit` / `lsp` **执行 0 次**（对照 `dsh://browser` 631 次）。所以本 change 的取舍原则是**语义零回归、体积大降、不为性能做过度工程**，而不是把 native 性能复刻出来。

---

## 1. 目标态（硬契约）

   > **2026-10-04 修订（task-12 诊断字段）**：本条的「一字不动」是 **parity swap 期的冻结口径**——它约束的是 native→WASM 替换本身的行为面 A/B。验收后的 0.2.6 起为可诊断性**有意背离**：`ast_grep`/`ast_edit` 结果新增**可选**诊断字段 `patternErrors` / `pathNotFound` / `overlapping`（native 对这三种失败同样静默，见 2026-10-04 实测报告 A1/A3/A6）。这是 spec'd 的契约扩展（ast/dvc spec 新增 Requirement "Diagnostic fields (deliberate divergence from the native predecessor)"），不属于本规格意义上的回归；既有字段名与语义仍一字不动。
1. **模型面契约一字不动**：`ast_grep` 的 `{patterns, path, offset, limit, includeMeta}`、`ast_edit` 的 `{ops:[{pat,out}], paths, dryRun}`，以及结果里 `changes` / `fileChanges` / `totalReplacements` / `filesTouched` / `filesSearched` / `applied` / `limitReached` / `parseErrors` / `matches` / `totalMatches` / `filesWithMatches` 的字段与语义全部保持。
2. **零 OMP 痕迹（代码/产物面）**：源码、产物、`.vendor`、运行时网络请求，以及 tarball 里运行时实际装载的面（`lib/`、`package.json`、`scripts/`）都不再出现 `@oh-my-pi` / `pi_natives`。tarball 内 `docs/` 是刻意的发布载荷，对本次迁移的历史性提及属预期、不计入该判据（2026-10-04 终审定界：代码/产物面实测 0 命中；docs prose 提及数量随发布内容浮动，非回归信号）。
3. **守住 zero-npm-runtime-deps 契约**：`dependencies` / `optionalDependencies` / `postinstall` 维持不存在；引擎与语法是**构建期输入**（devDependencies），产物以**包内资产**形式随 `files` 发布——即该规格认可的"构建期进产物"那条出路，不引入新的运行时自装。
4. **离线自足**：断网、无 npm、无 `.vendor` 的环境下 `ast_grep`/`ast_edit` 必须真实可用。
5. **fail-open 保持**：引擎整体或某一种语法加载失败，只降级该设备/该语言，插件加载与其余组件零影响；对外仍是 `DVC_DEVICE_ERROR`，措辞改为指向内置引擎。

---

## 2. 技术选型（spike 已证）

| 角色 | 选定 | 版本 | 体积 | 许可 |
|---|---|---|---|---|
| 匹配/改写引擎 | `@ast-grep/wasm`（**官方** ast-grep 的 WASM 构建） | 0.45.3 | 1.73 MB | MIT |
| WASM 运行时 | `web-tree-sitter` | 0.26.x | 0.20 MB | MIT |
| 语法（14 个） | `@lumis-sh/wasm-<lang>` | 0.26.x | 12.5 MB | MIT |

**合计 14.4 MB 随包**，对照现状 **70.8 MB 下载 / 328 MB 落盘 / 必须联网**。

语法↔扩展名表（沿用现有 `AST_CODE_EXTENSIONS`，本 change 不缩语言面）：

| 扩展名 | 语法 | 扩展名 | 语法 |
|---|---|---|---|
| `.py` `.pyi` | python | `.c` `.h` | c |
| `.js` `.jsx` `.mjs` `.cjs` | javascript | `.cpp` `.hpp` | cpp |
| `.ts` `.mts` `.cts` | typescript | `.html` | html |
| `.tsx` | tsx | `.css` | css |
| `.rs` | rust | `.json` | json |
| `.go` | go | `.yaml` `.yml` | yaml |
| `.sh` | bash | `.rb` | ruby |

### 2.1 spike 结论（丢弃式探针：`.scratch/ast-wasm-spike/`）

**A/B 一致性**：用 `natives-loader.ts` 同款方式 dlopen 本机真实 `pi_natives.linux-x64.node`，与 WASM 栈跑同一组用例——

| 用例 | OMP native | WASM 栈 | |
|---|---|---|---|
| `c` `foo($A)` | 0 | 0 | ✅ |
| `c` `return foo($A)` | 1 | 1 | ✅ |
| `cpp` `foo($A)` | 1 | 1 | ✅ |
| `css` `color: $V` / `color: red` | 0 / 0 | 0 / 0 | ✅ |
| `html` `<div class=$C>$$$K</div>` | 1 | 1 | ✅ |
| `python` `return $X` | 1 | 1 | ✅ |
| `js` `foo($$$A)` / `rust` `vec![$$$A]` / `yaml` `b: $V` / `go` `foo($A)` | 1 | 1 | ✅ |

**C / CSS 的"匹配不到"是 ast-grep 上游的 pattern 上下文歧义，不是 WASM 退化**——native 给同样的 0。行为面零回归。

**三个已解的坑**（实现时不得重新踩）：

1. **Node 不吃 ESM wasm import**：`@ast-grep/wasm` 的 `wasm.js` 直接 `import "*.wasm"`，Node 22 需 `--experimental-wasm-modules`。正解是**手动装配**：`WebAssembly.instantiate(bytes, { './wasm_bg.js': bg })` → `bg.__wbg_set_wasm(instance.exports)` → `instance.exports.__wbindgen_start()`（wasm-bindgen 标准手法；wasm 的 import module 名实测为 `./wasm_bg.js`，102 个 import）。
2. **`expandoChar` 必须显式给 `'µ'`**：默认值 `$` 只在 JS/TS/bash/cpp 下碰巧可用；python / rust / go 会**静默 0 命中**（实测矩阵：`default:0 / "$":0 / "µ":1`）。`µ` 在全部被测语言下可用。
3. **语法 wasm 必须是新式 `dylink.0`**：最流行的 `tree-sitter-wasms@0.1.13` 是 legacy `dylink`，与 `web-tree-sitter@0.26` 硬不兼容（`getDylinkMetadata` → `need dylink section`）。`@lumis-sh/wasm-*`（`dylink.0` 实测为 1）是正解。

**性能实测（诚实记录，见 §6）**：14 个语言 `registerDynamicLanguage` 冷启 **121 ms**；单文件 17 KB typescript 解析 **26.6 ms**；遍历 `better-dsh/src` 188 文件 / 1.1 MB 源码（解析+匹配）**1,273 ms ≈ 0.9 MB/s**（单线程）。

---

## 3. 模块设计

```
src/devices/ast/
  engine/
    wasm.ts          ← 手动 wasm 装配 + Parser.init + 惰性单例；唯一的 wasm 入口
    grammars.ts      ← 语言注册表：lang → 资产路径 + expandoChar 'µ'；懒注册、按需
    language-map.ts  ← 扩展名 → 语言（**单一真相源**）
    match.ts         ← pattern 编译 + 多根节点记 0 命中 + 命中 → AstFindMatch 映射（字节偏移）
    edit.ts          ← astEdit 核心：rewrites / dryRun / changes[] / 字节偏移换算
  walker.ts          ← .gitignore 感知遍历 + glob + 语言推断 + maxFiles 限额
  ast-device.ts      ← 保持公开契约，改为调 engine + walker（薄适配层）
  ast-reminder.ts    ← 语言集合改为对齐 engine 的语法表（不再"对 shipped 二进制实测"）
  natives-loader.ts  ← **删除**
```

**资产流**：新增 `scripts/copy-ast-assets.mjs`，构建期把 3 件套 wasm 从 `node_modules` 拷进 `lib/ast-assets/`（`files: ["lib", …]` 已覆盖，无需改发布面）。构建链改为：

```
tsdown && npm run build-client && node scripts/copy-kernel-bridge.mjs && node scripts/copy-ast-assets.mjs
```

> ⚠ 必须在 `tsdown` **之后**：tsdown 会清空 `lib/`（同 `lib/client/` 的老坑）。

**依赖面**：`@ast-grep/wasm` / `web-tree-sitter` / `@lumis-sh/wasm-*`（14 个）进 `devDependencies`。`src/vendor.ts` 本身保留（`dvc://browser` 的 puppeteer 仍用它），只删掉 pi-natives 的调用点与 `PI_NATIVES_VERSION`。

**需要主动补齐的行为（照 OMP 语义实现，不是搬运）**：

- **多根节点 pattern = 记 0 命中**：`function $N($$$A) { $$$B }`、`"alpha": $V` 这类片段在 wasm 的 `findAll` 会抛 `Multiple AST nodes are detected`。OMP 的 Rust 库虽有 `compile_wrapped_fallback`（`ops.rs`，仅 JSON 有模板），但实测 shipped native 在这条路径上并未用它：`astGrep` 返回 `matches=0` 且 `parseErrors=null`，`astEdit` 返回 `totalReplacements=0` 且结果里没有 `parseErrors` 键。因此 TS 侧对齐的是 **native 的实测行为**：捕获该异常 → 记 0 命中、不写 `parseErrors`、不抛错。
- **`.gitignore` 感知遍历** + glob 过滤 + `maxFiles` / `maxReplacements`。
- **UTF-8 字节偏移换算**：`range().index` 是**字符**偏移，OMP 的 `byteStart`/`byteEnd`/`deletedLength` 是**字节**偏移（实测含中文时 17 vs 25）。`changes[]` 生成时换算。
- **parseError 收集**、分页（`offset`/`limit`）、`includeMeta` 的 meta 变量收集、聚合统计。

**错误处理**：`wasm.ts` 加载失败 → 设备级 `DVC_DEVICE_ERROR`（措辞：内置引擎不可用，不再叫用户去装 npm 包）；单语言语法加载失败 → 该语言文件跳过并计入 `parseErrors`，其余语言照常。

---

## 4. 随本 change 一并改的文档

行为契约里目前写着 `@oh-my-pi/pi-natives`，必须同步改（否则 spec/impl 脱节）：

- `docs/20_specs/ast/spec.md` + `docs/specs/ast/spec.md`（两文件当前**内容相同**，同步改）：`Lazy natives, zero startup cost` 一条的措辞从"natives 懒加载"改为"内置 WASM 引擎按需加载"。
- `docs/20_specs/dvc/spec.md` + `docs/specs/dvc/spec.md`：`ast devices` 一条删掉 "backed by the published `@oh-my-pi/pi-natives` binding"，改为内置 WASM 引擎。
- `THIRD_PARTY_NOTICES.md`：增列 ast-grep / tree-sitter / `@lumis-sh/wasm-*`（三件套均 MIT）。
- `src/NOTICE-OMP.md`：**保留**（已核：该文件覆盖 browser / lsp / ast 三类共 8 个文件，ast 不是唯一来源）。`browser-device.ts`、`lsp-device.ts`/`lsp-client.ts`/`lsp-jsonrpc.ts`/`lsp-language.ts`/`lsp-types.ts`/`lsp-server-registry.ts` 仍显式引用它。正文无需改（通用措辞，未点名 ast）；仅在实现时确认 ast 的 2 个文件删除后**没有**残留 `../NOTICE-OMP.md` 引用。

---

## 5. 验收（对齐"改动点同类"红线）

1. **A/B 一致性矩阵常驻单测**：同一组 pattern 在 native 与 WASM 下逐条结果相同（§2.1 的表落成 `test/`）。
2. **离线第一人称实测**：断网 + 删掉 `<pkg>/.vendor` 后，4999 rig 上真实 session 走通 `dvc://ast_grep` 与 `dvc://ast_edit`（含 dryRun 与真写盘）。
3. **零 OMP 实证（代码/产物面）**：`npm pack` 出的 tarball 在 `lib/`、`package.json`、`scripts/` 上 `grep -rc "pi_natives\|@oh-my-pi"` = 0（`docs/` 发布载荷的历史性提及不计入）；运行期无 registry 请求。
4. **工具面口径同类**：`tsc --noEmit` 0 错；全量单测绿；boot graph 含 better-dsh；`dvc://` roster 仍列出两个 ast 设备。
5. 实测报告落 `docs/50_test-reports/`；**发布仍需 user 明确放行**（单次授权，见根 AGENTS.md 〇节）。

---

## 6. 已知风险与代价

| 风险 | 说明 | 处置 |
|---|---|---|
| **吞吐下降** | WASM 单线程 ≈ 0.9 MB/s；native 是 Rust 并行遍历。大仓全量 codemod 会明显变慢 | 明示接受（该设备 3 周 0 调用）。若日后成为瓶颈，再评估 worker 分片 |
| **语法 ABI 锁步** | `dylink.0` 要求 `web-tree-sitter` 与语法包**主版本同步**升级 | 两者一起 pin；升级走显式、带 A/B 的变更 |
| **语言面依赖第三方语法包** | `@lumis-sh/wasm-*` 是社区包（MIT，活跃） | 路径与版本在 `grammars.ts` 单点声明；若某语言其停更，可自行 `tree-sitter build --wasm`（本机有 docker）替换单个资产 |
| **`expandoChar` 静默失效** | 漏给 `µ` 会导致某语言**静默 0 命中**（不报错） | 每个语言注册后跑一次自检 pattern；单测锁定全语言矩阵 |
| **per-language pattern 歧义** | C 的 `foo($A)`、CSS 的 `color: $V` 匹配不到 | **与上游 native 行为一致**（已 A/B 证），非本 change 引入，不修 |
| 字节偏移换算错位 | 含多字节字符时 `changes[]` 坐标会偏 | 单测覆盖 CJK 用例 |

---

## 7. 进展日志

- **2026-10-03 设计轮**：user 裁决路线 A（官方 `@ast-grep/wasm` 引擎 + TS 底盘），14 个语法全部随包。丢弃式 spike 落在 `.scratch/ast-wasm-spike/`（`probe.mjs` / `iso.mjs` / `expando.mjs` / `comboA|B|C.mjs` / `probe3.mjs` / `probe4.mjs` / `ab-native.mjs`）：
  - 证伪了 `tree-sitter-wasms@0.1.13`（legacy `dylink`）；
  - 证真了 `@lumis-sh/wasm-*` 0.26.x（`dylink.0`）覆盖全部 14 语言；
  - 定位并解决 `expandoChar` 与手动 wasm 装配两个坑；
  - 与真 native 完成 A/B，行为零回归；
  - 量得 14.4 MB 资产、0.9 MB/s 吞吐、字节偏移差异。
