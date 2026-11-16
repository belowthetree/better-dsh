# 桌面形态

[English](client-surface.md) | 中文

桌面形态能力报告单个渲染窗口的角色、壳形态与呈现，以及改变 profile 共享呈现的命令。[ui-layout](../../packages/client/ui-layout/README.zh.md) 用它渲染感知呈现的框架，[Desktop 应用](../../apps/desktop/README.zh.md) 拥有其背后的原生窗口状态。

## 呈现状态

`SurfaceSnapshot` 携带窗口角色（`classic`、常驻 `orb` 或 `surface` 窗口）、壳形态（`classic` 或 `orb`）、呈现（`classic`、`orb`、`panel`、`modal` 或 `bubbles`）、面板固定状态、载体可用性与当前 `shell.modal` 条目 id。形态 profile 把悬浮球窗口与 surface 窗口作为两个渲染进程运行：悬浮球窗口始终报告 `orb` 呈现，surface 窗口报告真实呈现。`snapshot()` 在字段变化前保持同一引用，`follow(signal)` 先产出当前快照，再在信号中止前产出每次变化。classic 框架报告 `classic` 呈现，因此形态 profile 可以收起回到它；没有载体的页面报告 `available: false`，且永远无法改变呈现。

## 载体归属

Client 插件在激活时选择一个适配器：由 `__DSH_SURFACE__` 启动描述符播种的 Desktop preload 能力 `window.dshDesktop.surface`，或命令直接完成且无效果的惰性适配器。命令只在载体确认后完成，被载体拒绝的命令保留上一个快照。任一形态窗口发出的呈现命令都驱动共享呈现，而指针与拖拽上报只作用于来源窗口。窗口几何、工作区钳制、点击穿透与布局持久化留在 Electron 主进程；渲染进程只转发指针位移与指针是否在交互区域内。任何呈现变化都不写入 Session 事件，也不进入模型请求。

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<!-- END GENERATED cordis-surface -->