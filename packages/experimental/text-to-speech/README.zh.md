---
description: "具名实验性语音合成 Provider 及声音与格式目录。"
kind: "package-reference"
---

# @deepseek-ai/dsh-text-to-speech

[English](README.md) | 中文

## 概述

此服务定义通过 `ctx.textToSpeech` 选择具名语音合成器。消费者先解析请求再执行，Provider 独立注册。

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

通过语音输出组合加载，或组合此服务、Provider 与消费者。`defaultProvider` 选择确切的注册 Provider id，`voiceId` 选择该 Provider 公布的一种声音；两者均为必填。本版本的 `format` 固定为 `wav`。缺失或重复的 Provider 会明确报错。

Provider 公布 `voices`、`formats` 与 `maxTextChars`。`resolve()` 应用配置的选择，并拒绝空、仅空白或超过 Provider 限制的文本。`synthesize()` 返回编码后的音频字节与实际接受的文本长度；Provider 从不写文件。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>维护者信息 — 点击展开</summary>

`resolve()` 捕获 Provider 实例、文本、声音和格式。`synthesize()` 拒绝已撤销或替换的注册。注册的清理函数先拒绝新请求，再取消已接收的请求并等待 Provider 完成；Provider 必须响应取消。服务不会回退到其他合成器或把文本发送到别处。

`defaultProvider`、`voiceId` 与 `format` 是 volatile Config 字段：`configure()` 通过 `settings` 服务把传入的字段写入本插件的 profile 条目，运行中的实例无需重挂载即可读到更新值；保存覆盖值之前使用组合配置默认值。Settings 使用条目配置中的 id（`entry.options.id`）定位条目，不包含 Loader 的 Include 路径。没有 `settings` 或 profile 条目时 `configure()` 失败，并在保存前拒绝所选 Provider 未公布的声音或格式。`snapshot()` 与 `follow()` 公布 Provider 名单与当前选择；关闭观察者不会取消合成。

合成产生的是临时字节：没有任何 Session 事件、附件、文件、重试或日志行携带文本或音频。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

[语音合成子系统](../../../docs/subsystems/text-to-speech.zh.md)

[语音识别服务接口](../speech-to-text/README.zh.md)

-----

<a id="model-experience"></a>
## 模型体验

无，因为此 Host 服务接口不注册任何模型可见输入，且合成的音频字节从不进入模型请求。

#### KV 缓存影响

没有直接影响；该服务不注册任何模型可见输入，因此缓存的提示前缀保持不变。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

- 仅支持完整整句的 WAV 合成；此包不提供流式合成、部分音频或播放。
- 此包不附带本地或离线合成器，凭据、端点和按次计费披露由 Provider 拥有。
- 播放、自动朗读策略、排队、打断与按键抬起处理属于客户端消费者，而非此服务接口。

-----

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者信息 — 点击展开</summary>

无。

</details>
