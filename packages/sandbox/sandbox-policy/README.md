# dsh-sandbox-policy — the sandbox policy home (`ctx.sandboxPolicy`)

English | [中文](README.zh.md)

The single owner of sandbox-policy resolution: the deployment's default [`SandboxMode`](../sandbox/README.md) and fallback root, the independent outbound-network [`NetworkPolicy`](../sandbox/README.md), plus each session's durable mode and network overrides and its immutable workspace root. Every enforcing capability receives one resolved mode-and-root policy per call; before each request, the model receives the current file and network policy without a separate capability inventory.

## Why a shared home

Filesystem tools, one-shot bash commands, and terminal sessions may enforce the same mode vocabulary in different combinations. If each resolved its own `mode` + `workspaceRoot`, they could drift into a split world, exactly what [the sandbox Agent Note](../../../.agents/notes/implemented/feature/2026-07-06-sandbox.md) warns against. Each enforcing backend consumes the complete owner-resolved policy, while the current context describes only what that policy means for any available operation the DSH file sandbox enforces. The [cross-family fs sandbox Agent Note](../../../.agents/notes/implemented/feature/2026-07-14-cross-family-fs-sandbox.md) records the shared-policy decision. Network policy is a second, independent axis: `allow` keeps the file sandbox in place while outbound access stays permitted (the file backends do not gate sockets), `deny` tells network-bearing consumers and the model to refuse outbound access.

## Config

- `mode` — the deployment default `SandboxMode` (`read-only` / `workspace-write` / `danger-full-access`), validated at load. Default `read-only` (fail-safe).
- `networkAccess` — the deployment default `NetworkPolicy` (`allow` / `deny`), validated at load. Default `allow`: the file sandbox does not restrict sockets, so outbound access is permitted unless a deployment opts in to `deny`.
- `workspaceRoot` — the fallback directory `workspace-write` may write under for agentless calls or sessions without a cwd. Default `process.cwd()`, resolved to its absolute filesystem identity either way. A normal agent call uses its session header's immutable `cwd` instead.

## API

- `ctx.sandboxPolicy.resolve({ session?, mode?, network? })` — resolves one complete per-call policy. An explicit approved mode/network outranks the session's last `sandbox/mode`/`network/policy` event, which outranks the deployment default; the session's immutable `cwd` is canonicalized with filesystem semantics before becoming `workspaceRoot`, otherwise the configured fallback applies. Canonicalization precedes lexical normalization so `symlink/..` agrees with process working-directory resolution.
- `ctx.sandboxPolicy.defaultMode` / `ctx.sandboxPolicy.defaultNetwork` / `ctx.sandboxPolicy.workspaceRoot` — the deployment defaults and fallback root used by `resolve()`.
- `sandbox:policy` / `network:policy` — request-time cache-safe context contributions derived directly from `resolve({ session })`. The file context states the mode's capability-neutral file-effect contract and the canonical session workspace under `workspace-write`; the network context states the outbound policy, including the Windows restricted-token TLS/pipe boundary guidance under `allow`. Tool owners retain operation-specific denial and escalation guidance.
- `effectiveSandboxMode(events)` — the pure fold of a session's `sandbox/mode` events (the last switch wins, or `undefined`), used inside `resolve()`.
- `setSandboxMode(session, mode)` — THE write path for a per-session override: appends exactly one `sandbox/mode` event. The switch IS its event; nothing mutates the mode out of band.
- `effectiveNetworkPolicy(events)` — the pure fold of a session's `network/policy` events (the last switch wins, or `undefined`), used inside `resolve()`.
- `setNetworkPolicy(session, network)` — THE write path for a per-session network override: appends exactly one `network/policy` event.
- `SANDBOX_MODES` / `NETWORK_POLICIES` — every mode / network policy, for option advertisement and runtime validation.

The optional `./invariant` companion rejects a forged durable `sandbox/mode` or `network/policy` event whose value falls outside its closed vocabulary; Session and its companion own the surrounding storage and core execution-enclosure rules. The agent loop logs the assembled full runtime-context snapshot as a sourced `user/message`, so exact policy input remains reconstructable without an in-memory “last told” mirror.

## The per-session store

A runtime switch is one log-only `sandbox/mode` or `network/policy` event on the session it applies to. `effective = explicit grant ?? fold(events) ?? deployment default`, so an override survives restart by replay and two sessions never see each other's state. Workspace identity does not need another event: the immutable `SessionHeader.cwd` recorded at creation is the root for every call in that session. The events stay log-only; before the next request, the owner contributes the current facts to the full runtime-context snapshot.

## Model Experience

### Current file sandbox policy

#### What the model sees

One `sandbox:policy` contribution in the current runtime-context snapshot for every agent session. It does not enumerate mounted capabilities. Tool plugins retain operation and escalation guidance, approval policy contributes separately to the same snapshot, and plan guidance remains `dsh-plan-mode`'s system section.

##### Read-only

```markdown
Current DSH file policy: read-only. Any available operation enforced by the DSH file sandbox cannot modify files in the standing mode. Do not refuse a required modification from this policy alone: try an available tool normally and follow any denial and escalation guidance it returns.
```

##### Workspace-write

```markdown
Current DSH file policy: workspace-write. Any available operation enforced by the DSH file sandbox may modify files under the session workspace: "<workspace root>". Some platform temporary areas may also be writable.
```

##### Danger-full-access

```markdown
Current DSH file policy: danger-full-access. The DSH file sandbox does not restrict file modifications by available operations.
```

### Current network policy

One `network:policy` contribution in the same snapshot. `allow` (the default) states that the file sandbox does not restrict sockets, that no permission request is needed for the network itself, and that a network command that also writes files still obeys the file policy; it also discloses the Windows restricted-token boundary (Schannel/.NET/curl TLS failures, pipe-capture failures) so the model does not misread environment failures as a policy block or escalate speculatively. `deny` tells the model to avoid outbound access and notes that `web_search`/`web_fetch` are refused.

#### Token effect

Two concise durable context messages on the first request and each effective policy change; unchanged requests add nothing. `workspace-write` carries only the canonical session workspace path; platform-specific temporary paths are summarized without adding host-dependent bytes.

#### KV Cache effect

The stable system prompt remains byte-identical across mode or network-policy changes. A changed full context snapshot is appended after retained history, preserving the prior cached prefix; subsequent unchanged requests reuse that retained snapshot.

## Known Limitations and Deferred Work

- **One primary workspace root per session** — policy resolves `SessionHeader.cwd`; extra writable roots are not part of `SandboxExecutionPolicy`.
- **Network enforcement is consumer-owned** — `NetworkPolicy` is carried on every resolved policy and enforced by network-bearing consumers (the web tools refuse under `deny`); the process-sandbox backends do not gate sockets, so a `deny` is not a kernel-level block on shell commands. A hard shell-level network block remains deferred.
- **Temporary areas are deliberately summarized** — enforcing backends grant different platform temporary areas, which are selected after policy resolution and therefore cannot be enumerated truthfully in the current context.
