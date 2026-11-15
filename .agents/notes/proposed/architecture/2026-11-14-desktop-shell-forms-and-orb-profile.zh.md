# Agent Note: 桌面 shell form 与 orb profile

Status: proposed

[English](2026-11-14-desktop-shell-forms-and-orb-profile.md) | 中文

## Problem

Desktop 应用只呈现一个工作区窗口。[apps/desktop/src/main.ts](../../../../apps/desktop/src/main.ts) 创建单个主 `BrowserWindow` 和一个 welcome 窗口，其余界面——更新对话框、强制更新 UI、Platform 账户视图——都是内嵌的 `WebContentsView`，而不是窗口。shell 中没有任何地方使用置顶、透明或无边框窗口，也没有使用 `globalShortcut`；[apps/desktop/tests/main-startup.spec.ts](../../../../apps/desktop/tests/main-startup.spec.ts) 甚至断言从不调用 `setAlwaysOnTop`。麦克风授权在 [apps/desktop/src/microphone-permissions.ts](../../../../apps/desktop/src/microphone-permissions.ts) 中被限制在主的 `dsh-app://app` frame 内，Host 认证 cookie 只附加到该窗口的 WebSocket，应用内快捷键目录只有一座键盘桥接。客户端也只有一个 frame：[ui-layout](../../../../packages/client/ui-layout/src/client/index.ts) 注册唯一的 `root` 占用者，并声明其他 UI 插件注册的所有 frame 席位。

语音输入已经存在，但被限制在 composer 范围内。[client-ui-voice-input](../../../../packages/experimental/client-ui-voice-input/src/client/mount.ts) 在 `conversation.input.activity` 中挂载录音控件，并在该控件卸载、失焦或页面隐藏时拆除采集。Host 侧提供带已认证 Remote 的 speech-to-text seam，可选实验性组合包只随附本地 SenseVoice 识别器；[speech-to-text 参考](../../../../packages/experimental/speech-to-text/README.zh.md)记录语音合成没有任何 service 方法。仓库之外的 `@dsh-external/dsh-deepseek-suite` 组合包按 profile 安装、不属于本仓库，它已经把官方 DeepSeek 语音接口包装成面向模型的 `deepseek_asr` 与 `deepseek_tts` 工具，但不注册任何 Cordis 服务，因此 UI 或其他插件都无法在不消耗一次模型轮次的情况下使用这两个接口。仓库中不存在音频播放、text-to-speech 服务或 voice-output 消费方。

profile 是组装单元。随附模板为 [official-bundles](../../../../packages/util/official-bundles/src/bundles.ts) 中的 `acp`、`web`、`headless`、`sdk` 与 `sdk-minimal`；Electron 拥有 `$DSH_HOME/profiles/desktop`，并从 [paths.ts](../../../../apps/desktop/src/paths.ts) 的固定路径启动完全等于 `desktop` 的 profile 名称。Desktop 无法启动其他 profile，因此无法通过 profile 选择另一种桌面 form。

本文提出由新的 `better` profile 激活的新 dsh form：桌面侧边悬浮 orb、展开聊天框、桌面模态呈现、OS 全局快捷键，以及基于官方 DeepSeek 接口的语音输入与语音输出。该 form 保持为同一随附运行时、同一 Host↔page 协议之上的 Cordis 组装；它不是应用的分支。


## Proposal

本提案由一起交付的三部分组成。第一，产品 shell 能力渲染 profile 所声明的任一 form：一个带三种呈现的产品窗口、一个客户端 surface 服务，以及 system 作用域命令。第二，一个实验性可选组合包用该能力与新的客户端插件组装 orb form。第三，一个语音层把麦克风采集与 composer 解耦，让识别与合成都走由外部 suite 组合包拥有的官方 DeepSeek 接口，并补上缺失的语音合成 seam 与播放消费方。官方接口留在仓库之外的 suite 中，由它新增两个 provider 注册；产品侧改动是增量的，classic profile 保持当前窗口、快捷键与语音行为。


### Profile 声明 form

profile manifest 增加两个可选字段。`form` 声明该 profile 请求的 shell 呈现；`owner` 标记那些可执行包只由 Desktop 管理的 profile，这正是目前应用于 `profiles/desktop` 的规则。

```text
interface DshProfileManifest {
  bundles?: string[]
  owner?: 'desktop'
  form?: { kind: 'classic' | 'orb' }
}
```

