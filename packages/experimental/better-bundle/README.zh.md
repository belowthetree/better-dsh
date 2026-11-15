---
description: "在插件管理页启用 Desktop 的实验性球体形态。"
kind: "package-bundle"
---

# @deepseek-ai/dsh-better-bundle

[English](README.md) | 中文

## 概述

此可选 Bundle 为 Desktop 组合球体形态：Surface 服务、球体与面板外观、共享麦克风捕获、官方语音识别与合成 seam、带认证的语音 Remote，以及语音播放消费者。声明球体形态的 Desktop 自有 profile 会挂载它；随附 profile 保持经典窗口并默认关闭此 Bundle。

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

此 Bundle 仅适用于 Desktop。插件管理页将其显示为关闭状态；启用后相关包可用，但不会改变经典 profile。按 Desktop 外壳形态文档创建声明球体形态的 profile，然后用 `--profile <名称>` 启动 Desktop。窗口以收起的球体打开；点击升起居中对话框，其中包含提问输入框、语音输入开关与发送按钮，Escape 或点击背景可再次关闭。对话框自绘卡片表面，使用共享的 elevation 材质。Enter 或发送按钮把提问发送到最近的会话（没有会话时创建空白会话），随后关闭对话框；Shift+Enter 换行，被拒绝的提问保留在对话框内并显示失败提示。对话框的语音开关使用共享采集服务录音，并把识别出的文字追加到输入框末尾而不发送。Ctrl+Alt+D 在 Windows 与 macOS 上通过操作系统全局快捷键打开对话框；球体开关没有默认键位，可在“设置 → 快捷键 → 全局”中分配。球体可拖动，其右键菜单用于选择合成音色、静音播放，并在自动朗读策略之间循环。球体上的麦克风按钮与 `voice.pushToTalk` 系统级命令可在对话框关闭时开始采集；结束后升起对话框并填入其输入框。语音识别与合成需要外部 DeepSeek 套件在同一 profile 中注册 `deepseek-cloud` 与 `deepseek-tts` Provider；两者都是计费的云请求。若要在没有安装包的情况下评审组装后的形态，按 [Desktop README](../../../apps/desktop/README.zh.md) 的本地形态评审步骤操作。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>维护者细节——点击展开</summary>

静态 `cordis.patch.yml` 插入 Surface 行、球体插件、捕获服务、带 DeepSeek Provider id 的识别与合成 seam、两个带认证的 Remote、输入区麦克风控件，以及播放消费者。形态本身不在此声明：窗口选项必须在 Host 启动前从 profile manifest 同步读取，因此 profile manifest 才是运行时权威，Bundle 只组合该形态需要的插件。经典窗口、其聚焦窗口快捷键与 Web 行为保持不变，因为这些行只有在选择该 profile 时才挂载。

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

无；此形态只组合呈现、捕获与播放插件，不新增模型请求；普通用户提交拥有模型可见文字。

#### KV Cache effect

无直接影响；被组合的插件不改变提示内容，缓存前缀保持不变。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- 仅适用于 Desktop。Web 保持经典呈现，没有页面级球体回退；形态 profile 需按文档配方创建，因为 Settings 尚未提供创建入口。
- 两个语音 seam 都期望外部 `@dsh-external/dsh-deepseek-suite` 在同一 profile 中注册 `deepseek-cloud` 与 `deepseek-tts`。缺少 Provider 时在首次使用时失败，而不是在加载时失败。
- 球体没有注意徽标，右键菜单不提供新建会话或退出，面板收起时不会自动聚焦输入区。
- 按住式通话实为按一下开始、再按一下停止：Electron 全局快捷键不提供按键抬起事件，播放也不是流式的。

-----

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者细节——点击展开</summary>

无。

</details>
