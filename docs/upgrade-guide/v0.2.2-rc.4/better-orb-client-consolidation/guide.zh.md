---
kind: upgrade-guide
description: "独立的 @deepseek-ai/dsh-client-ui-orb 包被移除，其 Client 条目迁移到 @deepseek-ai/dsh-better-interact。"
---

# Orb Client 条目迁移到 better-interact

[English](guide.md) | 中文

## 变更

`@deepseek-ai/dsh-client-ui-orb` 不再发布。`@deepseek-ai/dsh-better-interact` 现在提供悬浮球、快捷提问、专用管理工作台及其命令。它们的 Slot、模态、命令和存储标识保持不变。直接引用被移除包的 profile 和清单会受影响；只挂载当前 Better bundle 的 profile 无需手工修改条目。

## 迁移

1. 在自定义 `cordis.yml` 或补丁中，将 `client-ui-orb` 行的包名替换为 `@deepseek-ai/dsh-better-interact`。如果其他覆盖项引用该行 id，则保留此 id。
2. 从 profile 或项目依赖中删除 `@deepseek-ai/dsh-client-ui-orb`，并运行 `pnpm install` 更新锁文件。
3. 启动目标 Desktop profile，确认悬浮球、快捷提问和两种工作台条目仍可打开。对被移除包的直接引用会导致包解析失败，必须删除该引用，不能静默忽略。