该类型扩展 [DshProfileManifest](../../../../packages/util/package-manifest/src/types.ts)。缺少 `form` 表示 `classic` 并保留每个既有 profile。未知或格式错误的 kind 会让 Desktop 启动失败，并给出一个可见错误，指明 profile 与受支持的 kind；它绝不静默回退，因为请求了某个 form 的 profile 不应以另一种 form 启动。[app-boot](../../../../packages/boot/app-boot/README.zh.md) 在加载 profile 目录时校验该字段，使 CLI 预览与 dump 报告同一对象。

Desktop 在启动 Host 之前同步读取 profile manifest，因为透明和置顶这样的窗口选项在构造之后无法更改。这排除了通过组合包 patch 条目或 Host 启动注入来声明 form 的做法，因为二者都只有 Host 就绪后才可知。profile 创建是 Desktop 流程：Settings 的 form 界面列出声明了 `dsh.bundle.form` 的已安装可选组合包，从其中一个创建 form profile 时，会把 web 模板的组合包列表、该 form 声明点名的组合包以及 form 组合包本身写入一个新的 Desktop 拥有的 profile。该声明在两侧并存，供不同读取方使用：组合包元数据向创建者宣传一个 form，而 profile manifest 才是运行时权威。

启动选择使用显式 profile 名称：打包应用的 `--profile <name>` 参数和 `dsh://open?profile=<name>` 深链接。省略选择时保持 `desktop` profile。CLI 继续对 `dsh plugin` 与 profile 初始化拒绝带 `owner: 'desktop'` 的 profile 名称，完全如同它今天拒绝保留的 `desktop` 名称，因此两个管理器绝不写同一个 profile 的可执行包。

### 一个产品窗口的三种呈现

form 使用一个产品窗口并改变其呈现，而不是为每个 surface 创建一个窗口。呈现是 shell 状态；内容是同一个客户端应用。三种呈现即所要求的桌面界面。

| 呈现 | 几何 | 窗口行为 | 内容席位 |
|---|---|---|---|
| `orb` | 112×112 逻辑像素，由用户放置，限制在显示器工作区内 | 无边框、透明、置顶、不在任务栏显示、orb 之外点击穿透 | `shell.overlay` |
| `panel` | 默认 560×160，锚定在 orb 旁或屏幕边缘，可在工作区边界内调整大小 | 无边框、透明卡片，未固定时失焦仍置顶，点击外部或按 Escape 即收起 | 形态自有的聊天框：一个提问输入框与一个发送按钮 |
| `modal` | 显示器大小的变暗背景上最多 720 像素的居中卡片 | 无边框、透明、置顶、焦点锁定，Escape 关闭顶层 | `shell.modal` |

单窗口是刻意约束。每个渲染器都会独立消费同一批已认证数据流：审批与用户问题是只有一次回答的 Remote waterfall（瀑布式事件），第二个渲染器会并发认领它们、重复麦克风授权、扩大 cookie 过滤范围，并重复快捷键目录。因此 panel 渲染形态自有的聊天框，而不是第二个分叉的会话实现：提问经注入的 sessions 服务发送到最近的会话，回复、审批与提问因此留在 form 之外，语音朗读是 form 内听到回答的方式。之后拆分为独立 surface 渲染器被记录为后续工作，而不是在此假定。

呈现切换由 Electron 主进程拥有，并由渲染器通过 surface API 请求。点击 orb、按切换命令或收到注意事件会展开聊天框并聚焦其输入框。Escape、收起窗口、点击未固定聊天框的外部、一次被接受的提交或再次按切换命令会回到 orb；固定的聊天框保持可见。`presentModal` 从当前呈现升起模态呈现，关闭后恢复先前呈现与焦点。最后的固定状态与 orb 位置以 schema 版本持久化在 `userData/form-layout.json`；不可读或未来版本文件回退到默认值，窗口在显示指标变化时重新限制。

点击穿透是透明 orb 所必需的：渲染器报告指针是否在范围内，当指针位于 orb 及其拖拽把手之外时，主进程调用 `setIgnoreMouseEvents(true, { forward: true })`。拖动 orb 使用显式指针跟踪和节流的位置 IPC，而不是 CSS app-region 拖动，因为 app-region 拖动区不会投递点击穿透命中测试所需的指针事件。边界写入在主进程中按目标显示器工作区限制；渲染器从不设置原始屏幕坐标。

### 启动、生命周期与窗口归属

