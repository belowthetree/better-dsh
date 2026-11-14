---
description: "桌面外壳的悬浮球形态界面：悬浮球、面板顶栏、语音快捷设置，以及系统级切换命令。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-orb

[English](README.md) | 中文

## 概述

悬浮球形态的客户端插件：一个 `shell.overlay` 条目在 orb 呈现中绘制 112 像素悬浮球、在 panel 呈现中绘制紧凑顶栏；一个 `shell.modal` 条目提供形态自有的语音快捷设置卡片；以及系统级 `orb.toggle` 命令。classic 框架继续渲染会话、输入框、审批与提问；本包只拥有悬浮球与面板界面，以及自己的模态内容。挂载同组服务包时显示采集与朗读状态；未挂载时每个控件照常可用。

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

在声明悬浮球形态的 profile 中加入 `client-ui-orb` 行，并同时挂载 [client-surface](../../client/surface/README.zh.md) 与感知呈现的 [ui-layout](../../client/ui-layout/README.zh.md)。本包注入 `surface`、`slots`、`locale` 与 `shortcuts`；窗口几何、透明、点击穿透与呈现切换由 Desktop 载体拥有，渲染端只报告意图。

overlay 条目跟随载体报告的呈现。处于 `orb` 时绘制一个圆形按钮，其视觉状态以 data 属性发布：`data-orb` 携带 `data-state`（`idle`、`capturing`、`transcribing`、`speaking` 或 `running`）与 `data-reduced-motion`，按钮自身携带 `data-hovered`、`data-pressed` 与 `data-dragging`。每个状态都有自己的本地化无障碍标签。点击展开面板；拖动超过四个逻辑像素后通过 `surface.dragBy` 报告经过节流的位移，并抑制随之产生的点击。指针进入或离开悬浮球及其拖动手柄时报告 `surface.setPointerInside`，载体据此在其他区域放行点击。麦克风采集服务挂载时，悬浮球右下角的小型麦克风按钮可在不打开面板的情况下开始采集，或结束采集并展开面板，让输入框消费暂存的转写。次要点击打开紧凑菜单：固定在顶层或取消固定、静音或取消静音朗读、循环自动朗读策略（关闭、仅语音发起、全部回复）、开始或停止语音采集以及语音设置。菜单在选择、Escape 或点击外部时关闭。菜单不含新建会话或退出项：新建会话留在侧栏，退出由 Desktop 外壳负责。

处于 `panel` 时，条目在 classic 框架上方绘制固定高度顶栏：活动 Session 标题、收起、固定（用快照中的状态经 `surface.setPinned` 报告）与设置；设置通过 `surface.presentModal('orb.quick-setup')` 升起形态自有的快捷设置卡片。拖动标题同样报告经过节流的位移。只有顶栏控件与标题拖柄接收指针输入，因此下方会话仍能收到点击；顶栏是覆盖带，不重新布局框架。处于 `classic` 与 `modal` 时条目渲染为空：没有该形态的 profile 不需要界面，而框架的模态层拥有自己的卡片。

`shell.modal` 条目 `orb.quick-setup` 渲染形态自有卡片：标出所选朗读语音的语音目录、静音开关、自动朗读策略、合成是按次计费的云端请求的说明，以及通过 `surface.dismissModal()` 关闭的按钮。焦点、Escape 与背景仍由框架拥有。朗读插件未挂载时，卡片说明语音输出未挂载而不是提供设置，悬浮球菜单也在静音与策略行的位置显示同样的说明。

`orb.toggle` 是 `scope: 'system'` 命令，没有默认绑定：在设置中的“通用”“全局”分组里分配。解析时若快照为 `orb` 则展开面板，否则收起，因此同一命令既能打开也能隐藏形态。`voice.pushToTalk` 是第二个没有默认绑定的系统级命令：空闲时开始采集，否则结束当前采集，因此全局按键无需面板即可听写。操作系统级注册与冲突报告由 `ctx.shortcuts` 负责。

