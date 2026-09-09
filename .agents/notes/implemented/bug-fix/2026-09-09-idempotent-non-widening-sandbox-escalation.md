# Agent Note: Idempotent non-widening sandbox escalations

Status: implemented

English | [中文](2026-09-09-idempotent-non-widening-sandbox-escalation.zh.md)

## Problem

Under a standing `danger-full-access` policy, models that were taught the
escalation fields by a narrower session keep attaching `sandbox_permissions`
defensively. The shared escalation choreography treated every such request as a
must-widen ask and failed the whole call before execution: `approveEscalation`
rejected a same-or-narrower mode with `sandbox escalation ... is not strictly
wider than this call's current "danger-full-access" mode` (nothing on the
`WIDER_MODES` ladder is wider than full access), and a blank `justification`
died earlier on `invalid justification: expected a non-empty sentence`. The
errors read like the permission system itself malfunctioning — "full access
sometimes does not work" (upstream Discussions #468, #340, #201, reported by
users on bash, pwsh, and fs tools across providers) — and every occurrence was
a wasted tool round-trip the model could not repair from its side, because no
wider mode exists to request.

## Decision

Make non-widening escalation requests **idempotent instead of fatal** at the
shared layer, and let the tool families skip the pairing validation for them:

- `approveEscalation` in `dsh-sandbox` gains a rank-based pre-check
  (`isNonWidening` against a `MODE_RANK` table) ahead of the strict-widening
  gate: a requested mode at or below the call's effective mode reuses the
  standing mode without consulting the approval channel, never lowers the
  call, and never reports an error. Only a strict widening reaches the
  approval channel, and an unrankable (unknown) mode string still fails closed
  through the existing `WIDER_MODES` check with the verbatim `not strictly
  wider` text, so the closed vocabulary stays enforced.
- The tool families (`tool-bash`, `tool-pwsh`, `tool-fs`) resolve the standing
  policy before validating the escalation arguments and detect the redundant
  case with the same shared predicate; a redundant request skips the
  `sandbox_permissions`/`justification` pairing validation (blank or missing
  justification included) and executes under the standing policy.

This is the upstream-discussion-recommended fix (option A), generalized from
the community patch (`if (effectiveMode === "danger-full-access") return
effectiveMode`) to handle every non-widening pair — including
`workspace-write` under `workspace-write` — while an unknown mode stays
fail-closed.

## Alternatives considered

**Reject at the tool schema / prompt instead (discussion option B).** Rejected:
schemas are registry-global while the effective mode is per-call truth, so the
enum cannot be trimmed per session; and models already holding the escalation
habit still emit the fields until the habit decays. The execution-time
idempotence handles both today and any future session.

**Accept only the exact equal-mode pair.** Rejected: a request for a strictly
narrower mode is equally redundant, and treating it as fatal keeps the
misleading error for the real-world `workspace-write`-under-full-access retry.

**Silently drop the redundant arguments at argument validation.** Rejected:
the pairing check cannot see the effective mode, so idempotence must be
decided where the standing policy is known — at the escalation resolution
point.

## Consequences

A `danger-full-access` session now executes a defensive same-or-narrower
`sandbox_permissions` retry (blank justification included) under the standing
mode instead of dying before anything runs, eliminating the "full access
sometimes fails" misdiagnosis and the wasted round-trips. Security properties
are unchanged: a strict widening still requires approval, a non-widening
request never prompts a human, an unknown mode string still fails closed, and
the call never runs under a mode narrower than its effective mode. Behavior is
pinned by updated escalation specs and new tool-level regression tests
(title: "runs a redundant escalation under the standing mode without
prompting").