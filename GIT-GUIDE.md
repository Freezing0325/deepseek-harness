# dsh 本地仓库 git 操作指南

本指南面向不熟悉 git 的你，把 `D:\Code\deepseek-harness` 这个仓库的日常操作讲清楚。
配合 `update-dsh.cmd`（一键更新脚本）使用。

## 一、仓库的两个分支（先记住这个）

| 分支 | 内容 | 什么时候用 |
|---|---|---|
| `master` | 和官方完全一致（纯净版） | 对比官方用，**永远不要在上面提交** |
| `my-custom` | 官方 + 你的本地补丁（默认分支） | 你所有的工作都在这 |

你的本地补丁就是这些提交（当前有 18 个，逐条登记在 `local/README.md`）：

```
feat(session): session.events getter（dsh-tui 读取的快照 API）
fix(llm-pi-ai): OpenCode x-opencode-session 头
feat(api-remotes): 桌面提醒（审批/提问/任务完成，win32）
feat(ui-layout): 标题待审批闪烁 + 按新结构的适配
fix(sandbox): 沙箱升级幂等（非扩权请求不再报错）
docs / chore: 一键更新脚本 + git 指南 + local/ 补丁自检（12 个提交，含每次 rebase 后的登记同步）
```

> 2026-09 更新说明：网络控制策略（sandbox 独立网络策略轴、tool-web 网络门禁、
> 目录/文档同步，共 4 个提交）**已确认鸡肋并移除**——没有 UI/CLI 入口、默认 allow
> 不改变任何行为，且横跨 sandbox/web/core 核心包、每次上游更新都冲突。
> directory-picker 的 UTF-16 修复上游已自带同名修复，因此一并放弃。

## 二、查看状态（最常用的三条）

```bash
git status                 # 当前状态：改了什么、有没提交
git log --oneline -5       # 最近 5 条提交
git log --oneline origin/master..my-custom   # 你的补丁清单
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
| `git log --oneline origin/master..my-custom` | 我的补丁 |
| `git diff` | 查看未提交的改动内容 |
| `git restore <文件>` | 丢弃某文件改动（危险） |
| `git stash` | 暂时收起未提交改动（可恢复） |

## 七、在另一台电脑上同步这次的更新

两台电脑共用同一个 fork，但**这次升级重写了 `my-custom` 的历史**（官方 0.1.2-alpha.5 → 0.1.5-rc.1，本地补丁全部重放，提交号全变了），所以那台**不能直接 `git pull`**（会报分叉或 non-fast-forward）：

```bash
git status                                   # 1. 确认没有未提交改动（有就先提交或 stash）
git branch backup/pre-0.1.5-<日期>            # 2. 备份（别省）
git checkout my-custom
git fetch mine                               # 3. 远端名以 git remote -v 为准（origin=官方，mine=fork）
git reset --hard mine/my-custom              # 4. 直接对齐到 fork
pnpm install                                 # 5. 官方改了依赖
pnpm run build                               # 6. 必须：TUI 读的是构建产物
local\doctor.cmd                             # 7. 自检，应全绿
```

⚠️ 那台若本地有这台没有的提交，**先别 reset**：记下那几条提交，重置后 `git cherry-pick`，或先告诉这台，由这台合并后再统一推。

git 管不到的部分（启动器、`~/.dsh` 配置、profile 里指向工作区的外部插件路径）逐项登记在 **`local/PORTING.md`**，按它核对即可。

## 八、当前进度（本次更新结果）

- 官方版本：**0.1.5-rc.1**（master 已同步；0.1.2-alpha.5 → 0.1.5 跨了 rc.1 / 0.1.3 / 0.1.5 三条版本线，客户端与会话层都有改动）
- 本地补丁：**18 个**，全部重放到新上游之上；只有两处冲突，均已手工合并
  （A3 标题闪烁按新的 `DocumentTitle` 结构重写；A4 沙箱文档的中文侧取补丁语义）
- 已移除：网络策略 4 个补丁（鸡肋）+ directory-picker 修复（上游已自带）
- 桌面提醒 / 标题闪烁：都在（A2 自动合并，A3 已适配 ui-layout 新结构）
- 启动器已同步修复：wrapper 加 `--no-open`（避免双开浏览器），并把 25 秒等待上限放宽到约 5 分钟（冷启动超过 25 秒不再误报失败）
- 补丁自检：`local\doctor.cmd`，逐条跑每个 A 类补丁自带的 spec 探针（清单见 `local/README.md`）
- 验证结果：`pnpm run build` 通过；`pnpm run test:gui` 373 个文件 / 5333 个用例通过；doctor 全绿（A1–A7、B1–B2、跨机项）
- 换机：另一台电脑怎么同步见本文第七节；git 管不到的配置与插件路径见 `local/PORTING.md`
