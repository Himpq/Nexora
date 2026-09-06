Get-Process -Name "node" -ErrorAction SilentlyContinue | Where-Object { $_.Id -ne$PID } | Stop-Process -Force -ErrorAction SilentlyContinue
Remove-Item "F:\Code\AI\ChatDB\NexoraApp_Android\.hvigor\daemon" -Recurse -Force -ErrorAction SilentlyContinue

$env:HVIGOR_USER_HOME = "F:\Code\AI\ChatDB\NexoraApp_Android\.hvigor"
$env:DEVECO_SDK0_SDK_HOME = "F:\Code\Program\DevEco Studio\sdk"

& "F:\Code\Program\DevEco Studio\tools\node\node.exe" "F:\Code\Program\DevEco Studio\tools\hvigor\bin\hvigorw.js" default@CompileArkTS -p module=entry --no-daemon
node "G:\Temp\Huawei\SDK\ArkUI_X_SDK\26.0.0\arkui-x\toolchains\ace_tools\lib\ace_tools.js" build apk --release