form profile 在四处改变启动。产品窗口在导航前以 form 的窗口选项创建，而不是 1280×820 的工作区窗口。welcome 窗口、首次使用引导、登录与更新流程保持当前行为；当首次运行需要引导时，产品窗口在进入工作区后创建。关闭产品窗口会像今天一样隐藏它；托盘图标、第二次启动、dock 激活与 `dsh://open` 恢复最后的呈现。退出确认、更新安装、任务中断与计划任务上报保持不变。

shell 拥有的覆盖层假定 owner 是正常大小的窗口。在更新对话框或强制更新覆盖层于 form 窗口打开之前，主进程要求 form 进入 panel 呈现，因此更新提示绝不会渲染在 112 像素的 orb 上。随后更新覆盖层以产品窗口作为 owner 挂载。如果渲染器无法进入 panel 呈现，shell 回退到消息框确认路径，而不是显示被裁剪的覆盖层。

散落的 `mainWindow` 假定合并为一个产品窗口注册表，其中也包含 form 窗口：麦克风授权、Host cookie 的 WebSocket 过滤、键盘挂载、主题与语言 fan-out、更新覆盖层归属以及退出检查都从注册表解析，而不是从单个变量解析。该注册表是 shell 的主要重构，也是 welcome 窗口、form 窗口与任何未来界面共享同一生命周期的必要条件。

### 客户端 surface 能力

新的产品客户端包 `packages/client/surface` 定义客户端 surface 能力：一个建立在共享协议类型之上的 Cordis 服务 `ctx.surface`，preload、Electron 适配器与测试都导入该协议。服务暴露一个快照与若干命令。

```text
interface SurfaceSnapshot {
  form: 'classic' | 'orb'
  presentation: 'orb' | 'panel' | 'modal'
  pinned: boolean
  available: boolean
}
interface SurfaceService {
  snapshot(): SurfaceSnapshot
  follow(signal: AbortSignal): AsyncIterable<SurfaceSnapshot>
  expand(): void
  collapse(): void
  presentModal(id: string): void
  dismissModal(): void
  setPinned(pinned: boolean): void
}
```

Electron 适配器调用 preload 产品 API 新增的 `surface` 区块，主进程针对 form 窗口、`dsh-app://app` 来源与顶层 frame 校验它。惰性载体适配器报告 `available: false` 与 `classic`；Web 页面保持 classic 呈现，页面级 orb 回退明确不在本提案范围内。boot 载荷发生变化：`dsh-desktop:boot` 处理器目前为每个渲染器返回同一个全局对象，现在改为按发送者返回，携带相同的 Host 注入加上 surface 描述符。[apps/web/src/main.ts](../../../../apps/web/src/main.ts) 在应用注入之前保存该描述符，因此客户端服务读取一个类型化全局变量，而不是从 DOM 状态推断 form。

### 感知呈现的 frame

[ui-layout](../../../../packages/client/ui-layout/src/client/index.ts) 仍是 frame 的所有者，并获得感知呈现的分支。它读取可选的 `ctx.get('surface')` 服务，因此没有 surface 条目的 classic profile 精确渲染今天的 frame。对于 `orb` 与 `modal` 呈现，它渲染透明根、既有 `shell.overlay` 席位以及新的 `shell.modal` 列表席位，并设置 `data-surface` 属性供 CSS 使用。对于 `panel`，它以 `data-surface="panel"` 渲染 classic frame，去掉窗口 chrome 留白、收窄内边距并使用既有窄布局行为。因此，已经在文档内使用 `Modal` 原语的产品对话框无需第二套实现即可在 panel 内继续工作。

`shell.modal` 是模态内容席位。form 组合包在那里注册模态内容，`ctx.surface.presentModal(id)` 选择活动条目；ui-layout 渲染背景、活动条目与焦点锁定，并把 Escape 与背景点击路由回 `dismissModal()`。这使模态呈现成为组装结果，而不是 shell 的分支。

### System 作用域快捷键

[shortcuts](../../../../packages/client/shortcuts/README.zh.md)目前建模的是应用命令，其绑定仅在某个产品窗口聚焦时由主进程拦截。命令定义增加 `scope` 字段：默认 `application`，或用于 OS 全局注册的 `system`。System 命令仅限桌面，只接受一个普通键加零到四个修饰键，拒绝两键组合、裸修饰键与 Web profile 默认值，且不能与应用绑定重复。命令所有者保留既有 `resolve` 约定，因此命令可以像今天一样根据模态与焦点状态作决定。

