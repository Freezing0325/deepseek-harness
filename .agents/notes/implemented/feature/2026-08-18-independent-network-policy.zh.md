# Agent Note：独立的网络策略轴

Status: implemented

[English](2026-08-18-independent-network-policy.md) | 中文

## 问题

`SandboxMode` 曾是唯一的策略轴：`read-only`／`workspace-write`／`danger-full-access` 只管控文件操作，文档也明确把网络与进程策略排除在词汇之外。实际上 Windows ACL 受限令牌 runner 根本不拦截套接字，但用户观察到「workspace-write 会封锁联网」：涉及网络的命令（git clone、包安装、下载）频繁失败，系统提示词对网络策略只字未提，模型在理解失败原因之前反复试错、反复升权到 `danger-full-access`（同时也会放开任意系统写入）。两个不同的失败模式加剧了困惑：

- 受限令牌会破坏 Windows 原生 TLS 栈（Schannel／.NET／curl 以 `SEC_E_NO_CREDENTIALS`／`CURLE_SSL_CONNECT_ERROR` 失败）以及子进程输出的管道捕获（拒绝访问），而基于 OpenSSL 的工具（node）正常——这些平台事实模型完全看不到。
- 同时写文件的联网命令在写入目标位于工作区之外时会被文件沙箱拒绝，而模型无法区分「网络被封锁」与「写入被封锁」。

## 决策

新增第二条独立的策略轴——`NetworkPolicy`（`allow`／`deny`），随 `SandboxExecutionPolicy` 携带，由 sandbox-policy 服务解析；配套的持久逐会话 `network/policy` 事件（含 fold 与写入路径，沿用 `sandbox/mode` 模式）、`networkAccess` 部署默认值，以及向模型陈述策略的 `network:policy` 运行时上下文贡献。

- 默认为 `allow`：文件后端不拦截套接字，因此无需任何权限申请即可出站访问；`deny` 是显式选择。
- 执行由消费者负责：进程沙箱后端在 Windows 上无法（也难以廉价地）拦截套接字，因此 `deny` 由涉及网络的能力执行——web 工具（`web_search`／`web_fetch`）在接触任何 provider 之前拒绝——并由提示词告知模型避免出站访问。内核级 shell 网络封锁仍属暂缓事项。
- `allow` 提示词披露 Windows 受限令牌边界（Schannel／.NET／curl 的 TLS 失败、管道捕获失败，OpenSSL 工具是可用的替代）以及写入策略的交互（工作区内写入无需升权；只有工作区外的写入才需要），让模型学会诊断失败，而不是盲目重试和升权。
- 子代理委托继承父会话的网络覆盖（带 `source: 'delegation'` 的 `network/policy` 事件），与既有 `sandbox/mode` 行为一致。

## 后果

- 用户可以在保持文件写入受限（`workspace-write` + `networkAccess: 'allow'`）的同时放开联网，也可以通过持久事件路径将会话切换为 `deny`；模型在每次请求上下文中都能看到当前策略。
- 模型不再把受限令牌的 TLS／管道失败误读为策略封锁，也不再盲目升权；失败引导给出了可用的替代工具与环境排查方向（代理、VPN、DNS）。
- `network/policy` 事件进入生成的持久化目录；没有该事件的旧日志折叠回部署默认值（`allow`），因此无需提升格式版本。
- 在 shell 轴上 `NetworkPolicy` 只是建议性的：在 Windows 上 `deny` 目前无法阻止一条执意联网的 shell 命令。

## 备选方案

- **扩展 `SandboxMode` 增加第四种模式**：否决。模式是用于升权的严格递进阶梯；网络与之正交，绝不能进入该阶梯。
- **在 shell 执行器内做网络封锁**：否决作为默认方案。Windows 受限令牌无法拦截套接字，代理黑洞／环境变量垫片既不完整又脆弱；消费者级闸门覆盖 DSH 自有的工具，其余由提示词兜底。
- **只加提示词、不加策略状态**：否决。用户明确要求一个开关，而持久事件让策略可重建、可按会话切换，而非仅被描述。
