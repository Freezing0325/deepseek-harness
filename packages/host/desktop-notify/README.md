---
description: "Windows desktop alert for web-host user-attention events: approval, question, and task-complete taskbar flash + chime (fire-and-forget, win32 only)."
kind: "package-reference"
---

# @deepseek-ai/dsh-host-desktop-notify

English | [中文](README.zh.md)

## Summary

`dsh-host-desktop-notify` notices when the web host is waiting on the user and
makes that wait impossible to miss: a user working in another window gets a
QQ-style taskbar flash on the dsh browser windows plus a per-kind system chime.
It observes three host events — `approval/request` (a tool asks for a
decision), `user-questions/request` (ask_user_question is pending), and the
`agent/status` running→idle edge for top-level tasks — and hands each to a
fire-and-forget win32 PowerShell child. The alert is best-effort by contract:
it never blocks, never delays, and never fails the event channel.

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

Compose this plugin in a web host deployment that runs on Windows and wants
out-of-band attention for quiet UI badges. The approval and question badges in
the Web UI announce nothing by themselves; someone parked in another window
lets the agent stall. This plugin bridges that gap with the familiar taskbar
flash + chime recipe.

### What you get

For each of the three event kinds the plugin spawns a detached `powershell.exe`
running [`scripts/desktop-notify.ps1`](scripts/desktop-notify.ps1), which
flashes every open browser window (chrome, msedge, firefox, brave, opera,
vivaldi by default — never unrelated terminals) and plays the kind's default
system sound (exclamation for approval, question for a question, asterisk for
completion). A custom `.wav` can replace the default per kind, and a foreground
message box is available as an opt-in third channel. Parallel bursts inside one
cooldown window collapse into a single alert.

### Behavior switches

The `desktop-notify` settings namespace carries the switches, read live on
every alert (edits to the user document apply without a restart): a master
`enabled` switch, `flash`/`popup` channel toggles, the `flashWindows` process
list, and per-kind `enabled`/`sound`/`soundFile` sections. Without a settings
provider the plugin uses the defaults above.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

### Design concept

The notifier (`src/desktop-notify.ts`) is a pure host-side function plugin
install: it registers the `desktop-notify` settings namespace when a settings
provider is mounted, then returns a `notify(kind, info)` handle that spawns the
Win32 child. The plugin wiring (`src/index.ts`) attaches that handle to the
three attention events.

### Waterfall observation, never answering

`approval/request` and `user-questions/request` are waterfall events the host
forwards to browser answerers (`ui-approval`, `ui-user-questions`) through
`api/remotes`. The alert listeners register with `prepend` so they fire before
the forwarding listener regardless of load order, then always `return next()`:
this plugin observes and alerts, it never claims the request. `agent/status`
is a plain emit; the running→idle edge is tracked per agent id and subagent
sessions are skipped, so only a top-level task finishing alerts.

### Fire-and-forget spawn contract

The child is spawned as `powershell.exe -NoProfile -NonInteractive
-ExecutionPolicy Bypass -WindowStyle Hidden -File <script> ...` with
`stdio: 'ignore'` and `unref()`. `detached`/`windowsHide` are deliberately
never passed: under the harness's restricted-token sandbox those flags make
powershell.exe exit silently without running the script. Switch flags are
passed present/absent rather than `-Flag:$false`, because `powershell -File`
binds every following token as a string and `"$false"` fails SwitchParameter
conversion in PS 5.1. A failed spawn is swallowed — the alert is best-effort.

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Host plugin: settings install + the three event listeners |
| [`src/desktop-notify.ts`](src/desktop-notify.ts) | `installDesktopNotify`: settings namespace, defaults, cooldown, and the spawn contract |
| [`scripts/desktop-notify.ps1`](scripts/desktop-notify.ps1) | Win32 child: taskbar flash + sound + optional popup (ASCII-only; user copy arrives via `DSH_NOTIFY_*` env) |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [`ui-approval`](../../client/ui-approval/README.md) — the browser approval answerer the host forwards to.
- [`ui-user-questions`](../../client/ui-user-questions/README.md) — the browser question answerer.
- [`api/remotes`](../../api/remotes/README.md) — the Host event forwarding that carries `approval/request` and `user-questions/request` to the browser.

-----

<a id="model-experience"></a>
## Model Experience

None. The plugin registers no tool, no system-prompt section, and no model-visible
metadata; alerts are host-side OS notifications.

#### KV Cache effect

None; no provider request is assembled or sent.

-----

<a id="known-limitations-and-deferred-work"></a>
## Known Limitations and Deferred Work

- **Win32 only** — off Windows the install is a no-op; other platforms get no
  out-of-band alert.
- **Browser-targeted flash only** — the flash targets browsers by default; a
  terminal-based dsh surface never routes through this plugin.
- **Cooldown collapse** — bursts inside the 2 s cooldown window produce one
  alert, so distinct rapid approvals are not individually announced.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

The postponed generalization (one shared settings page) and any non-Windows
backend are open questions, not defects.

</details>