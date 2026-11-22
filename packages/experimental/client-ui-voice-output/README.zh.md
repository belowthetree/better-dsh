---
description: "按自动朗读策略、音色选择与静音朗读已完成的助手回复。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-voice-output

[English](README.md) | 中文

## 概述

本实验性浏览器插件朗读活动会话中已完成的助手回复。它挂载生成的 `speechOutput` Remote 并提供 `ctx.voiceOutput`：一个快照，包含自动朗读策略、所选音色、目录音色、静音、朗读状态、待播数量、最近失败与文本上限，以及设置策略、选择音色、静音、停止与显式 `speak(text)` 的命令。`voice` 策略只朗读由语音转写发起的轮次，`all` 朗读每条已完成的回复。同一时刻只播放一段音频，最多保留一条待播回复，失败从不重试。

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

配置需要 `text-to-speech`、`api-text-to-speech` 两行以及本包；better bundle 已组合这三行。插件注入 `remote` 与 `surface`（web-app 组合已为两个语音 bundle 提供后者），并在 `sessions` 可用时观察会话对象层，因此经典帧、悬浮球与输入区都不持有播放逻辑。orb 形态只在 surface 渲染进程中挂载播放；Better 把朗读状态投影到常驻悬浮球。设置与播放命令通过主渲染进程的 `ctx.voiceOutput` 调用 `setMuted`、`setPolicy` 与 `setVoice`，其快照按名称列出目录音色。

策略决定自动播放。`off` 不朗读任何回复，显式的 `speak(text)` 仍会播放；`all` 朗读活动会话中每条已完成的助手回复；`voice` 只朗读其轮次由一次语音转写发起的回复。语音发起判定是启发式的：采集快照从 `transcribing` 回到 `idle` 时打开 60 秒窗口，窗口内提交的第一条用户消息标记它被认领所在轮次，标记在该次提交后清除。

`setVoice(voiceId)` 只接受目录中公布的音色，DeepSeek 提供方发布 `stella` 与 `tide`。未知 id 会公布 `voice` 失败并保留原选择。`setMuted(true)` 停止当前播放并丢弃待播回复。策略、音色与静音保存在浏览器 `localStorage` 的 `dsh.voice-output` 键下，非法存储值回落为默认值。

**隐私与计费。** 被朗读的文本经 Host 发往已配置的 DeepSeek 端点。合成音频只存在于浏览器内存：播放结束时撤销对象 URL，任何音频字节都不会进入会话日志、附件或磁盘。失败的合成不会重试，因为每次提供方调用都会计费。失败以封闭枚举公布：`unavailable`（Remote 缺失、不可达或未公布音色）、`remote`（Remote 拒绝了请求）、`playback`（浏览器无法创建或播放音频元素）、`voice`（所选音色不在当前目录中）。下一段成功开始播放的音频会清除失败。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>维护者信息 — 点击展开</summary>

插件一步完成两件事：挂载 `speechOutput` Remote 贡献并提供 `ctx.voiceOutput`；移除插件时两者一起撤回。播放会读取一次各提供方公布的音色（按 id 去重，`stella` 与 `tide` 来自 DeepSeek 提供方），并把目录的 `maxTextChars` 作为每次请求的文本上限；更长的回复被截断，而不是拆成多次计费请求。

自动播放不属于 React 组件。`ActiveReplyObserver` 通过客户端对象层读取活动会话：`ctx.sessions.list` 中主视图保留的那一行，再借用其 `SessionBinding` 的事件窗口。它只消费追加的持久事件与助手结算事件，因此替换窗口与更早分页（首次打开、重连基线、历史翻页）不会把整段对话当作新回复重放。`turn/start` 让上一轮的播放过期，`assistant/message` 中可见的文本块成为候选回复；工具结果、用户消息、无消息的尝试与仅含推理的消息从不朗读。

同一时刻只播放一段音频，待播槽位最多保留一条回复，因此播放期间完成的回复会替换更早的待播回复（最新者胜）。`stop()`、静音与新开轮次都会中断当前音频并放弃在途合成；失败的请求不会重试。音频元素由注入的工厂创建，默认是 `new Audio(url)`，其对象 URL 在播放结束或被中断时撤销。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [speechOutput Remote](../api-text-to-speech/README.zh.md) — 本包挂载的有界、瞬态合成能力。
- [语音合成服务定义](../text-to-speech/README.zh.md) — 该 Remote 背后的提供方注册表与选择。
- [语音采集服务](../client-voice-capture/README.zh.md) — 其完成的采集用于标记语音发起轮次的麦克风服务。
- [语音输入子系统](../../../docs/subsystems/voice-input.zh.md) — 与本播放路径配对的识别接缝。
- [Typert 子系统](../../../docs/subsystems/typert.zh.md) — Remote 命名空间、类型化错误与流。

-----

<a id="model-experience"></a>
## 模型体验

无，因为播放读取的是已记录的助手文本，只为合成而发送该文本，不新增模型请求或会话事件。

#### KV 缓存影响

没有直接影响；朗读的文本是内容不变的既有助手消息。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

- 没有流式合成或流式播放：每次请求返回一段完整音频，因此整段响应到达后才开始出声。
- 待播槽位只保留一条回复：播放期间完成的回复会替换更早的待播回复，被替换的回复不会朗读。
- 语音发起标记是启发式的：它依赖 60 秒窗口、只消费一次提交，并把标记归给持久用户消息被认领的轮次，因此排队或 steer 提交可能归错轮次。
- 不提供逐条消息的朗读操作；显式 `speak(text)` 供后续控件使用。
- 不使用浏览器系统语音；可选音色只来自语音 Remote 的提供方。
- 播放、队列与朗读状态只存在于拥有它们的渲染进程（orb 形态的 surface）中，重新加载该进程会丢失这些状态，而策略、音色与静音会保留。
- 需要 `text-to-speech` 与 `api-text-to-speech` 两行；缺少时插件不执行任何操作，只报告 `unavailable` 失败。

-----

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者信息 — 点击展开</summary>

无。

</details>
