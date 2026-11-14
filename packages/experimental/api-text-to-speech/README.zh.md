---
description: "通过已认证的 Web Remote 提供有界、瞬态的语音合成。"
kind: "package-reference"
---

# @deepseek-ai/dsh-api-text-to-speech

[English](README.md) | 中文

## 概述

`speechOutput` Remote 让浏览器通过 `ctx.textToSpeech` 播放助手文本的语音形式。它公布提供方、音色、格式与请求上限，保存用户的音色与格式选择，并在每次调用时返回一段完整音频。每个请求都受文本字符数、音频字节数与提供方超时约束，返回的 base64 音频是瞬态的：不写入会话事件、附件或文件。

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

与语音合成服务定义和 Typert 组合。`maxTextChars`、`maxAudioBytes` 与 `timeoutMs` 限制每个请求。启用播放客户端时，浏览器 UI 挂载本包生成的 `/remote` 贡献。

`synthesize()` 接收助手文本以及可选的显式提供方、音色与格式；省略时使用已保存的选择。结果包含用于播放与进度显示的 `audioBase64`、`format` 与 `characters`。播放、排队与停止策略属于客户端消费方，不属于此 Remote。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>维护者信息 — 点击展开</summary>

`catalog()` 暴露提供方清单、解析后的选择与三项请求限制。`follow()` 推送完整目录，使客户端无需轮询即可跟踪就绪状态与偏好变更。`configure()` 通过服务持久化传入的选择字段。

`synthesize()` 去除文本首尾空白，在调用提供方之前拒绝空文本与超长文本，并把调用方信号与 `AbortSignal.timeout(timeoutMs)` 合并。只有超时中止会转成类型化失败；调用方中止则重新抛出其自身的取消原因。超过 `maxAudioBytes` 的合成字节在编码前被拒绝，因此响应既不带 data URL 前缀，也不含部分结果。提供方拒绝会转成 `speech-output/synthesis-failed`：无法解析的提供方、音色或格式报告 `unavailable`，被拒绝的合成报告 `provider`。两者都不携带提供方的消息文本，从而让凭据与提供方诊断信息留在 Host。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [语音合成服务定义](../text-to-speech/README.zh.md) — 本 Remote 所服务的提供方注册表与选择。
- [语音输入子系统](../../../docs/subsystems/voice-input.zh.md) — 本 Remote 所对应的识别能力接缝。
- [Typert 子系统](../../../docs/subsystems/typert.zh.md) — Remote 命名空间、类型化错误与流。

-----

<a id="model-experience"></a>
## 模型体验

无，因为合成读取的是已记录的助手文本并返回瞬态音频；不新增请求、工具或会话事件。

#### KV 缓存影响

没有直接影响；朗读文本来自内容未变的既有助手消息。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

- 每次调用只合成一段完整结果：没有流式音频、分段投递或提供方词级时间戳。
- 音频是经由已认证 Remote 传输的瞬态 base64 数据，从不写入磁盘、附件、会话日志或诊断记录。
- 被拒绝的合成不会自动重试，因为每次提供方调用都会计费。
- 提供方失败以净化后的原因到达浏览器；提供方消息、端点与凭据状态留在 Host。

-----

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者信息 — 点击展开</summary>

无。

</details>
