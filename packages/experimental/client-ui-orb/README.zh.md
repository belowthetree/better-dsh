---
description: "桌面外壳的悬浮球形态界面：悬浮球、居中对话框，以及系统级命令。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-orb

[English](README.md) | 中文

## 概述

悬浮球形态的客户端插件：带形象与主题菜单的悬浮球浮层、居中快捷对话框（提问被接受后在同一 `manage` 管理对话上升起管理工作台），以及系统级 `orb.toggle`、`orb.workbench` 与 `voice.pushToTalk` 命令。悬浮球 profile 不渲染 classic 框架；挂载同组服务包时显示采集与朗读状态。对话框的语音开关使用共享采集服务录音，并把识别出的文字追加到输入末尾而不是直接发送。

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

在声明悬浮球形态的 profile 中加入 `client-ui-orb` 行，并同时挂载 [client-surface](../../client/surface/README.zh.md) 与感知呈现的 [ui-layout](../../client/ui-layout/README.zh.md)。本包注入 `surface`、`slots`、`locale`、`shortcuts`、`sessions` 与 `theme`，并读取可选的 `workspaces` 与 `settingsUi` 服务，把管理对话放进 Host 默认工作区并打开设置面板；窗口几何、透明、点击穿透与呈现切换由 Desktop 载体拥有，渲染端只报告意图。对话框在 `manage` Agent 预设下解析其管理 Session；[better Bundle](../better-bundle/README.zh.md) 声明该预设，只挂载只读的[会话查询工具](../tool-session-query/README.zh.md)，不挂载文件写入或 Shell 插件。

overlay 条目只在快照的 `orb` 角色中绘制，在 `surface` 窗口、气泡列窗口或 classic 窗口中渲染为空，因此悬浮球旁的 panel、气泡列或模态呈现都不会取代它。在悬浮球窗口中它绘制一个方形按钮，显示所选形象组：快照报告 `orbDocked` 时为贴边探头立绘，否则为站立立绘；其视觉状态以 data 属性发布：`data-orb` 携带 `data-state`（`idle`、`capturing`、`transcribing`、`speaking` 或 `running`）、`data-appearance`（`cute` 或 `mature`）与 `data-reduced-motion`，按钮自身携带 `data-hovered`、`data-pressed` 与 `data-dragging`。每个状态都有自己的本地化无障碍标签。点击升起居中对话框；拖动超过四个逻辑像素后通过 `surface.dragBy` 报告经过节流的位移，并抑制随之产生的点击。松开拖动时，若悬浮球停在距离工作区边缘的吸附范围内，就贴齐该边缘。指针进入或离开悬浮球及其拖动手柄时报告 `surface.setPointerInside`，载体据此在其他区域放行点击。次要点击在方形内打开菜单：管理对话工作台、设置面板、可爱或成熟形象组，以及浅色、深色或跟随系统的主题偏好，所选形象组持久保存在悬浮球窗口中。「设置」行调用可选的 `settingsUi` 服务，在 surface 窗口中升起设置模态窗并显示桌面应用的设置面板。Escape、点击菜单外的方块区域，或悬浮球窗口失焦到桌面或其他应用时会关闭菜单，且不发送载体命令；新建会话与退出仍由 Desktop 外壳负责。

`shell.modal` 条目 `orb.chat` 在框架带焦点陷阱的模态层中渲染快捷对话框：一个“管理对话”标题、一个自动获得焦点的文本域、一个语音输入开关与一个发送按钮。对话框绘制自己的表面——一张 Fluent 卡片，沿用共享输入框的材质：抬升的输入底色、发丝描边、草稿获得焦点时的两像素强调色下划线、控制行上方的发丝分隔线、34 像素的 info 填充发送圆钮与 28 像素的幽灵麦克风——因此它与工作台的输入框读作同一个控件。它把框架的模态卡片标记为无衬底，框架因此只保留关闭层、焦点陷阱与关闭行为。Enter 提交，Shift+Enter 换行，Escape 或点击背景经框架关闭呈现。提交成功会清空对话框并在原位升起管理对话工作台；被拒绝时保留文字，并在框内显示本地化的失败提示。提问经注入的 `sessions` 服务发送到悬浮球的管理 Session：该 Session 在 Host 默认工作区中运行 `manage` 预设，并记忆在悬浮球窗口中，因此对话始终是同一个管理对话。麦克风采集服务挂载时，语音开关开始录音，显示请求麦克风、录音与转写状态，并在结束后把转写追加到输入末尾，既不插入分隔符也不提交；未挂载该服务时开关不出现，对话框仍可作为普通提问框使用。录音期间关闭对话框会丢弃本对话框发起的录音。

