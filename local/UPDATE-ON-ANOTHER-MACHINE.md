# 在另一台电脑上更新 dsh —— 给那台电脑上的 AI 的执行说明

> **这份文件就是"内部额外的操作指示"。** 用户在那台电脑上只需要说一句：
> 「请将 github 仓库上的新版 dsh 拉取下来完成更新，如果内部有额外的操作指示，也请一并阅读处理好」
>
> 你要做的是按下面 1→6 步执行。**每一步都有验收判据**，判据不过就按该步的"失败怎么办"处理，**不要带着失败继续往下走**。

---

## 0. 先弄清这份仓库是什么、目标形态是什么

- 仓库 = 用户的 dsh fork：`https://github.com/Freezing0325/deepseek-harness.git`（远端名约定：**`mine` = fork**、**`origin` = 官方 `deepseek-ai/deepseek-harness`**）。
- **要用的分支是 `my-custom-020`**（0.2.0 线）。`my-custom` 是 0.1.5 旧线，只作回退，不要拿它当更新目标。
- ⚠️ **fork 的默认分支目前是 `master`**（旧的官方镜像）。所以 `git clone` 之后**必须显式切到 `my-custom-020`**，否则你会在一条废弃的线上干活。用户也可以在 GitHub 仓库设置里把默认分支改成 `my-custom-020`（一次性，之后 clone 就自动落在正确分支上）。
- **目标形态：一个目录** —— 该目录既是 git 仓库本体（自带 `.git` 与全部历史），也是正在运行的 0.2.0 树。profile 定义（插件清单 / provider 清单 / 禁用条目）都在仓库的 `local/profile/` 里，由 `local/setup-020.ps1` 写进 `~/.dsh/profiles/`。
- **这个仓库不含**（属于每台机器自己的东西，别去仓库里找）：
  - API 凭据 `~/.dsh/.credentials.yaml`
  - 启动器：`~/.dsh/bin/deepseek.cmd`（+ 同目录 `deepseek.exe`）、`~/.dsh/custom.cmd`、`~/.dsh/bin/dsh.cmd`
  - `~/.dsh/` 下的会话、设置、工作区注册表
  - 任何 `node_modules` / 构建产物

## 1. 前置检查（缺什么先补什么）

| 需要 | 检查 | 没有怎么办 |
|---|---|---|
| Node（`^22.19` 或 `>=24`） | `node -v` | 装 Node LTS |
| pnpm | `pnpm -v` | `npm i -g pnpm` |
| PowerShell 7 | `pwsh -v` | 装官方 MSI（**别用 winget 的 MSIX 版**：它的 Store 别名在受管进程里会静默失败） |
| Git 且能连 GitHub | `git ls-remote mine`（remote 还没配见第 2 步） | 开代理（本机用 Clash Verge，混合端口 `127.0.0.1:7897`；git 已全局配好代理） |
| 凭据 | `Test-Path "$env:USERPROFILE\.dsh\.credentials.yaml"` | 从旧机器拷一份；**永远不要提交进仓库** |
| 启动器（读指针的版本） | `Test-Path "$env:USERPROFILE\.dsh\bin\deepseek.cmd"`、`"$env:USERPROFILE\.dsh\custom.cmd"`、`"$env:USERPROFILE\.dsh\bin\dsh.cmd"` | 从旧机器拷这三个文件。它们读 `~/.dsh/tree.txt`（用哪棵树）与 `<树>\.dsh-profile`（哪套 profile），并把命令行里的 `web` 换成 `--profile <名字>` |

## 2. 拿到代码

```powershell
# 已经有这个仓库：
git -C <你的仓库目录> fetch mine
git -C <你的仓库目录> checkout my-custom-020
git -C <你的仓库目录> pull --ff-only mine my-custom-020

# 全新克隆：
git clone -b my-custom-020 https://github.com/Freezing0325/deepseek-harness.git D:\Code\deepseek-harness
cd D:\Code\deepseek-harness
git remote add origin https://github.com/deepseek-ai/deepseek-harness.git   # 官方，以后 rebase 用；已有则跳过
git remote add mine  https://github.com/Freezing0325/deepseek-harness.git   # fork；已有则跳过
```