Desktop 键盘桥接在聚焦窗口拦截旁增加全局注册模块。启动后，渲染器发送 system 命令定义与已接受的绑定；主进程推导 Electron accelerator，调用 `globalShortcut.register`，并按命令报告注册结果。注册失败——已被 OS 或其他应用占用——会报告给渲染器并显示在 Settings 中，先前已接受的绑定保持不变。快捷键录制 UI 激活期间暂停注册，退出时释放。全局激活作为带修订版本标记的命令事件转发给产品窗口，客户端注册表完全像聚焦窗口绑定一样执行它。

持久化在 `userData/keybindings.json` 中增加 `system` 覆盖映射与新的 schema 版本；既有的版本 1 和版本 2 文件保持当前行为，不可读或未来版本文件仍阻止编辑。[ui-shortcuts](../../../../packages/client/ui-shortcuts/src/client/index.ts) 增加 Global 分组，显示注册状态与不可用的平台组合。Web 与 Linux 的聚焦窗口模型不变。

Electron `globalShortcut` 不暴露按键抬起回调，因此本提案中的 push-to-talk 是按下开始、再按停止。按住说话手势需要原生按键状态轮询；这被记录为后续工作，而不是被模拟。系统保留的 macOS 组合、媒体键以及 Wayland 合成器限制会通过同一 Settings 状态表现为注册失败。

### 语音输入

采集变成客户端服务，而不再是 composer 组件。新的实验性客户端包承载 `ctx.voiceCapture`：它拥有录音器、麦克风设备偏好、WAV 编码与 `remote.speech.transcribe` 调用，并暴露 begin、cancel 与 finish 以及一个 surface 与测试可观察的快照。既有的 [client-ui-voice-input](../../../../packages/experimental/client-ui-voice-input/src/client/mount.ts) 包成为一个消费方：它的 composer 控件保留当前交互，但录音器生命周期不再随该控件卸载而结束。两个新消费方使用同一服务：orb 语音控件与全局 push-to-talk 命令。

识别使用官方 DeepSeek 接口，而不是本地模型。外部 `@dsh-external/dsh-deepseek-suite` 组合包在既有 speech-to-text seam 上注册 id 为 `deepseek-cloud` 的 `SpeechProvider`；它把 `remote.speech.transcribe` 送来的规范 16 kHz 单声道 PCM16 WAV 以 multipart 表单提交到 `POST /v1/tools/asr`，并返回响应中的 `text`。该 provider 声明处理位置为 `cloud`、只接受 `auto` 语言提示、不提供 preparation 任务、每次调用经 `ctx.credentials` 按 suite 配置解析 `DEEPSEEK_API_KEY` 凭证并沿用其回退，同时复用 suite 的 `baseUrl`、请求超时与类型化错误分类。凭证缺失、密钥无效、余额不足、限速、音频过大、超时与服务端故障都映射到 seam 的类型化失败；panel 显示本地化文案并提供跳转到模型设置的操作，且不会自动重试，因为每次重试都计费。

投递保持显式。完成的 transcript 在 classic 框架拥有 composer 时经既有 `InputActions.insertText` 路径填入活动会话的草稿；在 orb 形态中，surface 服务展开聊天框，由输入框接收暂存的转写。聊天框以最近编目的会话为目标，目录为空时创建空白会话。免提设置可以选择提交 transcript 而不是预填；该提交走普通 `session.prompt` 路径，因此模型可见文本是普通的持久 `user/message`。仅识别仍然不写 Session 事件，录音从不落盘或进入附件存储，且上传会作为一次到配置的 DeepSeek 端点的计费请求向用户说明。

麦克风授权跟随窗口注册表：form 窗口的 `dsh-app://app` 主 frame 像 classic 主 frame 一样被授权，且仅在 form profile 激活期间。权限拒绝、设备缺失与两分钟采集上限会释放音轨并丢弃录音。由于识别在云端，录音只在用户结束采集并请求转写后才离开本机；取消不会上传。


### 语音输出

语音输出由 Host 能力 seam 与客户端播放消费方共同组成，因为官方 DeepSeek 合成接口是需要凭证的 Host 调用，而音频播放属于渲染器。新的实验性 Host 包定义 `ctx.textToSpeech`：带语音与格式目录的具名 provider、经 settings 服务持久化的易变 `defaultProvider`、`voiceId` 与 `format` 选择、快照与 `follow`，以及与 speech-to-text seam 对称的 `resolve`、`synthesize` 与取消。新的 `api-text-to-speech` 包通过已认证 Remote 以 `speechOutput` 命名空间暴露相同操作，并限制 `maxTextChars`、`maxAudioBytes` 与 `timeoutMs`；结果携带瞬态的 base64 WAV 字节，从不成为 Session 事件或附件。

