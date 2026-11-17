---
description: "Agent output bubbles and the workbench dialog for the Desktop orb form: live agent text above the orb, the conversation without shell side panels."
kind: "package-reference"
---

# @deepseek-ai/dsh-better-interact

[English](README.md) | 中文

## 概述

orb 形态的 agent 交互：一个 `shell.overlay` 条目在悬浮球上方提供历史消息气泡与正在书写的回答；一个 `shell.modal` 条目提供工作台对话框，每个工作区一页，且不带 shell 侧边面板。流式消息气泡升起气泡列并保留到 agent 停止；历史消息气泡跟随悬浮球或气泡列上的指针出现，指针离开二者半秒后气泡列退场。工作台只渲染共享会话内容的 Chat 视图；Ctrl+Tab 切换工作区页面，Ctrl+Alt+W 重新打开最近使用的工作区。

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

在形态声明了 orb 呈现的 profile 中加入 `better-interact` 行，并同时挂载 [client-surface](../../client/surface/README.zh.md)、感知呈现的 [ui-layout](../../client/ui-layout/README.zh.md) 与 [client-ui-workspace](../../client/ui-workspace/README.zh.md)。本包注入 `surface`、`slots`、`locale`、`shortcuts`、`resources`、`sessions`、`workspaces` 与 `uiWorkspace`。

overlay 条目 `better-interact.bubbles` 绑定会话目录中排在第一位的会话，经 `betterinteract` 资源保留它，并且只在载体于气泡列窗口中呈现 `bubbles` 呈现时渲染气泡。两类气泡共用同一套排布：已完成回答的**历史消息气泡**，以及正在书写的回答的**流式消息气泡**。指针进入常驻悬浮球时，历史消息气泡升起气泡列；指针离开悬浮球并且不在气泡列上满半秒后，气泡列退场；指针回到二者之一会取消倒计时。回答文本一出现，流式消息气泡就会自行升起气泡列，并一直保留到 agent 停止，即使指针在别处也一样。指针不在流式气泡列上时只显示流式消息气泡；悬停悬浮球或气泡列会向上展开历史。每个气泡最多预览七行，并以省略号标出被省略的余下内容；相邻气泡间隔 230 毫秒从右侧弹入与弹出，悬停时微微浮起。气泡列位于自己的窗口中，悬浮球与 surface 窗口各自保有自己的窗口，因此任何呈现都不会取代另一者。点击任一气泡打开工作台，载体把它盖在 surface 窗口之上，关闭时恢复原来的呈现；打开的工作台会保持气泡列，关闭后恢复半秒规则。

模态条目 `better-interact.workbench` 为目录中的每个工作区提供一页，按目录顺序以 Fluent 标签片排列在共享会话内容之上；会话内容以 embedded 变体、且只带 Chat 视图，因此没有侧边栏、右面板或标题栏。活动页的卡片底部带强调色指示条；点击卡片显示该工作区的页面，卡片条过长时横向滚动。页面显示它记录的 Session（该工作区在主视图中保留的 Session），没有记录时显示该工作区最新的 Session；没有 Session 的工作区在激活其页面时连接空白会话。命令 `betterInteract.workbench` 默认绑定 Windows 与 macOS 的 Ctrl+Alt+W，打开最近使用的页面；`betterInteract.workbench.next` 与 `betterInteract.workbench.previous` 默认绑定 Ctrl+Tab 与 Shift+Ctrl+Tab，在对话框打开时循环切换页面。点击消息气泡打开它所属 Session 的页面。在 Windows 与 macOS 的 Desktop 上，已打开的工作台中按 Ctrl+N 会在活动页面的工作区里创建新会话：页面激活会先把该工作区的 Session 设为工作台主视图，共享的新建会话命令据此在该工作区创建会话，页面随后记录新会话。页面持久化活动页与每页记录的 Session，因此重新打开对话框会回到上次使用的页面。对话框标记自身为 `data-shell-modal-fill` 与 `data-shell-modal-surface="bare"`，框架因此把对话框高度交给它，卡片则立在透明窗口上、位于会话面板上方；它向载体申请工作区高度的五分之四，会话面板自行滚动转录本。目录为空时对话框显示空状态且不渲染卡片条。

<a id="understand-the-implementation"></a>
## 了解实现

气泡文本来自绑定会话的 Chat 目标：每个已加载轮次一条，取自它的导航预览；agent 书写时追加部分累加器中的流式前缀。最新的实时部分就是流式消息气泡；每个已提交的 assistant 消息是历史消息气泡，气泡带有 `data-kind` 以便区分两类。气泡列在单个组件内安排顺序：每个气泡带有按位置计算的动画延迟，因此气泡列从最新回答向外依次从右侧弹入与弹出。只有在悬浮球与气泡列都不被悬停、没有正在进行的运行、且工作台模态未打开时，半秒离开计时才会启动；输出进行期间气泡列保持，流式消息气泡持续显示。运行期间消息提交后，其气泡转为历史消息气泡，气泡列在剩余运行期间保持。预览辅助函数把气泡限制在七行或 190 个字符以内，并为被省略的内容追加省略号；工作台始终显示完整回答。`surface.presentBubbles()` 与 `surface.dismissBubbles()` 是该条目发出的唯一载体命令，因此没有形态载体的 profile 保持 classic 呈现。每个渲染进程为自己窗口报告指针活动：悬浮球窗口报告悬浮球悬停，气泡列窗口报告指针是否在列上。主进程把该悬停状态发布到每份 surface 快照；悬浮球窗口的 overlay 在该值变为 true 时申请气泡列，悬浮球窗口的气泡栈则在流式回答出现时申请气泡列。悬浮球窗口为这两个触发点保持气泡栈挂载；气泡列窗口只在列升起时挂载气泡栈，surface 窗口不渲染。气泡列独立于 surface 呈现，因此已打开的 panel 或模态既不取代它，也不关闭它。

工作台经 `renderFactorySlot` 复用 `conversation.content`，而不是自行拼装转录各部分；只有视图环被替换为 Chat 视图，这正是去掉侧边面板而不分叉会话的原因。页面是 `dsh.better-interact.workbench-pages.v1` 下的持久化快照存储：保存活动工作区与每页记录的 Session，而卡片本身来自工作区目录。激活页面时经注入的 `uiWorkspace` 导航服务打开其记录（或最新）的 Session；没有 Session 的工作区以同样方式连接空白会话。插件把主视图保留的 Session 记录到其工作区页面，并在对话框打开时选中该页面；对话框关闭时只记录 Session。两个目录都会清理引用的页面与 Session 记录。模态条目通过注入面取得页面存储与选中动作；框架把活动模态 id 作为快捷键上下文发布，因此切换命令只在该对话框内解析。`bubbles` 呈现、它的窗口几何与点击穿透都在 `apps/desktop` 中，插件只负责申请它。

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
- 卡片条展示目录中的所有工作区；激活没有 Session 的工作区会连接其空白会话，可能因此创建 Session。
- 每页按工作区记录一个 Session；主视图保留的 Session 会替换该记录，因此在其他入口打开的 Session 会成为该页的 Session，而不是独立页面。
- 页面存储是形态各渲染进程共享的浏览器存储；只有 surface 窗口会修改它，因此悬浮球与气泡列渲染进程在重新加载前持有旧副本。
- Ctrl+Tab 仅在 Windows 与 macOS 的 Desktop 上绑定；orb profile 运行期间即使对话框已关闭，Desktop 主进程也会消费该组合键。
