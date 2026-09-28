# deploy_cloud.ps1 — 把本地 NexoraLearning 代码发布到云端 learning 服务器
#
# 背景: 鸿蒙端 App 全部 Agent 能力(GET /events, /today, /decision, /cognition/*, /judgment/context,
# /context/device, /flow/*, /prereq/check, /confusion/scan)都在 api/agent_facade.py 里。云端只认华为云
# ECS 123.60.41.184(nginx :5002 -> 127.0.0.1:5001 -> /opt/NexoraLearning); chat.himpqblog.cn 是另一台
# 只有 /context /plan /ask-in-context 的旧机器, 不是本脚本的目标。改后端后用本脚本重新发布, 不要手工 scp 单个文件。
#
# 用法(NexoraLearning 目录; 密钥登录用 -IdentityFile, 密码登录则先手动 ssh 一次把公钥装到服务器):
#   powershell -ExecutionPolicy Bypass -File tools/deploy_cloud.ps1 -IdentityFile C:\path\to\key.pem
#   powershell -ExecutionPolicy Bypass -File tools/deploy_cloud.ps1 -IdentityFile ... -SeedDemo   # 顺带重灌 demo_student
#   powershell -ExecutionPolicy Bypass -File tools/deploy_cloud.ps1 -IdentityFile ... -SkipTests  # 跳过本地 pytest
#
# 步骤:
#   1. 本地 python -m pytest tests -q(可 -SkipTests)
#   2. 打包 api core frontend tools main.py prompts.py requirements.txt(排除 __pycache__; 不含 data/)
#   3. scp 到服务器 /root/, 远端先 cp -a 整目录到 /opt/NexoraLearning.bak_<时间戳>
#   4. 只替换代码目录(api core frontend tools + 顶层 py), data/ 原样保留
#   5. pip install -r requirements.txt(远端 venv 在 /opt/NexoraLearning/venv)
#   6. systemctl restart nexora-learning.service, 看 is-active 与最近日志
#   7. 用 tools/agent_smoke.py --read-only 对 http://123.60.41.184:5002 回归
#
# 服务器布局按 HarmonyosApp/README.md「云端接入与后续开发」与仓库根 DEPLOY.md。

param(
    [string]$RemoteHost = "123.60.41.184",
    [string]$RemoteUser = "root",
    [string]$IdentityFile = "",
    [string]$RemoteDir = "/opt/NexoraLearning",
    [string]$Service = "nexora-learning.service",
    [string]$PublicBaseUrl = "http://123.60.41.184:5002",
    [string]$SmokeUser = "ots20oug",
    [switch]$SkipTests,
    [switch]$SkipRestart,
    [switch]$SeedDemo
)

$ErrorActionPreference = "Stop"
# 文件本身带 UTF-8 BOM(Windows PowerShell 5.1 否则按 ANSI 解析中文注释); 管道到 ssh 的脚本必须无 BOM, 否则远端 bash 首行 `set -euo pipefail` 失效
$OutputEncoding = New-Object System.Text.UTF8Encoding($false)
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $Root

$SshOpts = @("-o", "StrictHostKeyChecking=accept-new", "-o", "ConnectTimeout=15")
if ($IdentityFile -ne "") {
    if (-not (Test-Path $IdentityFile)) { throw "IdentityFile 不存在: $IdentityFile" }
    $SshOpts += @("-i", $IdentityFile)
}
$Target = "$RemoteUser@$RemoteHost"

$VenvPython = Join-Path (Split-Path $Root -Parent) "venv\Scripts\python.exe"
# 仓库 venv 里可能没装 pytest(它是 paramiko/部署用途), 这时退回系统 python
$Python = "python"
if (Test-Path $VenvPython) {
    # 不能用 2>$null: 5.1 下原生命令写 stderr 会触发 $ErrorActionPreference=Stop
    $probe = cmd /c "`"$VenvPython`" -c `"import pytest`" >nul 2>&1 && echo yes || echo no"
    if ("$probe".Trim() -eq "yes") { $Python = $VenvPython }
}

function Invoke-Remote([string]$Script) {
    # 通过 stdin 交给远端 bash, 避免 PowerShell 对引号/换行的二次转义
    $Script | & ssh @SshOpts $Target "bash -s"
    if ($LASTEXITCODE -ne 0) { throw "远端命令失败(exit $LASTEXITCODE)" }
}

# 1. 本地测试
if ($SkipTests) {
    Write-Host "[deploy] 跳过 pytest(-SkipTests)" -ForegroundColor Yellow
} else {
    Write-Host "[deploy] 本地 pytest ..." -ForegroundColor Cyan
    & $Python -m pytest tests -q
    if ($LASTEXITCODE -ne 0) { throw "pytest 未通过, 不发布" }
}

