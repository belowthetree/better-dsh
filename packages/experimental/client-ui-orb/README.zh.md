---
description: "桌面外壳的悬浮球形态界面：悬浮球、居中对话框、语音快捷设置，以及系统级命令。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-orb

[English](README.md) | 中文

## 概述

悬浮球形态的客户端插件：一个 `shell.overlay` 条目绘制 112 像素悬浮球，两个 `shell.modal` 条目分别提供形态自有的居中对话框与语音快捷设置卡片，以及系统级 `orb.toggle` 与 `voice.pushToTalk` 命令。悬浮球 profile 不渲染 classic 框架：点击悬浮球升起对话框，提问发送到会话目录并在接受后关闭；挂载同组服务包时显示采集与朗读状态。对话框的语音开关使用共享采集服务录音，并把识别出的文字追加到输入末尾而不是直接发送。

## 目录

- [使用此包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用此包

在声明悬浮球形态的 profile 中加入 `client-ui-orb` 行，并同时挂载 [client-surface](../../client/surface/README.zh.md) 与感知呈现的 [ui-layout](../../client/ui-layout/README.zh.md)。本包注入 `surface`、`slots`、`locale`、`shortcuts` 与 `sessions`；窗口几何、透明、点击穿透与呈现切换由 Desktop 载体拥有，渲染端只报告意图。

overlay 条目跟随载体报告的呈现。处于 `orb` 时绘制一个圆形按钮，其视觉状态以 data 属性发布：`data-orb` 携带 `data-state`（`idle`、`capturing`、`transcribing`、`speaking` 或 `running`）与 `data-reduced-motion`，按钮自身携带 `data-hovered`、`data-pressed` 与 `data-dragging`。每个状态都有自己的本地化无障碍标签。点击升起居中对话框；拖动超过四个逻辑像素后通过 `surface.dragBy` 报告经过节流的位移，并抑制随之产生的点击。指针进入或离开悬浮球及其拖动手柄时报告 `surface.setPointerInside`，载体据此在其他区域放行点击。麦克风采集服务挂载时，悬浮球右下角的小型麦克风按钮可在不打开对话框的情况下开始采集，或结束采集并升起对话框，由输入框接收暂存的转写。次要点击打开紧凑菜单：固定在顶层或取消固定、静音或取消静音朗读、循环自动朗读策略（关闭、仅语音发起、全部回复）、开始或停止语音采集以及语音设置。菜单在选择、Escape 或点击外部时关闭。菜单不含新建会话或退出项：新建会话留在侧栏，退出由 Desktop 外壳负责。处于 `panel`、`modal` 与 `classic` 时条目渲染为空：panel 呈现只承载外壳自有的浮层，对话框容器由框架的模态层拥有，而没有该形态的 profile 不需要界面。

`shell.modal` 条目 `orb.chat` 在框架变暗且带焦点陷阱的模态层中渲染对话框：一个自动获得焦点的文本域、一个语音输入开关与一个发送按钮。对话框绘制自己的表面——一层从输入框往外渐隐的柔和填充——并把框架的模态卡片标记为无衬底，因此框架只保留遮罩、焦点陷阱与关闭行为。Enter 提交，Shift+Enter 换行，Escape 或点击背景经框架关闭呈现。提交成功会清空并关闭对话框；被拒绝时保留文字，并在框内显示本地化的失败提示。提问经注入的 `sessions` 服务发送到最近编目的 Session，目录为空时创建一个空白 Session。麦克风采集服务挂载时，语音开关开始录音，显示请求麦克风、录音与转写状态，并在结束后把转写追加到输入末尾，既不插入分隔符也不提交；未挂载该服务时开关不出现，对话框仍可作为普通提问框使用。录音期间关闭对话框会丢弃本对话框发起的录音。

`shell.modal` 条目 `orb.quick-setup` 渲染形态自有卡片：标出所选朗读语音的语音目录、静音开关、自动朗读策略、合成是按次计费的云端请求的说明，以及通过 `surface.dismissModal()` 关闭的按钮。焦点、Escape 与背景仍由框架拥有。朗读插件未挂载时，卡片说明语音输出未挂载而不是提供设置，悬浮球菜单也在静音与策略行的位置显示同样的说明。

`orb.open` 是 `scope: 'system'` 命令，在 Windows 与 macOS 上默认绑定 Ctrl+Alt+D：它升起对话框并聚焦输入框，对话框已打开时再次触发不会关闭它。可在“设置 → 通用 → 全局”中改绑；Linux 保留聚焦窗口模型，不提供操作系统级注册。`orb.toggle` 是第二个没有默认绑定的系统级命令：解析时若快照为 `orb` 则升起对话框，若处于模态呈现则关闭它，处于 panel 呈现则收回悬浮球，因此同一命令既能打开也能隐藏形态。`voice.pushToTalk` 是第三个没有默认绑定的系统级命令：空闲时开始采集，否则结束当前采集，因此全局按键无需打开对话框即可听写。操作系统级注册与冲突报告由 `ctx.shortcuts` 负责。

可选服务让同一套界面可以单独工作。挂载 [client-voice-capture](../client-voice-capture/README.zh.md) 时，悬浮球显示录音与转写阶段，对话框提供语音开关；挂载朗读包时显示朗读中、静音、策略与语音目录。缺少任一服务时，悬浮球仍可展开、拖动并提交提问。

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>维护者信息 — 点击展开</summary>

`apply` 注册一次八种语言词典，然后为每个观察源建立一个快照存储：载体呈现、减少动效媒体查询，以及每个已挂载的语音服务。呈现观察与两个可选语音观察共用一个助手：跟随带 signal 的流写入存储，并随 fiber 中止；可选服务经 `ctx.inject` 观察，因此卸载其中一个就会清空对应存储，界面继续可用。三个条目经 `ctx.slots.inject` 注册：它会等待框架声明，并在该声明收起时移除贡献。命令经 `ctx.shortcuts.register` 注册，其释放函数随插件运行。一次提交用本包的 `orbPrompt` 引用来源经 `ctx.sessions.using` 保留目标，然后调用 `prompt(content, 'queue')`；对话框不显示乐观转写，因此不注册本地提交回显。每条载体命令都从一个闭包发出，包含拒绝并只报告一次。

组件只接收普通数据与回调：`hooks` 分区的源绑定为 `useSurface`、`useCapture`、`useVoice` 与 `useReducedMotion` 选择器 Hook，标准 `useSessions` 座位提供运行状态，`actions` 携带回调。overlay 注入面携带 `openChat`、拖动与菜单命令以及 `toggleVoice`；对话框注入面另外携带基于共享采集服务的 `takeTranscript`、`submit`、`dismiss` 与听写命令，因此对话框从不拥有录音器。拖动状态、悬停、按下与菜单开关是组件局部状态；拖动 Hook 把指针移动合并为每动画帧一次报告，并在释放时发送剩余位移，这也决定了该手势是否算作拖动。对话框的文字、提交失败与听写提示是组件局部状态；追加转写是输入框之外对该文字的唯一写入。悬浮球菜单用共享的 `MenuSurface` 材质包裹自己的行。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [client-surface](../../client/surface/README.zh.md) —— 本浮层所发的呈现快照与载体命令。
- [ui-layout](../../client/ui-layout/README.zh.md) —— 声明 `shell.overlay` 与 `shell.modal` 并拥有模态呈现的框架。
- [client-voice-capture](../client-voice-capture/README.zh.md) —— 录音状态背后的可选采集服务。
- [桌面外壳形态与悬浮球 profile](../../../.agents/notes/proposed/architecture/2026-11-14-desktop-shell-forms-and-orb-profile.zh.md) —— 本包所属的窗口、呈现与语音设计。

-----

<a id="model-experience"></a>
## 模型体验

无，因为悬浮球、对话框与快捷设置卡片只渲染进程内呈现状态，不贡献模型输入。

#### KV 缓存影响

没有直接影响；每条模型可见消息由普通用户提交拥有。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

- 悬浮球菜单不含新建会话或退出项：新建会话属于侧栏自己的控件，退出由 Desktop 外壳负责。
- 没有提醒徽标。待处理的审批与提问仍在会话内渲染，悬浮球不统计也不加徽标，因此载体基于提醒的展开在本包没有可触发的事件。
- 不显示回复文本。对话框只提供提问入口；会话历史与助手回复不进入该形态，语音朗读是形态内唯一能听到回答的方式。
- 悬浮球右键菜单渲染在悬浮球窗口内。112 像素的呈现会裁剪它，因此在悬浮球呈现中无法点到菜单条目；载体若为菜单呈现留出更多空间即可访问，在此之前语音设置不可达。
- 语音控件依赖同组其他包。缺少朗读包时，静音与自动朗读策略项以及语音目录都不可用，卡片会说明这一点而不是提供设置；缺少采集包时对话框没有语音开关。
- 仅适用于 Desktop 形态 profile。Web 页面保持 classic 呈现，因此这里没有页面级悬浮球回退。
- 没有在组装后的形态窗口中检视浅色主题与减少动效场景；深色主题下的悬浮球、对话框、菜单与 Escape 切换由驱动组件与插件测试覆盖，浅色与减少动效评审仍属于形态载体一侧。

-----

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者信息 — 点击展开</summary>

无。

</details>
