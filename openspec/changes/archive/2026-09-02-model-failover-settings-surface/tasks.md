## 1. 侦察（区分缺构建 vs 真回归）

- [x] 1.1 prod 实例（3080，0.2.1-d 全量构建）核验：磁盘证据确认部署位已随包 `lib/client/index.js`（GUI 呈现留 user 30 秒核验）；4999 侧由 2.1 补齐
- [x] 1.2 **原生注册链路核实完成（design D4 关闭）**：原生行（locale `LanguageRow`、ui-chat `TranscriptViewRow`）= client bundle 内 `ctx.slots.inject('settings.general.item', register)`，slot 规格 `{kind:'list', scope:'root'}`；GeneralSection 渲染 slot entries、数据走 `remote.settings`——**未发现纯服务端注册行面**，FailoverRow 走的即原生路径（与原生行同构）；alpha.3→alpha.5 该契约无破坏性变化
- [x] 1.3 失败面定位：`npm run build-client` 在副本死于 **npm 自身 pre-script 的 workspace 枚举**（读 pnpm-workspace `vendor/*` glob 匹配到普通文件 CLAUDE.md → ENOTDIR/exit 236，tsx 根本没启动）；修法 = 直接 `tsx scripts/build-client.ts`

## 2. 测试路径补 client 半边

- [x] 2.1 副本内 tsx 直跑产出 `lib/client/index.js`（8.68 kB closure-factory，33ms，契约断言全绿）；4999 重启后 **boot graph 含 `@pgmi-builds/better-dsh` 行**，HTTP 拉取 200、与产物**字节一致**（仅服务端追加 `sourceMappingURL` 行），bundle 导出 `apply/inject/FailoverRow`
- [x] 2.2 「dashr 客户端卡渲染」并入回归循环：AGENTS.md「已验证/未验证」❓→✅（含 npm-runner 坑 + tsx 直跑命令）；`.agents/skills/upstream-alignment/SKILL.md` S7 增客户端 bundle 冒烟项；GUI 渲染确认并入 3.1

## 3. alpha.5 端到端验证

- [x] 3.1 UI：FailoverRow 呈现 **user GUI 确认（2026-09-03「Settings Failover 有了」）**；boot graph/字节级验证见 2.1；持久化经 `remote.settings` 常规通道（与原生行一致）
- [x] 3.2 行为：瀑布切换回归由 `test/failover.spec.ts`（8 用例，假服务触发 AUTH/MISSING_CREDENTIAL/QUOTA/RATE_LIMIT 失败链）在 3.3 全量中通过覆盖
- [x] 3.3 全量 `npx vitest run` **403/403** + `tsc --noEmit` **0 错误**

## 4. 收尾

- [x] 4.1 验证结论回写 AGENTS.md（❓→✅ 含验证法与 npm 坑）+ v0.2.1e-P1 报告 §5.5；alpha.5 无真回归发现（P1 缺失定性=测试路径缺构建，已收口）