可选服务让同一套界面可以单独工作。挂载 [client-voice-capture](../client-voice-capture/README.zh.md) 时，悬浮球显示录音与转写阶段；挂载朗读包时显示朗读中、静音、策略与语音目录。缺少任一服务时，悬浮球仍可展开、固定、拖动并打开卡片。

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>维护者信息 — 点击展开</summary>

`apply` 注册一次八种语言词典，然后为每个观察源建立一个快照存储：载体呈现、减少动效媒体查询，以及每个已挂载的语音服务。呈现观察与两个可选语音观察共用一个助手：跟随带 signal 的流写入存储，并随 fiber 中止；可选服务经 `ctx.inject` 观察，因此卸载其中一个就会清空对应存储，界面继续可用。两个条目经 `ctx.slots.inject` 注册：它会等待框架声明，并在该声明收起时移除贡献。命令经 `ctx.shortcuts.register` 注册，其释放函数随插件运行。每条载体命令都从一个闭包发出，包含拒绝并只报告一次。

组件只接收普通数据与回调：`hooks` 分区的源绑定为 `useSurface`、`useCapture`、`useVoice` 与 `useReducedMotion` 选择器 Hook，标准 `useSessions` 座位提供活动 Session 标题与运行状态，`actions` 携带回调。拖动状态、悬停、按下与菜单开关是组件局部状态；拖动 Hook 把指针移动合并为每动画帧一次报告，并在释放时发送剩余位移，这也决定了该手势是否算作拖动。悬浮球菜单用共享的 `MenuSurface` 材质包裹自己的行。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [client-surface](../../client/surface/README.zh.md) —— 本浮层所发的呈现快照与载体命令。
- [ui-layout](../../client/ui-layout/README.zh.md) —— 声明 `shell.overlay`、`shell.modal` 与 panel 呈现的框架。
- [client-voice-capture](../client-voice-capture/README.zh.md) —— 录音状态背后的可选采集服务。
- [桌面外壳形态与悬浮球 profile](../../../.agents/notes/proposed/architecture/2026-11-14-desktop-shell-forms-and-orb-profile.zh.md) —— 本包所属的窗口、呈现与语音设计。

-----

<a id="model-experience"></a>
## 模型体验

无，因为悬浮球、面板顶栏与快捷设置卡片只渲染进程内呈现状态，不贡献模型输入。

#### KV 缓存影响

没有直接影响；每条模型可见消息由普通用户提交拥有。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

- 悬浮球菜单不含新建会话或退出项：新建会话属于侧栏自己的控件，退出由 Desktop 外壳负责。
- 没有提醒徽标。待处理的审批与提问仍在会话内渲染，悬浮球不统计也不加徽标，因此载体基于提醒的展开在本包没有可触发的事件。
- 没有焦点移交。展开面板不会把键盘焦点移入输入框；需要焦点的话，形态所有者应在 `ctx.surface.expand()` 之后自行请求。
- 面板顶栏不重新布局框架。它是覆盖在 classic 框架顶部边缘的固定高度带，因此其下的框架头部会被遮住而不是下移。
- 悬浮球右键菜单渲染在悬浮球窗口内。112 像素的呈现会裁剪它，菜单呈现需要多少空间由载体决定。
- 语音控件依赖同组其他包。缺少朗读包时，静音与自动朗读策略项以及语音目录都不可用，卡片会说明这一点而不是提供设置。
- 仅适用于 Desktop 形态 profile。Web 页面保持 classic 呈现，因此这里没有页面级悬浮球回退。
- 本次变更没有在真实形态窗口中检视渲染后的浅色、深色与减少动效场景；组件行为由驱动属性与插件测试覆盖，整体视觉评审属于形态载体一侧。

-----

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者信息 — 点击展开</summary>

无。

</details>
