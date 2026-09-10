@echo off
rem ============================================================
rem  dsh 本地补丁自检入口
rem  作用：检查 fork 同步、源码补丁探针、仓库外补丁三件事，输出一张表
rem  用法：双击本文件；或命令行执行 local\doctor.cmd
rem        local\doctor.cmd -Quick   跳过跑测试，只看同步与仓库外补丁
rem  补丁清单与维护规则见同目录 README.md
rem
rem  注意：本文件必须保持 CRLF 行尾 + GBK 编码（cmd 标签扫描 + 中文显示）
rem ============================================================
setlocal
cd /d "%~dp0.."

set "PS=powershell"
where pwsh >nul 2>nul && set "PS=pwsh"

"%PS%" -NoProfile -ExecutionPolicy Bypass -File "%~dp0doctor.ps1" %*
set "RC=%ERRORLEVEL%"

echo.
pause
exit /b %RC%