provider 是外部 suite。`@dsh-external/dsh-deepseek-suite` 注册 id 为 `deepseek-tts` 的 `TextToSpeechProvider`，复用其现有 `synthesizeSpeech` 客户端：向 `POST /v1/tools/tts` 发送 `{ text, voice_id, format, filter_markdown: true }`，使用 `stella` 与 `tide` 音色及 `wav` 输出。凭证解析、base URL、请求超时与错误分类留在 suite 中，并与识别 provider 一致。该 provider 只返回音频字节、从不写文件，因此合成没有持久产物；既有 `deepseek_tts` 工具对显式的模型调用保留其写文件行为。

新的客户端消费方 `client-ui-voice-output` 拥有播放策略：自动朗读关闭、朗读由语音发起的轮次，或朗读全部回复；音色与静音选择；新轮次、Escape 或显式停止时的排队与中断；为 orb 发布朗读状态；以及本地化失败文案。它发送活动会话的 assistant 文本并按 Remote 上限截断，provider 的 `filter_markdown` 请求会在合成前去除 Markdown。音频播放、队列与朗读状态保持进程内，且从不成为 Session 事件；工具输出从不朗读，合成从不进入模型请求。


### better 组合包及其包

该 form 是一个可选实验性组合包，像既有语音输入组合包一样随安装一起交付，带 icon 与 locale 元数据。其 manifest 声明它提供的 form；其 patch 插入该 form 所需的 surface、orb、采集与语音条目，并配置外部 suite 注册的 provider id。新的实验性包使用不带前缀的 `@deepseek-ai/dsh-<name>` 形式并加入 `EXPERIMENTAL_PACKAGE_NAME_EXCEPTIONS`，而既有的遗留前缀语音包保留原名。

```yaml
- insert:
    - id: client-surface
      name: '@deepseek-ai/dsh-client-surface'
    - id: client-ui-orb
      name: '@deepseek-ai/dsh-client-ui-orb'
    - id: client-voice-capture
      name: '@deepseek-ai/dsh-client-voice-capture'
    - id: speech-to-text
      name: '@deepseek-ai/dsh-experimental-speech-to-text'
      config:
        defaultProvider: deepseek-cloud
        language: auto
    - id: api-speech-to-text
      name: '@deepseek-ai/dsh-experimental-api-speech-to-text'
    - id: ui-voice-input
      name: '@deepseek-ai/dsh-experimental-client-ui-voice-input'
    - id: text-to-speech
      name: '@deepseek-ai/dsh-text-to-speech'
      config:
        defaultProvider: deepseek-tts
        voiceId: stella
        format: wav
    - id: api-text-to-speech
      name: '@deepseek-ai/dsh-api-text-to-speech'
    - id: client-ui-voice-output
      name: '@deepseek-ai/dsh-client-ui-voice-output'
```

| 包 | 角色 | 状态 |
|---|---|---|
| `packages/client/surface` | 客户端 surface 服务定义、Electron 适配器、惰性适配器、共享协议 | 产品包，optional 分类 |
| `packages/experimental/better-bundle` | form 组装、可选组合包元数据、form 声明 | 实验性 |
| `packages/experimental/client-ui-orb` | orb 渲染、状态、菜单、命令、form 设置 | 实验性 |
| `packages/experimental/client-voice-capture` | 从既有语音输入 UI 中提取的录音服务 | 实验性 |
| `packages/experimental/text-to-speech` | Host 语音合成 Service Definition 与 provider 注册表 | 实验性 |
| `packages/experimental/api-text-to-speech` | 已认证语音合成 Remote 消费方 | 实验性 |
| `packages/experimental/client-ui-voice-output` | 播放消费方、自动朗读策略、语音控件 | 实验性 |

profile 配方是 web 模板组合包加上 better 组合包，并把仓库之外的 suite 从其本地目录通过插件管理器安装进同一 profile，同时在 profile manifest 中写 `form: { kind: 'orb' }` 与 `owner: 'desktop'`。组合包配置 provider id `deepseek-cloud` 与 `deepseek-tts`；当 suite 缺失或注册了不同 id 时，两个语音 seam 都会在加载时明确失败，并指出期望的 provider 与安装步骤。better 组合包获准进入 `OPTIONAL_BUNDLES`，因而进入安装依赖，这正是让可选实验性组合包以默认关闭状态随附的隔离例外（[决策](../../implemented/architecture/2026-09-21-experimental-capabilities-as-optional-bundles.zh.md)）。它不出现在任何随附 profile 模板中。


### 交互设计

