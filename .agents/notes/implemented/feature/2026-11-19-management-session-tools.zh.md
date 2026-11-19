# Agent Note: 管理对话的列表、最新回复与消息工具

Status: implemented

[English](2026-11-19-management-session-tools.md) | 中文

## 问题

球体的 `manage` 对话原本是只读的：它能搜索并读取默认工作区中的已有 Session，但不能列出工作区或 Session、直接读取某个 Session 的最新回答，也不能向另一个 Session 投递消息。用户要求从这个管理预设获得这三项操作。

跨会话投递不是查询。在工具内直接恢复目标会重复 Agent 组合、归档执行、收件箱排队与请求身份，而这些已由 Session Controller 拥有。等待目标轮次的工具会让一次工具调用横跨无关的模型运行，并使取消与失败报告变得含糊。无限制投递还会让管理对话触达其 persona 承诺范围之外的工作区。

## 决策

管理预设挂载 `@deepseek-ai/dsh-tool-session-list` 以取得工作区与 Session 元数据，并为现有 `@deepseek-ai/dsh-tool-session-query` 包启用新工具。

### 列表

`list_workspace` 与 `list_session` 来自现有列表包。它们返回注册表与 Session 元数据，不恢复 Agent，也不打开冷日志：ID、标题、工作区路径、创建与更新时间、归档过滤与有界分页。管理预设在查询工具旁新增该包；它没有扩展列表 schema。

### 最新回复

`session_latest_reply` 是查询包为每个消费方注册的读取工具。它用与其他读取工具相同的精确 `cwd` 工作区规则授权目标，观察目标一次，移除被后续 surface 替换遮蔽的 assistant 消息，并返回最新的、文本块非空的当前 assistant 消息。结果包含 Session id、事件序号、回复时间、轮次，以及最多 20000 字符的文本和截断标志；`session_event_read` 可取得完整事件。没有文本回复的 Session 返回 null 字段，而不是失败。

### 发送

`session_send_message` 通过默认 false 的 `allowSessionMessages` 选择启用；且只有存在 `sessionController` 服务时插件才注册它。工具先授权目标 header，拒绝调用方自身 id 与 subagent 目标，然后用新生成的 request id 以 queue 模式调用 Session Controller 的 prompt 操作。目标收到一条用户提示；调用在收件箱准入后返回 `accepted: true`，不等待目标轮次。Controller 拥有按记录预设恢复目标、归档执行、忙碌处理与策略。工具串行化自身调用，不做重试或重复抑制。

`manage` 预设设置 `allowSessionMessages: true`，更新 persona 以点名列表、最新回复与发送工具，并保留不写文件、不执行 Shell、不删除或改写的约束。挂载查询包的其他组合除非选择启用，否则仍保持只读。

## 考虑过的替代方案

- **把三个工具都放进新的管理专用包。** 拒绝：最新回复与投递需要查询包按调用方推导的工作区授权和服务边界；第二个包会重复这些。
- **无条件注册消息工具。** 拒绝：现有只读组合会静默获得一个提示注入原语。
- **在工具内恢复目标 Agent。** 拒绝：会重复 Session Controller 的组合、归档门禁、请求身份与队列所有权。
- **在发送调用内等待目标回复。** 拒绝：会把一次工具调用绑定到无关轮次，隐藏部分接受状态，并使取消复杂化。
- **允许跨工作区投递。** 拒绝：违背管理 persona 的工作区承诺，并扩大被提示注入的工具调用权限。
- **以 `agent-message` source 投递。** 本次拒绝：目标应收到来自管理对话的普通用户提示；Controller 的用户 source 是现有的、可重建路径。

## 后果

管理对话现在可以枚举 Session，并向同一工作区中的其他 Session 投递文本提示。投递是异步且非幂等的；模型必须用 `session_latest_reply` 读取回答，不能假定目标已执行。目标收到的文本是没有 `principal` 的用户提示，因此共享或面向 viewer 的 profile 不得暴露此工具。subagent 目标与调用方自身会被拒绝。目标侧归档或忙碌拒绝表现为 `SESSION_MESSAGE_TOOL_REFUSED`；工具无法验证目标完成工作。

验证：查询包测试钉住最新回复选择、替换遮蔽、截断、自身与跨工作区授权、条件注册、消息参数检查、subagent 拒绝与目标拒绝映射；管理预设测试校验每一行及其配置；真实 Desktop 管理对话列出了工作区与 Session、读取了另一个 Session 的最新回复，并投递了一条目标 Session 已接收并回答的消息。
