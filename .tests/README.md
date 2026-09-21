# .tests/ — 测试资产（tracked，按 rig 分目录）

本目录收拢**可再生的测试源**（启动脚本 + profile 种子），按测试线（rig）一目录一 rig。
运行态数据（DSH_HOME 实例 home）**永不入内**——见下方裁决。

```
.tests/
└── dsh-test1/           # Dev/Test 1：源码级 4988/4999 实例（AGENTS.md §二）
    ├── start-4999.sh    #   拉起脚本（PORT=/LAN= 可覆盖；built-lib boot，双平面修复后形态）
    ├── profiles/web/    #   测试 profile 种子（package.json / cordis.patch.yml / cordis.yml / pnpm-workspace.yaml）
    └── README.md        #   本 rig 的 home 再生步骤与注意项
```

新测试线 = 新建 `.tests/<rig-id>/`（自带 README 说明种子与 home 的对应关系）。

## home（运行态）裁决 — 2026-09-22

`.dsh-test*`、`.dsh-bun-test`、`.dsh-acp` 等根级点目录是各实例的 **DSH_HOME 运行态**
（物理 pnpm profile 树、sessions、storages、快照；`.dsh-test*/.env` 含**真实 key**）。
它们**不放进 `.tests/`**：

1. `.tests/` 是 tracked 源树，home 是 gitignored 状态数据且含密钥——混入 = 一次
   `git add -A` 之遥的泄密面；
2. home 是重 disposable 的重型运行态（每个 300–530MB），与再生种子生命周期不同；
3. 对应关系由各 rig 的 README 声明（如 `dsh-test1` ↔ `~/.dsh-test`，变量在 start 脚本
   顶部可查），不需要靠目录嵌套来表达。

home 的 gitignore 覆盖：`.dsh-test*/`（glob 含 `.dsh-test-<port>` 变体）、`.dsh-bun-test/`、
`.dsh-acp/`。
