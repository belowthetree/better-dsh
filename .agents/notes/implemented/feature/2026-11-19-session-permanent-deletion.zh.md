# Agent Note: Session 永久删除

Status: implemented

[English](2026-11-19-session-permanent-deletion.md) | 中文

## 问题

Session 管理只有归档，没有永久删除。归档是注册表级的可见性集合：它从分组界面隐藏 Session，但保留日志、工作区位置和磁盘上的全部派生缓存。希望从机器上彻底移除对话的用户没有产品动作；而绕过持久化 seam 直接删文件会与活动写句柄竞争，留下过期的会话目录与工作区记账，并遗留包含对话文本的投影检查点。

Session 菜单由侧栏行与 Better DSH 工作台书签共享，因此一个菜单动作必须服务所有界面。默认列表会把新建会话显示为空白行，清理空日志也属于同一操作。

Host 在回合结束后仍保留活动 Agent 以便复用；拒绝所有活动 Session 会让大多数真实会话无法删除，而在活动 Agent 下删除日志会让该 Agent 继续写入已移除的文件。

## 决策

永久删除是与归档不同的操作，通过 Session Remote 命名空间的 `session.delete` 与 Client 的 `sessions.delete(sessionId)` 暴露。它不可恢复，只从共享 Session 菜单中位于归档之后的删除动作提供，并带确认对话框。

### 持久化 seam

`SessionPersistence.delete(id, options?)` 永久移除一个已存储 Session 及后端为其保留的全部产物。基类实现以 `SessionPersistenceDeleteUnsupportedError` 拒绝；后端通过覆写选择支持。JSONL 提供方先取得该 Session 的跨进程写锁，再移除会话自有目录，其中包含全部历史 generation 与锁。本进程仍持有该 id 的打开句柄或未实体化 create 时以 `SessionPersistenceBusyError` 拒绝，其他进程持有写锁时以 `SessionAlreadyOwnedError` 拒绝，会话不存在时以 `SessionPersistenceNotFoundError` 拒绝。SQLite 提供方继承该拒绝。`delete` 不是迁移原语：它不会触碰其他 Session 的已提交 generation。

### Host 操作

`SessionController.delete` 拒绝运行中的 Agent、由其他消费方持有的空闲 Agent，以及有 subagent 子会话的父会话（`session/delete-has-children`，并带回子会话）。本控制器拥有的空闲 Agent 会先被停止，再移除日志。成功后从所有工作区分离该 Session、移除其归档与置顶成员关系、通过 `sessionProjectionCache.evict` 淘汰投影检查点，并广播 `api-session/removed`。共享附件对象仍然保留，因为其他 Session 可能引用它们。

### Agent 句柄所有权

`ApiSessionAgentController` 现在保留其创建或恢复的每个 Agent 的 `AgentHandle`，包括 fork 子会话使用的 `createOwned`。`disposeAgent(sessionId)` 只处置该句柄一次并从所有权映射中移除；`agent/disposed` 会移除在别处被处置的条目。该能力让删除可以停止空闲的活动 Agent，而不必侵入其他消费方的 Agent。

### Client 与菜单

共享 Session 菜单贡献观察 Session 列表：仅当访问快照包含 `session/delete` 且 Session 未在运行时提供删除。选择后在 `shell.overlay` 中升起 `workspace.session-delete`；对话框写明 Session 名称、完整日志将被永久移除，并提供取消与永久删除。确认后调用 `uiWorkspace.deleteSession`，经 Session Client 删除，并在被删 Session 正是主视图所选时清除主选择。侧栏行与 Better DSH 工作台书签打开同一菜单，因此自动继承该动作。

## 考虑过的替代方案

- **把删除做成归档的别名。** 拒绝：归档仍保存日志且可恢复，不满足需求。
- **拒绝所有活动 Agent。** 拒绝：Host 为复用保留空闲 Agent，打开过一次的 Session 会在进程退出前一直无法删除。
- **在活动 Agent 下删除日志。** 拒绝：Agent 的写句柄会存活于文件之后，Session 仍留在目录中。
- **级联删除 subagent 子会话。** 本次拒绝：拒绝父会话可让隐藏的后代仍归其所有者可见，而不是静默成为孤儿或被删除。未来操作可以带自己的确认实现级联。
- **绕过持久化 seam 删除文件。** 拒绝：会绕过写锁及后端的全部保证。
- **把删除并入归档的 Host 策略。** 拒绝：归档是可逆的可见性决策，访问与恢复语义不同。

## 后果

删除不可恢复且依赖后端；随产品交付的 JSONL 后端支持，SQLite 返回 `session/delete-unavailable`。运行中的 Session 或有 subagent 子会话的父会话必须先归档或处理。派生投影检查点会被淘汰，但附件对象与继承 fork 前缀的其他 Session 不受影响。访问快照不含 `session/delete` 时不显示菜单项。

验证：JSONL 提供方测试覆盖移除、占用句柄、待定 create、缺失 id 与取消；基类契约测试钉住默认拒绝；Session Controller 测试覆盖运行拒绝、外部所有权、子会话拒绝、空闲处置、成功副作用与失败映射；Client 服务测试 Remote 调用与本地行移除；UI 测试钉住菜单顺序、运行与访问门控、确认对话框、apply 接线与主视图清除；真实 Desktop 运行从经典菜单与 Better DSH 工作台书签分别删除了冷 Session 与空闲活动 Session。
