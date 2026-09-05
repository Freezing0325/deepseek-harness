# Agent Note: 在 OpenCode 路由上自动发送 x-opencode-session header

Status: implemented

[English](2026-09-05-opencode-session-header.md) | 中文

## 问题

OpenCode Go 从 09/05 起要求每个推理请求携带 `x-opencode-session` header（值为每个对话稳定的 UUID），缺失则报错。而 harness 什么都不发：没有任何适配器附加会话身份，唯一的变通办法是在每个路由手写静态 `headers` 项——所有对话共用一个 id，恰恰破坏了这个 header 要表达的按对话亲和性。约 2.5 万个 harness 用户组织在调用 Go API，其中 `deepseek-v4-flash` 量最大，而提供方侧测得的 header 覆盖率接近于零（见[讨论帖](https://github.com/deepseek-ai/deepseek-harness/discussions/5495)）。

## 决定

`llm-pi-ai` 在[adapter.ts](../../../../packages/llm/llm-pi-ai/src/adapter.ts) 的对话调用点，给所有 `opencode*` 路由自动附加该 header。门控对标官方 OpenCode 客户端（`providerID.startsWith("opencode")`）。线上值由 harness 对话 id（`session-<uuid>`，每个对话签发一次、创建时冻结）剥出裸 UUID 得到；不含 UUID 的值原样发送。因此该值在多轮、resume、compaction、retry 之间保持稳定，新对话、fork、子代理会话则换新值。运行时值优先于任何静态 `headers` 项；非 OpenCode 路由与 discovery 探测不发送。

## 备选方案

**`sessionHeader` profile 字段（显式 opt-in）。** 逐路由配置要发送的 header 名，是通用机制，也能组合未来有同样需求的提供方。未被选为默认方案，因为这个 header 没有自由度——头名、值来源、路由三者全由提供方定死——每个部署都要手写同一行，而漏配的路由静默损坏。该字段仍可作为未来的手动覆盖项；出货的是自动默认行为。

**在 `dsh-llm` attribution 层注入，让所有 adapter 都带。** 一处覆盖 pi-ai 之外的 adapter。暂否决，因为目前只有 pi-ai 服务 OpenCode 路由，而 attribution 层是共享 header 空间，不属于提供方专属 header 的位置。若将来有别的 adapter 路由到 OpenCode，再搬不迟。

**逐路由静态 `headers` 项。** 本来就可行，也本来就是错的：所有对话一个 id，压垮提供方按此缓存的亲和性；陈旧静态值还会掩盖真相。现在运行时值优先于静态项。

## 后果

部署无需改配置：升级后现有 `opencode*` 路由即开始发送。之前手写过静态 `x-opencode-session` 的部署照常工作——静态值会被每对话值覆盖，删掉只是清理，不是迁移。OpenCode 之外的提供方看不到新 header。

## 测试

`packages/llm/llm-pi-ai/tests/session-header.spec.ts` 用 mock server 的 header 记录固定了：门控、裸 UUID 归一化、无 session 不发、非 UUID 原样、运行时优先于静态。