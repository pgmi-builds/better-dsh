## 1. 审计定位

- [ ] 1.1 定位 loopback auth patch 的现维护位置（prod 部署位 diff、`~/.dsh` overlay、其他工作区目录；对照 npm 原产物找出被改文件）
- [ ] 1.2 还原 patch 意图与 alpha.3 态行为（认证流哪里被旁路/注入；截图/抓包记录预期形态）

## 2. 漂移分析

- [ ] 2.1 diff 上游 alpha.3→alpha.5 的 provider directory / Models 清单加载链路，锁定 patch 触点的变动 commit
- [ ] 2.2 判定失效机理（触点文件重构/改名/逻辑迁移 CSS-or-别的层）；顺带判定是否存在官方配置面可整体替代 patch

## 3. 重适配

- [ ] 3.1 按 design D2 优先级重做 patch（配置面 > dashr 扩展点 > 可重放 overlay 脚本）；验证：4999 实例 Settings > Models 清单加载成功、无 "loading the provider directory failed"
- [ ] 3.2 prod（3080）同步重放并验证（遵守"user, just another user"边界：不改上游管理的安装位语义）

## 4. 可维护性收口

- [ ] 4.1 patch 触点表 + 重放命令落文档（patch 自述或 `docs/`），纳入 `.agents/skills/upstream-alignment/SKILL.md` S7 检查项
- [ ] 4.2 在下一次上游对齐演练中实际走一遍重放（或标注待下次对齐验证）
