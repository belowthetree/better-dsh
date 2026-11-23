---
description: "面向 agent 开发者与维护者的、按工作区授权的模型侧会话历史、最新回复与可选跨会话消息工具。"
kind: "package-reference"
---

# @deepseek-ai/dsh-tool-session-query

[English](README.md) | 中文

## 概述

使用实验性的 `dsh-tool-session-query` 工具，让模型搜索早先会话、检查事件匹配、追踪会话或事件关系、读取精确事件数据，并读取某个会话的最新回复。它的六个只读工具返回无游标文本，并且仅当目标会话的 `cwd` 与调用方完全相同时才授权跨会话访问；没有 `cwd` 的调用方只能检查自己。可选的第七个工具向另一个已授权会话投递一条文本消息，不等待对方回复。本包为可选启用；启用后会给每个模型请求加入固定指引以及六或七个工具 schema。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

当 agent 需要搜索自己的早先会话、检查其关系与事件，或读取另一个会话的最新回复时，挂载本包。常见路径是显式的：把插件挂载到 `ctx.sessionQuery` 之上（由 `dsh-session-query-sqlite` 支撑），再让模型调用这些工具。

### 何时选择

当部署希望由模型驱动地检索早先工作——例如编码 agent 在开始任务前搜索自己以前的会话——选择本包。仅当该 agent 还可以向同一工作区中的其他会话投递提示时，才启用 `allowSessionMessages`；仅当它还可以在那里新建会话时，才启用 `allowSessionCreate`。仅需要程序化检索，或没有可信消费方应该在另一个会话中启动工作时，不要启用这两个写入工具：`ctx.sessionQuery` 本身即可服务代码调用方，不需要模型侧 schema、提示和授权层。

### 配置

| 字段 | 默认值 | 含义 |
|---|---|---|
| `maxSearchResults` | `100` | 一次搜索调用返回的最大授权命中数 |
| `searchTimeoutMs` | `30000` | 附加到两个全文搜索工具上的协作式截止时间 |
| `allowSessionMessages` | `false` | 在 Session Controller 服务也存在时注册消息工具 |
| `allowSessionCreate` | `false` | 在 Session Controller 服务也存在时注册会话创建工具 |

