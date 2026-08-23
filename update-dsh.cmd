@echo off
rem ============================================================
rem  dsh 一键更新脚本
rem  作用：拉取官方最新版本，并把本地定制补丁重放到最新上游之上
rem  用法：双击本文件，或在命令行执行 update-dsh.cmd
rem  前置：Clash 代理在运行（git fetch 走 127.0.0.1:7897）
rem  详见同目录 GIT-GUIDE.md（git 操作教学）
rem ============================================================
setlocal
cd /d "%~dp0"

echo [1/6] 检查工作树状态...
git status --porcelain | findstr /r /c:"." >nul
if not errorlevel 1 (
  echo.
  echo  *** 警告：存在未提交的改动！ ***
  echo  未提交改动会阻止 rebase，请先处理：
  echo    查看：   git status
  echo    提交：   git add -A ^&^& git commit -m "描述你的改动"
  echo    丢弃：   git restore .    （危险，会丢失改动）
  echo  处理完再重新运行本脚本。
  goto :end
)
echo  工作树干净，可以更新。

echo [2/6] 拉取官方最新版本...
git fetch origin
if errorlevel 1 goto :git_error

echo [3/6] 本次官方更新（最近 10 条提交）:
git log --oneline HEAD..origin/master | more
echo.

echo [4/6] 重放本地补丁到最新上游（rebase）...
git rebase origin/master
if errorlevel 1 (
  echo.
  echo  *** rebase 遇到冲突，需要手动解决 ***
  echo  步骤：
  echo    1. git status          查看哪些文件冲突
  echo    2. 编辑冲突文件         去掉 ^<^<^<^<^<^< HEAD / ^=^=^=^=^=^= / ^>^>^>^>^>^> 标记，
  echo                            保留你想要的内容
  echo    3. git add 已解决的文件
  echo    4. git rebase --continue  继续
  echo  放弃本次合并：git rebase --abort
  echo  解决冲突的详细教程见 GIT-GUIDE.md
  goto :end
)

echo [5/6] 同步 master 分支到官方最新...
git branch -f master origin/master

echo [6/6] 更新依赖（pnpm install）...
call pnpm install
if errorlevel 1 (
  echo  依赖更新失败，请检查网络后手动运行: pnpm install
  goto :end
)

echo.
echo  ============================================================
echo   更新完成！
echo   当前状态: my-custom = 官方最新 + 你的本地补丁
echo   查看补丁: git log --oneline origin/master..my-custom
echo   重启生效: dsh stop 然后 dsh web
echo  ============================================================
goto :end

:git_error
echo.
echo  git 命令失败。常见原因：
echo   1. Clash 代理未运行（git 走 127.0.0.1:7897）
echo      - 运行 clash-auto fix，或手动打开 Clash Verge
echo   2. 网络异常
echo  修复后重新运行本脚本。
goto :end

:end
endlocal
pause
