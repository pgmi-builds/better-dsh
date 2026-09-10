# upstream dsh 0.1.5-rc.2 本地对齐实测报告（Dev/Test 1 · 4988 实例）

> 日期：2026-09-11（HKT）
> 执行：对齐轮 S1–S7（runbook：`docs/60_exploration-and-research/05-dashr-dev/upstream-alignment.md`）
> 目标 tag：`dsh-v0.1.5-rc.2`（npm dist-tag `next`，最高版本；`latest` 停在 rc.1）
> 前置版本对账报告：`docs/upstream-dsh-0.1.5-rc.2-report.md`（846 commits / 3170 files / ~104k 行）

---

## 一、实测范围与结果表

| # | 步骤 | 结果 |
|---|---|---|
| S1 | patch 载体 tag 间 diff + dashr 56 个 `@deepseek-ai/*` 引用名对新 tag 包集全数命中 | ✅ |
| S2 | checkout `dsh-v0.1.5-rc.2` + 三 patch 手工重放（pnpm-workspace.yaml 冲突按新 allowBuilds 手解） | ✅ |
| S3 | rsync 副本 + stale peerDep 复查（absent）+ **新增 devDeps 手术**（见瑕疵 F2） | ✅ |
| S4 | `pnpm install`（36s，供应链策略 1543 entries 过）+ `pnpm run build`（234 client artifacts）+ 副本 tsdown/client 半 | ✅ |
| S5 | 插件契约对齐：**4 处真实语义漂移移植**（见 §三） | ✅ |
| S6 | `tsc --noEmit` **0 errors**；`vitest --run` **493/493**（37 files，128s） | ✅ |
| S7 | 4998 实例 systemd-run 冒烟 **8/8 探针全绿**（见 §四） | ✅ |

红线遵守：未 npm publish、未动 prod 3080、未动 Caddyfile。

## 二、环境事实

- monorepo：`upstream/deepseek-harness` @ `dsh-v0.1.5-rc.2`（detached），本地 patch 三件套在场（unrun devDep / storeDir+verifyDepsBeforeRun+zeromq / tsdown resolveRepositoryRoot）。
- allowBuilds 冲突解：采纳上游新集（**fs-ext 移除**——flock 改走 node-addon-system 预编译；新增 `electron-winstaller: false`、`msgpackr-extract: false`），保留本地 `zeromq: true` 与两条 `dsh-subprocess-local`。
- 副本 `packages/better-dsh/better-dsh/` = canonical 0.2.3-b + devDeps 手术（14 个 `workspace:*`）。
- 实例：unit `dsh-4988-test`，`DSH_HOME=~/.dsh-test`，`DSH_TRUSTED_HOSTS=test.pc.randomhash.app pc.randomhash.app 192.168.31.130`，`UnsetEnvironment=DISPLAY WAYLAND_DISPLAY`，**端口 4988**（4997–4999 被 superd PoC 占用，见瑕疵 F4）。
- 残留实验文件未动：`packages/boot/app-boot/bun-registry/`、`bun-internal-bridge.ts`（2026-09-06 bun compile 实验，构建容忍，untracked 不碍 checkout）。

## 三、契约漂移与移植（本轮核心工作）

对 0.1.5-rc.2 的 **4 处真实漂移**全部移植，canonical 已同步（src/test 与副本 diff = 空）：

1. **会话事件改名**（Session V3「PTC durable vocabulary」）：`tool/code-dispatch(-start)` → `tool/ptc-dispatch(-start)`。`src/index.ts` 2 处 append + 3 处注释；测试 3 文件的字符串断言同步。
2. **subagents 统一消息缝**：`followup`/`reportFrom` 两方法合并为 `sendMessage(sender, targetId, content, {signal})`（上行 = targetId 命中 sender 的 `parentSession` 自动走 send-to-parent；`source`/`delivery` 选项 knobs 已删，runtime 自盖章）。移植面：`src/subagents-surface.ts` 接口重述、`src/bridges/index.ts` 两调用点（parent 方向新增 root-agent 本地护栏，语义等价旧 UNAUTHORIZED）、`delegation.spec`/`bridges.spec`/`helpers.ts` 全部 fake 与断言。
3. **持久化读路径**：`SessionPersistence.inspect` 消失（接口只剩 create/open/flush/stat/list）；读 = `open(id,'read')` → `handle.read(offset?,length?,opts)` + `close()`，元数据 = `stat(id).header.createdAt`。移植面：`src/url-schema/handlers/agent.ts` 的 surface 接口重述 + 3 调用点收敛为 `persistedEventsOf` helper。
4. **SessionSeq 品牌化**：裸 `number` 不再可赋值，需 `SessionSeq(n)` 构造（`dsh-session` 导出）；`assistant/message` 事件 data 新增必填 `stream: AssistantStreamRecord[]`（V3 in-history stream 内嵌）——测试 fixture 两处补 `stream: []`。

