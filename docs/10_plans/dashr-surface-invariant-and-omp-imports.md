# DASHR 表面不变式与 omp 引入组合

> 日期:2026-08-28 · 来源:v0.1.8e/8f 五轮实测(docs/v0.1.8e-实测报告.md §1–§11)+
> 两份调研(`agent-harness/21_CLI-Agent/03_deepseek-dsh/dsh-ptc-tools-research.md`、`…/05_omp/omp-research.md`)+
> 用户决策(2026-08-28)。
> 性质:设计原则陈述 + 引入组合排序。A 节应在下一个 change 的 design/spec 里原样落地。

---

## A. 表面不变式(应写入 design/plan 的表述)

### A.1 三句话原则

1. **DASHR 的新工具 = 包装/路由原生定义的真工具**(URL wrapper 的 read/write/grep/glob 如此;delegation 桥也应如此)。
2. **REPL 自动桥接注册表放行的一切**(restrict 之后的 visible 全集,单态机械映射,零名单 —— 即 D3)。
3. **不变式:运行时直调面 ≡ REPL `tool.*` 面**。两个面是同一个注册表投影的两个消费者,wire 拿到什么,cell 里就绑什么;反之,DASHR 声明给模型的每一个能力,两个面必须同时在场。

### A.2 当前违反不变式的实证(v0.1.8f,五轮实测)

| 能力 | wire 直调 | REPL `tool.*` | 目录声明 | 来源机制 |
|---|---|---|---|---|
| `eval`(传输)| ✅ | —(排除自身)| —(排除自身)| `tools.register`(真工具)|
| read/write/grep/glob(URL wrapper)| ✅ | ✅ | ✅ | agent own 层 `tools.register`(真工具)+ 自动桥接 |
| `agent` / `agent_message` / `agent_workflow` | ❌ **缺席** | ✅ | ✅ | `createAgentBridgeBindings`(仅 cell 函数)+ `AGENT_BRIDGE_SCHEMAS`(手写 schema 喂目录渲染器)|

桥的三件套(下发 spawn / 三向消息 / workflow 编排)**只在 cell 内可达**:`tool.agent({...})` 能跑,模型直调 `agent(...)` 不存在 —— 绑定集 24 里有、wire 22+eval+MCP 里没有(v0.1.8e 报告 §3/§11 各轮实测口径)。这是 v0.1.8f 三连修(3fdd3dd→db6d84b→0a56da4)留下的结构现状,不是文档笔误。

### A.3 违反的代价

1. **payload 形调用的转义摩擦**(ptc-research §8.5 的实测结论):长 prompt 的 spawn、多引号多换行的 workflow script 经 cell 要过一层字符串字面量转义;native 直调时内容就是参数值,单层序列化。调用路由启发式(payload→直调,logic→REPL)在桥上失效了一半。
2. **双源漂移**:`AGENT_BRIDGE_SCHEMAS` 是手写的模型面声明,与运行时校验(`rejectUnknownKeys` 等)平行维护 —— 正是 D3 消灭"名单漂移"所要避免的形态,在桥上又回来了。
3. **不变式倒置的掩护**:v0.1.8e 的掩码达成了"被掩名两面同消失";桥却做成"两面同在场但只有一面可达"—— 名义上没违反"wire=REPL",实质上模型能力面在两个通道不等。

### A.4 修法(下一个 change)

**把三个桥注册成真工具**:`tools.register`(与 `eval` 同宿主位),execute 直调现有桥实现;然后:

- wire 自动获得 `agent`/`agent_message`/`agent_workflow` 直调(schema 即真 schema,单源);
- REPL 自动桥接**自然拾取**(D3 机制,零改动);
- `AGENT_BRIDGE_SCHEMAS` 手写声明路径**退役** —— `collectSdkSchemas` 从注册表读到的就是它们;
- 校验逻辑保持在 execute 内,桥的"结构化错误不抛异常"语义不变。

回滚即反操作(撤 register、恢复手写 schema),风险面小。**验收标准照 A.1 第三句写**:`registry.wireSchemas(scope)` 与 cell 内绑定集逐名相等(允许的例外仅 `eval` 自身与非平坦 MCP 名)。

---

## B. omp 引入组合(按杠杆排序,2026-08-28 讨论)

已引入不计入:`dvc://` 设备路由(= `xd://`)+ ast_edit/ast_grep/browser/lsp;紧凑签名目录(D4-B);URL schema 本身;REPL pad + `tool.*` loopback。

