## Purpose

让模型通过 ctx:// URL 读写运行时上下文与持久内核变量，实现 context-as-variable。

## ADDED Requirements

### Requirement: 内核变量读取
系统 SHALL 让 read 接受 ctx://<var> 并返回该内核变量的当前值。

#### Scenario: 读取已定义变量
- **WHEN** 模型读取 ctx://<已定义内核变量>
- **THEN** 系统返回该变量当前值

#### Scenario: 读取未定义变量
- **WHEN** 模型读取 ctx://<未定义变量>
- **THEN** 系统返回结构化错误，说明变量不存在

### Requirement: 变量序列化契约
系统 SHALL 对 JSON 可序列化的变量返回 JSON，否则返回 repr 文本并标注。

#### Scenario: 非 JSON 变量回退 repr
- **WHEN** 模型读取一个不可 JSON 序列化的变量
- **THEN** 系统返回其 repr 文本，并标注为 repr（非 JSON）

### Requirement: 命名空间列举
系统 SHALL 让裸 ctx:// 返回当前内核命名空间的变量清单。

#### Scenario: 列举命名空间
- **WHEN** 模型读取裸 ctx://
- **THEN** 系统返回当前内核命名空间的变量名清单

### Requirement: 内核变量写入
系统 SHALL 让 write 接受 ctx://<var> 并设置该变量值。

#### Scenario: 写入变量
- **WHEN** 模型 write 到 ctx://<var> 并给出值
- **THEN** 系统将该变量写入内核命名空间，后续 read ctx://<var> 返回新值
