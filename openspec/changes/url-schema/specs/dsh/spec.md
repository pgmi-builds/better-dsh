## Purpose

让模型通过 dsh:// URL 读取 harness 文档与生效配置，实现运行时自描述。

## ADDED Requirements

### Requirement: 文档寻址
系统 SHALL 让 dsh://docs 返回 harness 文档（列表或指定文档内容）。

#### Scenario: 浏览文档列表
- **WHEN** 模型读取 dsh://docs
- **THEN** 系统返回可用文档清单

#### Scenario: 读取指定文档
- **WHEN** 模型读取 dsh://docs/<doc>
- **THEN** 系统返回该文档内容

### Requirement: 生效配置寻址
系统 SHALL 让 dsh://config 返回当前 resolved 生效配置（模型/provider/工具配置等）。

#### Scenario: 读取生效配置
- **WHEN** 模型读取 dsh://config
- **THEN** 系统返回当前生效配置（resolved，非文档默认值）

### Requirement: 配置不泄密
系统 SHALL 确保 dsh://config 不暴露 credentials/env secrets。

#### Scenario: 配置隐藏密钥
- **WHEN** 模型读取 dsh://config
- **THEN** 返回内容不包含 API key 等 secret 字段
