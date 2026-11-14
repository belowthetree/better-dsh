---
description: "基于实验性语音 Remote 的共享麦克风采集服务，含输入设备偏好、WAV 编码与识别调用。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-voice-capture

[English](README.md) | 中文

## 摘要

提供浏览器端的语音采集能力：一个麦克风录音器、一份持久化的输入设备选择、规范的 WAV 编码以及语音 Remote 的识别调用，并以 Cordis 服务 `ctx.voiceCapture` 暴露。插件自行挂载实验性语音 Remote 贡献，因此挂载本包的组合无需再配置一条语音行。 [client-ui-voice-input](../client-ui-voice-input/README.zh.md) 中的输入框控件只是其中一个消费者；后续的悬浮球与按键说话控件观察同一份快照，并且采集不再因为某个控件卸载、失去焦点或页面隐藏而结束。

## 目录

- [使用本包](#use-this-package)
- [了解实现](#understand-the-implementation)
- [延伸阅读](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发者说明](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

在需要麦克风采集的浏览器组合中挂载本包。插件注入 `remote`，并在挂载生成的语音 Remote 贡献后提供 `ctx.voiceCapture`。消费者注入该服务并读取 `snapshot()`：阶段（`idle`、`starting`、`capturing`、`transcribing`）、已选麦克风、实时输入电平、上一次失败、宿主机的采集上限，以及为下一次完成采集记住的识别选择。只要这些事实不变，快照就保持同一引用；`follow(signal)` 会先产出当前值，再产出直到信号中止前的每一次变化。

`begin()` 获取所选麦克风并开始录音；并发采集、已释放的服务或获取失败都会拒绝。`finish()` 停止录音器，编码规范的 16 kHz 单声道 PCM16 WAV，用 `begin()` 时记住的选择请求语音 Remote 识别，并在服务回到 `idle` 后返回识别结果。`cancel()` 停止并丢弃录音，且从不上传。命令失败会让服务回到 `idle` 并携带封闭失败联合中的一个成员（`unavailable`、`permission`、`empty`、`cancelled`、`interrupted`、`deviceMissing`、`transcribe`），下一次 `begin()` 会清除它。没有专属成员的失败（包括被拒绝的 Remote 识别）都归为 `transcribe`，并在拒绝值上保留诊断信息。`finish({ hold: true })` 还会把转写发布到 `snapshot().pendingTranscript`，直到 `takeTranscript()` 取走一次，因此面板收起时也能在输入框出现之前完成采集。

`setDevice(device)` 使用既有的 `dsh.voice-input.microphone` 存储键保存浏览器输入偏好，因此本包出现之前记录的偏好继续有效；空 id 表示跟随系统输入。`catalog()` 解开语音 Remote 目录并拒绝其错误分支，`followCatalog(signal)` 在传输重连之间保持镜像。`configure`、`prepare` 与 `cancelPreparation` 转发给语音 Remote，使消费者保留其选择与准备界面。`preview(device, onFailure, signal)` 为电平表获取一个麦克风，但不录音、不上传；中止信号会释放等待中或已完成的获取。

<a id="understand-the-implementation"></a>
## 了解实现

<details>
<summary>实现细节——点击展开</summary>

`/protocol` 导出是浏览器两侧共享的纯类型声明，运行时没有任何导入。`/client` 导出是 Cordis 插件：它挂载语音 Remote 贡献、构造服务，并在提供 `ctx.voiceCapture` 之前把服务释放注册为 fiber effect。释放按顺序执行：撤回服务以唤醒依赖者、服务释放全部录音器与预览、最后完成 Remote 卸载。

同一时间只有一个录音器实例，它属于服务而不是某个渲染控件。电平循环仅在 `capturing` 阶段通过 `requestAnimationFrame` 读取录音器分析器，其他阶段发布零值。`finish` 会把编码音频截断到宿主时长上限与由 `maxAudioBytes` 推导的字节上限中较小者，因此即使计时器超出，规范 WAV 仍处于 Remote 接收限制之内。设备中断、录音器错误与轨道结束都会先释放轨道，再发布失败。

</details>

-----

<a id="further-exploration"></a>
## 延伸阅读

- [client-ui-voice-input](../client-ui-voice-input/README.zh.md) —— 消费本服务的输入框控件。
- [api-speech-to-text](../api-speech-to-text/README.zh.md) —— 本包挂载并调用的已认证语音 Remote。
- [speech-to-text](../speech-to-text/README.zh.md) —— 该 Remote 背后的宿主机识别接缝。
- [语音输入子系统](../../../docs/subsystems/voice-input.zh.md) —— 采集、识别与输入框如何协同。

-----

<a id="model-experience"></a>
## 模型体验

无：录音、编码与识别都不产生模型输入；后续消息内容由普通用户提交产生。

#### KV Cache 影响

无直接影响；本包不发送任何模型请求。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

- **停止期限由一个消费者驱动** —— 服务发布 `maxDurationSeconds` 并按宿主机限制截断编码音频，但停止计时器由消费者负责；若消费者已卸载而没有其他消费者接手，采集会一直占用麦克风，直到某个消费者停止或取消它。
- **没有部分识别结果或流式音频** —— 每次完成的采集只发起一个完整 WAV 请求。
- **识别服务由别处拥有** —— 提供方选择、凭据、计费以及云端或本地执行属于语音识别接缝及其提供方；本包只请求识别结果。
- **没有投递策略** —— 服务从不插入或提交文本；每个消费者决定识别结果的去向。暂存的转写只是一次交接；若消费者始终没有挂载，它会留在快照中直到下一次 `begin()`。

<a id="dev-note"></a>
### 开发者说明

<details>
<summary>维护者工作背景——点击展开</summary>

语音 Remote 贡献通过生成的 `/remote` 导出提供，该文件只在构建后存在；源码测试用合成的贡献调用 `mountVoiceCapture`，浏览器刷新则验证构建产物入口。

</details>
