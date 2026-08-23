# Agent Note: Independent Network Policy Axis

Status: implemented

English | [中文](2026-08-18-independent-network-policy.zh.md)

## Problem

`SandboxMode` was the only policy axis: `read-only` / `workspace-write` / `danger-full-access` govern file effects, and the docs explicitly left network and process policy outside the vocabulary. In practice the Windows ACL restricted-token runner does not gate sockets at all, yet users observed that "workspace-write blocks networking": network-bearing commands (git clone, package installs, downloads) frequently failed, the system prompt said nothing about network policy, and the model burned turns retrying and escalating to `danger-full-access` (which also opens arbitrary system writes) before understanding the failure. Two distinct failure modes fed the confusion:

- The restricted token breaks Windows-native TLS (Schannel/.NET/curl exit with `SEC_E_NO_CREDENTIALS` / `CURLE_SSL_CONNECT_ERROR`) and pipe capture of child output (access denied), while OpenSSL-based tools (node) work — platform facts invisible to the model.
- A network command that also writes files is denied by the file sandbox when the write target is outside the workspace, and the model could not tell "network blocked" from "write blocked".

## Decision

Add a second, independent policy axis — `NetworkPolicy` (`allow` / `deny`) — carried on `SandboxExecutionPolicy` and resolved by the sandbox-policy service, plus a durable per-session `network/policy` event with fold and write path (the `sandbox/mode` pattern), a `networkAccess` deployment default, and a `network:policy` runtime-context contribution that states the policy to the model.

- Default is `allow`: the file backends do not gate sockets, so outbound access stays permitted without any permission request; `deny` is an explicit opt-in.
- Enforcement is consumer-owned: the process-sandbox backends do not (and cannot cheaply) gate sockets on Windows, so `deny` is enforced by network-bearing consumers — the web tools (`web_search` / `web_fetch`) refuse before contacting any provider — and by the prompt telling the model to avoid outbound access. A kernel-level shell network block remains deferred.
- The `allow` prompt discloses the Windows restricted-token boundary (Schannel/.NET/curl TLS failures, pipe-capture failures, OpenSSL tools as the working alternative) and the write-policy interaction (writes inside the workspace need no escalation; only workspace-external writes do), so the model diagnoses failures instead of retrying and escalating blindly.
- Child delegation inherits the parent session's network override (`network/policy` with `source: 'delegation'`), matching the existing `sandbox/mode` behavior.

## Consequences

- Users can allow networking while keeping file writes confined (`workspace-write` + `networkAccess: 'allow'`), and can switch a session to `deny` through the durable event path; the model sees the current policy in every request context.
- The model stops misreading restricted-token TLS/pipe failures as a policy block and stops escalating speculatively; the failure guidance names the working alternatives and the environment suspects (proxy, VPN, DNS).
- The `network/policy` event joins the generated persistence catalog; old logs without it fold to the deployment default (`allow`), so no format version bump is needed.
- `NetworkPolicy` is advisory on the shell axis: a `deny` cannot stop a determined shell command from touching the network on Windows today.

## Alternatives considered

- **Extend `SandboxMode` with a fourth mode** — rejected: modes are a strictly-wider ladder used by escalation; network is orthogonal and must not enter that ladder.
- **A network block inside the shell executors** — rejected as the default: Windows restricted tokens cannot gate sockets, and a proxy-blackhole/env shim is partial and fragile; the consumer-owned gate covers the DSH-owned tools and the prompt covers the rest.
- **Prompt-only, no policy state** — rejected: the user explicitly asked for a switch, and a durable event makes the policy reconstructable and switchable per session, not just described.
