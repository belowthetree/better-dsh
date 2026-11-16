---
description: "基于 preload surface 桥的桌面外壳形态呈现服务，并提供惰性的 Web 回退。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-surface

[English](README.md) | 中文

## 概述

提供客户端 surface 能力：拥有该渲染进程的窗口的一份呈现快照，以及改变 profile 共享呈现的命令。桌面端的 preload 桥支撑实时服务；没有该桥的 Web 页面与桌面窗口获得惰性适配器，它报告 classic 呈现且无法改变呈现。[ui-layout](../ui-layout/README.zh.md) 在未挂载 surface 服务时渲染 classic 框架。启动描述符在 Client 插件加载前从全局变量读取。

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

当 profile 挂载本包时，`ctx.surface` 提供 `snapshot()`、`follow(signal)`、`expand()`、`collapse()`、`presentModal(id, size?)`、`dismissModal()`、`presentBubbles()`、`dismissBubbles()`、`setPinned(pinned)`、`dragBy(deltaX, deltaY)` 与 `setPointerInside(inside)`。在某个呈现字段变化之前，`snapshot()` 返回同一个引用稳定的值；`follow(signal)` 依次产出当前快照与之后的每次变化，直到 signal 中止。命令方法仅在载体确认后 resolve；载体拒绝的命令会让调用方 reject，并保留上一份快照。该插件不要求任何注入服务，因此可挂载于任意 Client 组合。

`SurfaceSnapshot` 携带形态（`classic` 或 `orb`）、窗口 `role`（`classic`、常驻 `orb` 或 `surface` 窗口）、呈现（`classic`、`orb`、`panel`、`modal` 或 `bubbles`）、是否置顶、当前载体能否改变呈现，以及活动的 `shell.modal` 条目 id。形态 profile 把悬浮球窗口与 surface 窗口作为两个渲染进程运行：悬浮球窗口始终报告 `orb` 呈现，surface 窗口报告真实呈现。classic 框架报告 `classic`，使形态 profile 能收回到它；模态 id 让框架从共享 slot 注册表中选择模态内容，而不是拥有该内容。条目还可以传入 `ModalSizeHint`：`heightRatio` 要求对话框占工作区高度的该比例，省略则保持载体的对话框尺寸。`bubbles` 呈现是载体悬浮球上方的输出列，只承载 overlay 席位。

桌面端通过 `dsh-desktop:boot` 载荷发布启动描述符；[apps/web](../../../apps/web/src/main.ts) 在 Client 注入运行前把它存为 `globalThis.__DSH_SURFACE__`。Electron 适配器读取 `window.dshDesktop.surface`，并以该描述符作为首份快照。没有该桥的页面获得惰性适配器：`available: false`、classic 呈现，命令无效果但正常 resolve。

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

`/protocol` 导出与 Electron 主进程、preload 进程共享的纯类型声明，运行时不导入任何内容。`/client` 导出是 Cordis 插件：每次激活选择一次适配器，提供 `ctx.surface`，并在一个 `ctx.effect` 中跟随载体通知，因此插件释放会移除 preload 订阅。每个命令发布其载体最终落定的快照，相同快照保留原引用。`follow` 保留读取间隙发布的变化，在 signal 中止时正常结束而不抛错，对已中止的 signal 仍会先产出一份当前快照。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [ui-layout](../ui-layout/README.zh.md)——消费该服务以呈现感知呈现方式的框架。
- [桌面应用](../../../apps/desktop/README.zh.md)——拥有 preload 桥与形态窗口。
- [Web 客户端架构](../../../docs/subsystems/web-client.zh.md)——Client 插件如何加载并接收服务。

-----

<a id="model-experience"></a>
## 模型体验

无，本包只暴露浏览器呈现状态与窗口命令，不注册任何模型输入。

#### KV Cache 影响

无；该包既不组装也不发送提供方请求。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- **没有 Web 呈现**——Web 页面保持 classic 呈现；惰性适配器只报告可用性，从不改变呈现，页面级 orb 回退属于延期工作。
- **窗口角色固定**——渲染进程的角色来自其启动描述符；把已有渲染进程切换到另一角色需要重新加载。
- **两个渲染器，一份呈现**——形态 profile 在悬浮球窗口与 surface 窗口中各加载一份完整 Web 客户端，只通过主进程共享呈现状态；在两个渲染器之间同步其他客户端状态不属于该服务。
- **载体拥有几何**——该服务只把指针位移与置顶转发给主进程；屏幕坐标、工作区裁剪与布局持久化留在 Electron 进程内。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>