orb 反映状态而不是文字：空闲时变暗、悬停时响应、采集时显示波形、活动会话运行时旋转、朗读时脉动，并在审批或提问等待时显示注意圆点。拖动移动它，点击展开聊天框，右键菜单提供固定、静音、自动朗读策略、语音开关、语音采集与语音设置；新建会话或退出项仍为后续工作。减少动态效果设置会去掉旋转与脉动动画，每个 orb 状态都有一个本地化无障碍标签。

展开的聊天框只有一个提问输入框与一个发送按钮，没有会话、标题或设置界面：Enter 或按钮把提问发送到最近的会话并折叠聊天框，Shift+Enter 换行，Escape 不发送直接折叠，被拒绝的提交保留在框内并显示本地化文案。orb 上的麦克风按钮无需打开聊天框即可开始采集，并展开聊天框把暂存转写放入输入框。审批与提问卡片留在会话中，既有插件已在那里渲染它们；orb 不为它们加徽标或展开。

模态呈现由 form 拥有：首次使用的凭证或语音设置、权限修复、form 致命错误与快速语音设置卡片使用 `shell.modal`。Escape 与背景会关闭它，焦点回到先前呈现，从 orb 打开的模态以 orb 的屏幕位置为锚点。模态呈现中的任何内容都不替换既有产品对话框；这些对话框保持其在聊天框窗口内的 `Modal` 行为。


### 日志与持久性

该 form 不引入 Session 事件、不改变持久化格式、除普通用户消息外不增加模型请求内容。语音 transcript 仅在普通提交后才对模型可见，而提交已经记录 `user/message` 与 composer 草稿路径；录音与合成音频都是瞬态字节，从不进入 Session 日志、附件或磁盘。送去合成的 assistant 文本就是已经记录的消息；语音播放、呈现、固定状态与 orb 几何是进程内或用户设置。profile 的 `form` 与 `owner` 字段是本地配置，由 Desktop 应用与 profile 工具读取，与会话格式版本没有关系。这保持了「模型可见即已记录」规则与已发布会话格式规则不变。


### 安全

新的 surface API 是唯一新增的特权渲染器边界。主进程只接受来自 form 窗口 `dsh-app://app` 顶层 frame 的调用，按封闭联合类型校验每个命令，把所有几何限制到已连接的显示器工作区，并且从不暴露任意窗口或屏幕控制。全局快捷键同步校验封闭的目录形状与绑定命令数量，注册失败不会让 shell 崩溃。profile 的 `owner: 'desktop'` 由 CLI 拒绝路径强制，而不是靠隐藏文件。麦克风授权只加到 form 窗口；classic 窗口的检查不变。form 布局文件带版本并被视为不可信输入。Host↔main 的 Node IPC 协议不扩展：窗口与快捷键控制走类型化 preload API，与既有 directory-picker、键盘和文件拖拽边界一致。

语音按设计跨越网络，并作为需要凭证、按次计费的用户数据处理。suite 的 provider 每次调用经 `ctx.credentials` 解析 `DEEPSEEK_API_KEY` 凭证，除本机回环测试服务器外只接受 HTTPS base URL，从不记录或持久化密钥，并让密钥不进入渲染器与 Remote 载荷。浏览器只发送 WAV 字节或文本，Host 再发送到配置的 DeepSeek 端点，因此录音与朗读文本都会离开本机，设置文案会说明这一点以及按次计费。DSH 不保留任何音频，合成请求不会自动重试，Remote 限制文本长度、音频大小与超时，合成失败的报告不会暴露 provider 诊断或凭证。


### 测试与文档

测试遵循仓库的阶梯。单元 spec 覆盖 profile form 解析与拒绝、窗口几何持久化与限制、用 mock Electron API 验证全局注册结果、surface 协议校验、感知呈现的 frame 渲染、以 stub provider 验证 speech-to-text 与 text-to-speech seam、Remote 边界与类型化错误、采集服务与播放消费方。suite 自身的单元与集成测试继续用本地 HTTP stub 覆盖官方 API 客户端，包括 multipart 布局与 TTS 字节处理，仓库测试复用同样的 stub 模式而不访问真实端点。mock 的 main-startup harness 增加新的窗口注册表与 form 窗口，并将既有「未使用置顶」断言替换为关于 form 窗口选项的断言。REAL 组合 Loader 测试用 better 组合包、stub 语音 provider 与 form 声明启动测试 profile，断言注入的条目、默认 provider id 与 form 元数据。GUI 测试用驱动的 props 覆盖 panel、orb 与模态呈现，无密钥的 Web replay 套件覆盖保持不变的 classic profile。包 README、apps/desktop README 中关于 form 与 system 快捷键的章节、shell form surface 与 speech-synthesis seam 的子系统页面以及分组 README 行随实现一起落地。实验性组合包通过 `OPTIONAL_BUNDLES` 获准；产品客户端包在 [product-package-policy](../../../../scripts/product-package-policy.ts) 中分类为 optional，因为只有显式选择该 form 的 profile 才挂载它。


