# bun-test — dashr 编译产物 rig

bun distro（编译单文件）的冒烟 rig。与 test123（源码级 rig）的本质差别：**产物集合是固定的**——一次
build = 一个自包含可执行文件（`dashr/dist/dashr-<ver>-<os>-<arch>`），所以 rig 不需要种子再生、
symlink 农场或 plugin 安装，**只需要一个 home 路径**（`.test/home/bun-test/`）。

## 纪律：always clean profile > start new（user 2026-09-24）

被测变量是产物本身，不是长寿命数据——**每次启动前清 home**（`start.sh` 默认 `CLEAN=1` 直接 `rm -rf`）。
guide §3.3 的 compat/clean 配对在这里不适用：单一 home、永远干净。`CLEAN=0` 逃生口仅用于
"session 跨重启存活"类验收实验（spec §7 第 4 条），用完即弃。

## 用法

```bash
bash .test/seed/bun-test/start.sh                    # 自动选 dist/ 最新产物，默认 4996
BIN=dashr/dist/dashr-0.1.6-alpha.2-linux-x64 bash …  # 钉某个产物
PORT=4986 bash …                                     # 换端口
```

- `DSH_BUN_COMPILED=1` 由脚本注入（编译态 seam 的门控，缺它 boot 走错平面）。
- LAN 中继默认开（socat 绑 LAN IP → loopback，同 test123 形态；webserver 硬拒 0.0.0.0）。
- 单元名 `dsh-<port>-bun-test` + `bun-test-lan-<port>-relay`；日志 `.scratch/dsh-<port>-bun-test.log`。
- 重建产物：`bash dashr/scripts/dashr/build.sh`（distro 仓）；验收门禁见
  `dashr/docs/specs/dashr-bun-port/upstream-sync.md` §五。

## 取代记录（2026-09-24）

取代旧 ad-hoc LAN 单元 `dsh-m1-lan`/`dsh-m1-relay`（4996/4997、`.scratch/m1-lan-home`——该 home 的
workspace 曾指向旧仓库路径，制造过 `dashr/port/.git/dsh-hooks` 残留）。旧单元已停用删除。
