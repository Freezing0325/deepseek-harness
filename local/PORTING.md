# 换机核对清单（local/PORTING.md）

> 用途：本机（"这台"）和另一台电脑（"那台"）共用同一个 fork，但**只有仓库里的东西能靠 git 同步**。
> 本文件记录 git 管不到、必须人工核对的部分，以及每次官方更新后那台要做的事。
>
> 最后更新：2026-10-03 | 本机：0.2.0 树 `D:\Code\dsh-020`（worktree，分支 `my-custom-020`）+ 0.1.5 冷备树 `D:\Code\deepseek-harness` | 官方基线：**0.2.0-rc.2**
>
> **0.2.0 环境怎么在那台落地 → 直接看第八节（含 `local\setup-020.ps1` 一条命令）。**

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

> 本节描述的是 **0.1.5 时代**的 `web` profile。**0.2.0 的 profile（`web020` 与 `dsh-tui`）见第八节**，它们的定义已经进仓库（`local/profile/`），不再靠手工抄。

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

## 六、升级与构建踩过的坑

（这两条来自 2026-09-02 的那份旧移植笔记，至今仍然有效，所以搬到这里；其余内容已被本文件取代。）

**构建**

- 官方换版本（大改）后先 `pnpm run clean` 再 `pnpm run build`：tsc 的增量缓存（`*.tsbuildinfo`）会把**陈旧产物**留在 `packages/*/lib/`，tsdown 打包时报 `MISSING_EXPORT`（本机实际遇到过，clean 之后就好了）。
- 源码版启动走 `node --import tsx/esm apps/cli/src/bin.ts`，host / client 两面的 `lib/*.js` 产物都必须存在（缺 `typert.host.js` 或 `lib/client.js` 会启动即崩）。
- 冷启动（重启机器后第一次）超过 30 秒属正常（tsx 要加载整仓），启动器的等待上限约 3 分钟。
- 只想局部重建：`pnpm run build:lib`（库）/ `pnpm run build:web`（前端 `apps/web/dist`，改前端后只跑这个）。

**数据目录（`~/.dsh`）**

- 会话正文：`~/.dsh/sessions/**/session.jsonl.zstd`（zstd 压缩的历史，**勿删**）。
- 派生投影缓存：`~/.dsh/storages/`。旧版本写下的缓存与新版 schema 不兼容时**启动会崩**——把 `storages` 备份移走后新版会自动重建（本机 2026-09-02 就这样处理过，重建后自动恢复了 3 个旧工作区）。
- `~/.dsh/storages.old-20260902` 是当时的备份，确认不需要回滚就可以删（本机仍留着）。

---

## 七、这次升级两台各自要做的总结

> 本节是 **0.1.5 那次**升级的收尾表，保留作历史对照；**0.2.0 的落地见第八节**。

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

---

## 八、0.2.0 环境落地（2026-10-03，当前主线）

本机的形态是**一棵 0.2.0 树 + 两个 profile + 两个指针**，0.1.5 树保留为冷备（切换是秒级的）：

| 角色 | 本机值 | 仓库里的位置 |
|---|---|---|
| 0.2.0 树 | `D:\Code\dsh-020`（git worktree，分支 `my-custom-020`，已推 `mine/my-custom-020`） | 就是这个仓库的 `my-custom-020` 分支 |
| 0.1.5 树（冷备） | `D:\Code\deepseek-harness`（分支 `my-custom`；**没有** `.dsh-profile`，所以仍走 `web` profile） | 同一仓库的 `my-custom` 分支 |
| 0.2.0 Web profile | `~\.dsh\profiles\web020` | `local/profile/web020/`（3 个文件） |
| TUI profile | `~\.dsh\profiles\dsh-tui` | `local/profile/dsh-tui/`（2 个文件） |
| 指针 | `~\.dsh\tree.txt` 选树；`<树>\.dsh-profile` 选该树的 profile | 机器本地，**不进 git**（已在 `.gitignore` 里） |

### 8.1 那台的一条命令

```powershell
git fetch mine ; git checkout my-custom-020      # 或 git pull mine my-custom-020
pnpm install ; pnpm run build                    # 必须产出 apps/web/dist/index.html
pwsh -File local\setup-020.ps1                   # 写 profile、装插件、指指针、装全局 TUI
```

`local\setup-020.ps1` 幂等且不删东西：已存在且内容不同的文件只提示不覆盖（要覆盖加 `-Force`，旧文件留 `.bak-<时间戳>`）。它做四件事：写两个 profile（缺的才写）→ 各自 `pnpm install` → 写两个指针 → 装全局 `@deepseek-harness-tui/dsh-tui@0.12.0`。

