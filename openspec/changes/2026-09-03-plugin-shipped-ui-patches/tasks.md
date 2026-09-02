## 1. P2 — web-trust-fence（插件随发授权线）

- [x] 1.1 **机制单测**：`!!js` 合并表达式（`DSH_TRUSTED_HOSTS` 空值惰性 / 多值 / 含 malformed 条目时上游 fail-loud 传导）在 dump-config 合成层可测的写法落测；不可测处记录手验步骤。  # 单测落在 web-trust.spec（脚本纯函数）；!!js 求值经真实 js-yaml 方言 + evaluate 双态验证（env 合并/空惰性），4999 实测补全
- [x] 1.2 **bundle patch 落地**：`dashr/cordis.patch.yml` 追加 `connection` 行覆盖（整行重述 + env 合并式 trustedHosts，见 design D2）；`dsh --dump-config` 断言合成结果。  # dump-config 显示 connection 行 "patched by @pgmi-builds/better-dsh"（层序生效 + 出处注释）
- [x] 1.4 **isLoopback 腿 = B 机制落地（user 定案；A 直访与 C 上游 PR 均已否决——需求本体是其他 device 访问，且上游关闭所有 PR）**：host 半监听 `webserver/index-inject`，push `{kind:'script', placement:'head', text}` 内联脚本——`location.hostname ∈ trustedPageAuthorities`（新 config 键，数组）时设 `window.__DSH_TRANSPORT__ = { ownsHost: true }`；空列表不注入。含 config schema、脚本安全转义、单测（authority 匹配 / 空列表惰性 / 注入行形状）。
- [ ] 1.5 **4999 + prod 双实测**：fence 腿（`DSH_TRUSTED_HOSTS` + 非 loopback Host 的 `/api` 403→200）与 isLoopback 腿（`trustedPageAuthorities` 含 LAN IP / 域名时，非 loopback 拼法访问 Settings/Models 恢复、持久化 host 生效）分别验证；空配置双惰性复测；含 prod alpha.3 手改 patch 现状核验（retired 路径）。
## 2. P3 — mobile-layout（client 半边）

- [x] 2.1 **mobile 模块**：`dashr/src/client/` 增量（CSS 注入 + 手势监听 + `ctx.layout.toggleSidebar()`），config 面 `mobile: { enabled: true, breakpoint: 1024, swipeDistancePx, swipeVelocityPxPerMs }` 进 dashr 行 schema。
- [ ] 2.2 **CSS 覆盖**：媒体查询 + `[data-sidebar-collapsed]`（及平板窄档策略）→ 侧栏轨 0；验证矩阵：手机档（<920）/ 平板窄档（920–1023，details 开关两态）/ 桌面档（≥1024 不受影响）。
- [x] 2.3 **手势三条件**：起点（边缘带）+ 距离 + **速率**判定纯函数化 + vitest 单测（慢速拖选不触发、快速轻扫触发、可交互元素起点忽略）。
- [ ] 2.4 **4999 实测**：devtools 移动模拟 + 真机（视口 + 触摸）双验；`toggleSidebar` 窄视口语义（narrowExpanded 翻转）行为正确。

## 3. 收口

- [x] 3.1 **回归**：vitest 全量（403 基线 + 新增）+ tsc 0 错；`dsh --dump-config` 快照。  # 423/423 + tsc 0 错
- [x] 3.2 **文档**：`docs/50_test-reports/` 新实测报告（含 1.3 复诊结论）；`docs/` 里 P2/P3 的部署说明（env 语义、安全提示、retired 手改 patch 清单）。  # 报告 docs/50_test-reports/v0.2.1f-plugin-shipped-ui-patches实测报告.md；部署说明（env/authorities 语义、安全提示）落报告 §2/§4 + AGENTS ✅ 条目；retired 手改 patch 清单随 prod 升级另走
- [x] 3.3 **skill + AGENTS.md**：`.agents/skills/dsh-plugin-development/` 两分量（本 change 机制结论沉淀）；AGENTS.md 插件开发面一节；upstream-alignment S7 查表加 connection 行形状 + AppFrame 属性两项。  # skill 两分量 + AGENTS 第四节/✅ 条目 + upstream-alignment S7 查表 +3 项（connection 行形状 / ownsHost 消费点 / AppFrame 属性）
- [x] 3.4 **版本**：package.json `0.2.1-f`；本地 commit + tag `v0.2.1f`（发布与 prod 部署另按年龄门流程，不在本 change 内）。  # 0.2.1-f，commit b1b85e5 + tag v0.2.1f（本地，未 push）
