---
description: "Agent output bubbles and the workbench dialog for the Desktop orb form: live agent text above the orb, the conversation without shell side panels."
kind: "package-reference"
---

# @deepseek-ai/dsh-better-interact

[English](README.md) | 中文

## 概述

orb 形态的 agent 交互：一个 `shell.overlay` 条目把 agent 输出以悬浮球上方的气泡列形式呈现，一个 `shell.modal` 条目把当前会话托管在工作台对话框中、不带 shell 的侧边面板。气泡列显示正在书写的回答，从最新回答向外依次入场与退场，指针停留时保持并向上展开此前的回答。工作台只渲染共享会话内容的 Chat 视图，另有一条可重新绑定的命令打开它。

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

overlay 条目 `better-interact.bubbles` 绑定会话目录中排在第一位的会话，经 `betterinteract` 资源保留它，并且只在载体呈现 `bubbles` 呈现时渲染气泡。agent 流式回答期间，该条目向载体申请该呈现；载体把气泡列放在悬浮球自有窗口的上方且不抢占焦点，因此用户在其他应用中操作时它也能出现。气泡列把最新回答画成一张卡片。气泡从最新回答向外依次入场，悬停的气泡会微微浮起。指针停在气泡列上会向上展开此前的回答并保持展开；指针离开后，每个气泡按同样顺序退场，随后气泡列关闭。指针从未进入过的气泡列在输出结束后等待一小段静默时间，再以同样方式退场。指针在常驻悬浮球窗口上的活动会向载体申请同一个气泡列并直接展开历史；气泡列渲染在 surface 窗口中，而悬浮球保有自己的窗口，两者互不取代。点击任一气泡打开工作台，载体把它盖在 surface 窗口之上，关闭时恢复原来的呈现。

模态条目 `better-interact.workbench` 为目录中的当前会话渲染工作台对话框：共享会话内容以 embedded 变体、且只带 Chat 视图，因此没有侧边栏、右面板或标题栏。对话框标记自身为 `data-shell-modal-fill`，框架因此把对话框高度交给卡片；对话框向载体申请工作区高度的五分之四，并自行滚动转录本。命令 `betterInteract.workbench` 默认绑定 Windows 与 macOS 的 Ctrl+Alt+W，打开同一个对话框，并可在设置中重新绑定。目录为空时对话框渲染空状态而不是会话。

<a id="understand-the-implementation"></a>
## 了解实现

气泡文本来自绑定会话的 Chat 目标：每个已加载轮次一条，取自它的导航预览；agent 书写时追加部分累加器中的流式前缀。气泡列在单个组件内安排顺序：每个气泡带有按位置计算的动画延迟，因此气泡列从最新回答向外依次入场与退场；指针进入会取消正在进行的退场，一个计时器在最后一个气泡离开后请求载体关闭。`surface.presentBubbles()` 与 `surface.dismissBubbles()` 是该条目发出的唯一载体命令，因此没有形态载体的 profile 保持 classic 呈现。悬停请求来自悬浮球窗口的渲染进程，它只为快照的 `orb` 角色报告指针活动；主进程把命令路由到 surface 窗口的呈现，气泡列不会取代已打开的 panel 或模态呈现。

工作台经 `renderFactorySlot` 复用 `conversation.content`，而不是自行拼装转录各部分；只有视图环被替换为 Chat 视图，这正是去掉侧边面板而不分叉会话的原因。`bubbles` 呈现、它的窗口几何与点击穿透都在 `apps/desktop` 中，插件只负责申请它。

<a id="further-exploration"></a>
## 进一步探索

- [client-surface](../../client/surface/README.zh.md)：呈现协议与载体服务。
- [ui-layout](../../client/ui-layout/README.zh.md)：渲染 overlay 与模态层的框架。
- [ui-conversation](../../client/ui-conversation/README.zh.md)：会话目标与视图契约。
- [client-ui-orb](../client-ui-orb/README.zh.md)：气泡列可见时代其位置的 orb 外观。


<a id="dev-note"></a>
## 开发备注

气泡列的时序常量由组件测试用假定时器驱动；`bubbles` 呈现及其窗口几何由 Desktop 的 form-window 与 surface-controller 测试覆盖。

<a id="model-experience"></a>
## 模型体验

无，因为本包不发送模型请求、不注册工具，也不增加模型可见输入。

#### KV Cache 影响

无直接影响；气泡列与工作台只读取转录本已经渲染的会话事件。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与后续工作

- 气泡列只报告会话目录中排在第一位的会话；若另一个会话在目录中排在其后产出输出，不会被报告。
- 气泡列渲染在 surface 窗口中；该窗口中的 panel 或模态呈现不会被悬停的悬浮球取代。
- 悬停请求只在指针离开悬浮球窗口时重新武装，因此停在悬浮球上的指针不会重新打开刚刚退场的气泡列。
- 由悬停悬浮球打开、但指针从未进入的气泡列会在静默时间后离开：surface 窗口看不到停在悬浮球窗口上的指针。
- 历史只覆盖已加载窗口中的轮次预览，因此在转录本中继续向前滚动不会扩充它。
