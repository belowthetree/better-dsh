# 桌面形态

[English](client-surface.md) | 中文

桌面形态能力报告单个产品窗口的壳形态与呈现，以及改变它们的命令。[ui-layout](../../packages/client/ui-layout/README.zh.md) 用它渲染感知呈现的框架，[Desktop 应用](../../apps/desktop/README.zh.md) 拥有其背后的原生窗口状态。

## 呈现状态

`SurfaceSnapshot` 携带壳形态（`classic` 或 `orb`）、呈现（`classic`、`orb`、`panel` 或 `modal`）、面板固定状态、载体可用性与当前 `shell.modal` 条目 id。`snapshot()` 在字段变化前保持同一引用，`follow(signal)` 先产出当前快照，再在信号中止前产出每次变化。classic 框架报告 `classic` 呈现，因此形态 profile 可以收起回到它；没有载体的页面报告 `available: false`，且永远无法改变呈现。

## 载体归属

Client 插件在激活时选择一个适配器：由 `__DSH_SURFACE__` 启动描述符播种的 Desktop preload 能力 `window.dshDesktop.surface`，或命令直接完成且无效果的惰性适配器。命令只在载体确认后完成，被载体拒绝的命令保留上一个快照。窗口几何、工作区钳制、点击穿透与布局持久化留在 Electron 主进程；渲染进程只转发指针位移与指针是否在交互区域内。任何呈现变化都不写入 Session 事件，也不进入模型请求。

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<!-- END GENERATED cordis-surface -->