---
description: "DeepSeek OCR, speech recognition, speech synthesis, and in-memory playback tools with their speech providers."
kind: "package-reference"
---

# @deepseek-ai/dsh-deepseek-suite

[English](README.md) | 中文

## 概述

内置的 DeepSeek 应用 API 工具集：`deepseek_ocr` 逐页识别文档，`deepseek_asr` 用 DeepSeek 账号转写音频，`deepseek_tts` 把文本合成音频文件，`deepseek_speak` 把文本合成语音直接在客户端内存里播放。插件同时在组合提供对应 seam 时注册 `deepseek-cloud` 识别 Provider 与 `deepseek-tts` 合成 Provider，因此 Better DSH 的球体 profile 不需要外部套件。

## 摘要

内置的 DeepSeek 应用 API 工具与语音 Provider：文档识别、账号语音识别、文件合成与内存播放；由 better bundle 挂载，球体 profile 不再需要外部套件。

## 使用本包

Better bundle 在 `better-bundle/cordis.patch.yml` 里以 `deepseek-suite` 行挂载本包，因此声明球体形态的 profile 自动获得四个工具与两个 Provider。工具在根作用域注册，沿作用域链对每个 Agent 可见，包括 `manage` 预设。

- `deepseek_ocr` / `deepseek_tts` 使用 `apiKeyRef` 指定的凭证（默认 `DEEPSEEK_API_KEY`，读不到时回退同名环境变量）。
- `deepseek_asr` 只接受 DeepSeek 账号授权：未登录、401 或请求期间退出登录都会给出稳定错误码与“设置 → 账号”的指引。
- `deepseek_speak` 的音频只经语音合成 Remote 在浏览器内存播放，不写文件、不进入会话记录；客户端从 `tool/result` 的 `speak` 展示元数据读到要念的文字（Better DSH 的球体界面负责播放）。
- `filePath` 与 `outputPath` 的相对路径按当前会话工作区解析；未给 `outputPath` 时在工作区生成 `deepseek-tts-<时间戳>.wav`。

## 了解实现

[api.ts](src/api.ts) 是纯传输层：显式接收 baseUrl、凭证、fetch 与 AbortSignal，把 HTTP 失败映射成带状态、Provider 代码与可重试标记的 `DeepSeekApiError`。TTS Provider 与识别 Provider 都复用同一套传输与账号授权；TTS Provider 只返回编码后的音频字节，从不写文件。

## 进一步探索

- [better-bundle](../better-bundle/README.zh.md)：球体形态的组合与 `manage` 预设。
- [语音合成](../../../docs/subsystems/text-to-speech.zh.md)：Provider 注册表与选择。
- [语音输入](../../../docs/subsystems/voice-input.zh.md)：识别 seam 与麦克风采集。

## 模型体验

### 四个工具

#### What the model sees

四个工具调用 DeepSeek 应用 API：`deepseek_ocr`、`deepseek_asr`、`deepseek_tts`、`deepseek_speak`。每次成功调用返回一段给模型看的文本，`deepseek_speak` 返回字符数并附带只给客户端看的 `speak` 展示元数据。

#### Token effect

每个挂载本包的 Agent 每次请求都带四个工具 schema 的固定成本；OCR 与识别结果受 `maxOutputChars` 截断，截断处明确标注省略了多少字。

#### KV Cache effect

schema 与描述在组合不变时是稳定前缀；每次调用只往后缀追加结果文本。`speak` 展示元数据不进入模型内容。

## 已知限制与延期工作

- `deepseek_speak` 只在挂载了语音播放服务（`ctx.voiceOutput`）的界面里发声；没有播放服务的进程静默跳过。
- 与外部 `@dsh-external/dsh-deepseek-suite` 同时安装会重复注册工具名与 Provider id；装内置版本时不要再装外部版本。
- 管理页（原外部套件的插件详情表单）未移植：凭证名、超时、输出目录通过本包的 `Config` 在组合里配置。
- `deepseek_ocr` 单文件上限 100 MiB、1000 页；接口错误按原样返回。
