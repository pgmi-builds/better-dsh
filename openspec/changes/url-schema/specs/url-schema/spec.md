## Purpose

为 DASHR 引入统一 URL 资源寻址：read/write/grep/glob 接受 scheme:// URL，按 scheme 路由到对应 handler，并对所有资源提供一致的 selector 语法。

## ADDED Requirements

### Requirement: FS 形工具接受并路由 scheme URL
系统 SHALL 让 read/write/grep/glob 工具接受 scheme:// URL，并按 scheme 路由到对应 handler，返回该资源的解析视图。

#### Scenario: 读取已注册 scheme
- **WHEN** 模型调用 read 并传入一个已注册 scheme 的 URL（如 skill://foo）
- **THEN** 系统返回该 scheme handler 解析出的内容，而非按文件路径解析

#### Scenario: 搜索已注册 scheme 资源
- **WHEN** 模型调用 grep 并以一个已注册 scheme 的 URL 作为搜索路径
- **THEN** 系统在该 scheme 资源的内容上执行搜索，返回匹配结果

#### Scenario: 读取未注册 scheme
- **WHEN** 模型调用 read 并传入未注册的 scheme URL
- **THEN** 系统返回结构化错误，说明该 scheme 未注册

### Requirement: 统一 selector 语法
系统 SHALL 对所有 scheme URL 与普通文件路径应用一致的 selector 语法（:N-M、:raw、/path、?q=）。

#### Scenario: scheme URL 带行范围
- **WHEN** 模型读取带 :N-M 选择器的 scheme URL
- **THEN** 系统按行范围分页返回，与普通文件一致

### Requirement: 普通路径透传
系统 SHALL 让非 scheme 路径的 read/write/grep/glob 行为保持不变（由原生或 hashline 实现处理）。

#### Scenario: 普通文件操作不受影响
- **WHEN** 模型对普通文件路径调用 read/write/grep/glob
- **THEN** 系统行为与引入 URL schema 之前一致
