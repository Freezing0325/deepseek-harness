# 换机核对清单（local/PORTING.md）

> 用途：本机（"这台"）和另一台电脑（"那台"）共用同一个 fork，但**只有仓库里的东西能靠 git 同步**。
> 本文件记录 git 管不到、必须人工核对的部分，以及每次官方更新后那台要做的事。
>
> 最后更新：2026-09-10 | 本机：`E:\Code\deepseek-harness`（用户 `16034`）| 官方基线：**0.1.5-rc.1**

---

## 一、代码同步（每次都做）

### 1.1 先对齐远端名

本仓库的约定是 **`origin` = 官方**、**`mine` = 自己的 fork**：

```bash
git remote -v
# origin  https://github.com/deepseek-ai/deepseek-harness.git
# mine    https://github.com/Freezing0325/deepseek-harness.git
```

名字不一样就先 `git remote rename` 对齐（早期文档里 fork 叫过 `origin`）。名字对不上时，本文件下面所有 `mine/...` 都要按实际名字替换。

### 1.2 2026-09-10 这次升级**重写了 `my-custom` 的历史**

官方从 `0.1.2-alpha.5` 跳到 `0.1.5-rc.1`（1459 条提交），15 条本地补丁全部 rebase 重放，**sha 全变了**。那台如果还停在旧 sha 上，普通 `git pull` 会失败或产生分叉 —— 显式重置：

```bash
git status                                  # 先确认没有未提交改动（有就先提交或 stash）
git branch backup/pre-0.1.5-<日期>           # 备份本地，别省这一步
git checkout my-custom
git fetch mine
git reset --hard mine/my-custom
```

⚠️ 如果那台本地有**这台没有的提交**，先别 reset：记下那几条提交，重置后 `git cherry-pick`，或者先告诉这台，由这台合并后再统一推送。

### 1.3 装依赖 + 重建产物

```bash
pnpm install        # 官方这次动了依赖，必须重新装
pnpm run build      # 必须：TUI 读的是 packages/core/session/lib/ 构建产物（见 A7）
```

### 1.4 自检

```bat
local\doctor.cmd
```

全绿（或只剩"工作树不干净"这类 WARN）才算同步完成。A 类补丁逐条跑它自带的 spec 探针，红了说明补丁被这次同步弄坏了。

---

## 二、启动器（git 管不到，两台各自维护，只核对行为一致）

启动器在两台的 `%USERPROFILE%\.dsh\bin`：`deepseek.exe`（Explorer 地址栏可用）、`deepseek.cmd`（分发逻辑）、`deepseek.cs`（exe 源码）、`open-web-url.ps1`（打开带 token 的 URL）、`dsh.cmd`（给硬编码 `dsh` 的第三方工具用的 shim）。**本文件不复制这些文件**，只登记它们必须满足的行为。

### 2.1 必须一致的契约

| 项 | 约定 |
|---|---|
| 子命令 | `deepseek`（默认模式）/ `web` / `cli` / `tui` / `set web\|cli\|tui` / `stop` |
| web 启动 | 调 `dsh web --no-open`（自己开浏览器，避免双开），并等日志里出现 `?token=` 再开 |
| token 提取 | 日志文件引用必须存在（本机叫 `web-url.log`，旧版本叫 `web.out.log`，doctor 两个都认） |
| 行尾 | `deepseek.cmd` 必须是 **CRLF**（LF 会让 cmd.exe 扫标签和中文出错） |
| tui | 必须**前台**运行、保留 TTY；非交互环境只打印提示不硬启 |
| stop | `taskkill /F /T` 杀掉 3080 的进程树 |

核对方法：跑 `local\doctor.cmd`，B2 那一条会逐项断言上面几项；缺哪条按提示补。

### 2.2 本次升级对启动器的影响：**不需要改**

官方 0.1.5 的 CLI 参数与 0.1.2 一致 —— `web --no-open`、`dsh --profile headless "任务"` 都还在，token URL 仍然打印成 `http://127.0.0.1:3080/?token=...`，所以 `deepseek.cmd` 的分发逻辑照旧可用。

本机在这轮里动过启动器一处：`deepseek.cmd` 由 LF 转成 **CRLF**。那台也建议查一下（`local\doctor.cmd` 会替你看）。

### 2.3 顺手要删的东西

npm 全局若又生成了**无扩展名 shim**（`%APPDATA%\npm\dsh`、`%APPDATA%\npm\dsh-tui`），在浏览器地址栏输入时会弹"打开方式"，出现就删。

---

## 三、`~/.dsh` 配置（git 管不到，逐项核对）

### 3.1 `settings.yaml` 的关键项

本机当前值（**不含密钥**）：

| 段 | 本机值 | 说明 |
|---|---|---|
| `agent-default-model` | `opencode-go-chat` / `deepseek-flash` | 默认模型 |
| `permission.defaultPreset` | `danger-full-access` | 审批策略 |
| `ui-conversation.busyEnter` | `steer` | 忙时回车行为 |
| `ui-theme.preference` | `light` | 主题 |
| `llm-pi-ai.providers` | 见下表 | 自定义 provider（**这部分最值得核对**） |

本机自定义的 provider：

