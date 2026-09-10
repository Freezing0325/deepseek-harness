# 本地补丁登记册（local/）

这个目录只做一件事：**让你的每一条本地定制都有归属、有探针、有重放时机**。

跑 `local\doctor.cmd`（或双击）即可把下面所有检查跑一遍，最后输出一张表。

- 教程向的 git 操作说明在仓库根目录 `GIT-GUIDE.md`。
- 设计背景与历史决策在 `~/.dsh/PATCHING.md`。
- 本文件是**补丁的唯一清单**：加了新补丁必须在这里登记一行，否则 doctor 检查不到它。

## 一、为什么要这么组织

本地定制其实有三类，**它们的失效方式完全不同**，所以不能用同一套办法管：

| 类别 | 住在哪 | 上游更新时会怎样 | 失效方式 |
|---|---|---|---|
| **A 源码补丁** | 本仓库 `my-custom` 上的 commit | `git rebase origin/master` 自动重放 | rebase 冲突；或 rebase 干净通过但语义被改坏；或提交被判"上游已应用"而**静默丢弃** |
| **B 仓库外补丁** | `~/.dsh/`、npm 全局目录 | git 完全不管 | `npm update -g` 直接覆盖；换机/重装后凭空消失 |
| **C 配置** | `~/.dsh/settings.yaml`、profile 的 `cordis.patch.yml` | git 完全不管 | 靠人记得；无版本历史 |

三个必须记住的原则：

1. **不存 `.patch` / `.diff` 副本。** A 类补丁的 commit 本身就是补丁；B 类补丁的幂等脚本本身就是补丁。再存一份 diff 等于第三份真相，上游一动就腐烂。
2. **探针必须是可执行的。** "记得手动检查"等于没检查——2026-09-10 就是这样漏掉了 fork 落后 2 条提交。每条补丁要配一条命令，doctor 替你跑。
3. **B 类补丁的脚本要幂等 + 失败即退出。** 已经打过就跳过，锚点找不到就报错，绝不半改。`patch-opencode-session.cjs` 是模板。

## 二、A 类：源码补丁

探针统一是"跑补丁自带的 spec"。**补丁被打包了测试，测试就是探针**——rebase 之后 spec 还绿，说明补丁活着；spec 变红，说明它被 rebase 吃掉或被改坏。

| # | 补丁 | 提交 | 探针（spec 文件） |
|---|---|---|---|
| A1 | OpenCode `x-opencode-session` 头（源码侧） | `47b69d2f8a` | `packages/llm/llm-pi-ai/tests/session-header.spec.ts` |
| A2 | 桌面提醒 desktop-notify（审批/提问/完成，win32） | `0f185d5cde` | `packages/api/remotes/tests/desktop-notify.spec.ts` |
| A3 | 标签页待审批闪烁 | `328ba0cb93` | `packages/client/ui-layout/tests/document-title.client.spec.tsx` |
| A4 | 沙箱升级幂等（重复的非扩权升级请求不再报错） | `31df14264f` | `packages/sandbox/sandbox/tests/escalation.spec.ts`、`packages/fs/tool-fs/tests/tools.spec.ts`、`packages/shell/tool-bash/tests/tools.spec.ts`、`packages/shell/tool-pwsh/tests/tools.spec.ts` |
| A5 | 一键更新脚本 + git 指南（本目录的宿主） | `3b8bc323ca`、`f4cecd9fab`、`995a4cce66`、`caa6b07bbb`、`bdee25e3f9` | 文件存在性断言（doctor 内置，无需 spec） |
| A6 | Agent Note 文档配对记录 | `a3cbcfafe5` | 文件存在性断言（doctor 内置） |
| A7 | `session.events` getter（`deepseek tui` 读取；快照重构后变成 undefined） | `ea2573c083` | `packages/core/session/tests/session.spec.ts`（`events getter` 两条用例） |

> A4 与 A1 都属于**上游也想要**的修复（A4 上游至今没有、A1 有人独立写了同样实现）。能提到上游就尽早提，合并后这条补丁永久消失，连 npm 侧都不用再补。

