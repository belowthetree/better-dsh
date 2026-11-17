---
description: "Agent output bubbles and the workbench dialog for the Desktop orb form: live agent text above the orb, the conversation without shell side panels."
kind: "package-reference"
---

# @deepseek-ai/dsh-better-interact

[English](README.md) | 中文

## 概述

orb 形态的 agent 交互：一个 `shell.overlay` 条目在悬浮球上方提供已完成回答的历史消息气泡，以及正在书写的回答的流式消息气泡；一个 `shell.modal` 条目提供不带 shell 侧边面板的工作台对话框。流式消息气泡会升起气泡列并保留到 agent 停止；历史消息气泡在指针位于悬浮球或气泡列上时出现，指针离开二者半秒后气泡列退场。气泡从右侧弹入与弹出，最新的在前。工作台只渲染共享会话内容的 Chat 视图，另有一条可重新绑定的命令打开它。

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

在形态声明了 orb 呈现的 profile 中加入 `better-interact` 行，并同时挂载 [client-surface](../../client/surface/README.zh.md) 与感知呈现的 [ui-layout](../../client/ui-layout/README.zh.md)。本包注入 `surface`、`slots`、`locale`、`shortcuts`、`resources` 与 `sessions`。

overlay 条目 `better-interact.bubbles` 绑定会话目录中排在第一位的会话，经 `betterinteract` 资源保留它，并且只在载体于气泡列窗口中呈现 `bubbles` 呈现时渲染气泡。两类气泡共用同一套排布：已完成回答的**历史消息气泡**，以及正在书写的回答的**流式消息气泡**。指针进入常驻悬浮球时，历史消息气泡升起气泡列；指针离开悬浮球并且不在气泡列上满半秒后，气泡列退场；指针回到二者之一会取消倒计时。回答文本一出现，流式消息气泡就会自行升起气泡列，并一直保留到 agent 停止，即使指针在别处也一样。指针不在流式气泡列上时只显示流式消息气泡；悬停悬浮球或气泡列会向上展开历史。每个气泡最多预览七行，并以省略号标出被省略的余下内容；相邻气泡间隔 230 毫秒从右侧弹入与弹出，悬停时微微浮起。气泡列位于自己的窗口中，悬浮球与 surface 窗口各自保有自己的窗口，因此任何呈现都不会取代另一者。点击任一气泡打开工作台，载体把它盖在 surface 窗口之上，关闭时恢复原来的呈现；打开的工作台会保持气泡列，关闭后恢复半秒规则。

模态条目 `better-interact.workbench` 为目录中的当前会话渲染工作台对话框：共享会话内容以 embedded 变体、且只带 Chat 视图，因此没有侧边栏、右面板或标题栏。对话框标记自身为 `data-shell-modal-fill`，框架因此把对话框高度交给卡片；对话框向载体申请工作区高度的五分之四，并自行滚动转录本。命令 `betterInteract.workbench` 默认绑定 Windows 与 macOS 的 Ctrl+Alt+W，打开同一个对话框，并可在设置中重新绑定。在 Windows 与 macOS 的 Desktop 上，已打开的工作台中按 Ctrl+N 会开启新的工作台会话：共享的新建会话命令创建新会话，而不是重新打开被对话框遮住的空白会话，对话框随后跟随目录切到该会话。目录为空时对话框渲染空状态而不是会话。

<a id="understand-the-implementation"></a>
## 了解实现

气泡文本来自绑定会话的 Chat 目标：每个已加载轮次一条，取自它的导航预览；agent 书写时追加部分累加器中的流式前缀。最新的实时部分就是流式消息气泡；每个已提交的 assistant 消息是历史消息气泡，气泡带有 `data-kind` 以便区分两类。气泡列在单个组件内安排顺序：每个气泡带有按位置计算的动画延迟，因此气泡列从最新回答向外依次从右侧弹入与弹出。只有在悬浮球与气泡列都不被悬停、没有正在进行的运行、且工作台模态未打开时，半秒离开计时才会启动；输出进行期间气泡列保持，流式消息气泡持续显示。运行期间消息提交后，其气泡转为历史消息气泡，气泡列在剩余运行期间保持。预览辅助函数把气泡限制在七行或 190 个字符以内，并为被省略的内容追加省略号；工作台始终显示完整回答。`surface.presentBubbles()` 与 `surface.dismissBubbles()` 是该条目发出的唯一载体命令，因此没有形态载体的 profile 保持 classic 呈现。每个渲染进程为自己窗口报告指针活动：悬浮球窗口报告悬浮球悬停，气泡列窗口报告指针是否在列上。主进程把该悬停状态发布到每份 surface 快照；悬浮球窗口的 overlay 在该值变为 true 时申请气泡列，悬浮球窗口的气泡栈则在流式回答出现时申请气泡列。悬浮球窗口为这两个触发点保持气泡栈挂载；气泡列窗口只在列升起时挂载气泡栈，surface 窗口不渲染。气泡列独立于 surface 呈现，因此已打开的 panel 或模态既不取代它，也不关闭它。

工作台经 `renderFactorySlot` 复用 `conversation.content`，而不是自行拼装转录各部分；只有视图环被替换为 Chat 视图，这正是去掉侧边面板而不分叉会话的原因。`bubbles` 呈现、它的窗口几何与点击穿透都在 `apps/desktop` 中，插件只负责申请它。

<a id="further-exploration"></a>
## 进一步探索

- [client-surface](../../client/surface/README.zh.md)：呈现协议与载体服务。
- [ui-layout](../../client/ui-layout/README.zh.md)：渲染 overlay 与模态层的框架。
- [ui-conversation](../../client/ui-conversation/README.zh.md)：会话目标与视图契约。
- [client-ui-orb](../client-ui-orb/README.zh.md)：气泡列可见时代其位置的 orb 外观。


<a id="dev-note"></a>
## 开发备注

气泡列的时序常量由组件测试用假定时器驱动；`bubbles` 窗口角色、气泡列呈现与工作台保持规则由 Desktop 的 surface-controller 测试覆盖。

<a id="model-experience"></a>
## 模型体验

无，因为本包不发送模型请求、不注册工具，也不增加模型可见输入。

#### KV Cache 影响

无直接影响；气泡列与工作台只读取转录本已经渲染的会话事件。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与后续工作

- 气泡列只报告会话目录中排在第一位的会话；若另一个会话在目录中排在其后产出输出，不会被报告。
- 气泡列有自己的窗口，因此 panel 或模态呈现不会取代它；在工作台模态打开期间申请的气泡列会在模态关闭后出现。
- 在首个回答文本出现之前的纯工具阶段不显示流式消息气泡；回答文本出现时气泡列才升起。
- 历史只覆盖已加载窗口中的轮次预览，因此在转录本中继续向前滚动不会扩充它。
