---
description: "桌面 orb 形态的 agent 界面：悬浮球上方的环境化回答气泡，以及带会话书签与键盘快捷键的悬浮工作区页面工作台。"
kind: "package-reference"
---

# @deepseek-ai/dsh-better-interact

[English](README.md) | 中文

## 概述

Better DSH 让 agent 成为桌面上的常驻存在。回答以气泡形式在悬浮球旁升起，漫画式对话气泡会报告等待权限、回答或计划确认的会话。Ctrl+Alt+W 打开一个悬浮工作台，管理对话排在最前，每个工作区一页，每个会话一个书签。键盘优先：Ctrl+Tab 切换页面，Ctrl+Q 进入会话导航，Ctrl+Alt+N 添加工作区；书签菜单可归档或删除会话。它复用 shell 的会话内容，因此转录、工具与输入框保持不变。它是 Desktop orb 形态的体验，不替代 classic shell。

## 目录

- [使用本包](#use-this-package)
- [了解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

Better DSH 基于三个理念。**存在感优于导航**：全天使用的 agent 不应藏在窗口后面，因此悬浮球常驻，工作台在它之上打开。**环境化输出**：正在书写的回答以流式气泡在悬浮球旁升起，已完成的回答加入那里的历史，因此查看进度不需要切换窗口。**工作区即工作单元**：工作台在全部真实工作区之前为管理对话提供一页，每页的会话成为会话面板旁的书签。

悬浮球常驻桌面。指针进入会升起历史气泡列；流式回答会自行升起它，并保持到 agent 停止。有待处理的请求时，同一列会以对话气泡形式升起它，并保持到请求被处理；点击气泡会打开该会话所在的工作台页面。历史气泡同样打开这个工作台，它盖在 surface 窗口之上，关闭时恢复之前的呈现。

点击悬浮球会打开 `orb.chat`，在聚焦的输入框中向管理对话提问。接受提问后会打开单 Session 的 `orb.workbench`；其输入框、转录本、工具、审批与提问都来自共享 Conversation 包。快捷提问、专用工作台与管理页通过一个控制器解析 Session，并保留现有 `dsh.orb.management-session.v2` 偏好。新建时优先使用 Host 默认工作区，不可用时复用主视图 Session 所属的已注册工作区；两者都不可用时经现有提问框或工作台错误提示失败，不创建未注册的管理 Session。挂载对应兄弟服务后会显示语音输入与播放状态。

工作台是宽大的无边框表面：管理对话与工作区页面的 Fluent 卡片位于居中的会话面板上方，该页的会话以书签卡片排列在面板左侧外部。管理页始终排在卡片条最前；工作区增多时，卡片条可用滚轮、触控板或方向键横向滚动。当前会话带强调色条；键盘光标带独立的选中环。Ctrl+Tab 与 Shift+Ctrl+Tab 循环切换页面。Ctrl+Q 把焦点移到书签；方向键移动选中环但不切换会话，回车打开焦点所在的会话。Ctrl+Alt+N 选择文件夹并添加或复用工作区页面，Ctrl+N 在活动页面的工作区里创建会话。悬停卡片或书签会显示完整名称与绑定快捷键。重新打开对话框时会恢复上次的页面与会话。

### 何时选择

在希望 agent 始终在场、不借助 classic shell 就能用键盘抵达会话的 Desktop 工作流中选择 Better DSH。若侧边栏、面板与标题栏是工作流的一部分，或没有 orb 呈现，则选择 classic shell，或直接组合 [ui-conversation](../../client/ui-conversation/README.zh.md)。

### 最小配置

在形态声明了 orb 呈现的 profile 中加入 `better-interact` 行，并同时挂载 [client-surface](../../client/surface/README.zh.md)、感知呈现的 [ui-layout](../../client/ui-layout/README.zh.md) 与 [client-ui-workspace](../../client/ui-workspace/README.zh.md)。本包注入 `surface`、`slots`、`locale`、`shortcuts`、`resources`、`sessions`、`workspaces`、`uiWorkspace`、`uiSession` 与 `theme`，读取可选的设置和语音服务，不接受配置字段。

<a id="understand-the-implementation"></a>
## 了解实现

<details>
<summary>实现内部细节——点击展开</summary>

插件贡献悬浮球 overlay、快捷提问、专用管理工作台、通用工作台与气泡列。气泡列读取正在运行或最近产生输出的会话的 Chat 目标，并保持运行中的目标直到它停止；已提交的 assistant 消息成为历史气泡，实时部分则是流式气泡。气泡栈在一个组件内安排顺序与半秒离开规则，并通过 `surface.presentBubbles()` 与 `surface.dismissBubbles()` 向载体申请 `bubbles` 呈现。该条目还发布 `ctx.uiSession.pendingInteractions`；气泡栈把优先级最高的请求投影为一条提醒，以带指向悬浮球尾巴的最后一个气泡呈现，等待期间保持气泡列可见，点击即打开相应会话。

工作台经 `renderFactorySlot` 复用 `conversation.content`，只把视图环替换为 Chat 视图；这正是去掉 shell 外观而不分叉会话的原因。页面是 `dsh.better-interact.workbench-pages.v1` 下的持久化快照存储：保存活动页面与每页记录的 Session。合成的管理页不是工作区：它由记录预设为 `manage` 的 Session 摘要推导，始终排在卡片条最前，并把这些 Session 从其真实工作区页面移除。激活页面时经注入的 `uiWorkspace` 导航服务打开其记录（或最新）的 Session；没有 Session 的工作区以同样方式连接空白会话，没有会话的管理页则按 `manage` 预设在 Host 默认工作区或已注册的当前工作区新建一个管理对话。插件把主视图保留的 Session 记录到其页面，在对话框打开时选中该页面，并用页面与会话目录清理失效的页面与 Session 记录。聚焦命令只递增对话框注入面里的计数器；组件移动焦点、以本地状态绘制光标环，并在回车时打开焦点会话。快捷键提示来自快捷键目录中的有效条目。

surface 渲染进程拥有页面写入、Session 导航以及真实的采集和播放服务。悬浮球与气泡渲染进程通过 `ctx.surface` 发送有界意图；主渲染进程只返回悬浮球所需的采集阶段与朗读状态投影。音频和完整录音状态留在主渲染进程，悬浮球重新加载后可请求恢复快照。

| 区域 | 源码 |
|---|---|
| 条目、命令与页面 | [src/client/index.ts](src/client/index.ts) |
| Orb 条目与命令 | [src/client/orb.ts](src/client/orb.ts) |
| 共享管理 Session | [src/client/management-session.ts](src/client/management-session.ts) |
| 共享嵌入式 Conversation | [src/client/embedded-conversation.tsx](src/client/embedded-conversation.tsx) |
| 气泡列 | [src/client/bubbles.tsx](src/client/bubbles.tsx) |
| 提醒投影 | [src/client/reminders.ts](src/client/reminders.ts) |
| 工作台对话框 | [src/client/workbench.tsx](src/client/workbench.tsx) |
| 页面存储 | [src/client/workbench-pages.ts](src/client/workbench-pages.ts) |
| Desktop 窗口与呈现 | [apps/desktop](../../../apps/desktop/README.zh.md) |

</details>

<a id="further-exploration"></a>
## 进一步探索

- [client-surface](../../client/surface/README.zh.md)：呈现协议与载体服务。
- [ui-layout](../../client/ui-layout/README.zh.md)：渲染 overlay 与模态层的框架。
- [ui-conversation](../../client/ui-conversation/README.zh.md)：会话目标与视图契约。
- [Orb 实现](src/client/orb.ts)：常驻悬浮球、快捷提问、专用工作台与系统命令。

<a id="model-experience"></a>
## 模型体验

无，因为本包不发送模型请求、不注册工具，也不增加模型可见输入。

#### KV Cache 影响

无直接影响；气泡列与工作台只读取转录本已经渲染的会话事件。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

- 快捷对话框没有转录本；接受的提问会打开专用管理工作台，由它持有历史与后续输入。
- 专用 `orb.workbench` 刻意只显示一个 Session，没有工作区卡片条或会话书签；这些属于通用工作台。
- 语音控制与播放状态依赖兄弟采集和播放服务；没有这些服务时，提问框与悬浮球仍保留文本和指针行为。
- 气泡列一次只报告一个会话：优先运行活动，其次最近完成的输出；运行中的目标保持稳定直到它停止。
- 气泡列有自己的窗口，因此 panel 或模态呈现不会取代它；在工作台模态打开期间申请的气泡列会在模态关闭后出现。
- 在首个回答文本出现之前的纯工具阶段不显示流式消息气泡；回答文本出现时气泡列才升起。
- 历史只覆盖已加载窗口中的轮次预览，因此在转录本中继续向前滚动不会扩充它。
- 卡片条始终以管理对话页开头，然后是目录中的所有工作区；没有可见滚动条，长卡片条用滚轮、触控板或方向键横向滚动。
- 管理页是工作台的分组，不是工作区：它的 Session 保留真实工作区的 cwd 与成员关系。没有管理 Session 时激活该页会在 Host 默认工作区新建管理对话，默认工作区不可用时复用主视图 Session 所属的已注册工作区；两者都无法解析时创建会显示失败，不创建未注册的 Session。
- 激活没有 Session 的工作区会连接其空白会话，可能因此创建 Session。
- 对话气泡一次只报告一条请求：优先级最高的待处理交互（权限、计划确认、提问），其余以数量提示。尾巴指向卡片条右缘，也就是悬浮球通常所在的位置。
- 气泡只报告待处理交互；未读的完成回答仍留在输出气泡中。
- 每页按工作区记录一个 Session；主视图保留的 Session 会替换该记录，因此在其他入口打开的 Session 会成为该页的 Session，而不是独立页面。
- Ctrl+Tab、Ctrl+Q 与 Ctrl+Alt+N 仅在 Windows 与 macOS 的 Desktop 上绑定；orb profile 运行期间即使对话框已关闭，Desktop 主进程也会消费这些组合键。

<a id="dev-note"></a>
### 开发备注

气泡列的时序常量由组件测试用假定时器驱动；提醒投影有独立测试；`bubbles` 窗口角色、气泡列呈现与工作台保持规则由 Desktop 的 surface-controller 测试覆盖。
