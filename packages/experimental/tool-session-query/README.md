---
description: "Workspace-authorized model-facing session history, latest-reply, and opt-in cross-session message tools for agent developers and maintainers."
kind: "package-reference"
---

# @deepseek-ai/dsh-tool-session-query

English | [中文](README.zh.md)

## Summary

Use the experimental `dsh-tool-session-query` tools to let a model search earlier sessions, inspect event matches, trace session or event relationships, read exact event data, and read a session's newest reply. Its six read-only tools return cursor-free text and authorize cross-session access only when the target session's `cwd` exactly matches the caller's; callers without a `cwd` can inspect only themselves. An opt-in seventh tool delivers a text message to another authorized session without waiting for its reply. The package is opt-in, and enabling it adds fixed guidance plus six or seven tool schemas to every model request.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Mount this package when the agent should be able to search its own prior sessions, inspect their relationships and events, or read another session's latest reply. The common path is explicit: mount the plugin over `ctx.sessionQuery` (backed by `dsh-session-query-sqlite`), then let the model call the tools.

### When to choose it

Choose it when a deployment wants model-driven retrieval of prior work — for example a coding agent that searches what it did in earlier sessions before starting a task. Enable `allowSessionMessages` only when that agent may also deliver prompts to other sessions in the same workspace. Avoid the message tool when only programmatic retrieval is needed or when no trusted consumer should start work in another session: `ctx.sessionQuery` itself serves code callers without the model-facing schema, prompt, and authorization layer.

### Configuration

| Field | Default | Meaning |
|---|---|---|
| `maxSearchResults` | `100` | Maximum authorized hits returned by one search call |
| `searchTimeoutMs` | `30000` | Cooperative deadline attached to both full-text search tools |
| `allowSessionMessages` | `false` | Register the message tool when a Session Controller service is also present |

