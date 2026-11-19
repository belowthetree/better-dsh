# Agent Note: Session permanent deletion

Status: implemented

English | [中文](2026-11-19-session-permanent-deletion.zh.md)

## Problem

Session management offered archive but no permanent removal. Archive is a registry-global visibility set: it hides a Session from grouping surfaces while keeping its log, Workspace position, and every derived cache on disk. Users who wanted a conversation gone from the machine had no product action, and a deletion implemented as a file operation outside the persistence seam would race the live write handle, leave the Session catalog and Workspace accounting stale, and strand the projection checkpoint that contains conversation text.

The Session menu is shared by sidebar rows and Better DSH workbench bookmarks, so one menu action must serve every surface. The default listing shows newly created Sessions as blank rows, making an empty-log cleanup path part of the same operation.

The Host also keeps an Agent live after a turn ends, for reuse. Refusing every live Session would make most real Sessions undeletable; deleting the log under a live Agent would leave that Agent writing to a removed file.

## Decision

Permanent deletion is a distinct operation from archive, exposed as `session.delete` on the Session Remote namespace and `sessions.delete(sessionId)` on the Client. It is irreversible and available only from the shared Session menu's Delete action after Archive, with a confirmation dialog.

### Persistence seam

`SessionPersistence.delete(id, options?)` permanently removes one stored Session and every backend artifact for it. The base implementation refuses with `SessionPersistenceDeleteUnsupportedError`; a backend opts in by overriding it. The JSONL provider acquires the Session's cross-process write lease and removes the Session-owned directory, which holds every historical generation and the lock. It refuses `SessionPersistenceBusyError` while it holds any open local handle or an unmaterialized create for the id, `SessionAlreadyOwnedError` while another process holds the write lock, and `SessionPersistenceNotFoundError` for an absent Session. The SQLite provider inherits the refusal. `delete` is not a migration primitive: it does not touch committed generations of other Sessions.

### Host operation

`SessionController.delete` refuses a running Agent, an idle Agent owned by another consumer, and a parent of subagent Sessions (`session/delete-has-children`, naming the children). An idle Agent this controller owns is stopped first, then the log is removed. Success detaches the Session from every Workspace, removes its archive and pin membership, evicts its projection checkpoint through `sessionProjectionCache.evict`, and broadcasts `api-session/removed`. Shared attachment objects stay stored because other Sessions may reference them.

### Agent handle ownership

`ApiSessionAgentController` now retains the `AgentHandle` of every Agent it creates or resumes, including `createOwned` for fork children. `disposeAgent(sessionId)` disposes that handle exactly once and removes it from the ownership map; `agent/disposed` removes entries disposed elsewhere. This is the capability that lets deletion stop an idle live Agent without reaching into another consumer's Agent.

### Client and menu

The shared Session menu contribution observes the Session list: it offers Delete only when the access snapshot includes `session/delete` and the Session is not running. Choosing it raises `workspace.session-delete` in `shell.overlay`; the dialog names the Session, states that its complete log is removed permanently, and exposes Cancel and Delete permanently. Confirming calls `uiWorkspace.deleteSession`, which deletes through the Session Client and clears the main view when the deleted Session was selected. Sidebar rows and Better DSH workbench bookmarks inherit the same action because they open the same menu.

## Alternatives considered

- **Alias Delete to archive.** Rejected: archive still stores the log and remains recoverable, so it does not meet the request.
- **Refuse every live Agent.** Rejected: the Host retains idle Agents for reuse, so a Session opened once would remain undeletable until process exit.
- **Delete the log under the live Agent.** Rejected: the Agent's write handle would outlive the file, and the Session would remain in the catalog.
- **Cascade subagent children.** Rejected for this change: refusing a parent keeps hidden descendants visible to their owner instead of silently orphaning or deleting them. A future operation can cascade with its own confirmation.
- **Delete files outside the persistence seam.** Rejected: it would bypass the write lease and every backend guarantee.
- **Make deletion part of archive's Host policy.** Rejected: archive is a reversible visibility decision with different access and recovery semantics.

## Consequences

Deletion is irreversible and backend-dependent; the shipped JSONL backend supports it, while SQLite reports `session/delete-unavailable`. A running Session or subagent parent must be archived or handled before deletion. Derived projection checkpoints are evicted, but attachment objects and other Sessions that inherited a fork prefix are unaffected. The menu is unavailable when the access snapshot excludes `session/delete`.

Verification: the JSONL provider tests removal, busy handles, pending creates, absent ids, and abort; the base contract test pins the default refusal; the Session Controller tests running refusal, foreign ownership, child refusal, idle disposal, success side effects, and failure mapping; the Client service tests the Remote call and local row removal; UI tests pin menu ordering, the running and access gates, the confirmation dialog, apply wiring, and main-view clearing; the live Desktop run deleted a cold Session and an idle live Session from the classic menu and from a Better DSH workbench bookmark.