| provider | api | apiKeyEnv |
|---|---|---|
| `zai-coding-cn` | 默认 | `ZAI_CODING_CN_API_KEY` |
| `opencode-go` | 默认 | `OPENCODE_GO_API_KEY` |
| `opencode-go-customized` | `openai-responses` | `OPENCODE_GO_CUSTOMIZED_API_KEY` |
| `opencode-go-chat` | `openai-completions` | `OPENCODE_GO_CUSTOMIZED_API_KEY` |
| `opencode-go-messages` | `anthropic-messages` | `OPENCODE_GO_CUSTOMIZED_API_KEY` |
| `paratera` | `openai-completions` | `PARATERA_API_KEY` |

那台如果缺哪个 provider，模型列表里就会少掉对应模型 —— 按上表补（模型清单可直接从这台的 `settings.yaml` 抄，值里没有密钥）。

### 3.2 凭据 `.credentials.yaml`

- `version` 必须是数字 `1`。
- 密钥值**不在仓库里**，每台各填各的。本机引用到的 key 名：`DEEPSEEK_API_KEY`、`OPENCODE_GO_API_KEY`、`OPENCODE_GO_CUSTOMIZED_API_KEY`、`PARATERA_API_KEY`、`ZAI_CODING_CN_API_KEY`。
- 那台若用不同的 key 名，把 `settings.yaml` 里的 `apiKeyEnv` 一起改掉。

### 3.3 `mode.txt`

本机是 `web`（一行，末尾无空行也无所谓，但本机是 CRLF）。`deepseek` 不带参数时按它进默认模式。

---

## 四、profile（`~/.dsh/profiles/`）

### 4.1 web profile

本机 `package.json` 的 `dsh.profile.bundles`（后三个是 npm 上的第三方插件，profile 目录里 `pnpm install` 之后才有）：

```
@deepseek-ai/dsh-base
@deepseek-ai/dsh-web-app
dshmarket
@linxin666/dsh-web-all
dsh-session-recycle-bin
```

那台若缺这些第三方插件，在 profile 目录里装一次（`dsh plugin` 就是把参数转发给 pnpm，工作目录是那个 profile）：

```bash
dsh plugin --profile web install
```

本机 `cordis.patch.yml` 里注册了一个**仓库外的工作区插件**（这是跨机器最容易踩的坑）：

| 项 | 本机值 |
|---|---|
| 插件文件 | `E:\尹思昱\学习\研一下\断裂力学\断裂力学笔记插件.cjs` |
| `workspaceDir` | `E:\尹思昱\学习\研一下\断裂力学` |
| `noteFile` | `断裂力学笔记.html` |

**那台据说在 D 盘** —— 必须核对这两处路径是否存在，不存在就改成那台的实际路径（`name` 是 `file:///` 编码后的 URL，改完记得保持 URL 编码一致；`workspaceDir` 是普通 Windows 路径）。路径不存在时该 profile 会加载失败。

核对方法：跑 `local\doctor.cmd`（C 类会检查 `cordis.patch.yml` 里引用的 `file://` 路径是否可达），或手动：

```powershell
Get-Content "$env:USERPROFILE\.dsh\profiles\web\cordis.patch.yml"
```

### 4.2 dsh-tui profile

本机 `cordis.patch.yml` 是空数组 `[]`；`deepseek tui` 的界面由 npm 全局包 `@deepseek-harness-tui/dsh-tui` 提供，那台需要：

```bash
npm i -g @deepseek-harness-tui/dsh-tui
```

TUI 会读 `session.events`（见 A7 补丁），而它加载的是 `packages/core/session/lib/` 的**构建产物**（`node` 进程没有 tsx hook）—— 所以 **每次 pull 后必须 `pnpm run build`**，否则 TUI 读到的还是旧产物。

---

## 五、npm 侧补丁（B1）—— 只在用 npm 版 dsh 时才需要

`local/patch-opencode-session.cjs` 给 **npm 安装的 dsh** 补 `x-opencode-session` 头（OpenCode Go 的推理请求要求）。

- 本机走源码版（`~/.dsh/custom.cmd` 指向这个 checkout），**不需要**它。
- 那台若 `~/.dsh/custom.cmd` 不存在、实际在跑 npm 版 dsh，则需要；`npm update -g @deepseek-ai/dsh` 会覆盖产物，升级后重跑：

```bash
node local/patch-opencode-session.cjs
```

---

## 六、这次升级两台各自要做的总结

| 步骤 | 这台 | 那台 |
|---|---|---|
| `git reset --hard mine/my-custom`（历史被重写） | 已完成 | **必做** |
| `pnpm install` | 已完成 | **必做** |
| `pnpm run build` | 已完成 | **必做** |
| `local\doctor.cmd` 全绿 | 已完成（A1–A7、B1–B2 通过） | 要跑一次 |
| 启动器改动 | 无需改（上一轮修过 CRLF） | 核对 CRLF / `--no-open` / token 提取 |
| `settings.yaml` provider | 本文件 3.1 为准 | 缺的补上 |
| web profile 外部插件路径 | `E:\尹思昱\...` | 按实际盘符改 |
| 默认模式 `mode.txt` | `web` | 按喜好 |

任何一项对不上，**先按本文件核对，再决定改哪边**；改完记得把结论写回本文件（它就是为这件事存在的）。