它**不做**（属于 git/系统层，见本文件 §2、§3、§六）：凭据 `~\.dsh\.credentials.yaml`、启动器文件 `~\.dsh\bin\*.cmd` 与 `~\.dsh\custom.cmd`、以及 `pnpm run build`。

装完自检：

```powershell
deepseek stop ; deepseek web            # 然后看 %USERPROFILE%\.dsh\web.out.log 里的 token URL
node D:\Code\dsh-kit\tools\dsh-web-check.mjs   # 本机本地脚本（不在仓库里，那台可能没有）：无头浏览器加载页面，PASS = 每个客户端条目都激活了
deepseek tui                            # 模型选择器里应出现第八节 8.3 的那些 provider
```

### 8.2 `web020` profile 里有什么、为什么

- `package.json`：bundles（`dsh-base`、`dsh-web-app`、`dshmarket`、`@linxin666/dsh-web-ui-all`、`@deepseek-harness-tui/dsh-tui` …）与依赖。
- `pnpm-workspace.yaml`：`overrides` 把六个 `@linxin666/*` 子包钉在**作者为 0.2.0 发布的 0.4.4 线**；四个没有 0.2.0 版本的包留在 0.3.12。
- `cordis.patch.yml`：profile 补丁层（provider/model 清单、禁用条目、笔记插件、主题…）。**跨机器最需要逐项核对的就是它**：里面有两处机器相关路径（笔记插件的 `file:///` URI 与 `workspaceDir`），路径不存在时 `!!js` 守卫会让那一条静默跳过，不会让服务崩。

当前**故意禁用**的条目（每条都在文件里写了原因与解除条件）：

| 条目 | 原因 |
|---|---|
| `@linxin666/dsh-perf`、`dsh-doctor`、`dsh-desktop-launcher`、`dsh-tool-describe-image` | 到 2026-10-03 仍无 0.2.0 版本（最新版仍 inject 0.2.0 已删除的客户端 `settingsScope` 服务） |
| `dsh-tui-workspaces`、`-command-trees`、`-settings-sections`、`-scenes`、`-plugin-host`、`-extensions` | `dsh-tui@0.12.0` 这六条在 settings 重载路径上于 activation 期间 emit root events，违反 cordis invariant → **整个设置域被拒**（任何写入都返回 `settings/rejected`，症状是欢迎弹窗永远确认不了） |
| `dsh-tui`（主条目） | 交互式前门要 TTY、卸载时会拆掉整棵 app 树，属于独立 profile，不属于 Web profile |
| `web-ui-better-sidebar`、`web-ui-remote-web-ui`、`web-ui-dsh-aionui-panel`、`xmanrui-dsh-im`、`ui-dsh-opencode-usage` | 上游删掉了它们依赖的服务（`settingsNamespace` / `apiProxy` / `client-runtime`），或无兼容版本 |

### 8.3 TUI 的模型选择 = 与 Web 同一份配置（2026-10-03 修复）

TUI 走**它自己的** profile（`dsh-base` + tui bundle）。`llm-pi-ai` 只从**插件 Config** 读路由，没有共享的 providers 文件 —— 所以 TUI 的 `cordis.patch.yml` 原本是空数组 `[]` 时，模型选择器里只有官方接口。

修法：把 Web profile 的 `agent-default-model` + `llm-pi-ai` 两块原样搬进 `local/profile/dsh-tui/cordis.patch.yml`。

**两份必须同步改**：`~\.dsh\profiles\web020\cordis.patch.yml` 与 `~\.dsh\profiles\dsh-tui\cordis.patch.yml`（两个文件里都有注释互相点名）。加/改 provider 或模型时两边都要动。

不需要 TTY 的验证方式：

```powershell
pnpm dsh --profile dsh-tui --dump-config | Select-String 'opencode-go-chat|paratera|zai-coding-cn'
```

### 8.4 两个指针与启动器

- `~\.dsh\tree.txt`：一行绝对路径，`~\.dsh\custom.cmd` 与 `~\.dsh\bin\dsh.cmd` 都读它。
- `<树>\.dsh-profile`：一行 profile 名（0.2.0 树里是 `web020`）。两个启动器会把命令行里的 `web` 换成 `--profile <名字>`。
- 切版本 = 改 `tree.txt` + 重启服务：`D:\Code\dsh-kit\switch\切到0.2.0.cmd` / `D:\Code\dsh-kit\switch\回退到0.1.5.cmd`。
- `deepseek tui` 也跟 `tree.txt` 走（宿主是裸 `dsh`）。**dsh-tui 0.12.0 的 peer 只认 0.2.0-rc 系**，所以回退到 0.1.5 后 TUI 会被兼容性预检跳过；要在 0.1.5 用 TUI 就重装 `@deepseek-harness-tui/dsh-tui@0.11.2`。
