# dsh 本地仓库 git 操作指南

本指南面向不熟悉 git 的你，把 `D:\Code\deepseek-harness` 这个仓库的日常操作讲清楚。
配合 `update-dsh.cmd`（一键更新脚本）使用。

## 一、仓库只有一个分支（先记住这个）

| 分支 | 内容 | 什么时候用 |
|---|---|---|
| `my-custom-020` | 官方 0.2.2 + 唯一一条本地补丁（A9） | 你所有的工作都在这，也是 fork 的默认分支 |

2026-11-07 清理：`master`（官方旧镜像）、`my-custom`（0.1.5 回退线）和全部 `backup/*` 都已删除，本地与远程都只剩这一条。**0.1.5 线不再保留**——按你的规则，新版本能正常启动，旧线就该清掉。

你的本地补丁现在**只剩一条**（逐条登记在 `local/README.md`；条数以 `git log --oneline origin/master..my-custom-020` 为准）：

```
fix(llm-pi-ai): OpenCode 网关的空 body 400 归类为上下文超限
```

其余历史补丁的去向：

| 补丁 | 现在在哪 |
|---|---|
| A1 OpenCode 请求头 | 仓库外的 `dsh-local-extras` 插件（挂官方 `llm-pi-ai/request-headers`） |
| A2 桌面提醒 | 同一个插件（挂 `approval/request` 等公开事件） |
| A3 标签页闪烁 | 同一个插件（host 端点 + 浏览器轮询） |
| A4 沙箱升级幂等 | 官方 0.2.0 起自带同口径 |
| A7 `session.events` getter | dsh-tui 0.19 已改用 `snapshotEvents()` |
| A8 Windows 模块回落树容错 | 那个目录只出现在 0.1.5 升级上来的 profile，本机没有 |
| B1 npm 产物补丁 | 插件已覆盖 TUI profile |

## 二、查看状态（最常用的三条）

```bash
git status                 # 当前状态：改了什么、有没提交
git log --oneline -5       # 最近 5 条提交
git log --oneline origin/master..my-custom-020   # 你的补丁清单
```

## 三、日常：改了代码后提交（你开发完功能的收尾）

```bash
git status                 # 1. 看改了哪些文件（确认没有误改）
git add 文件或目录          # 2. 把改动放进暂存区
                            #    想全部提交：git add -A
git commit -m "feat(名字): 描述"   # 3. 提交（会触发自动检查 lint）
```

> 提交信息格式建议：`feat(功能): 说明` 或 `fix(位置): 说明`。
> 一次提交只做一个目的；几个不相关的改动分几次提交。

## 四、从官方更新（核心流程）—— 建议直接用 update-dsh.cmd

```bash
git fetch origin                # 1. 拉取官方最新（不修改你的代码）
git rebase origin/master        # 2. 把你的补丁重放到最新上游之上
```

就是这么简单——前提是工作树干净（`git status` 没有未提交改动）。

### 出错了怎么办？

**情况 A：`git fetch` 报连不上 127.0.0.1:7897**
→ Clash 代理没开。运行 `clash-auto fix` 或手动打开 Clash Verge，再重试。

**情况 B：rebase 报 "You have unstaged changes"**
→ 有未提交的改动。先 `git status` 看，提交或丢弃后再 rebase。

**情况 C：rebase 中途停住，提示冲突（CONFLICT）**
→ 这是正常的，说明官方改了你补丁也改过的地方。按提示操作：

```bash
git status                  # 1. 看哪些文件冲突（标记为 both modified）
```

打开冲突文件，会看到三行特殊标记把冲突区分成两段：

- **7 个小于号 + `HEAD`**：往下到分隔线之间是官方的新代码
- **7 个等号**：分隔线
- **7 个大于号 + 你的提交号**：分隔线往下到标记之间是你的补丁代码

手动编辑：**把这三行标记删掉，保留你想要的内容**（通常是两边都要——官方的新逻辑 + 你的功能）。然后：

```bash
git add 你改好的文件        # 2. 标记已解决
git rebase --continue       # 3. 继续重放下一个补丁
```

重复直到 rebase 完成。想反悔：`git rebase --abort` 回到更新前。

> 好消息：你的补丁和官方改动重叠不多，多数时候自动合并成功，根本不会冲突。
> 仓库开了 `rerere`，同样的冲突第二次出现时 git 会自动套用你上次的解法。

**情况 D：官方把你改的文件整个删了/挪了位置**
→ 比如这次官方把 `client/web` 挪成了 `client/ui-renderer`。这时要把你的改动"移植"到新文件上：找到官方的新文件，把你的改动重新加进去，再 `git add` + `git rebase --continue`。这种需要一点代码理解，拿不准就让我来。

## 五、更新后收尾

```bash
git branch -f master origin/master   # 把 master 同步到官方最新（可选，保持纯净基线）
pnpm install                         # 官方可能改了依赖，装一下
```

## 六、需要记住的 git 命令速查

| 命令 | 作用 |
|---|---|
| `git status` | 查看状态（最常用） |
| `git add <文件>` / `git add -A` | 暂存改动 |
| `git commit -m "说明"` | 提交 |
| `git fetch origin` | 拉取官方最新（不合并） |
| `git rebase origin/master` | 补丁重放到最新上游 |
| `git rebase --continue` | 解决冲突后继续 |
| `git rebase --abort` | 放弃本次 rebase |
| `git log --oneline -5` | 最近提交 |
| `git log --oneline origin/master..my-custom-020` | 我的补丁 |
| `git diff` | 查看未提交的改动内容 |
| `git restore <文件>` | 丢弃某文件改动（危险） |
| `git stash` | 暂时收起未提交改动（可恢复） |

