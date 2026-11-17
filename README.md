# Better DSH

中文 | [English](README.en.md)

> 基于 DeepSeek Harness 的桌面 agent 交互形态：让 agent 常驻桌面，而不是成为一个需要造访的窗口。

你是否受够了传统窗口 agent 交互的繁文缛节？Better DSH 把 agent 从「需要造访的窗口」变成「桌面上的常驻存在」：看视频、听歌、浏览帖子时，随时唤出工作台交代任务；回答在悬浮球旁升起，进度不用切窗口看。交互层建立在 DeepSeek Harness 之上，复用它的会话、工具与输入框，而不是另造一套。

## 核心理念

- **存在感优于导航**：悬浮球常驻桌面，需要时唤出工作台，不需要时不占一块屏幕。
- **环境化输出**：正在书写的回答以流式气泡出现在悬浮球旁，已完成的回答进入历史；查看进度不需要切换窗口。
- **工作区即工作单元**：工作台为每个工作区提供一页，该页的会话成为会话面板旁的书签；切换工作区就是切一页。
- **键盘优先**：打开工作台、切换页面、聚焦会话、选中与新建都可以在键盘上完成。
- **复用既有能力**：工作台直接渲染 Harness 的共享会话内容，转录、工具调用与输入框和 classic shell 一致，不另造一套会话。

## 功能

### 悬浮球与回答气泡

悬浮球常驻桌面。指针进入悬浮球时升起历史气泡列；流式回答出现时气泡列自动升起，并保持到 agent 停止。每个气泡预览有限行，点击任一气泡即可打开它所属会话的工作台。

### 工作台

工作台是无边框、居中的 Fluent 悬浮面板：工作区卡片位于会话面板上方，当前页面的会话以书签卡片排列在面板左侧外部。当前会话带强调色条，键盘光标带独立的选中环，两者可以同时出现，分别表示「正在看的会话」与「准备切换的会话」。

| 快捷键 | 作用 |
|---|---|
| `Ctrl+Alt+W` | 打开最近使用的工作台页面 |
| `Ctrl+Tab` / `Shift+Ctrl+Tab` | 切换工作区页面 |
| `Ctrl+Q` | 聚焦会话书签；方向键移动选中环，回车切换 |
| `Ctrl+Alt+N` | 打开文件夹选择窗口，添加或复用工作区 |
| `Ctrl+N` | 在活动页面的工作区创建新会话 |

以上快捷键默认在 Windows 与 macOS 的 Desktop 上绑定，可在设置中修改。悬停工作区卡片或会话书签会显示完整名称与绑定快捷键。工作台会记住上次使用的页面与会话。

## 主要模块

| 模块 | 职责 |
|---|---|
| [packages/experimental/better-interact](packages/experimental/better-interact/README.zh.md) | Better DSH 的悬浮球气泡与工作台插件：overlay 与 modal 条目、工作区页面存储、快捷键与提示 |
| [packages/client/ui-conversation](packages/client/ui-conversation/README.zh.md) | 共享会话内容、Chat 视图与输入框 |
| [packages/client/ui-workspace](packages/client/ui-workspace/README.zh.md) | 工作区目录、会话导航与 `uiWorkspace` 服务 |
| [packages/client/surface](packages/client/surface/README.zh.md) / [ui-layout](packages/client/ui-layout/README.zh.md) | 呈现协议与载体服务、框架的 overlay 与模态层 |
| [apps/desktop](apps/desktop/README.zh.md) | Electron 桌面外壳：orb、surface 与气泡列窗口，模态尺寸与打包 |
| [packages/api/session-controller](packages/api/session-controller/README.zh.md) / [workspace-controller](packages/api/workspace-controller/README.zh.md) | 客户端会话与工作区数据层 |
| [packages/core/agent-loop](packages/core/agent-loop/README.zh.md) / [packages/session](packages/session/README.zh.md) | agent 循环、会话持久化等 Harness 核心 |
| [packages](packages/README.zh.md) / [docs](docs/AGENTS.md) | 包索引、架构、开发与用户文档 |

## 环境要求

- Node.js `>=24.9.0`
- pnpm `11.28.5`（可通过 corepack 启用或自行安装）
- Git
- 运行 Desktop 需要对应平台的 Electron 依赖；打包、更新与 Windows 签名见 [apps/desktop](apps/desktop/README.zh.md)

<a id="run"></a>
## 编译与安装

<a id="run-from-source"></a>
### 从源码构建

```sh
git clone https://github.com/deepseek-ai/deepseek-harness.git
cd deepseek-harness
pnpm install
pnpm run build
```

`pnpm run build` 生成 `lib/`、Web 前端与类型产物；后续命令直接使用这些产物，不会重新构建。

### 运行 Web

```sh
pnpm dsh web
```

默认在 `http://127.0.0.1:3080` 启动 Web UI 并打开默认浏览器。传 `--no-open` 只启动服务；通过 SSH 启动时只打印远端地址，由 SSH 客户端或编辑器负责本地转发。使用说明见 [Web UI 指南](docs/user/guide/index.zh.md)。

### 运行 Desktop

```sh
pnpm run dev:desktop   # 构建后启动
# 或先 pnpm run build，再：
pnpm run start:desktop
```

Better DSH 的 orb 形态由 Desktop profile 与 `better-interact` 行启用；窗口形态、profile 与打包细节见 [apps/desktop](apps/desktop/README.zh.md)。

### 从 npm 体验 Web 模式

```sh
npx @deepseek-ai/dsh web
```

该命令运行已发布的 DeepSeek Harness Web UI。本仓库的 Better DSH 桌面体验请使用上面的源码构建。

## 开发与验证

```sh
pnpm run dev:web    # 构建并监听客户端改动
pnpm run typecheck
pnpm run test
pnpm run test:gui   # 客户端与 GUI 套件
pnpm run lint
```

开发指南见 [docs/development.md](docs/development.md)，架构说明见 [docs/architecture.md](docs/architecture.md)，文档门禁可用 `pnpm run test:docs` 与 `pnpm run doc-sync`。

## 文档

- 文档站点：<https://deepseek-harness.github.io/deepseek-harness/>
- 用户指南：[docs/user/guide/index.zh.md](docs/user/guide/index.zh.md)
- 架构：[docs/architecture.md](docs/architecture.md)
- 开发：[docs/development.md](docs/development.md)

## 安全与许可

运行前请阅读 [SAFETY.zh.md](SAFETY.zh.md)。项目以 [MIT](LICENSE) 许可发布，第三方依赖及其许可见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。

## 社区与贡献

- 提交反馈或问题：[GitHub Discussions](https://github.com/deepseek-ai/deepseek-harness/discussions)
- 插件仓库可添加 [`dsh-plugin`](https://github.com/topics/dsh-plugin) 话题
- 加入 [DeepSeek Harness Discord](https://discord.gg/4MrtZUhpxg)
- 贡献指南：[CONTRIBUTING.zh.md](CONTRIBUTING.zh.md)
