# dashr — dsh distro（筹界定，尚无代码）

> **定位**：dashr = **dsh 发行版（distro）**——把上游 dsh 与全部 better-dsh 组件
> （repl / url-schemes / failover / compaction-tuning / web-trust / mobile，及其后续新包）
> 预组态成一个开箱即用的发行面：一份 bundles 组合 + patch 底座 + kernel 供给 + 移动端/
> 信任栅栏默认值，用户一次安装即得完整体验，无需逐个插件拼装。
>
> **与 `../better-dsh/` 的关系**：better-dsh 是 **dsh 插件包**（npm `@pgmi-builds/better-dsh`，
> 组件化、可独立发布、装进任何 dsh）；dashr 是 **组合与交付层**（消费 better-dsh 各包，
> 不重复实现它们）。类比：better-dsh = 组件集，dashr = 用这套组件装好的整机。
>
> **状态（2026-09-22）**：本目录目前只有本章程，无代码、无 package.json。发行物形态
> （npm pack / bundle tarball / profile 模板 / 安装器）、版本与 tag 命名、与上游对齐节奏的
> 绑定方式——见根 AGENTS.md 与仓库编排讨论结论后再立。
>
> **红线继承**：本仓 Development Operation Contract（根 AGENTS.md §〇）对 dashr 同样生效；
> 发布前三闸（第一人称实测 → 报告 → user 放行）不豁免。
