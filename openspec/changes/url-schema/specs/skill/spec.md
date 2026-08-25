## Purpose

让模型通过 skill:// URL 直接寻址 skill 正文及其内部资源，取代上游 skill 工具的正文加载路径。

## ADDED Requirements

### Requirement: skill 正文寻址
系统 SHALL 让 read 接受 skill://<name> 并返回该 skill 的正文。

#### Scenario: 读取已存在 skill
- **WHEN** 模型读取 skill://<已注册 skill 名>
- **THEN** 系统返回该 skill 的 SKILL.md 正文

#### Scenario: 读取不存在的 skill
- **WHEN** 模型读取 skill://<未注册名>
- **THEN** 系统返回结构化错误，说明 skill 未知或不再可用

### Requirement: skill 内部资源寻址
系统 SHALL 让 read 接受 skill://<name>/<path> 并返回该 skill 目录内的指定资源。

#### Scenario: 读取 skill 内引用文件
- **WHEN** 模型读取 skill://foo/references/x.md
- **THEN** 系统返回该 skill 目录下 references/x.md 的内容

### Requirement: 完整分页
系统 SHALL 对 skill 正文不做默认行数截断，仅由显式 selector 分页。

#### Scenario: 长 skill 正文完整返回
- **WHEN** 模型读取 skill://foo 且正文超过默认行数上限
- **THEN** 系统返回完整正文（不受默认 read 行数限制）

### Requirement: skill 工具被遮蔽
系统 SHALL 从模型可见工具面移除上游 skill 工具（presentation 层 mask）。

#### Scenario: skill 工具不可见
- **WHEN** 模型查看可用工具目录
- **THEN** 工具目录不包含 skill 工具，但 skill:// URL 仍可寻址 skill 内容