生成的[配置目录](../../../docs/config-catalog.zh.md#deepseek-aidsh-tool-session-query)是每个已接受字段及其 JSDoc 的穷尽式真源。

### 模型能做什么

| 工具 | 模型得到什么 |
|---|---|
| `session_search` | 匹配字面查询的会话，按排序返回标题和最佳匹配摘录；始终省略调用方会话 |
| `session_event_search` | 一个已授权会话内匹配字面查询的事件；对当前会话会在发起本次调用的 step 之前停止 |
| `session_trace` | 一个会话的已授权祖先链与后代树；未授权边界显示为不含隐藏 id 的标记 |
| `session_event_trace` | 一个事件的位置替换与被引用的源事件关系 |
| `session_event_read` | 一个完整未删节事件的 JSON，以及可选的相邻事件摘要 |
| `session_latest_reply` | 最新的、含非空文本的当前 assistant 消息，及其事件序号、时间、轮次和最多 20000 字符文本 |
| `session_send_message` | 一条文本消息作为用户提示进入另一个会话收件箱后的接受回执；不等待目标轮次完成 |
| `session_create` | 新会话的 id、适用时的预设，以及第一条消息是否已投递；不等待轮次完成 |

工作区授权是保守的：跨会话访问要求目标会话与调用方会话的 `cwd` 完全相等，没有 `cwd` 的调用方只能检查自己。消息工具只接受调用方工作区内、header 非 subagent 的另一个会话，并拒绝调用方自己的 id。投递经过 Session Controller：冷目标会按记录下的预设恢复，已归档目标会被与 Client 提示相同的门禁拒绝，空闲目标会启动一个轮次。创建工具要求调用方拥有 `cwd`，并以同一目录请求 Session Controller 创建会话，因此新会话以组合的默认预设加入调用方工作区；可选的第一条消息经过与消息工具相同的投递操作。请求的父 id 在搜索前会去重并做授权检查；不存在的猜测与跨工作区猜测行为一致。搜索结果无游标：达到上限时会要求模型收窄查询，绝不暴露 Provider 游标、偏移、页大小或模型可控上限。工具边界上的时间戳是带时区的 ISO 8601，并转换为包含端点的 epoch 毫秒过滤值。

### 失败与恢复

每次可信查询服务调用都经过同一个错误清洗器：调用方取消被原样保留，语料与 Provider 诊断写入内部日志，不安全或不可打印的失败回退为固定的 `SESSION_QUERY_TOOL_FAILED` 代码与消息。本地参数校验与授权错误保留精确的工具自有消息（目标在调用方工作区之外时为 `SESSION_QUERY_TOOL_UNAUTHORIZED`）。消息工具把目标侧拒绝报告为 `SESSION_MESSAGE_TOOL_REFUSED`，把 subagent 目标报告为 `SESSION_MESSAGE_TOOL_SUBAGENT`；接受意味着提示已进入收件箱，不意味着轮次已完成。创建工具把没有工作区目录的调用方报告为 `SESSION_CREATE_TOOL_NO_WORKSPACE`，把 Controller 的拒绝（包括可选第一条消息的拒绝）报告为 `SESSION_CREATE_TOOL_REFUSED`。读取结果保持完整，只有最新回复工具会在 20000 字符处截断其文本字段并置 `truncated: true`；用返回的序号调用 `session_event_read` 可取得完整事件。需要为其他工具限制内联输出的部署可挂载 `@deepseek-ai/dsh-spill-policy`，它可以在保留完整结果的同时替换过大的渲染文本。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部细节——点击展开</summary>

本节解释工具背后的设计决策，并指向实现它们的代码；可观察行为已完整覆盖在[使用本包](#use-this-package)中。

### 设计理念

该消费方建立在一个分离与四项承诺之上：

- **精简读取工具加可选写入工具。** 六个读取工具、一个消息工具与一个创建工具，全部使用扁平 snake-case schema；游标、偏移、页大小或模型可控上限绝不进入模型。
- **权限来自调用方，绝不来自模型。** 调用方身份来自 `ToolExecution.exec.agent`；工作区是精确字符串 `cwd` 相等，并针对每个结果观察到 header 再检查一次。
- **一个模型边界清洗器。** 每次可信 `ctx.sessionQuery` 调用都经过服务边界，由它保留取消并包含诊断与分类失败。
- **一个显式投递 seam。** 消息与创建工具调用 Session Controller 的 prompt 与 create 操作，因此恢复、归档、排队、预设选择与策略仍归该服务所有，而不是在工具中重新实现。
- **没有第二种截断格式。** 读取结果保持完整；只有最新回复文本受限，其他受限内联输出由通用 spill 策略负责。

设计历史见[模型侧会话查询工具记录](../../../.agents/notes/archived/feature/2026-07-24-model-facing-session-query-tools.md)与[会话搜索默认不发布记录](../../../.agents/notes/archived/feature/2026-08-02-session-search-not-shipped-default.md)。

### 源码地图

| 文件 | 角色 |
|---|---|
| [`src/index.ts`](src/index.ts) | 插件入口：配置、提示区段、读取工具注册、条件消息与创建注册 |
| [`src/input.ts`](src/input.ts) | 模型 schema、参数归一化、过滤条件构造 |
| [`src/workspace-access.ts`](src/workspace-access.ts) | 调用方身份、工作区授权、标题访问、谱系投影 |
| [`src/service-boundary.ts`](src/service-boundary.ts) | 可信调用与模型安全错误转换 |
| [`src/operations.ts`](src/operations.ts) | 五个搜索、追踪与事件读取工作流 |
| [`src/reply.ts`](src/reply.ts) | 最新回复的 surface 扫描、边界与 JSON 结果 |
| [`src/message.ts`](src/message.ts) | 目标检查与 Session Controller 提示投递 |
| [`src/create.ts`](src/create.ts) | 调用方工作区检查与 Session Controller 创建及可选第一条消息 |
| [`src/presentation.ts`](src/presentation.ts) | 文本结果渲染与工具调用卡片 |

### 操作流

每个读取执行器都会推导调用方、把模型参数归一化为服务过滤条件、针对调用方工作区授权目标（或请求的父 id），并通过服务边界收集结果。两个搜索工具在观察到的 generation 保持有效时通过 Provider 游标内部分页，直到 `maxSearchResults`；由于一次搜索会消耗绑定 generation 的 Provider 游标，两个搜索工具与兄弟工具调用互斥执行，而精确追踪、事件读取与最新回复工具可选择并行执行。最新回复工具观察目标，移除被后续 surface 替换遮蔽的消息，并选择最新的、含文本的当前 assistant 消息。谱系输出会把未授权的祖先与后代边界替换为不含隐藏会话 id 的标记。

消息工具先授权目标 header，拒绝自身或 subagent 目标，然后用新生成的 request id 以 queue 模式调用 `ctx.sessionController.prompt`。Controller 拥有目标恢复、归档执行与收件箱准入；工具只串行化自身的调用并返回接受回执。

创建工具要求调用方自己的 `cwd`，随后以该目录调用 `ctx.sessionController.create`，使新会话以默认预设加入调用方工作区。可选的第一条消息在会话存在后经过同一个 prompt 操作投递；工具串行化自身的调用，并直接报告拒绝而不重试。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

当包级契约不够时阅读这些页面。它们从工具表面移动到下层服务、schema 目录与设计证据。

- [生成的工具目录](../../../docs/tool-catalog.zh.md#deepseek-aidsh-tool-session-query)——模型看到的六个读取 schema 与条件消息、创建 schema。
- [dsh-session-query](../../session-query/session-query/README.zh.md)——这些读取工具调用的服务。
- [dsh-session-query-sqlite](../../session-query/session-query-sqlite/README.zh.md)——两个搜索工具背后的全文后端。
- [dsh-api-session-controller](../../api/session-controller/README.zh.md)——消息工具用于恢复并提示目标的服务。
- [Session Query 子系统参考](../../../docs/subsystems/session-query.zh.md)——工具之下的类型级契约。
- [模型侧会话查询工具](../../../.agents/notes/archived/feature/2026-07-24-model-facing-session-query-tools.md)——工作区授权、无游标结果与 spill 决策。

-----

<a id="model-experience"></a>
## 模型体验

### 系统提示

#### 模型看到什么

模型收到一个固定的早先历史指引区段。启用 `allowSessionMessages` 且存在 Session Controller 时，同一区段会追加一句投递指引；`allowSessionCreate` 会追加一句创建指引。

##### 早先历史指引

```markdown
Use session_search to find relevant work from prior sessions, or session_event_search to search earlier events in one session. Search results are cursor-free and workspace-scoped. Follow a useful hit with session_trace, session_event_trace, or session_event_read when you need lineage, relationships, or exact data. Use session_latest_reply to read the newest reply in an authorized session.
```

##### 投递指引

```markdown
Use session_send_message to deliver a text message to another authorized session; it returns once accepted and does not wait for the reply. Read the answer with session_latest_reply.
```

##### 创建指引

```markdown
Use session_create to start a new session in the caller workspace, optionally with its first message; it returns the new session id once the session is created and does not wait for a reply.
```

#### Token 影响

插件挂载期间，每个请求都有一个固定的简短区段；每个启用的写入工具增加一句话。

#### KV Cache 影响

在插件、指引文本与写入工具可见性不变时，前缀保持稳定。

### 工具 schema

#### 模型看到什么

模型看到生成的[会话查询工具 schema](../../../docs/tool-catalog.zh.md#deepseek-aidsh-tool-session-query)：`session_search`、`session_event_search`、`session_trace`、`session_event_trace`、`session_event_read` 与 `session_latest_reply`，以及启用消息功能时的 `session_send_message`、启用创建功能时的 `session_create`，各自都只在存在 Session Controller 时出现。搜索过滤条件会增加固定 schema token，而游标、工作区路径、输出分页与模型可控结果上限仍然缺席。

#### Token 影响

可见时每个请求发送六个固定只读 schema；每个启用的写入工具增加一个 schema。

#### KV Cache 影响

在工具可见性与定义不变时，前缀保持稳定。

### 工具结果

#### 模型看到什么

每次成功的读取调用输出一个纯文本块。搜索结果包含标题与最佳匹配摘录；追踪包含全部已授权关系；事件读取包含未删节的目标 JSON。最新回复调用输出 JSON，含会话 id、事件序号、回复时间、轮次、受限文本与截断标志。成功的消息调用输出含 `accepted: true` 与目标会话 id 的 JSON。成功的创建调用输出含新会话 id、适用时的预设与第一条消息是否已投递的 JSON。

#### Token 影响

结果依赖数据，并在压缩前保留在已记录的工具历史中；`maxSearchResults` 限制搜索命中数，最新回复文本限制为 20000 字符。

#### KV Cache 影响

仅追加的结果文本跟在可复用请求前缀之后，不会使早先的缓存条目失效。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>


这些限制界定本包何时不适合或需要特殊运维注意。它们是当前包约束，不是任务清单。

- **搜索有上限且无续传**——搜索最多返回部署上限，并在还有更多匹配时要求模型收窄查询；没有续传 token。
- **保守的工作区身份**——工作区身份是精确字符串 `cwd` 相等，因此符号链接等价的路径不共享授权。
- **异步投递**——消息工具只报告接受；没有完成回执、回复等待、重试或重复抑制，目标可能把提示排在正在运行的轮次之后。
- **新建会话使用默认预设**——创建工具不能选择预设，新会话始终运行组合的默认预设；第一条消息在工具返回后才启动该会话的第一个轮次。
- **创建之后的拒绝**——可选的第一条消息被拒绝时，工具报告 `SESSION_CREATE_TOOL_REFUSED`，但会话已经存在；模型在该报告之后重试会再创建一个会话，而不是继续第一个。
- **用户权限投递**——目标收到的是无 principal 的用户提示，因此模型读到的任何内容都可能影响投递；仅在可信所有者控制对话时挂载消息工具。
- **没有 spill 策略时的内联载荷**——没有通用 spill 策略的自定义组合会内联接受完整追踪与事件载荷；只有最新回复文本本身受限。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

本开发备注是维护者的工作上下文：未决的设计问题与方向，尚未决定。它明确非权威——已交付行为、限制与已接受理由位于上述章节、包代码与链接的 Agent Note 中。

#### 未来：更广的工作区语义

精确字符串 `cwd` 相等是刻意保守的；符号链接感知或规范路径的工作区身份会改变哪些会话共享授权，尚未决定。

</details>
