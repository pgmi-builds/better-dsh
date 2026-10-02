# .test/ — 测试资产布局（seed 与 home 分离）

规范来源：仓库根 `Cordis-dsh-dev-test-guides.md` §3（冲突以该文件为准）。

```
.test/
  seed/<rig>/     # 入库：启动脚本、profile 种子、rig README（含 session schema 版本与最近兼容验证日期）
  home/<rig>/     # gitignored：DSH_HOME 实体（sessions/storages/profiles/*/node_modules）
```

- 现行 rig：
  - `test123`（Dev/Test 1 — 干净 harness + plugin-add 交付形态）。`home/compat/` = 默认长寿命
    home（**测试现场不换 home**，user data 与 `.credentials.yaml` 是测试资产跨重置保留；2026-09-27 裁决）；
    全新 home 只在专门验证首次行为时经 `RIG_HOME=clean` 临时指一个，用完即删。
    start.sh 以 `RIG_HOME` 选择，默认 compat。
  - `bun-test`（dashr 编译产物 rig — 固定产物集合 + 单一 home 路径 `home/bun-test/`）。
    重启默认**保留 home**（resume test：sessions 跨重启存活）；`CLEAN=1` 才清测试数据，
    且保留 user-config keep-set（`.env` / `settings.yaml[.imported]` / `.credentials.yaml`）。
    取代旧 `dsh-m1-lan`/`dsh-m1-relay` ad-hoc 单元。
- 迁移记录（2026-09-24，guide §6 Q3 落地）：由 `.tests/`（seed 与 home 混排、home 另散根级点目录）
  收敛而来；旧 `.tests/dsh-test1/`、`.dsh-test*/` 等已删除。
