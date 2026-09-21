# dashr — AGENTS.md

本文件是 `dashr/`（dsh distro）子目录的 AGENTS.md。上层为 DASHR 根目录 `AGENTS.md`；其规则对本目录仍有效，冲突时以本文件为准。

## 定位速查

- 本目录 = **dsh distro**（发行版组合层）：消费 `../better-dsh/` 的全部组件包，产出开箱即用的发行面。**不实现插件功能**——功能一律落在 better-dsh 各包里，本目录只做组合、默认值与交付。
- 仓库编排（同仓/拆仓、tag 命名空间、发布节奏）的裁决记录在根 AGENTS.md；本目录在其框架内工作。

## 边界纪律

- **不跨目录相对路径 import better-dsh 源码**：发行消费走发布产物（registry 精确版本）或内嵌副本手术模式（同 better-dsh 现行惯例）——保持两目录各自可拆分。
- better-dsh 的功能变更不在本目录做；发现组件缺陷 → 回 `../better-dsh/` 修并发版，distro 跟版本。