`shell.modal` 条目 `orb.workbench` 是管理对话的工作台：一张只承载该 Session Chat 视图的宽卡片，没有通用工作台的工作区页面与会话书签。它按嵌入式形态组合共享的 `conversation.content` 工厂，并把可见视图固定为 Chat 对话记录，因此输入框、流式回答、工具卡片、审批与提问都来自会话相关包，而不是本包。模态的注入面携带保留的管理 `SessionReference`；插件在载体快照报告该模态时保留它，卡片关闭时释放。快捷对话框接受的提问会升起此工作台，悬浮球设置菜单与 `orb.workbench` 命令也能再次升起它，而不发送任何内容。

`orb.open` 是 `scope: 'system'` 命令，在 Windows 与 macOS 上默认绑定 Ctrl+Alt+D：它升起对话框并聚焦输入框，对话框已打开时再次触发不会关闭它。可在“设置 → 通用 → 全局”中改绑；Linux 保留聚焦窗口模型，不提供操作系统级注册。`orb.toggle` 是第二个没有默认绑定的系统级命令：解析时若快照为 `orb` 则升起对话框，若处于模态呈现则关闭它，处于 panel 呈现则收回悬浮球，因此同一命令既能打开也能隐藏形态。`orb.workbench` 是第三个没有默认绑定的系统级命令：它升起管理对话工作台，菜单的第一行也能打开它。`voice.pushToTalk` 是第四个没有默认绑定的系统级命令：空闲时开始采集，否则结束当前采集，因此全局按键无需打开对话框即可听写。本包没有设置模态窗的命令；菜单行与设置外壳自己的 `settings.open` 命令都能到达它。操作系统级注册与冲突报告由 `ctx.shortcuts` 负责。

可选服务让同一套界面可以单独工作。挂载 [client-voice-capture](../client-voice-capture/README.zh.md) 时，悬浮球显示录音与转写阶段，对话框提供语音开关；挂载朗读包时，悬浮球反映其朗读状态。缺少任一服务时，悬浮球仍可打开对话框、拖动并提交提问。

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>维护者信息 — 点击展开</summary>

`apply` 注册一次八种语言词典，然后为每个观察源建立一个快照存储：载体呈现、减少动效媒体查询、每个已挂载的语音服务，以及客户端主题偏好。呈现观察与两个可选语音观察共用一个助手：跟随带 signal 的流写入存储，并随 fiber 中止；主题存储跟随 `theme/change` 并随 fiber 关闭；可选服务经 `ctx.inject` 观察，因此卸载其中一个就会清空对应存储，界面继续可用。overlay、对话框、工作台条目与工作台的对话槽经 `ctx.slots.inject` 注册：它会等待框架声明，并在该声明收起时移除贡献。命令经 `ctx.shortcuts.register` 注册，其释放函数随插件运行。一次提交先解析管理 Session——Host 仍在列出时使用记忆的 Session，否则在 Host 默认工作区中以 `manage` 预设创建；可选 `workspaces` 服务初始化出默认工作区时传入其标识——再用本包的 `orbPrompt` 引用来源经 `ctx.sessions.using` 保留它，然后调用 `prompt(content, 'queue')`；对话框不显示乐观转写，因此不注册本地提交回显。提问被接受后升起工作台；呈现存储的订阅随后用 `orbChat` 来源与 conversation facet 经 `ctx.sessions.retain` 保留同一 Session，把该引用写入模态注入面，并在模态关闭或插件停止时释放。每条载体命令都从一个闭包发出，包含拒绝并只报告一次。

