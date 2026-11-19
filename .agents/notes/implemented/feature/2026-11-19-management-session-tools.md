# Agent Note: Management Session tools for listing, latest reply, and messaging

Status: implemented

English | [中文](2026-11-19-management-session-tools.zh.md)

## Problem

The orb's `manage` conversation was read-only: it could search and read existing Sessions in the default workspace, but it could not list workspaces or Sessions, read a Session's newest answer directly, or deliver a message to another Session. The user asked for those three operations from the management preset.

Cross-session delivery is not a query. A tool that resumes a target directly would duplicate Agent composition, archive enforcement, inbox queueing, and request identity that the Session Controller already owns. A tool that waits for the target turn would hold one tool call open across an unrelated model run and make cancellation and failure reporting ambiguous. Unrestricted delivery would also let a management conversation reach Sessions outside the workspace the persona promises to respect.

## Decision

The management preset mounts `@deepseek-ai/dsh-tool-session-list` for workspace and Session metadata, and enables the existing `@deepseek-ai/dsh-tool-session-query` package's new tools.

### Listing

`list_workspace` and `list_session` come from the existing list package. They return registry and Session metadata without resuming an Agent or opening a cold log: IDs, titles, workspace paths, creation and update times, archived filtering, and bounded pagination. The manage preset adds the package beside the query tools; it does not extend the list schema.

### Latest reply

`session_latest_reply` is a read tool registered with the query package for every consumer. It authorizes the target with the same exact-`cwd` workspace rule as the other read tools, observes the target once, removes assistant messages shadowed by later surface replacements, and returns the newest current assistant message whose text blocks are non-empty. The result carries the Session id, event sequence, reply time, turn, and at most 20000 characters of text with a truncation flag; `session_event_read` retrieves the complete event. A Session with no text reply returns null fields rather than a failure.

### Sending

`session_send_message` is opt-in through `allowSessionMessages`, which defaults to false, and the plugin registers it only while a `sessionController` service is present. The tool authorizes the target header, refuses the caller's own id and a subagent target, then calls the Session Controller's prompt operation with a freshly minted request id in queue mode. The target receives a user prompt; the call returns `accepted: true` after inbox admission and does not wait for the target turn. The Controller owns target resume under its recorded preset, archive enforcement, busy handling, and policy. The tool serializes its own calls and performs no retry or duplicate suppression.

The `manage` preset sets `allowSessionMessages: true`, updates its persona to name the list, latest-reply, and send tools, and keeps the no-file, no-shell, no-delete/rewrite constraints. Other compositions that mount the query package remain read-only unless they opt in.

## Alternatives considered

- **Add all three tools to a new management-only package.** Rejected: the latest reply and delivery need the query package's caller-derived workspace authorization and service boundary; a second package would duplicate them.
- **Register the message tool unconditionally.** Rejected: existing read-only compositions would silently gain a prompt-injection primitive.
- **Resume the target Agent inside the tool.** Rejected: it duplicates the Session Controller's composition, archive gate, request identity, and queue ownership.
- **Wait for the target's reply inside the send call.** Rejected: it ties one tool call to an unrelated turn, hides partial acceptance, and complicates cancellation.
- **Allow cross-workspace delivery.** Rejected: it contradicts the management persona's workspace promise and broadens the authority of a prompt-injected tool call.
- **Deliver as an `agent-message` source.** Rejected for this change: the target should receive an ordinary user prompt from the management conversation; the Controller's user source is the existing, reconstructable path.

## Consequences

Management conversations can now enumerate Sessions and deliver text prompts to other Sessions in the same workspace. Delivery is asynchronous and non-idempotent; the model must read the answer with `session_latest_reply` and must not assume the target acted. The target receives the text as a user prompt with no `principal`, so shared or viewer-facing profiles must not expose this tool. Subagent targets and the caller itself are refused. A target-side archive or busy refusal surfaces as `SESSION_MESSAGE_TOOL_REFUSED`; the tool cannot verify that the target completed work.

Verification: the query package tests pin latest-reply selection, replacement shadowing, truncation, self and cross-workspace authorization, conditional registration, message argument checks, subagent refusal, and target refusal mapping; the management preset test validates every row and its config; the live Desktop management conversation listed workspaces and Sessions, read another Session's latest reply, and delivered a message that the target Session received and answered.