The generated [configuration catalog](../../../docs/config-catalog.md#deepseek-aidsh-tool-session-query) is the exhaustive source for every accepted field and its JSDoc.

### What the model can do

| Tool | What the model gets |
|---|---|
| `session_search` | Sessions matching a literal query, ranked, with title and best-match excerpt; always omits the caller session |
| `session_event_search` | Events matching a literal query inside one authorized session; for the current session it stops before the step that invoked it |
| `session_trace` | The authorized ancestor chain and descendant tree of one session; unauthorized boundaries appear as markers without hidden ids |
| `session_event_trace` | One event's positional replacements and cited source-event relationships |
| `session_event_read` | One full unabridged event as JSON, plus optional neighboring event summaries |
| `session_latest_reply` | The newest current assistant message with non-empty text, its event sequence, time, turn, and up to 20000 characters of text |
| `session_send_message` | Acceptance after one text message enters another session's inbox as a user prompt; it does not wait for the target turn |

Workspace authority is conservative: cross-session access requires exact `cwd` equality between target and caller session, and a caller without `cwd` can inspect only itself. The message tool accepts only another session in the caller's workspace with a non-subagent header; it refuses the caller's own id. Delivery goes through the Session Controller, so a cold target resumes under its recorded preset, an archived target is refused by the same gate as a Client prompt, and an idle target starts a turn. Requested parent ids are deduplicated and authority-checked before search; missing and cross-workspace guesses behave identically. Search results are cursor-free: a capped result asks the model to narrow its query, and never exposes provider cursors, offsets, page sizes, or a model-controlled limit. Timestamps at the tool boundary are timezone-qualified ISO 8601 and become inclusive epoch-millisecond filters.

### Failures and recovery

Every trusted query-service call crosses one error sanitizer: caller cancellation is preserved exactly, corpus and provider diagnostics go to the internal log, and unsafe or unprintable failures fall back to the fixed `SESSION_QUERY_TOOL_FAILED` code and message. Local argument-validation and authorization errors keep their precise tool-owned messages (`SESSION_QUERY_TOOL_UNAUTHORIZED` for a target outside the caller workspace). The message tool reports a target-side refusal as `SESSION_MESSAGE_TOOL_REFUSED` and a subagent target as `SESSION_MESSAGE_TOOL_SUBAGENT`; acceptance means the prompt entered the inbox, not that a turn completed. Read results stay complete, and the latest-reply tool truncates only its text field at 20000 characters with `truncated: true`; use `session_event_read` with the returned sequence for the complete event. Deployments that need bounded inline output for the other tools mount `@deepseek-ai/dsh-spill-policy`, which can replace oversized rendered text while retaining the complete result.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

This section explains the design decisions behind the tools and points at the code that realizes them; the observable behavior is fully covered in [Use this package](#use-this-package).

### Design philosophy

The consumer is built on one separation and four commitments:

- **Narrow read tools plus one opt-in write.** Six read tools and one message tool, all with flat snake-case schemas; no cursor, offset, page-size, or model-controlled limit ever reaches the model.
- **Authority derived from the caller, never the model.** Caller identity comes from `ToolExecution.exec.agent`; workspace is exact-string `cwd` equality, re-checked against the header observed with each result.
- **One model-boundary sanitizer.** Every trusted `ctx.sessionQuery` call goes through the service boundary, which preserves cancellation and contains diagnostic and classification failures.
- **One explicit delivery seam.** The message tool calls the Session Controller's prompt operation, so resume, archive, queueing, and policy stay owned by that service rather than reimplemented in a tool.
- **No second truncation format.** Read results stay complete; only the latest-reply text is bounded, and the generic spill policy owns other bounded inline output.

The design history lives in the [model-facing session query tools note](../../../.agents/notes/archived/feature/2026-07-24-model-facing-session-query-tools.md) and the [session-search-not-shipped-default note](../../../.agents/notes/archived/feature/2026-08-02-session-search-not-shipped-default.md).

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Plugin entry: config, prompt section, read-tool registrations, conditional message registration |
| [`src/input.ts`](src/input.ts) | Model schemas, argument normalization, filter construction |
| [`src/workspace-access.ts`](src/workspace-access.ts) | Caller identity, workspace authorization, title access, lineage projection |
| [`src/service-boundary.ts`](src/service-boundary.ts) | Trusted calls and model-safe error translation |
| [`src/operations.ts`](src/operations.ts) | The five search, trace, and event-read workflows |
| [`src/reply.ts`](src/reply.ts) | Latest-reply surface scan, bound, and JSON result |
| [`src/message.ts`](src/message.ts) | Target checks and the Session Controller prompt delivery |
| [`src/presentation.ts`](src/presentation.ts) | Text result rendering and tool-call cards |

### Operation flow

Each read executor derives the caller, normalizes the model's arguments into service filters, authorizes the target (or the requested parent ids) against the caller workspace, and collects results through the service boundary. Both search tools page internally through provider cursors while the observed generation stays valid, stopping at `maxSearchResults`; because one search consumes generation-bound provider cursors, the two search tools execute exclusively with sibling tool calls, while the exact trace, event-read, and latest-reply tools opt into parallel execution. The latest-reply tool observes the target, removes messages shadowed by later surface replacements, and selects the newest current assistant message that contains text. Lineage output replaces unauthorized ancestor and descendant boundaries with markers containing no hidden session id.

The message tool authorizes the target header, refuses a self or subagent target, then calls `ctx.sessionController.prompt` with a freshly minted request id in queue mode. The Controller owns target resume, archive enforcement, and inbox admission; the tool serializes its own calls and returns only the acceptance receipt.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

Read these pages when the package-level contract is not enough. They move from the tool surface to the underlying service, the schema catalog, and the design evidence.

- [Generated tool catalog](../../../docs/tool-catalog.md#deepseek-aidsh-tool-session-query) — the six read schemas and the conditional message schema as the model sees them.
- [dsh-session-query](../../session-query/session-query/README.md) — the service these read tools call.
- [dsh-session-query-sqlite](../../session-query/session-query-sqlite/README.md) — the full-text backend behind the two search tools.
- [dsh-api-session-controller](../../api/session-controller/README.md) — the service the message tool uses to resume and prompt a target.
- [Session Query subsystem reference](../../../docs/subsystems/session-query.md) — the type-level contract under the tools.
- [Model-facing session query tools](../../../.agents/notes/archived/feature/2026-07-24-model-facing-session-query-tools.md) — workspace authority, cursor-free results, and spill decisions.

-----

<a id="model-experience"></a>
## Model Experience

### System prompt

#### What the model sees

The model receives one fixed prior-history guidance section. With `allowSessionMessages` and a Session Controller, the same section appends one delivery sentence.

##### Prior-history guidance

```markdown
Use session_search to find relevant work from prior sessions, or session_event_search to search earlier events in one session. Search results are cursor-free and workspace-scoped. Follow a useful hit with session_trace, session_event_trace, or session_event_read when you need lineage, relationships, or exact data. Use session_latest_reply to read the newest reply in an authorized session.
```

##### Delivery guidance

```markdown
Use session_send_message to deliver a text message to another authorized session; it returns once accepted and does not wait for the reply. Read the answer with session_latest_reply.
```

#### Token effect

One fixed concise section is present on each request while the plugin is mounted; messaging adds one sentence.

#### KV Cache effect

Prefix-stable while the plugin, guidance text, and message-tool visibility are unchanged.

### Tool schemas

#### What the model sees

The model sees the generated [session-query tool schemas](../../../docs/tool-catalog.md#deepseek-aidsh-tool-session-query): `session_search`, `session_event_search`, `session_trace`, `session_event_trace`, `session_event_read`, and `session_latest_reply`, plus `session_send_message` when messaging is enabled and a Session Controller is present. Search filters add fixed schema tokens, while cursors, workspace paths, output pagination, and model-controlled result limits remain absent.

#### Token effect

Six fixed read-only schemas are sent on each request while visible; enabling messaging adds one write schema.

#### KV Cache effect

Prefix-stable while tool visibility and definitions are unchanged.

### Tool results

#### What the model sees

Each successful read call emits one plain-text block. Search results include titles and best-match excerpts; traces include all authorized relationships; event reads include unabridged target JSON. The latest-reply call emits JSON with the session id, event sequence, reply time, turn, bounded text, and a truncation flag. A successful message call emits JSON with `accepted: true` and the target session id.

#### Token effect

Results are data-dependent and remain in logged tool history until compaction; `maxSearchResults` bounds search-hit count and the latest-reply text is bounded at 20000 characters.

#### KV Cache effect

Append-only result text follows the reusable request prefix and does not invalidate earlier cache entries.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>


These limits define when this package is a poor fit or needs special operational care. They are current package constraints, not a task backlog.

- **Search caps without continuation** — search returns at most the deployment cap and asks the model to narrow its query when more matches exist; there is no continuation token.
- **Conservative workspace identity** — workspace identity is exact-string `cwd` equality, so symlink-equivalent paths do not share authority.
- **Asynchronous delivery** — the message tool reports acceptance only; it has no completion receipt, reply wait, retry, or duplicate suppression, and the target may queue the prompt behind a running turn.
- **User-authority delivery** — the target receives an unprincipal user prompt, so any content the model reads can steer delivery; mount the message tool only where a trusted owner controls the conversation.
- **Inline payloads without the spill policy** — custom compositions without the generic spill policy accept complete trace and event payloads inline; the latest-reply text alone is bounded.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

This Dev Note is working context for maintainers: open design questions and directions that are not decided. It is explicitly non-authoritative — shipped behavior, limits, and accepted rationale live in the sections above, the package code, and the linked Agent Notes.

#### Future: broader workspace semantics

Exact-string `cwd` equality is deliberately conservative; symlink-aware or canonical-path workspace identity would change which sessions share authority and is undecided.

</details>
