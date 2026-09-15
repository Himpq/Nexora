$ErrorActionPreference = "Stop"

$apkPath = "F:\Code\AI\ChatDB\NexoraApp_Android\.arkui-x\android\app\build\outputs\apk\release\app-release.apk"
$previousApkHash = ""

if (Test-Path $apkPath) {
    $previousApkHash = (Get-FileHash -Path $apkPath -Algorithm SHA256).Hash
}

Get-Process -Name "node" -ErrorAction SilentlyContinue | Where-Object { $_.Id -ne$PID } | Stop-Process -Force -ErrorAction SilentlyContinue
Remove-Item "F:\Code\AI\ChatDB\NexoraApp_Android\.hvigor\daemon" -Recurse -Force -ErrorAction SilentlyContinue

$env:HVIGOR_USER_HOME = "F:\Code\AI\ChatDB\NexoraApp_Android\.hvigor"
$env:DEVECO_SDK_HOME = "F:\Code\Program\DevEco Studio\sdk"
$env:DEVECO_SDK0_SDK_HOME = "F:\Code\Program\DevEco Studio\sdk"
$env:JAVA_HOME = "F:\Code\Env\AndroidStudio\jbr"

& "F:\Code\Program\DevEco Studio\tools\node\node.exe" "F:\Code\Program\DevEco Studio\tools\hvigor\bin\hvigorw.js" default@CompileArkTS -p module=entry --no-daemon

if ($LASTEXITCODE -ne 0) {
    throw "ArkTS compile failed with exit code $LASTEXITCODE"
}

# ace_tools/Gradle keeps a stale release asset directory after CompileArkTS.
# Remove only this generated release staging directory so the APK contains the
# modules.abc produced by the compile above instead of an older chat bundle.
$releaseAssetsPath = "F:\Code\AI\ChatDB\NexoraApp_Android\.arkui-x\android\app\build\intermediates\assets\release"
if (Test-Path -LiteralPath $releaseAssetsPath) {
    Remove-Item -LiteralPath $releaseAssetsPath -Recurse -Force
}

node "G:\Temp\Huawei\SDK\ArkUI_X_SDK\26.0.0\arkui-x\toolchains\ace_tools\lib\ace_tools.js" build apk --release

if ($LASTEXITCODE -ne 0) {
    throw "Android APK build failed with exit code $LASTEXITCODE"
}

if (-not (Test-Path $apkPath)) {
    throw "Android APK build reported success, but app-release.apk was not generated"
}

$apkWriteTime = (Get-Item $apkPath).LastWriteTimeUtc
$currentApkHash = (Get-FileHash -Path $apkPath -Algorithm SHA256).Hash

if ($currentApkHash -eq $previousApkHash) {
    # APK 字节未变有两种可能：构建没更新产物（要报错），或产物本来就与当前源码一致（应放行）。
    # 只用 mtime 判断会把「无变化重建」误判成假成功；这里用「源码是否比 APK 新」区分这两种情况
    $staleSources = Get-ChildItem "F:\Code\AI\ChatDB\NexoraApp_Android\entry\src", "F:\Code\AI\ChatDB\NexoraApp_Android\AppScope" -Recurse -File -ErrorAction SilentlyContinue |
        Where-Object { $_.LastWriteTimeUtc -gt $apkWriteTime }

    if ($staleSources) {
        throw "Source files are newer than app-release.apk but the build did not update it; inspect the ArkUI-X/Gradle output above"
    }
}
