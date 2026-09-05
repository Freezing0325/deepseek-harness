# Agent Note: Automatic x-opencode-session header on OpenCode routes

Status: implemented

English | [中文](2026-09-05-opencode-session-header.zh.md)

## Problem

OpenCode Go requires an `x-opencode-session` header carrying a stable per-conversation UUID on inference requests since 09/05, and errors requests without one. The harness sent nothing: no adapter attached any session identity, and the only available workaround was a static `headers` entry shared by every conversation, which defeats the per-conversation affinity the header exists for. About 25k harness user organizations call the Go API, with `deepseek-v4-flash` the highest-volume model and near-zero header presence measured on the provider side ([discussion](https://github.com/deepseek-ai/deepseek-harness/discussions/5495)).

## Decision

`llm-pi-ai` attaches the header automatically on every `opencode*` route at the chat call site in [adapter.ts](../../../../packages/llm/llm-pi-ai/src/adapter.ts). The gate mirrors the official OpenCode client (`providerID.startsWith("opencode")`). The wire value is the bare UUID extracted from the harness conversation id (`session-<uuid>`, minted once per conversation and frozen at creation); a value carrying no UUID is sent raw. The value is therefore stable across turns, resume, compaction, and retries, and fresh for new conversations, forks, and subagent sessions. The runtime value wins over any static `headers` entry; non-OpenCode routes and discovery probes send nothing.

## Alternatives considered

**A `sessionHeader` profile field (explicit opt-in).** A per-route configuration field naming the header to send is the general mechanism and composes with any future provider needing the same shape. Rejected as the default because this header has no degrees of freedom — the name, the value source, and the routes are all fixed by the provider — so every deployment would hand-write the identical line while an unset route stays broken silently. The field remains a coherent future manual override; the automatic default is what ships.

**Injecting at the `dsh-llm` attribution layer so all adapters carry it.** Covers adapters beyond pi-ai in one place. Rejected for now because only pi-ai serves OpenCode routes, and the attribution layer is shared header space where a provider-specific header does not belong. The move stays open if another adapter ever routes to OpenCode.

**A static `headers` entry per route.** Already possible and already wrong: one id for every conversation collapses the affinity the provider caches on, and a stale entry shadows the truth. The runtime value now wins over static entries instead.

## Consequences

Deployments need no configuration change: existing `opencode*` routes start sending the header on upgrade. A deployment that set a static `x-opencode-session` keeps working — the static value is ignored in favor of the per-conversation one, so removing the entry is cleanup, not migration. Providers other than OpenCode see no new header.

## Testing

`packages/llm/llm-pi-ai/tests/session-header.spec.ts` pins the gate, the bare-UUID normalization, the no-session silence, the raw fallback for non-UUID ids, and runtime-wins-over-static through a mock server's header record.