// LiveViewController.ets - 实况窗（灵动岛）控制器
// ArkUI-X 跨平台版：HarmonyOS NEXT 独有的 LiveView Kit 在 Android/iOS 无对应能力，
// 此处保留接口签名做空实现，保证 EntryAbility 调用方代码不需改动，主流程零影响。


export class LiveViewController {

    private active: boolean = false;

    static readonly shared: LiveViewController = new LiveViewController();

    // 发布"模型正在回复"实况窗：跨平台版空实现
    async startGenerating(): Promise<void> {
        return;
    }

    // 更新实况窗内容：跨平台版空实现
    async updateContent(fullText: string): Promise<void> {
        return;
    }

    // 回复完成，实况窗改"完成"并延时关闭：跨平台版空实现
    async finishGenerating(): Promise<void> {
        return;
    }

    // 停止实况窗：跨平台版空实现
    async stop(): Promise<void> {
        return;
    }
}