## 七、官方出新版时，这台机器怎么更新（大白话版）

按顺序跑，**前一条失败就停下来修，别硬往下走**：

```powershell
deepseek stop                     # 1. 停服务：Windows 会锁住正在运行的文件，不停 build 会失败
cd E:\Code\deepseek-harness
git fetch origin                  # 2. 下载官方新版（只进仓库，不动你正在用的文件）
git rebase origin/master          # 3. 把 A9 那 9 行改动重新贴到新版上
pnpm install && pnpm run build    # 4. 装依赖 + 编译，约 10 分钟
local\doctor.cmd                  # 5. 体检，最后一行 FAIL 必须是 0
deepseek web                      # 6. 启动验证（体检绿 ≠ 真能跑）
```

每一条在干什么：

| 命令 | 作用 | 失败说明 |
|---|---|---|
| `deepseek stop` | 停掉正在跑的服务，释放文件锁 | 本来就没在跑也无所谓 |
| `git fetch origin` | 去官方下载最新代码，**不碰你的工作文件** | 多半是网络 / Clash 没开 |
| `git rebase origin/master` | 把你的补丁从旧版"撕下来"，贴到新版对应位置 | 有冲突就手工解；解不动用 `git rebase --abort` 退回更新前 |
| `pnpm install` | 下载官方新版用到的第三方库 | 网络问题 |
| `pnpm run build` | 把源代码编译成能跑的程序 | 先确认 install 跑过；跨大版本先 `pnpm run clean` |
| `local\doctor.cmd` | 自检补丁、版本、插件、外部路径 | 它会写明哪条没过 |
| `deepseek web` | 真启动一次看看 | 起不来就看 `~\.dsh\web.err.log` |

**两条铁律**：

1. **别手动跑 `tsc -b`**：Node 默认只给 4GB 堆，会内存溢出；官方脚本给 8GB。一律用 `pnpm run build`。
2. **rebase 搞砸了不会丢东西**：git 里旧版本一直在，`git rebase --abort` 就回到更新前。

**冲突只会来自 A9**（`packages/llm/llm-pi-ai/src/stream.ts` 的 `classifyPiAiError`）。其他文件都不该冲突——真冲突了说明有别的改动混进来了，先查清楚。

## 八、在另一台电脑上同步这次的更新

两台电脑共用同一个 fork，但**0.2.2 这次升级重写了 `my-custom-020` 的历史**（官方 0.2.0-rc.2 → 0.2.2-rc.1，本地补丁全部重放，提交号全变了），所以那台**不能直接 `git pull`**（会报分叉或 non-fast-forward）：

```bash
git status                                   # 1. 确认没有未提交改动（有就先提交或 stash）
git branch backup/pre-0.2.2-<日期>            # 2. 备份（别省）
git checkout my-custom-020
git fetch mine                               # 3. 远端名以 git remote -v 为准（origin=官方，mine=fork）
git reset --hard mine/my-custom-020          # 4. 直接对齐到 fork
pnpm install                                 # 5. 官方改了依赖
pnpm run build                               # 6. 必须：TUI 读的是构建产物
pwsh -File local\fix-022.ps1                 # 7. 两个 profile 迁到 0.2.2 线（幂等）
local\doctor.cmd                             # 8. 自检，应全绿
```

⚠️ 那台若本地有这台没有的提交，**先别 reset**：记下那几条提交，重置后 `git cherry-pick`，或先告诉这台，由这台合并后再统一推。

git 管不到的部分（启动器、`~/.dsh` 配置、profile 里指向工作区的外部插件路径）逐项登记在 **`local/PORTING.md`**，按它核对即可。

## 九、当前进度（2026-11-07）

- 官方版本：**0.2.2-rc.1**；分支 `my-custom-020` 是唯一分支，也是 fork 默认分支
- **源码补丁只剩一条 A9**：OpenCode 网关对超窗请求回 400 且 body 为空时，归类为上下文超限，让压缩能减量重试
- 其余补丁的去向见本文第一节的表格；插件源码在 `E:\Code\dsh-plugins\dsh-local-extras`，分发包是同目录的 `dsh-local-extras-1.0.0.tgz`
- 构建：`pnpm run build` 10 个 gate 全过；`local\doctor.cmd` 12 OK / 0 FAIL
- 0.2.2 迁移要点（已固化进 `local\fix-022.ps1`）：
  - `dsh-tui` 必须 0.19.0（0.12 / 0.18 的 peer 只到 0.2.1-rc.5，会被 0.2.2 跳过）
  - 六个 `@linxin666/*` 用 0.4.15；web020 要显式依赖 `@deepseek-ai/dsh-settings@0.2.2-rc.1`
  - `@huanlin/dsh-plugin-session-delete@0.3.1` 不兼容会被跳过，警告不致命，**不要**用 allow-version 强拉
- 构建链注意：要求 `pnpm@11.28.5`；Windows 上 `vite build` 需绕开被占用的系统 Temp（见 `CLAUDE.local.md` 陷阱）
- 换机：另一台电脑怎么同步见本文第八节；git 管不到的配置与插件路径见 `local/PORTING.md`