## Alternatives considered

**把该 form 作为第二个 Electron 应用交付。** 应用启动规则只允许 dsh profile 启动受支持的 Node 应用，且第二个 shell 会重复打包、签名、更新与 Host 运行时。profile 选择器复用同一个已签名 shell。

**把 orb 做成既有窗口内的页面级覆盖层。** shape 插件的先前实践证明这对页内界面很便宜，但它无法浮在其他应用之上、无法接收 OS 全局快捷键或呈现真正的桌面模态，而且随页面消失。它只是未来 Web 回退的正确设计。

**通过既有 desktop profile 启用该 form，而不是新 profile。** 这会把新 form 泄漏到每次 Desktop 启动，并使语音与 orb 插件无法与 classic 工作区分离。用户要求的是由 profile 激活的 form，而 profile 正是这种组装的单元。

**为 orb、panel 与模态使用三个独立窗口。** 独立渲染器会各自消费同一批 Remote waterfall，并发认领审批与提问，各自需要麦克风与 cookie 授权，并各自重复快捷键目录。一个窗口的三种呈现保持一个 UI 所有者，同时仍满足所要求的三个界面。一旦存在按 surface 作用域的客户端图，之后拆分是可能的。

**通过新的 Host↔main 协议从 Host 侧插件驱动窗口。** 今天没有通用请求/响应通道，只有用于生命周期与诊断的封闭事件联合。新增一个会制造第二个面向插件的原生边界与新的窗口生命周期所有者。由渲染器驱动的类型化 preload API 符合既有原生命令模式，并让 Host 不参与窗口管理。

**通过组合包 patch 条目或 Host 启动注入声明 form。** 二者都只有 Host 就绪后才可知，而透明与置顶窗口必须在构造时选择选项。profile manifest 可同步读取，且已经是组装记录。

**在 `PROFILE_TEMPLATES` 中随附 `better` profile 模板。** 默认产品隔离门禁拒绝随附模板中的实验性包，而实验性 form 必须保持可选。form profile 改为创建为 Desktop 拥有的 profile，组合包通过 `OPTIONAL_BUNDLES` 获准。

**保留本地 SenseVoice 识别器与平台系统语音。** 可选组合包已经随附离线识别器，浏览器也提供系统语音用于播放，但该 form 必须使用官方 DeepSeek 接口，而混用引擎会把质量、凭证、计费与失败语义拆成两条路径。本地 provider 与系统语音仍可供选择它们的 profile 使用，但不用于此 form。

**通过一次 agent 轮次调用 suite 的面向模型工具 `deepseek_asr` 与 `deepseek_tts`。** 这些工具已经包装同一批端点，但 push-to-talk 交互不能等待模型决策、消耗 token，或仅仅为了转写或朗读就产生一次工具调用；provider 角色暴露同样的客户端函数而不改变模型契约。

**在新的仓库 provider 包中复制官方 API 客户端。** suite 已经拥有凭证解析、base URL 校验、超时、multipart 编码与错误分类；复制会造出两个会漂移的客户端与两处处理计费错误的地方。把唯一所有者留在 suite，使本仓库只保留 service、Remote 与消费方角色。

**用原生按键状态监听实现 push-to-talk。** Electron 对全局快捷键不暴露按键抬起，因此这需要在第一版中引入新的原生模块与打包工作。本版本交付切换语义；按住说话仍是后续的 provider 决策。

**按 surface 作用域限定客户端插件，并为每个 surface 渲染各自图。** 那是内存与隔离的长期形态，但它改变模块图、每个 frame 注册以及文档间对话框仲裁。一个窗口使该问题在本提案中不再必要。


## Acceptance criteria

`better` profile 可从 Settings 或文档配方创建，列出 web 模板组合包加上语音输入与 better 组合包，声明 `form: { kind: 'orb' }` 并标记为 Desktop 拥有；CLI 拒绝管理它。

用该 profile 启动 Desktop 后显示收起的 orb，浮于其他应用之上，不在任务栏显示，且 orb 之外的点击穿透。