组件只接收普通数据与回调：`hooks` 分区的源绑定为 `useSurface`、`useCapture`、`useVoice`、`useReducedMotion` 与 `useTheme` 选择器 Hook，标准 `useSessions` 座位提供运行状态，`actions` 携带回调。overlay 注入面携带 `openChat`、`openWorkbench`、`openSettings`、拖动命令、`toggleVoice` 与 `setTheme`；对话框注入面另外携带基于共享采集服务的 `takeTranscript`、`submit` 与听写命令，因此对话框从不拥有录音器；工作台注入面携带保留的对话引用，其对话条目组合共享的 `conversation.content` 工厂。拖动状态、悬停、按下、形象组与菜单可见性都是组件局部状态，贴边姿态则跟随载体的呈现快照；拖动 Hook 把指针移动合并为每动画帧一次报告，并以屏幕坐标测量，因此载体在指针下移动窗口不会抵消下一次位移，释放时发送剩余位移，这也决定了该手势是否算作拖动。对话框的文字、提交失败与听写提示是组件局部状态；追加转写是输入框之外对该文字的唯一写入。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [client-surface](../../client/surface/README.zh.md) —— 本浮层所发的呈现快照与载体命令。
- [ui-layout](../../client/ui-layout/README.zh.md) —— 声明 `shell.overlay` 与 `shell.modal` 并拥有模态呈现的框架。
- [ui-conversation](../../client/ui-conversation/README.zh.md) —— 管理工作台组合的共享会话工厂。
- [client-voice-capture](../client-voice-capture/README.zh.md) —— 录音状态背后的可选采集服务。
- [桌面外壳形态与悬浮球 profile](../../../.agents/notes/proposed/architecture/2026-11-14-desktop-shell-forms-and-orb-profile.zh.md) —— 本包所属的窗口、呈现与语音设计。

-----

<a id="model-experience"></a>
## 模型体验

无，因为悬浮球与对话框只渲染进程内呈现状态，不贡献模型输入。

#### KV 缓存影响

没有直接影响；每条模型可见消息由普通用户提交拥有。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

- 设置菜单有意保持精简。它打开管理对话工作台与设置模态窗，并切换形象与主题偏好；固定置顶、朗读静音、自动朗读策略、语音选择、新建会话与退出都没有形态界面，朗读服务沿用其配置的默认值。
- 没有自己的设置页。设置模态窗经可选的 `settingsUi` 服务渲染桌面应用的设置分区；本包只请求该服务，形象选择仍是悬浮球局部状态，而不是一条设置行。
- 悬浮球本身没有提醒徽标。待处理的审批与提问仍在会话内渲染，由 better-interact 的对话气泡在悬浮球旁报告；本包只渲染悬浮球外观。
- 快捷对话框不显示回复文本。对话框只提供提问入口；提问被接受后会升起管理工作台，由它承载对话历史、流式回答与后续提问输入框。
- 工作台卡片有意保持单会话。它没有工作区条、会话书签或页面选择；那些留在通用工作台，这张卡片始终绑定悬浮球的管理对话。
- 语音控件依赖同组其他包。缺少采集包时悬浮球没有录音与转写状态，对话框也没有语音开关；缺少朗读包时悬浮球只保持空闲状态。
- 管理对话是只读且单工作区的。它的预设带会话查询读取工具，但不带文件写入、Shell、终端、子代理或目标工具；会话查询权限只暴露 Host 默认工作区，因此其他工作区的会话不可读，对话也不能向其他会话发送提问。
- 仅适用于 Desktop 形态 profile。Web 页面保持 classic 呈现，因此这里没有页面级悬浮球回退。
- 没有在组装后的形态窗口中检视浅色主题与减少动效场景；深色主题下的悬浮球、对话框与 Escape 切换由驱动组件与插件测试覆盖，浅色与减少动效评审仍属于形态载体一侧。

-----

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者信息 — 点击展开</summary>

无。

</details>