# 2. 打包(Windows 10+ 自带 bsdtar)
$Stamp = Get-Date -Format "yyyyMMdd_HHmmss"
$Archive = Join-Path $env:TEMP "nexora-learning_$Stamp.tgz"
$Payload = @("api", "core", "frontend", "tools", "main.py", "prompts.py", "requirements.txt")
foreach ($item in $Payload) {
    if (-not (Test-Path (Join-Path $Root $item))) { throw "缺少要打包的文件/目录: $item" }
}
Write-Host "[deploy] 打包 -> $Archive" -ForegroundColor Cyan
& tar -czf $Archive --exclude="__pycache__" --exclude=".pytest_cache" --exclude="*.pyc" -C $Root @Payload
if ($LASTEXITCODE -ne 0) { throw "tar 打包失败" }
$SizeMb = [math]::Round((Get-Item $Archive).Length / 1MB, 2)
Write-Host "[deploy] 包大小 $SizeMb MB(不含 data/)"

# 3. 上传
$RemoteArchive = "/root/nexora-learning_$Stamp.tgz"
Write-Host "[deploy] scp -> ${Target}:$RemoteArchive" -ForegroundColor Cyan
& scp @SshOpts $Archive "${Target}:$RemoteArchive"
if ($LASTEXITCODE -ne 0) { throw "scp 上传失败(检查 -IdentityFile / 服务器可达)" }

# 4-6. 远端备份、替换代码、装依赖、重启
$RestartLine = if ($SkipRestart) { "echo '[remote] 跳过重启(-SkipRestart)'" } else { "systemctl restart $Service" }
$RemoteScript = @"
set -euo pipefail
DIR="$RemoteDir"
ARCHIVE="$RemoteArchive"
STAMP="$Stamp"
if [ ! -d "`$DIR" ]; then echo "[remote] `$DIR 不存在, 请先确认服务器布局" >&2; exit 2; fi
echo "[remote] 备份 -> `${DIR}.bak_`$STAMP"
cp -a "`$DIR" "`${DIR}.bak_`$STAMP"
echo "[remote] 替换代码目录(data/ 保留)"
for d in api core frontend tools; do rm -rf "`$DIR/`$d"; done
tar -xzf "`$ARCHIVE" -C "`$DIR"
find "`$DIR" -name __pycache__ -type d -prune -exec rm -rf {} + 2>/dev/null || true
PY=""
for cand in "`$DIR/venv/bin/python" "`$DIR/.venv/bin/python" /opt/nexora/venv/bin/python; do
  if [ -x "`$cand" ]; then PY="`$cand"; break; fi
done
if [ -n "`$PY" ]; then
  echo "[remote] pip install (`$PY)"
  "`$PY" -m pip install -q -r "`$DIR/requirements.txt" || echo "[remote] pip install 失败, 继续(依赖未变时无影响)" >&2
else
  echo "[remote] 未找到 venv, 跳过 pip install; 若新增依赖请手动安装" >&2
fi
$RestartLine
sleep 2
echo "[remote] 服务状态: `$(systemctl is-active $Service || true)"
journalctl -u $Service -n 15 --no-pager || true
rm -f "`$ARCHIVE"
"@
Write-Host "[deploy] 远端备份 + 替换 + 重启 ..." -ForegroundColor Cyan
Invoke-Remote $RemoteScript

# 可选: 重灌演示账号(教材/答题/时间线), 云端 demo_student 曾是空账号(lectures=[])
if ($SeedDemo) {
    Write-Host "[deploy] 远端重灌 demo_student(seed_demo.py --reset) ..." -ForegroundColor Cyan
    Invoke-Remote @"
set -euo pipefail
cd "$RemoteDir"
PY=""
for cand in "$RemoteDir/venv/bin/python" "$RemoteDir/.venv/bin/python" /opt/nexora/venv/bin/python python3; do
  if command -v "`$cand" >/dev/null 2>&1 || [ -x "`$cand" ]; then PY="`$cand"; break; fi
done
"`$PY" tools/seed_demo.py --reset
"@
}

# 7. 云端回归
Write-Host "[deploy] 云端回归 $PublicBaseUrl ..." -ForegroundColor Cyan
& $Python tools/agent_smoke.py --base-url $PublicBaseUrl --username $SmokeUser --read-only
if ($LASTEXITCODE -ne 0) {
    Write-Host "[deploy] 回归有 FAIL: 服务可能没起来或 nginx 仍指向旧进程; 回滚: ssh $Target 'rm -rf $RemoteDir && mv ${RemoteDir}.bak_$Stamp $RemoteDir && systemctl restart $Service'" -ForegroundColor Red
    exit 1
}
Write-Host "[deploy] 完成。备份在 ${RemoteDir}.bak_$Stamp; 若远端 data/config.json 里已有 proactive.judgment 段, 核对 max_tokens>=2000 / timeout 40 / think false。" -ForegroundColor Green