### T1 —— 补闭环,不是补工具

1. **LSP 接线进 write/edit**:设备已在位但只是 discoverable(显式 `write dvc://lsp`);omp 本义是 "wired into every write"。落点:url-schema 的 write/edit wrapper 加 post-write hook —— 有 language server 的目标语言自动拉 diagnostics 附进结果 + format-on-write。**edit 完立即知道写对了没有**,当前表面唯一还清零的反馈环。
2. **`completion()` cell 原语**:无工具的一次性 LLM 调用(可带 JSON Schema 合成 respond tool)。第四个桥 → ctx LLM 服务。judge/extraction/handoff 压缩在 cell 内一步完成,零 spawn。实现成本最低。
3. **checkpoint/rewind 探索段折叠**:agent-loop 插件(hook pre/post step),把探索段显式收缩成报告;与 recallable compaction("压")互补,这是"折"。

### T2 —— 顺着 URL/设备脊柱的便宜扩张

4. **`skill://` 可写**(= manage_skill/learn 的 DASHR 原生形态):`write skill://name` → 创建/更新 SKILL.md。模型已认识该 scheme,比 omp 独立工具更顺。
5. **`pr://` / `issue://` scheme**:gh CLI 在机,handler 样板现成,复用统一 selector。边际成本极低。
6. **inspect_image(vision 外包)**:图 → 视觉档模型 → 文字。主模型弱视时图像通道不作废。
7. **并行任务 worktree 隔离**:workflow `agent()` 子当前共享工作区,并行改文件不安全;给 spawn 加 `isolation: worktree` opt-in(git worktree + diff 回收)。与 ralph 的"共享工作区即记忆"相反语义,故 opt-in 不默认。

### T3 —— 看场景

8. **snapcompact**(像素 PNG 归档,~1/3 输入价,零 LLM):dsh 有干净 compaction 插件面(`dsh-compaction-snapcompact` 一个包)。**先验证 deepseek v4 系图片 token 计价与 vision 保真度** —— omp 数字按 Anthropic/Gemini 公式调,换 provider 套利未必成立。
9. **TTSR 流中规则**:规则沉睡、命中即流中中止注入、存活过 compaction;`/omfg` 回测起草是杀手子功能。dsh 化 = 响应前钩子 + 规则文件。
10. **Advisor 第二模型盯轮**(aside/concern/blocker):成本近翻倍,长自治任务再上。
11. **discovery 八格式继承**(.cursor/.clinerules/…):采用曲线便利性。
12. 归档/SQLite 写、DAP、tts/generate_image:低频/重/随时可包,后置。

### 不引入

- 31 工具扁平哲学、hub、12-scheme 照抄(补类别,不对齐数量)。
- **mnemopi —— 见 C 节,不是"≈平",是 corti 占优**。

---

## C. corti vs mnemopi:修正为"corti 占优"(用户判断,2026-08-28)

此前对比矩阵(ptc-research §4)记"记忆 ≈平",修正:

| 维度 | corti(dsh 侧)| mnemopi(omp 内建)|
|---|---|---|
| 记忆归属 | **共享 agent 记忆**:跨会话、跨 agent、跨 PC/运行时同一记忆库(pc-deepseek/pc-hermes 等全部读写同库,注入式召回)|| 每安装一份:SQLite 本地文件,子代理 alias 父状态,不出本机 |
| 后端 | **PostgreSQL**:向量 + 关系混合查询,规模化的索引与并发能力 || SQLite:单机单文件,量级与并发上限低 |
| 抽取/召回 | 会话边界抽取(episodes/atomic facts)+ 注入式背景召回 || turn 级自动 retain + 混合打分召回 |

结论:**不引入 mnemopi,也不需要对标实现**;omp 侧若有可取细节(如混合打分里 importance/时间衰减权重),只作为 corti 侧调参参考,不构成引入项。

---

## 附:与既有文档的关系

- A 节是对 `openspec/changes/surface-and-devices/design.md` D1–D3 的**后继修正**:D1/D3 解决了"被掩名两面同消失",A 节把同一不变式的另一半(自声明能力两面同在场)补全。
- B 节 T1-1/T1-2 与 ptc-research §5 的 T1 清单同源;T1-2(persistent runtime)已由 DASHR 本体消化,故不重复。
- C 节修正 ptc-research §4 记忆行与 omp-research §3.4#4 的对照结论。
