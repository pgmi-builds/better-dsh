# 2026-10-06 authentication-only Web admission — 4999 实测

## 结果与范围

本地测试包 `better-dsh@0.2.5-e` 已通过 tarball 的 `dsh plugin add` 安装到
`.test/home/compat/profiles/web`。运行实例为 `dsh-4999-test123`，原测试 home、
会话和共享 credential seed 保留，未触碰生产 3080/3081 或 Caddy 配置。
未发布 npm；user 于 2026-10-06 确认测试「looks good」并授权在本地 main 提交。

测试开启 `dashr-web-trust.config.trustAllHosts: true`。该模式仅包装原生
Connection 实例的 `requestRejection`，通过公开 `authorizeIndex` 接口委托
cookie 校验，不复制认证实现、不访问 private 字段、不修改上游。传入真实
Host/Cookie 与固定无 query 的 index 路径，API 准入不会执行 token 铸 cookie。

浏览器初始化脚本在任意 hostname 设置 `ownsHost: true`，已有 transport 保留。
默认仍为 `trustAllHosts: false`。关闭/卸载模式恢复原生地址检查，页面能力需刷新。

## 网络与登录

- 原生服务器监听 `127.0.0.1:4999`；现有 socat 中继监听 `192.168.31.130:4999`。
- 实际运行 argv 无 `--trusted-host`，没有给测试进程传入 `DSH_TRUSTED_HOSTS`。
- HTTPS 入口为 `https://test.pc.randomhash.app/`，沿用已有 Caddy。
- 本 test profile 禁用 `dashr-web-password`，以验证原生 token URL 登录；生产未变。
- launcher 允许 `TRUSTED_HOSTS=''` 显式省略 CLI 名单。原生/clean rig 默认仍由
  CLI 放行 loopback、LAN 与测试域名。

## 运行时验证

每个入口先以本次 launch token 完成原生 303 cookie 交换，再读取 HTML 与 RPC。
额外的 unlisted Host 通过 loopback 连接模拟，未修改 DNS、服务器名单或代理。

| 入口 | 页面 | 模型列表/可配置 provider | 插件列表 | 设置描述 |
|---|---|---|---|---|
| loopback | 200 | 通过 | 通过 | 通过 |
| LAN | 200 | 通过 | 通过 | 通过 |
| unlisted | 200 | 通过 | 通过 | 通过 |
| HTTPS | 200 | 通过 | 通过 | 通过 |

- 各入口 HTML 均有 all-host `ownsHost` 初始化脚本。
- 未列入名单的请求携带不匹配 Origin 与 cross-site Fetch-Metadata，认证后仍成功。
- LAN 与 unlisted 请求分别验证：缺失、篡改、其他 authority 的 cookie 均为 401。
- 真实 `/api/remote.mux` WebSocket upgrade：unlisted Host + 跨域 Origin，认证后 101，
  未认证 401。
- HTTPS `settings/mutate` 将测试字体 17 改为 18，描述接口读回 18 且 profile 文件
  持久化；之后按 revision 恢复 17 并复验。未改模型凭据。

## 静态与自动测试

- LSP 核实 Connection capability 定义、web-trust 的引用；TypeScript AST 核实脚本
  生成与插件 apply 结构。
- TDD：新增准入测试先复现 403，页面全地址测试先复现缺失 ownsHost；实现后通过。
- 定向测试 16/16；包含原生 Connection 的认证、native cookie lifetime 与卸载恢复。
- 全量 66 个测试文件通过：709 passed、1 skipped。
- host/client typecheck 通过，构建与 pack 通过，launcher `bash -n` 通过。
- 构建保留既有 puppeteer 相关 `eval` / 可选 `yauzl` 警告；不在本次准入改动范围。

## 验收与交接

当前 Computer Use 没有可用浏览器，接口验证不等于 UI 操作验收。
user 已确认测试效果可接受。4999 实例保持运行，测试 tarball 是 profile 的本地依赖来源，
交接时保留但不入库。仅提交本次代码、测试、rig 指引与文档，不发布 npm。
生产 profile 仅移除旧 `dashr-repl` trustedPageAuthorities 覆盖，Python 配置继承 bundle，
不安装测试包、不重启生产。备份保存在 `/tmp/dashr-prod-cordis.patch.before-cleanup-20261006.yml`。