**验收**：`git rev-parse --abbrev-ref HEAD` 输出 `my-custom-020`；`git log --oneline -3` 能看到 `docs(local):` / `fix(local):` 开头的本地提交。

**失败怎么办**：若 `pull` 报分叉（本地有本地提交），先 `git status` 看清是什么，**不要** `git reset --hard`；把情况报给用户。

## 3. 装依赖 + 构建

```powershell
cd <你的仓库目录>
pnpm install
pnpm run build
```

**验收**：`Test-Path apps\web\dist\index.html` 为 `True`（前端产物必须存在，否则页面打不开）。

**失败怎么办**：多为网络/代理问题，先解决网络再重试；**不要**改用 `npm install`（workspace 链接会坏）。

## 4. 用仓库里的脚本落地 profile 与两个指针

```powershell
pwsh -File local\setup-020.ps1
```

它做四件事（幂等、不删东西：已存在且内容不同的文件只提示不覆盖，加 `-Force` 才覆盖并留 `.bak`）：

1. 把 `local/profile/{web020,dsh-tui}/*` 写进 `~/.dsh/profiles/`（缺的才写）；
2. 两个 profile 目录各跑一次 `pnpm install`（**这一步就是在装插件**）；
3. 写 `~/.dsh/tree.txt` = 本 checkout 路径，并写 `<树>\.dsh-profile` = `web020`；
4. 装全局 `@deepseek-harness-tui/dsh-tui@0.12.0`（TUI 只认 0.2.0 宿主）。

**验收**：输出里应有 `tree.txt = <你的树路径>`、`.dsh-profile = web020`、`virtualStoreDir matches this checkout`，以及三条 launcher contract 的 `ok`。

**失败怎么办**：哪一条不是 `ok` 就照它打印的提示做；`pnpm install` 失败先看网络。

## 5. 起服务并验收（**这一步最关键**）

```powershell
deepseek stop
deepseek web
```

三条判据，**全部通过才算更新成功**：

```powershell
# a) 端口在听、且本轮启动打印了带 token 的 URL
Select-String -Path "$env:USERPROFILE\.dsh\web.out.log" -Pattern 'dsh web: http'

# b) 主机侧没有任何激活失败（**输出为空才算过**；这条能抓住"页面看着正常、其实服务端已经废了"）
Select-String -Path "$env:USERPROFILE\.dsh\web.err.log" `
  -Pattern 'did not activate|corrupt session log|pending \(waiting for service|plugin tree failed to load'

