# Agent Note：沙箱升级请求的幂等非加宽处理

Status: implemented

[English](2026-09-09-idempotent-non-widening-sandbox-escalation.md) | 中文

## 问题

在 standing `danger-full-access` 策略下，曾被较窄会话教会升级字段的模型会防御性地继续携带 `sandbox_permissions`。共享的升级编排把这类请求一律当作必须加宽的请求，并在任何执行之前让整个调用失败：`approveEscalation` 对同级或更窄模式抛出 `sandbox escalation ... is not strictly wider than this call's current "danger-full-access" mode`（`WIDER_MODES` 阶梯上没有任何模式比 full access 更宽），空白 `justification` 则更早死在 `invalid justification: expected a non-empty sentence` 上。这些错误读起来像是权限系统自身出了故障——"full access 有时不生效"（上游 Discussions #468、#340、#201，用户在 bash、pwsh、fs 工具上跨 provider 报告）——而且每一次发生都是一次模型无法自行修复的无效工具往返，因为不存在可以请求的更宽模式。

## 决策

在共享层把非加宽升级请求改为**幂等放行而非致命失败**，并让工具族对这种请求跳过配对校验：

- `dsh-sandbox` 的 `approveEscalation` 在严格加宽闸门之前新增基于等级的前置检查（针对 `MODE_RANK` 表的 `isNonWidening`）：请求模式等于或低于调用有效模式时，直接复用有效模式，不咨询审批通道、绝不降低调用、绝不报错。只有严格加宽才到达审批通道；无法排名（未知）的模式字符串仍会经既有 `WIDER_MODES` 检查以逐字 `not strictly wider` 文本 fail closed，封闭词汇表保持强制。
- 工具族（`tool-bash`、`tool-pwsh`、`tool-fs`）在验证升级参数之前先解析 standing 策略，并用同一个共享谓词识别冗余情形；冗余请求跳过 `sandbox_permissions`/`justification` 配对校验（含空白或缺失 justification），直接按 standing 策略执行。

这是上游讨论推荐方案（方案 A）的落地，并从社区补丁（`if (effectiveMode === "danger-full-access") return effectiveMode`）推广到所有非加宽组合——包括 `workspace-write` 在 `workspace-write` 下——同时未知模式保持 fail closed。

## 考虑过的替代方案

**改为在工具 schema / 提示层拒绝（讨论方案 B）。** 否决：schema 是注册表全局的，而有效模式是按调用的真值，枚举无法按会话裁剪；而且已经养成升级习惯的模型在习惯消退前仍会携带这些字段。执行时的幂等既覆盖当下，也覆盖未来的任何会话形态。

**只接受恰好相等的模式组合。** 否决：请求严格更窄的模式同样冗余，把它当作致命错误会让真实世界里"full access 下请求 workspace-write"的重试继续产生误导性错误。

**在参数校验阶段静默丢弃冗余参数。** 否决：配对校验看不到有效模式，因此幂等必须在知道 standing 策略的地方判定——即在升级解析点。

## 后果

`danger-full-access` 会话现在会以 standing 模式执行防御性的同级或更窄 `sandbox_permissions` 重试（含空白 justification），而不是在任何执行前夭折，消除了"full access 有时失效"的误诊与无效往返。安全属性不变：严格加宽仍须审批，非加宽请求绝不提示人类，未知模式字符串仍 fail closed，调用绝不以窄于有效模式的模式运行。行为由更新的升级 spec 与新的工具级回归测试钉住（标题："runs a redundant escalation under the standing mode without prompting"）。