点击 orb 或按切换快捷键会展开一个聊天框，其中只有一个提问输入框与一个发送按钮；Enter 或按钮把提问发送到最近的会话并折叠聊天框，Escape 或点击外部不发送直接回到 orb；固定的聊天框保持打开；几何与固定状态在重启后保留，并在显示器变化后仍位于工作区内。

`presentModal` 显示变暗、焦点锁定的模态呈现，在 Escape 或背景点击时关闭，并恢复先前呈现与焦点。

默认 system 快捷键在 Windows 与 macOS 上注册；冲突绑定在 Settings 中报告失败并保留先前绑定；录制期间暂停注册，退出时释放所有 accelerator；classic profile 不注册任何快捷键，Web 保持不变。

push-to-talk 在 orb 收起时采集，经官方 DeepSeek ASR provider `deepseek-cloud` 转写，展开后把 transcript 插入活动会话草稿，仅在免提启用时提交，并在该情况下产生普通 `user/message`；API Key 缺失或无效、余额不足、限速、录音过大与超时都显示本地化、可操作的文案，且不下载任何本地模型。

回复经官方 DeepSeek TTS provider `deepseek-tts` 使用选定的 `stella` 或 `tide` 音色按配置的自动朗读策略合成，在新轮次或显式停止时停止，从不朗读工具输出，且不在 Session 日志、附件或磁盘上留下音频；合成请求不会自动重试。

main-startup、几何、快捷键、surface、语音 provider、Remote 与组合 spec 通过；`pnpm run test:gui`、`DSH_SNAPSHOT=replay pnpm run test:web`、`pnpm run typecheck`、`pnpm run lint` 与文档门禁为绿；在 better 组合包作为可选组合包获准的情况下隔离门禁保持为绿。

## Risks

透明、无边框与置顶窗口在 Windows、macOS 与 Linux 合成器之间行为不同；焦点、点击穿透、全屏 Spaces 与动画时序需要逐平台人工矩阵，且既有关于置顶的启动断言必须有意识地改变，而不是顺带改变。

单窗口形变避免了重复渲染器，但集中了布局风险：用聊天框取代会话会把回复留在 form 之外，而边界与内容同时变化时呈现切换可能闪烁。动画过渡与 form 内回复文本是后续工作。

Electron `globalShortcut` 无法报告按键抬起、没有原子冲突检查，并且在部分 Wayland 合成器下不可靠；切换交互与 Settings 报告是诚实的限制，而不是与聚焦窗口快捷键的完全对等。

把麦克风与 WebSocket 授权扩大到 form 窗口会削弱目前由单变量检查构成的安全不变量；窗口注册表、封闭命令联合与拒绝路径测试必须同一改动中落地。

官方语音路径依赖一个位于本仓库之外、通过 profile 链接安装的外部组合包：它的 provider id、凭证名、默认 base URL 与错误分类构成本设计引用的契约，suite 升级必须保持两个 provider 注册兼容，否则 form 会在加载时明确失败。该包的所有权、评审与发布仍归 suite。

语音从此依赖网络、凭证与计费。识别与合成增加往返延迟、按次收费、会在 401/402/429/5xx 下失败，并把录音或朗读文本发送到配置的 DeepSeek 端点；第一版没有本地回退，离线与隐私敏感部署受限，设置与失败文案必须说明这一点。

form profile 是 `$DSH_HOME` 下由 Desktop 拥有的数据；较旧的 dsh 版本会忽略新 manifest 字段，但写入 profile 之后的任何降级都必须继续以 classic 启动该 profile 而不是失败，上述宽容读取器明确支持这一点。

第一版不交付 Web 回退、不交付按住说话手势，也不交付流式合成或部分 transcript；这些是可见的产品缺口，form 的实验性状态必须说明而不是隐藏。

## Deferred work

流式合成与播放、部分 ASR transcript、按消息的朗读操作，以及面向无法把音频发送到云端端点的部署的可选本地或离线语音回退。

用于按住说话 push-to-talk 的原生按键状态轮询，包括其打包与权限后果。

按 surface 作用域的客户端插件图，以及 orb 与模态 surface 的独立渲染器（若内存或对话框仲裁需要）。

在 Desktop 之外查看 profile 时，在页面内渲染 orb 与 panel 的 Web 载体回退。

专用轻量 panel UI、呈现过渡的动态设计，以及每个受支持平台的屏幕阅读器审计。

唤醒词激活、多显示器锚定偏好，以及多个会话同时需要用户时按 surface 的注意路由。
