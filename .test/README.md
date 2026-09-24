# .test/ — 测试资产布局（seed 与 home 分离）

规范来源：仓库根 `Cordis-dsh-dev-test-guides.md` §3（冲突以该文件为准）。

```
.test/
  seed/<rig>/     # 入库：启动脚本、profile 种子、rig README（含 session schema 版本与最近兼容验证日期）
  home/<rig>/     # gitignored：DSH_HOME 实体（sessions/storages/profiles/*/node_modules）
```

- 现行 rig：
  - `test123`（Dev/Test 1 — 干净 harness + plugin-add 交付形态）。home 配对（guide §3.3）：
    `home/compat/` 长寿命，专测格式兼容与开发迭代；`home/clean/` 可弃，专测干净启动。
    start.sh 以 `RIG_HOME` 选择，默认 compat。
  - `bun-test`（dashr 编译产物 rig — 固定产物集合 + 单一 home 路径 `home/bun-test/`）。
    **always clean profile > start new**（user 2026-09-24）：每次启动前清 home；guide 的
    compat/clean 配对不适用。取代旧 `dsh-m1-lan`/`dsh-m1-relay` ad-hoc 单元。
- 迁移记录（2026-09-24，guide §6 Q3 落地）：由 `.tests/`（seed 与 home 混排、home 另散根级点目录）
  收敛而来；旧 `.tests/dsh-test1/`、`.dsh-test*/` 等已删除。