另有两处**行形状查表结论**（runbook S7.5/S7.8，全绿）：
- `connection` 行（web-app cordis.patch.yml）tag 间**逐字节同形**（仅注释位移）——fence 腿整行重述继续有效；
- `__DSH_TRANSPORT__`/ownsHost 消费点、`data-sidebar-collapsed`（AppFrame.tsx:210 仍在）、`conversation.session.header` 与 `settings.general.item` slot、`apps/web/index.html` viewport meta、`webserver injections.ts` head splice——**全部原样存活**。

## 四、S7 冒烟明细（unit dsh-4988-test）

| 探针 | 结果 |
|---|---|
| `web --dump-config` → dashr-repl 行 + `DASHR_KERNEL_PYTHON` 注入 | ✅ |
| fence：trusted Host `/api` = **401**（过栅栏卡认证）；evil Host = **403** | ✅ |
| token 鉴权根页 200 + `__DSH_TRANSPORT__` boot script 在页 | ✅ |
| boot graph `"id":"better-dsh"` + `/plugins/??better-dsh/client.js&rev=…` | ✅ |
| client bundle：200，**17824B 与本地逐字节一致**（+84B = 服务端 sourceMappingURL 追加，符合已知行为） | ✅ |
| mobile 锚点：layout 模块含 `data-sidebar-collapsed` + `SIDEBAR_AUTO_COLLAPSE = 1024` | ✅ |
| hashline 中央库 `$DSH_HOME/storages/dsh-better-edit/hash-store.sqlite` 在位 | ✅ |
| 0.1.5 新组合在场：ui-sidebar-right/documentpreview/files、client-resources、api-workspace-files、ui-deliverables 均入 module batch | ✅ |

实例**保持运行**供 user 验收：`http://127.0.0.1:4988/?token=k1oafyb5HXnvAleXNQrfrBjuN2U2xrozzARLxrkO2Kw`（token 每次重启轮换）。

## 五、发现的瑕疵（定性 + 去向）

- **F1（流程/runbook 漂移）**：`packages/node_modules` 在新 tag 安装布局下不再生成 → runbook 的 `../../node_modules/.bin/tsx`（build-client）失效，正确为 `../../../node_modules/.bin/tsx`。→ 已回写 AGENTS.md §二。
- **F2（工具链坑，重要）**：canonical 的 npm-range optional peerDeps（`>=0.1.2-alpha.1 <0.2.0-0`）在 pnpm 11 严格预发布 semver 下**不匹配 workspace `0.1.5-rc.2`**（元组规则），autoInstallPeers 落到 registry **0.1.2-rc.1**（唯一满足该 range 的 registry 版本）→ 副本 node_modules 双身份，tsc 品牌类型互斥报错。**解法（S3 新增手术）**：副本 package.json devDependencies 注入 14 个 `workspace:*`（dashr 实际 import 的 dsh-* 名单），每次 rsync 后重打。→ 已回写 AGENTS.md §二；canonical 不动（npm 发布语义保持）。
- **F3（上游观察，非阻塞）**：rc.2 的 `test`/`build:bench` scripts 前置 `build:native-system`；主 `build` 已含（scripts/build.ts:44），无额外步骤。`native/system/packages/linux-x64/bin/glibc/system.node` 已产出。
- **F4（环境冲突）**：4997（127.0.0.1）、4998、4999（0.0.0.0）被 superd multi-context PoC 占用（`~/workspaces/superd/.scratch/multi-context-poc/poc4-v3-e2e.mjs`，pid 2233871 + 1393092，Sep 10 19:41 起，独立 DSH_HOME）——不可杀（user 的在跑实验），本轮实例改 **4988**。**注意：若 Caddy test.pc.randomhash.app 后端指 4999，域名叫到的将是 superd 实例**——user 域名验收前需先对齐端口或等 PoC 结束（Caddyfile 红线未动）。
- **F5（上游观察）**：`pnpm peers check` 有 WARN（副本 npm-range peers vs workspace 版本）——F2 的同一根源，运行期无影响（profile symlink 直连 monorepo）。

## 六、流程化产出

- 本报告 + AGENTS.md §二 write-back（tag 对齐记录、tsx 路径、devDeps 手术、端口事实）。
- `.scratch/dsh-v0.1.3-alpha.2-local-patches-backup.patch`（旧 patch 备份，切换前快照）。

## 七、Open items

1. **user 验收**（第一人称）：127.0.0.1:4988 实例（域名词见 F4 注意）；重点 = dashr-repl 真跑一轮（kernel 三级供给在新 runtime 下）、better-edit 读改写、mobile 手势/zoomGuard 真机。
2. canonical 改动（4 文件 src + 6 文件 test）**未 commit**——等 user 指令（上轮有 commit 前 "Wait" 先例）。
3. Caddy test.pc → 4999 端口归属与 superd PoC 的冲突排查（user 裁决）。
4. 既有遗留：v0.2.5 zoomGuard standalone 双形态 CDP 复验（AGENTS.md 已记）。
5. prod（3080）**维持 0.1.3-alpha.2 不动**；升 0.1.5 需另行裁决（对账报告 §六建议先行）。
