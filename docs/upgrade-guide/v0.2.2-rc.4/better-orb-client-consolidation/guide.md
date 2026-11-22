---
kind: upgrade-guide
description: "The separate @deepseek-ai/dsh-client-ui-orb package is removed and its Client entries move to @deepseek-ai/dsh-better-interact."
---

# Orb Client entries move to better-interact

English | [中文](guide.zh.md)

## Change

`@deepseek-ai/dsh-client-ui-orb` no longer ships. `@deepseek-ai/dsh-better-interact` now provides the orb, quick prompt, dedicated management workbench, and their commands. Their Slot, modal, command, and storage identifiers are unchanged. This affects profiles and manifests that name the removed package directly; profiles that only mount the current Better bundle need no manual row edits.

## Migration

1. In a custom `cordis.yml` or patch, replace the `client-ui-orb` row's package name with `@deepseek-ai/dsh-better-interact`. Keep the row id if other overrides reference it.
2. Remove `@deepseek-ai/dsh-client-ui-orb` from the profile or project dependencies and update the lockfile with `pnpm install`.
3. Start the target Desktop profile and confirm that the orb, quick prompt, and both workbench entries still open. A direct reference to the removed package fails package resolution and must be removed rather than ignored.
