## Purpose

让模型通过 agent:// URL 统一寻址 agent 名册、输出 artifact 与完整 transcript，取代上游 history://。

## ADDED Requirements

### Requirement: agent 名册寻址
系统 SHALL 让裸 agent:// 返回 agent 名册（id、status、kind、parent、last activity）。

#### Scenario: 列出全部 agent
- **WHEN** 模型读取裸 agent://
- **THEN** 系统返回 agent 名册表，含每个 agent 的 id/status/kind/parent/last activity

### Requirement: agent 输出寻址
系统 SHALL 让 agent://<id> 返回该 agent 的输出 artifact。

#### Scenario: 读取已完成 agent 输出
- **WHEN** 模型读取 agent://<已完成 agent id>
- **THEN** 系统返回该 agent 的 schema-validated 输出对象

### Requirement: agent transcript 寻址
系统 SHALL 让 agent://<id>/transcript 返回该 agent 的完整会话 transcript（含 live/parked/released）。

#### Scenario: 读取 agent 会话历史
- **WHEN** 模型读取 agent://<id>/transcript
- **THEN** 系统返回该 agent 的完整 transcript

### Requirement: 嵌套输出寻址
系统 SHALL 让 agent://<id>/<child> 返回该 agent 的嵌套子 agent 输出。

#### Scenario: 读取嵌套子 agent 输出
- **WHEN** 模型读取 agent://<id>/<child id>
- **THEN** 系统返回该子 agent 的输出

### Requirement: history 语义并入
系统 SHALL 将 history:// 的语义并入 agent://，不再提供独立的 history scheme。

#### Scenario: history scheme 不可用
- **WHEN** 模型尝试读取 history://
- **THEN** 系统提示 history 语义已并入 agent://（或按未注册 scheme 处理）
