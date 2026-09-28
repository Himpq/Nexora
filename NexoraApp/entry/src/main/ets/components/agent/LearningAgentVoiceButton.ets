import { common } from '@kit.AbilityKit';
import { VoiceRecognizerService } from '../../common/VoiceRecognizerService';

// 转写只填草稿，不自动发送；生命周期结束立即释放麦克风。
@Component
export struct LearningAgentVoiceButton {
    @Prop @Watch('availabilityChanged') disabled: boolean = false;
    @StorageProp('appForeground') @Watch('availabilityChanged') foreground: boolean = true;
    onText: (text: string) => void = (_text: string): void => {};
    onError: (message: string) => void = (_message: string): void => {};
    @State private listening: boolean = false;
    private service: VoiceRecognizerService = new VoiceRecognizerService();
    private alive: boolean = false;
    private generation: number = 0;
    private finishTimer: number = -1;

    aboutToAppear(): void { this.alive = true; }
    aboutToDisappear(): void { this.alive = false; this.cancel(); }

    private availabilityChanged(): void {
        if (this.disabled || !this.foreground) { this.cancel(); }
    }

    private cancel(): void {
        this.generation++;
        this.listening = false;
        if (this.finishTimer >= 0) { clearTimeout(this.finishTimer); this.finishTimer = -1; }
        this.service.cancel();
    }

    private async toggle(): Promise<void> {
        if (this.listening) {
            this.listening = false;
            await this.service.finish();
            return;
        }
        if (this.disabled || !this.foreground) { return; }
        const host = this.getUIContext().getHostContext();
        if (host === undefined) { this.onError('暂时不能使用语音输入'); return; }
        const generation: number = ++this.generation;
        const recognizer: VoiceRecognizerService = new VoiceRecognizerService();
        this.service = recognizer;
        this.listening = true;
        const message: string = await recognizer.start(host as common.UIAbilityContext, {
            onText: (text: string, isFinal: boolean): void => {
                if (this.alive && generation === this.generation && isFinal && text.trim().length > 0) {
                    this.onText(text.trim());
                }
            },
            onState: (active: boolean, status: string): void => {
                if (!this.alive || generation !== this.generation) { return; }
                this.listening = active;
                if (!active) {
                    if (this.finishTimer >= 0) { clearTimeout(this.finishTimer); this.finishTimer = -1; }
                    if (status.length > 0 && status !== '识别完成') { this.onError(status); }
                }
            },
            onLevel: (_level: number): void => {},
        });
        if (!this.alive || generation !== this.generation) { recognizer.cancel(); return; }
        if (message.length > 0) { this.listening = false; this.onError(message); return; }
        if (this.listening) {
            this.finishTimer = setTimeout((): void => {
                this.finishTimer = -1;
                if (generation === this.generation) { void this.service.finish(); }
            }, 60000);
        }
    }

    build() {
        Button({ type: ButtonType.Circle }) {
            Image(this.listening ? $r('app.media.ic_stop') : $r('app.media.ic_mic'))
                .width(18).height(18).fillColor(this.listening ? '#B44343' : '#566B91')
        }
        .width(34).height(34)
        .backgroundColor(this.listening ? '#FCE8E8' : '#EDF2F9')
        .enabled(!this.disabled || this.listening)
        .accessibilityText(this.listening ? '结束语音输入' : '语音输入，转写到草稿')
        .onClick((): void => { void this.toggle(); })
    }
}
