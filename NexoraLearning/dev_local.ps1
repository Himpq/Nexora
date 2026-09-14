# dev_local.ps1 — NexoraLearning 本地开发一键启动
#
# 用法:
#   powershell -ExecutionPolicy Bypass -File dev_local.ps1
#   powershell -ExecutionPolicy Bypass -File dev_local.ps1 -Port 5001
#
# 可选: 在脚本同目录创建 .env.local(已被 .gitignore 忽略), 每行 KEY=VALUE:
#   NEXORALEARNING_NEXORA_BASE_URL=https://chat.himpqblog.cn
#   NEXORALEARNING_NEXORA_API_KEY=你的云端模型密钥(不写则模型相关接口不可用)
#   NEXORALEARNING_RUNTIME_API_KEY=本地自定密钥(留空=开发模式, 不强制鉴权)
#   NEXORALEARNING_PUBLIC_BASE_URL=http://127.0.0.1:5001
#   NEXORALEARNING_PORT=5001
#
# 密钥只存在于当前进程环境变量, 不会写回 data/config.json。

param(
    [int]$Port = 0
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $Root

# 1. 加载 .env.local
$EnvFile = Join-Path $Root ".env.local"
if (Test-Path $EnvFile) {
    Get-Content $EnvFile | ForEach-Object {
        $line = $_.Trim()
        if ($line -and -not $line.StartsWith("#") -and $line.Contains("=")) {
            $name, $value = $line -split "=", 2
            [Environment]::SetEnvironmentVariable($name.Trim(), $value.Trim(), "Process")
        }
    }
    Write-Host "[dev] 已加载 $EnvFile"
} else {
    Write-Host "[dev] 未找到 .env.local — 使用 data/config.json 配置(模型接口可能不可用)"
}

if ($Port -gt 0) { [Environment]::SetEnvironmentVariable("NEXORALEARNING_PORT", "$Port", "Process") }

# 2. 关键配置提示
if (-not $env:NEXORALEARNING_NEXORA_BASE_URL) {
    Write-Host "[dev] 提示: 未设置 NEXORALEARNING_NEXORA_BASE_URL, 模型接口将指向 http://127.0.0.1:5000 (本地未跑)" -ForegroundColor Yellow
}
if (-not $env:NEXORALEARNING_NEXORA_API_KEY) {
    Write-Host "[dev] 提示: 未设置 NEXORALEARNING_NEXORA_API_KEY — context/today/进度等读接口可用, plan/ask 等模型接口会失败" -ForegroundColor Yellow
}
if (-not $env:NEXORALEARNING_RUNTIME_API_KEY) {
    Write-Host "[dev] 提示: 开发模式(不强制 X-API-Key)。接入小艺/公网部署前必须设置" -ForegroundColor Yellow
}

# 3. 选择 Python 解释器(优先仓库 venv)
$VenvPython = Join-Path (Split-Path $Root -Parent) "venv\Scripts\python.exe"
$Python = if (Test-Path $VenvPython) { $VenvPython } else { "python" }
Write-Host "[dev] Python: $Python" -ForegroundColor Cyan

# 4. 启动
& $Python main.py