> A7 走的是**构建产物**而非源码：`deepseek tui` 是 `node` 直接拉起 npm 上的 dsh-tui（没有 tsx hook），它解析到的 `@deepseek-ai/dsh-session` 就是 `packages/core/session/lib/` 的编译结果。所以改了 `src/index.ts` 必须 `pnpm build` 才对 TUI 生效——只改源码不构建，TUI 仍读旧产物（`agent.session.events` 几十处会读出 undefined）。

## 三、B 类：仓库外补丁

| # | 补丁 | 载体（唯一真相） | doctor 怎么查 |
|---|---|---|---|
| B1 | npm 版 dsh 的 `x-opencode-session` 头（`deepseek tui` 链路） | `local/patch-opencode-session.cjs` | 幂等重跑 + 对产物做行为断言 |
| B2 | `deepseek` 启动器（`deepseek.exe` / `deepseek.cmd` / `deepseek.cs`） | `~/.dsh/bin/`（本仓库不存，见下） | 断言 `deepseek.cmd` 含 `--no-open`、是 CRLF、`deepseek.exe` 存在 |

**B1 为什么需要**：`deepseek tui` 走第三方 `@deepseek-harness-tui/dsh-tui` → `~/.dsh/profiles/dsh-tui` → **npm 版 dsh**，不经过源码 fork，所以 A1 的修复够不着它；`~/.dsh/profiles/node_modules/@deepseek-ai/dsh-llm-pi-ai` 是**指向 npm 安装目录的 Junction**，一份补丁两条路径都生效。

**B1 什么时候必须重跑**：`npm update -g @deepseek-ai/dsh` 会覆盖产物 → 跑 doctor 即可（它会重新补上）。B1 的触发条件是三个 B 类里唯一会**静默失效**的，所以 doctor 把它做成自动重放。

`~/.dsh/bin/patch-opencode-session.cjs` 现在是一个**转发器**，指向本目录的脚本；改脚本请改本目录这份（它才是被 git 管起来的那份）。

**B2 为什么不进仓库**：启动器里有本机绝对路径与用户特定行为（黑窗口/set 模式/token 提取），而且它必须在 dsh 启动前就可用——放进仓库反而多一层依赖。因此只做**断言**（发现漂移就报），不做自动重放。

## 四、C 类：配置（只能人工核对）

doctor 会把这些原样列出来提醒你，但不会替你改：

- `~/.dsh/settings.yaml` 的 `desktop-notify` 段（开关 / 提示音 / `flashWindows`）
- `~/.dsh/profiles/web/cordis.patch.yml`、`~/.dsh/profiles/dsh-tui/cordis.patch.yml` 的插件注册
- `~/.dsh/mode.txt`（默认模式 web / cli / tui）
- `.credentials.yaml` 的 `version` 必须是**数字 `1`**
- npm 全局是否又被生成了无扩展名 shim `%APPDATA%\npm\dsh`、`%APPDATA%\npm\dsh-tui`（有就删）

## 五、什么时候跑 doctor

| 时机 | 谁触发 |
|---|---|
| 每次 `update-dsh.cmd` 跑完 | **自动**（脚本最后一步） |
| `npm update -g @deepseek-ai/dsh` 之后 | 手动 |
| `git rebase origin/master` 之后 | 手动（update-dsh.cmd 已含） |
| fork 上有没有我不知道的提交 | 每次 doctor 都会报 |
| TUI / web 报诡异错误时 | 手动，先看这张表 |

```bat
local\doctor.cmd            :: 全量
local\doctor.cmd -Quick     :: 跳过 A 类 spec（只看 fork 漂移与 B 类）
```

## 六、加一条新补丁时

1. 改代码，**同时写一个 spec**（这就是你未来的探针）。
2. 提交到 `my-custom`，小步提交、一条补丁一个目的。
3. 到本文件第二节加一行：补丁名、提交号、探针文件。
4. 跑一次 `local\doctor.cmd` 确认它变绿。
5. `git push mine my-custom` 推给 fork。
