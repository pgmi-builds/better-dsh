## Purpose

为 DASHR 预留设备执行面：xd:// 是「read=设备文档、write=调度执行」的设备 scheme，为后续挂载 LSP/AST/MCP 等执行面留统一入口。

## ADDED Requirements

### Requirement: 设备清单寻址
系统 SHALL 让裸 xd:// 返回已挂载设备清单（当前为空）。

#### Scenario: 列举已挂载设备
- **WHEN** 模型读取裸 xd://
- **THEN** 系统返回已挂载设备清单；当前无设备时返回「no devices mounted」

### Requirement: 设备文档寻址
系统 SHALL 让 xd://<device> 返回该设备的输入文档与 JSON Schema；未挂载设备返回「unknown device」。

#### Scenario: 读取未知设备
- **WHEN** 模型读取 xd://<未挂载设备名>
- **THEN** 系统返回结构化错误，说明该 device 未挂载

### Requirement: write 调度入口预留
系统 SHALL 让 write 到 xd://<device> 的路径成为设备调度入口；无设备挂载时该路径返回错误。

#### Scenario: 无设备时 write 调度
- **WHEN** 模型 write 到 xd://<未挂载设备>
- **THEN** 系统返回结构化错误（当前无设备可调度）
