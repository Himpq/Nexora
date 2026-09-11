# build.ps1 - NexoraApp 鸿蒙构建脚本
# 用法: .\build.ps1          构建 + 安装
#       .\build.ps1 -Clean   清理缓存后全量构建 + 安装
#       .\build.ps1 -BuildOnly   只构建不安装

param(
    [switch]$Clean,
    [switch]$BuildOnly
)

$ErrorActionPreference = 'Continue'

$PROJECT = 'F:\Code\AI\ChatDB\NexoraApp'
$NODE = 'F:\Code\Program\DevEco Studio\tools\node\node.exe'
$HVIGORW = 'F:\Code\Program\DevEco Studio\tools\hvigor\bin\hvigorw.js'
$HDC = 'F:\Code\Program\DevEco Studio\sdk\default\openharmony\toolchains\hdc.exe'
$DEVICE = '127.0.0.1:5555'
$HAP = "$PROJECT\entry\build\default\outputs\default\entry-default-unsigned.hap"

# 环境变量
$env:DEVECO_SDK_HOME = 'F:\Code\Program\DevEco Studio\sdk'
$env:HVIGOR_USER_HOME = "$PROJECT\.hvigor"
$env:DEVECO_SDK0_SDK_HOME = 'F:\Code\Program\DevEco Studio\sdk'

Write-Host '=== NexoraApp 构建 ===' -ForegroundColor Cyan

# 停止 daemon
Write-Host '[1/4] 停止 hvigor daemon...' -ForegroundColor Yellow
& $NODE $HVIGORW --stop-daemon 2>&1 | Out-Null

# 清理
if ($Clean) {
    Write-Host '[2/4] 清理缓存（全量构建）...' -ForegroundColor Yellow
    Remove-Item "$PROJECT\entry\build" -Recurse -Force -ErrorAction SilentlyContinue
    Remove-Item "$PROJECT\.hvigor\caches" -Recurse -Force -ErrorAction SilentlyContinue
    Remove-Item "$PROJECT\.hvigor\project_caches" -Recurse -Force -ErrorAction SilentlyContinue
    Remove-Item "$PROJECT\.hvigor\daemon" -Recurse -Force -ErrorAction SilentlyContinue
    Write-Host '  已清理 entry/build, .hvigor/caches, project_caches, daemon' -ForegroundColor Green
} else {
    Write-Host '[2/4] 跳过清理（增量构建）' -ForegroundColor Gray
}

# 构建：hvigorw 由子进程输出到控制台，必须显式落盘才能用于失败判定（仅看退出码会漏报编译错误）
Write-Host '[3/4] 构建 HAP...' -ForegroundColor Yellow
& $NODE $HVIGORW assembleHap --mode module 2>&1 | Tee-Object -FilePath "$PROJECT\build_log.txt"
$buildExit = $LASTEXITCODE

$logText = Get-Content "$PROJECT\build_log.txt" -Raw -ErrorAction SilentlyContinue
$hasCompilerError = $logText -match 'ArkTS Compiler Error|BUILD FAILED|FAILURE: Build' -or $logText -match 'COMPILE RESULT:FAIL'

if ($buildExit -ne 0 -or $hasCompilerError) {
    Write-Host "  构建失败! 详情见 build_log.txt（exit=$buildExit）" -ForegroundColor Red
    if ($hasCompilerError) {
        Select-String -Path "$PROJECT\build_log.txt" -Pattern 'Error Message:|COMPILE RESULT' |
            Select-Object -First 30 | ForEach-Object { Write-Host "    $($_.Line.Trim())" -ForegroundColor DarkYellow }
    }
    exit 1
}
Write-Host '  构建成功' -ForegroundColor Green

# 安装
if ($BuildOnly) {
    Write-Host '[4/4] 跳过安装（-BuildOnly）' -ForegroundColor Gray
} else {
    Write-Host '[4/4] 安装到模拟器...' -ForegroundColor Yellow
    if (Test-Path $HAP) {
        & $HDC -t $DEVICE install -r $HAP
        if ($LASTEXITCODE -eq 0) {
            Write-Host '  安装成功' -ForegroundColor Green
        } else {
            Write-Host '  安装失败! 请确认模拟器已连接' -ForegroundColor Red
        }
    } else {
        Write-Host "  HAP 不存在: $HAP" -ForegroundColor Red
    }
}

Write-Host '=== 完成 ===' -ForegroundColor Cyan