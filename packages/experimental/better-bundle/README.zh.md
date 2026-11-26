---
description: "在插件管理页启用 Desktop 的实验性球体形态。"
kind: "package-bundle"
---

# @deepseek-ai/dsh-better-bundle

[English](README.md) | 中文

## 概述

此可选 Bundle 为 Desktop 组合球体形态：Surface 服务、球体与面板外观、共享麦克风捕获、官方语音识别与合成 seam、带认证的语音 Remote、语音播放消费者，以及球体的 `manage` Agent 预设。声明球体形态的 Desktop 自有 profile 会挂载它；随附 profile 保持经典窗口并默认关闭此 Bundle。

## 目录

- [使用此包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步阅读](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用此包

此 Bundle 仅适用于 Desktop。插件管理页将其显示为关闭状态；启用后相关包可用，但不会改变经典 profile。按 Desktop 外壳形态文档创建声明球体形态的 profile，然后用 `--profile <名称>` 启动 Desktop。窗口以收起的球体打开；点击球体或按 Ctrl+Alt+D 会唤出朝向桌面中心的半圈球体选项按钮，其中“大肥鱼对话框”选项升起居中快捷对话框，包含提问输入框、语音输入开关与发送按钮。Enter 或发送按钮把提问发送到球体专属的 `manage` 对话（首次使用时在 Host 默认工作区创建），并升起管理工作台——一张显示共享对话记录、流式回答与后续提问输入框的宽卡片；Shift+Enter 换行，被拒绝的提问保留在对话框内并显示失败提示，Escape 或点击背景可关闭任一张卡片。球体右键菜单与 `orb.workbench` 命令可在不发送内容的情况下重新升起工作台。对话框自绘卡片表面，使用共享的 elevation 材质。对话框的语音开关使用共享采集服务录音，并把识别出的文字追加到输入框末尾而不发送。Ctrl+Alt+D 在 Windows 与 macOS 上通过操作系统全局快捷键开关球体选项半环；球体开关没有默认键位，可在“设置 → 快捷键 → 全局”中分配。球体可拖动，其右键菜单用于选择合成音色、静音播放，并在自动朗读策略之间循环。球体上的麦克风按钮与 `voice.pushToTalk` 系统级命令可在对话框关闭时开始采集；结束后升起对话框并填入其输入框。语音识别与合成由内置的 `deepseek-suite` 行提供 Provider（`deepseek-cloud` 与 `deepseek-tts`），不再需要外部套件；两者都是计费的云请求。Bundle 声明球体对话框创建管理会话所用的 `manage` 预设（管理对话）：它挂载启用 `workspaceAccess: current` 的会话列表工具、会话查询、读取最新回复和发送消息的工具，不挂载文件、Shell 或删除/改写类工具。根作用域注册的工具沿作用域链被预设内 Agent 继承，因此 better-interact 的 `orb_balloon`（把一句话显示成对话气球）与外部套件的 `deepseek_speak`（直接朗读）都可用于大肥鱼；气球内容默认朗读，开关、音色与试听在“设置 → 语音播报”。列表工具只暴露管理 Session 已注册的默认工作区，并在执行时拒绝其他工作区 ID。若要在没有安装包的情况下评审组装后的形态，按 [Desktop README](../../../apps/desktop/README.zh.md) 的本地形态评审步骤操作。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>维护者细节——点击展开</summary>

静态 `cordis.patch.yml` 复用 Web 应用的 Surface 行，并插入球体插件、捕获服务、带 DeepSeek Provider id 的识别与合成 seam、两个带认证的 Remote、输入区麦克风控件，以及播放消费者。第二个静态补丁 `presets/manage.patch.yml` 声明球体管理会话所挂载的 `manage` Agent 预设。形态本身不在此声明：窗口选项必须在 Host 启动前从 profile manifest 同步读取，因此 profile manifest 才是运行时权威，Bundle 只组合该形态需要的插件。经典窗口、其聚焦窗口快捷键与 Web 行为保持不变，因为这些行只有在选择该 profile 时才挂载。

</details>

-----

<a id="further-exploration"></a>
## 进一步阅读

- [客户端 Surface](../../../docs/subsystems/client-surface.zh.md)
- [语音输入](../../../docs/subsystems/voice-input.zh.md)
- [语音合成](../../../docs/subsystems/text-to-speech.zh.md)
- [Desktop 外壳形态](../../../apps/desktop/README.zh.md)

-----

<a id="model-experience"></a>
## 模型体验

间接地，通过 `manage` 预设：固定的中文 persona、工作区 Agent 指令、当前时间、仅限当前工作区的会话列表、会话查询、读取最新回复、发送消息和新建会话的工具 schema，以及提问工具只在 Session 挂载它时进入请求，压缩也可能丢弃较早的工具结果。

#### KV Cache effect

除 `manage` 预设外无直接影响。重复的管理对话把 persona、指令与工具 schema 保持在同一个稳定前缀中，追加的对话记录增长后缀；压缩运行时重写历史。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- 仅适用于 Desktop。Web 保持经典呈现，没有页面级球体回退；形态 profile 需按文档配方创建，因为 Settings 尚未提供创建入口。
- 两个语音 seam 的 Provider 由内置的 `deepseek-suite` 行注册；禁用该行后，缺少 Provider 时在首次使用时失败，而不是在加载时失败。
- 球体没有注意徽标，右键菜单不提供新建会话或退出，面板收起时不会自动聚焦输入区。
- 按住式通话实为按一下开始、再按一下停止：Electron 全局快捷键不提供按键抬起事件，播放也不是流式的。
- `manage` 预设发布自己的中文名称与描述，因此在预设列表中归入自定义预设，而不是已本地化的四个内置预设。

-----

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者细节——点击展开</summary>

无。

</details>