# c) 页面能开：用 a) 里那行 token URL 打开浏览器（或带 token 访问一次，能拿到 200/303 即可）
```

**预期噪音（不是故障，别去修）**：
- `dsh: skipping profile bundle "@huanlin/dsh-plugin-session-delete"`
- `dsh: disabling profile plugin row "dsh-tui-agent-presets"`

**失败怎么办**：见第 6 节的 1、2 两条（这两类故障的症状一模一样：服务起不来或工作区打不开，但原因完全不同）。

## 6. 已知坑与修法（这台机器全都踩过，照着做即可）

1. **树被改名或搬动过 → pnpm 卡在交互提问，服务起不来，TUI 报"未找到 dsh / 建议重装"。**
   根因：pnpm 把**绝对**虚拟 store 路径记在 `<树>\node_modules\.modules.yaml` 的 `virtualStoreDir` 里；路径一变它就判定 node_modules 要从零重装，而那次 install 会**交互式提问** `The modules directories will be removed and reinstalled from scratch. Proceed? (Y/n)` —— 启动器是隐藏窗口，没人回答，于是永久卡住（TUI 的"未找到 dsh"只是探针超时）。
   修法：把那一行改成 `<树>\node_modules\.pnpm` 的实际路径即可（`node_modules` 本身不用动，里面的链接都是相对的）。`local\setup-020.ps1` 每次运行都会检查这一条并提示。**别被那句"建议 `npm i -g @deepseek-ai/dsh`"骗去重装 dsh。**
2. **动过 `~/.dsh/sessions/` 下的目录 → 工作区列表空、工作区打不开、TUI 也打不开，而客户端页面完全正常。**
   根因：会话日志第一行内嵌它自己的 `cwd`，store 用它反推这条日志该待在哪个目录；搬目录不改 header 就会被判 `corrupt session log`，`WorkspaceRegistry.init` 直接 reject → `workspaceRegistry` 永不激活 → 所有依赖工作区的插件停在 `pending`。
   判据与修法：`local/PORTING.md` §8.6（`check` 只读，`relocate --from <旧cwd> --to <新cwd> --apply` 改 header）。**没动过 sessions 就不会遇到这条。**
3. **`git push` 被 pre-push 钩子挡住**（报 `Cannot find module 'D:\d\Code\...\node_modules\pnpm\bin\pnpm.mjs'`，路径里多一层 `\d\`）。
   根因：dsh 服务若从 **Git Bash 会话**启动，会继承 `MSYSTEM=MINGW64` / `PWD=/d/...`；git 钩子由 MSYS `sh` 跑 lefthook，把项目根算错。
   修法：从**普通 cmd / PowerShell 窗口** push；或 `git push --no-verify` 之后手动跑一次 `npm run typecheck` 补等价检查。
4. **TUI 的版本必须与线匹配**：`dsh-tui@0.12.0` 只认 0.2.0 宿主；回退到 0.1.5 线要 `@deepseek-harness-tui/dsh-tui@0.11.2`。两者互斥，换线就得重装全局那份。
5. **两份 profile 补丁的 LLM 块必须同步改**：`~/.dsh/profiles/web020/cordis.patch.yml` 与 `~/.dsh/profiles/dsh-tui/cordis.patch.yml`（加/改 provider 或模型时两边都要动，两个文件里都有注释互相点名）。验证：`pnpm dsh --profile dsh-tui --dump-config`。
6. **`dsh-tui@0.12.0` 的六条 web-plane 条目在 0.2.0 下必须保持禁用**（`-workspaces` / `-command-trees` / `-settings-sections` / `-scenes` / `-plugin-host` / `-extensions`）：它们在 settings 重载路径上于 activation 期间 emit root events，会让**所有** settings 写入被拒（症状：欢迎弹窗永远确认不了）。这条已经写在 `local/profile/web020/cordis.patch.yml` 里，别手动解禁。

## 7. 以后在这台机器上怎么更新（固定动作）

```powershell
cd <你的仓库目录>
git fetch origin
git rebase origin/master          # 或切到官方 tag
pnpm install
pnpm run build
deepseek stop ; deepseek web
# 然后跑第 5 节那三条判据
```

**永远不要新建带版本号的文件夹，也不要为同一套环境开第二个检出** —— 这套配置（`tree.txt` + `.dsh-profile` + 一个 profile 一个目录）只服务一个目录。

## 8. 想更细的背景

- `local/PORTING.md`：跨机核对清单。§8 = 0.2.0 落地细节、§8.5 = 改名陷阱、§8.6 = 会话身份陷阱。
- `local/profile/`：两套 profile 的**可复现定义**（`web020` 给 Web、`dsh-tui` 给 TUI）。
- `local/setup-020.ps1`：本文件第 4 步用的引导脚本，幂等。
- 原机（另一台）上还有一套**机器本地**的排查工具（**不在仓库里**，那台机器没有也能按上面第 5 节验收）：`D:\Code\dsh-kit\`，其中 `tools\dsh-preflight.mjs` 一条命令查 11 项健康度（含主机侧日志与会话完整性），`tools\fix-pnpm-virtual-store.ps1` 是第 6 节第 1 条的修法。
