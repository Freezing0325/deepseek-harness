---
description: "面向 web 宿主用户注意力事件的 Windows 桌面提醒：审批、提问与任务完成的浏览器任务栏闪光 + 提示音（fire-and-forget，仅 win32）。"
kind: "package-reference"
---

# @deepseek-ai/dsh-host-desktop-notify

[English](README.md) | 中文

## 概述

`dsh-host-desktop-notify` 在 web 宿主等待用户操作时把这些等待变得不容错过：你在别的窗口忙时，会收到 dsh 浏览器窗口的 QQ 式任务栏闪光，以及分类分音的系统提示音。它观察三个宿主事件——`approval/request`（工具请求一次决定）、`user-questions/request`（ask_user_question 挂起）、以及顶层任务的 `agent/status` running→idle 边沿——并交给一个 fire-and-forget 的 win32 PowerShell 子进程。提醒按契约尽力而为：绝不阻塞、绝不拖延、绝不让事件通道失败。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

在运行于 Windows、且想让安静的 UI 徽章获得带外提醒的 web 宿主部署中组合本插件。Web UI 里的审批与提问徽章本身不发声；在别的窗口忙的你容易让 agent 干等。本插件用熟悉的"任务栏闪光 + 提示音"配方补上这个缺口。

### 你能得到什么

三类事件的每一类，插件都会派生一个脱离的 `powershell.exe` 运行 [`scripts/desktop-notify.ps1`](scripts/desktop-notify.ps1)：它会闪动所有打开的浏览器窗口（默认 chrome、msedge、firefox、brave、opera、vivaldi——绝不打扰无关终端），并播放该类默认的系统提示音（审批 = 感叹音、提问 = 问询音、完成 = 星号音）。每类可用自定义 `.wav` 替换默认音，另有一个可选的前台消息框作为第三通道。同一冷却窗口内的并发爆发会折叠成一次提醒。

### 行为开关

`desktop-notify` 设置命名空间承载全部开关，每次提醒实时读取（编辑用户文档无需重启即生效）：总开关 `enabled`、`flash`/`popup` 通道开关、`flashWindows` 进程名单，以及按类的 `enabled`/`sound`/`soundFile` 小节。没有 settings provider 时使用上述默认值。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

### 设计思路

通知器（`src/desktop-notify.ts`）是一个纯宿主侧函数插件安装：在有 settings provider 时注册 `desktop-notify` 命名空间，并返回一个派生 Win32 子进程的 `notify(kind, info)` 句柄。插件接线（`src/index.ts`）把该句柄挂到三个注意力事件上。

### 观察 waterfall，绝不作答

`approval/request` 与 `user-questions/request` 是宿主经 `api/remotes` 转发给浏览器应答者（`ui-approval`、`ui-user-questions`）的 waterfall 事件。提醒监听器以 `prepend` 注册，从而无论加载顺序都先于转发监听器触发，然后始终 `return next()`：本插件只观察并提醒，从不认领请求。`agent/status` 是普通 emit；按 agent id 跟踪 running→idle 边沿并跳过 subagent 会话，因此只有顶层任务完成才提醒。

### Fire-and-forget 派生契约

子进程以 `powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File <脚本> ...` 派生，`stdio: 'ignore'` + `unref()`。刻意绝不传 `detached`/`windowsHide`：在 harness 的受限令牌沙箱下这两个标志会让 powershell.exe 静默退出而不执行脚本。开关标志以"出现/不出现"而非 `-Flag:$false` 传递，因为 `powershell -File` 把其后的每个 token 都绑定为字符串，`"$false"` 字符串在 PS 5.1 下无法做 SwitchParameter 转换。派生失败会被吞掉——提醒按契约尽力而为。

### 源码地图

| 文件 | 职责 |
|---|---|
| [`src/index.ts`](src/index.ts) | 宿主插件：settings 安装 + 三个事件监听器 |
| [`src/desktop-notify.ts`](src/desktop-notify.ts) | `installDesktopNotify`：settings 命名空间、默认值、冷却、派生契约 |
| [`scripts/desktop-notify.ps1`](scripts/desktop-notify.ps1) | Win32 子进程：任务栏闪光 + 提示音 + 可选弹窗（仅 ASCII；用户文案经 `DSH_NOTIFY_*` 环境变量到达） |

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [`ui-approval`](../../client/ui-approval/README.zh.md)——宿主转发的浏览器审批应答者。
- [`ui-user-questions`](../../client/ui-user-questions/README.zh.md)——浏览器提问应答者。
- [`api/remotes`](../../api/remotes/README.zh.md)——把 `approval/request` 与 `user-questions/request` 带到浏览器的宿主事件转发。

-----

<a id="model-experience"></a>
## 模型体验

无。插件不注册任何工具、系统提示段落或模型可见元数据；提醒是宿主侧 OS 通知。

#### KV Cache 影响

无；不组装也不发送任何 provider 请求。

-----

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与延期工作

- **仅 win32** —— 非 Windows 上安装是 no-op；其它平台没有带外提醒。
- **仅针对浏览器的闪光** —— 默认只闪浏览器；基于终端的 dsh 表面根本不经过本插件。
- **冷却折叠** —— 2 秒冷却窗口内的爆发只产出一条提醒，因此密集的先后审批不会逐条播报。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

未决的泛化（共用一个设置页）与非 Windows 后端是开放问题，不是缺陷。

</details>