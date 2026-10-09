import bridge from '@arkui-x.bridge';
import { hilog } from '@kit.PerformanceAnalysisKit';

const DOMAIN = 0x0000;
const TAG = 'LiveViewController';
const NATIVE_BRIDGE_NAME = 'NexoraLiveUpdate';
const PROGRESS_UPDATE_INTERVAL_MS = 1000;
const ROLLING_WINDOW_CHARS = 5;

export class LiveViewController {
    private active: boolean = false;
    private nativeBridge: bridge.BridgeObject | null = null;
    private lastProgressText: string = '';
    private lastProgressUpdateAt: number = 0;

    static readonly shared: LiveViewController = new LiveViewController();

    initialize(): void {
        if (this.nativeBridge !== null) {
            return;
        }

        try {
            this.nativeBridge = bridge.createBridge(NATIVE_BRIDGE_NAME);
            hilog.info(DOMAIN, TAG, 'Android live update bridge initialized');
        } catch (error) {
            hilog.error(DOMAIN, TAG, 'Android live update bridge init failed: %{public}s',
                String(error));
        }
    }

    async startGenerating(): Promise<void> {
        if (this.active) {
            return;
        }

        this.active = true;
        this.lastProgressText = '正在生成回复';
        this.lastProgressUpdateAt = 0;

        const started: boolean = await this.callNative('startGenerating');

        if (!started) {
            this.active = false;
        }
    }

    async updateContent(fullText: string): Promise<void> {
        if (!this.active) {
            return;
        }

        const now: number = Date.now();

        if (now - this.lastProgressUpdateAt < PROGRESS_UPDATE_INTERVAL_MS) {
            return;
        }

        const progressText: string = fullText.length > 0
            ? fullText.substring(Math.max(0, fullText.length - ROLLING_WINDOW_CHARS))
            : '正在生成回复';

        if (progressText === this.lastProgressText) {
            return;
        }

        this.lastProgressText = progressText;
        this.lastProgressUpdateAt = now;
        await this.callNative('updateContent', progressText);
    }

    async finishGenerating(): Promise<void> {
        if (!this.active) {
            return;
        }

        this.active = false;
        await this.callNative('finishGenerating');
    }

    async stop(): Promise<void> {
        this.active = false;
        await this.callNative('stop');
    }

    private async callNative(methodName: string, ...parameters: Array<string>): Promise<boolean> {
        const nativeBridge: bridge.BridgeObject | null = this.nativeBridge;

        if (nativeBridge === null) {
            hilog.error(DOMAIN, TAG, 'Android live update bridge is not initialized');
            return false;
        }

        try {
            await nativeBridge.callMethod(methodName, ...parameters);
            return true;
        } catch (error) {
            hilog.error(DOMAIN, TAG, 'Android live update call %{public}s failed: %{public}s',
                methodName, String(error));
            return false;
        }
    }
}
