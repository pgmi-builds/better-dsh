# DASHR URL Schema 实现契约 (v0.1.8c)

跨任务共享契约。每个 doer 必读本文件 + `openspec/changes/url-schema/design.md` + `tasks.md`。

## 仓库基线
- **仓库根** `/home/u1/workspaces/dashr/`；**包根（npm/tsc 工作目录）** = `/home/u1/workspaces/dashr/dashr/`。所有源码路径以包根为基准（`src/index.ts`、`cordis.patch.yml`、`tsconfig.json`、`node_modules/@deepseek-ai/dsh-tools/`）。
- build: `npm run build`（tsdown，在包根 `dashr/` 下跑）；typecheck: `npm run typecheck`（tsc --noEmit）；test: `npm run test`（vitest --run）。
- 每个 task 验收至少跑 `npm run typecheck` 通过。**不跑全量 test**（最后 8.1 统一跑）。
- **⚠️ 工作树有未提交的用户改动（compaction 移除、package 升 0.1.9、preset 删除等）。不许 revert / checkout / clean / git reset / 改无关文件。只加新文件 + 定向编辑本任务指定的文件。**

## 架构决策（不许偏离）
1. 新建插件 `dsh-url-schema`，独立模块目录 `dashr/src/url-schema/`，独立挂载（新 cordis.patch.yml 行，或由 dashr-repl `ctx.plugin()` 挂载——由 2.1 定，遵循现有模式）。
2. `dsh-url-schema` 拥有：URL resolver、URL-aware read/write/grep/glob、vendored hashline、5 个 scheme handler、skill 工具 mask。
3. `dashr-repl`（`src/index.ts`）只改两处：(a) ctx:// 内核 query/set 通道；(b) `MASKED_TOOL_NAMES` 加 `'skill'`。
4. read 工具 = 一个实现两条分支：`scheme://` → resolver；普通文件 → vendored hashline。

## 文件布局
```
dashr/src/url-schema/
  index.ts            # 插件入口 name='dsh-url-schema', inject=['tools'], apply(ctx)
  resolver.ts         # UrlResolver
  selector.ts         # URL 解析 + selector
  handlers/{skill,agent,dsh,ctx,xd}.ts
  tools/{read,write,grep,glob}.ts
  vendored/hashline/  # 2.3 拷入
```

## Resolver 契约（2.2 产出，2.4/2.5/3-7 消费）
```ts
// selector.ts
export type Selector =
  | { kind: 'raw' }
  | { kind: 'lines'; ranges: Array<[number, number]> }
  | { kind: 'path'; value: string }
  | { kind: 'query'; q: string }
export interface ParsedUrl { scheme: string; path: string; selector: Selector | null }
export function parseUrl(raw: string): ParsedUrl   // 无 scheme 抛错
export function applySelector(text: string, sel: Selector | null): string

// resolver.ts
export interface ResolverEnv { /* ctx.skills / subagents / settings / 内核通道 等 */ }
export interface SchemeHandler {
  resolve(env: ResolverEnv, path: string): Promise<string>   // 返回全文，selector 由调用方 apply
}
export class UrlResolver {
  register(scheme: string, handler: SchemeHandler): void
  resolve(env: ResolverEnv, url: string): Promise<string>    // parseUrl → dispatch → applySelector
}
```

## 工具注册模式
- `defineTool({ name, description, parameters, output, execute })` 来自 `@deepseek-ai/dsh-tools`。
- 注册：`ctx.tools.register(toolDef)`（参考 `src/index.ts:994`）。
- read 工具注册名 `'read'`（shadow 上游 native read + 被移除的 BetterEdit read）。
- 参考 BetterEdit：`~/.dsh/profiles/web/node_modules/dsh-better-edit/lib/tool-read.js`。

## 5 个 scheme（详见 design.md D3）
- `skill://<name>[/<path>]` → `ctx.skills`（filesystem provider）
- `agent://` 四形态：裸=roster、`<id>`=output、`<id>/transcript`、`<id>/<child>`
- `dsh://docs[/<doc>]` + `dsh://config`（config 挡 secret）
- `ctx://<var>`（裸=列命名空间；依赖 6.1 内核通道）
- `xd://` 空占位（裸=no devices；`<device>`=unknown；write=报错）

## vendored hashline（2.3）
- 源：`~/.dsh/profiles/web/node_modules/dsh-better-edit/lib/`（编译 JS + .d.ts，无 TS 源码）。
- 选项 A：直拷编译 JS + .d.ts；选项 B：从 GitHub `Rianico/dsh-better-edit` 取 TS 源码。
- 运行时依赖 3 个 npm 包需自带：`diff`、`file-type`、`xxhash-wasm`。
- 署名：LICENSE/README 加 4 层版权（见 design.md D2）。

## 验收原则
- doer 产出后由 verifier 检查：契约一致性、`npm run typecheck` 通过、行为符合 task 验收条件。
- 最终验收由主 agent 按 task 分组进行（Task 2 = 2.1-2.5 总体验收）。
