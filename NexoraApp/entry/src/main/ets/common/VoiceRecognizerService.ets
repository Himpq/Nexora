// VoiceRecognizerService.ets - 随笔语音输入的系统能力适配层
// AudioCapturer 负责采集 PCM，Core Speech Kit 负责识别；页面只接收文本和状态，不感知平台音频细节。

import { BusinessError } from '@kit.BasicServicesKit';
import { abilityAccessCtrl, common, PermissionRequestResult, Permissions } from '@kit.AbilityKit';
import { audio } from '@kit.AudioKit';
import { speechRecognizer } from '@kit.CoreSpeechKit';
import { hilog } from '@kit.PerformanceAnalysisKit';

const DOMAIN: number = 0x0000;
const TAG: string = 'VoiceRecognizer';
const MICROPHONE_PERMISSION: string = 'ohos.permission.MICROPHONE';
const AUDIO_PACKET_SIZE: number = 1280;
const AUDIO_PACKET_INTERVAL_MS: number = 40;

export interface VoiceRecognitionCallbacks {
    onText: (text: string, isFinal: boolean) => void;
    onState: (isListening: boolean, message: string) => void;
    onLevel: (level: number) => void;
}

export class VoiceRecognizerService {
    private engine: speechRecognizer.SpeechRecognitionEngine | undefined = undefined;
    private capturer: audio.AudioCapturer | undefined = undefined;
    private readDataHandler: ((buffer: ArrayBuffer) => void) | undefined = undefined;
    private sessionId: string = '';
    private callbacks: VoiceRecognitionCallbacks | undefined = undefined;
    private active: boolean = false;
    private engineStarted: boolean = false;
    private engineStartResolver: ((message: string) => void) | undefined = undefined;
    private pendingAudio: Uint8Array = new Uint8Array(0);
    private audioQueue: Uint8Array[] = [];
    private audioSendTimer: number = -1;
    private finishing: boolean = false;
    private engineFinishRequested: boolean = false;
    private lastLevelAt: number = 0;

    // 启动一次中文长语音识别，并在引擎确认就绪后才开始采集和发送音频。
    async start(context: common.UIAbilityContext, callbacks: VoiceRecognitionCallbacks): Promise<string> {
        if (this.active) {
            return '语音识别正在进行';
        }

        this.callbacks = callbacks;
        this.sessionId = 'nexora_voice_' + Date.now().toString();
        this.engineStarted = false;
        this.pendingAudio = new Uint8Array(0);
        this.audioQueue = [];
        this.audioSendTimer = -1;
        this.lastLevelAt = 0;

        try {
            const permissionGranted: boolean = await this.requestMicrophonePermission(context);

            if (!permissionGranted) {
                this.releaseResources();
                return '未获得麦克风权限，请允许后再试';
            }

            this.engine = await speechRecognizer.createEngine({
                language: 'zh-CN',
                online: 1,
                extraParams: {
                    locate: 'CN',
                    recognizerMode: 'long'
                }
            });

            this.engine.setListener(this.createRecognitionListener());
            const currentCapturer: audio.AudioCapturer = await audio.createAudioCapturer(this.createAudioOptions());
            this.capturer = currentCapturer;
            this.readDataHandler = (buffer: ArrayBuffer): void => {
                this.forwardAudio(buffer);
            };
            currentCapturer.on('readData', this.readDataHandler);

            this.active = true;
            this.finishing = false;
            this.engineFinishRequested = false;
            const engineStartPromise: Promise<string> = new Promise<string>(
                (resolve: (message: string) => void): void => {
                    this.engineStartResolver = resolve;
                }
            );
            this.engine.startListening({
                sessionId: this.sessionId,
                audioInfo: {
                    audioType: 'pcm',
                    sampleRate: 16000,
                    soundChannel: 1,
                    sampleBit: 16
                }
            });

            const engineStartError: string = await engineStartPromise;

            if (engineStartError.length > 0 || !this.active || this.engine === undefined) {
                this.releaseResources();
                return engineStartError.length > 0 ? engineStartError : '语音识别启动失败';
            }

            await currentCapturer.start();
            hilog.info(DOMAIN, TAG, 'voice recognition started, session=%{public}s', this.sessionId);
            return '';
        } catch (error) {
            const message: string = this.formatError(error as BusinessError);
            hilog.error(DOMAIN, TAG, 'voice recognition start failed: %{public}s', message);
            this.resolveEngineStart(message);
            this.releaseResources();
            return message;
        }
    }

    // 结束当前识别，先停止采集并发送完已缓存的合法音频包，再让引擎回传最后结果。
    async finish(): Promise<void> {
        if (!this.active || this.engine === undefined || this.sessionId.length === 0) {
            return;
        }

        if (!this.engineStarted) {
            this.resolveEngineStart('语音识别已结束');
            this.completeSession('');
            return;
        }

        this.finishing = true;
        const currentCapturer: audio.AudioCapturer | undefined = this.capturer;

        try {
            if (currentCapturer !== undefined) {
                await currentCapturer.stop();
            }
        } catch (error) {
            hilog.error(DOMAIN, TAG, 'audio capturer stop failed: %{public}s',
                this.formatError(error as BusinessError));
        }

        this.flushPendingAudio();

        if (this.audioQueue.length === 0) {
            this.finishEngine();
        } else {
            this.startAudioPump();
        }
    }

    // 页面离开或编辑器切换时立即取消识别，避免音频采集器留在后台。
    cancel(): void {
        if (!this.active || this.engine === undefined || this.sessionId.length === 0) {
            this.releaseResources();
            return;
        }

        try {
            this.engine.cancel(this.sessionId);
        } catch (error) {
            hilog.error(DOMAIN, TAG, 'voice recognition cancel failed: %{public}s',
                this.formatError(error as BusinessError));
        }

        this.completeSession('');
    }

    private requestMicrophonePermission(context: common.UIAbilityContext): Promise<boolean> {
        const permissions: Array<Permissions> = [MICROPHONE_PERMISSION as Permissions];

        return new Promise<boolean>((resolve: (value: boolean) => void): void => {
            abilityAccessCtrl.createAtManager().requestPermissionsFromUser(
                context,
                permissions,
                (error: BusinessError, result: PermissionRequestResult): void => {
                    if (error) {
                        hilog.error(DOMAIN, TAG, 'microphone permission request failed: %{public}s', error.message);
                        resolve(false);
                        return;
                    }

                    resolve(result.authResults.length > 0 && result.authResults[0] === 0);
                }
            );
        });
    }

    private createAudioOptions(): audio.AudioCapturerOptions {
        const streamInfo: audio.AudioStreamInfo = {
            samplingRate: audio.AudioSamplingRate.SAMPLE_RATE_16000,
            channels: audio.AudioChannel.CHANNEL_1,
            sampleFormat: audio.AudioSampleFormat.SAMPLE_FORMAT_S16LE,
            encodingType: audio.AudioEncodingType.ENCODING_TYPE_RAW
        };
        const capturerInfo: audio.AudioCapturerInfo = {
            source: audio.SourceType.SOURCE_TYPE_MIC,
            capturerFlags: 0
        };

        return {
            streamInfo: streamInfo,
            capturerInfo: capturerInfo
        };
    }

    private createRecognitionListener(): speechRecognizer.RecognitionListener {
        return {
            onStart: (sessionId: string, eventMessage: string): void => {
                hilog.info(DOMAIN, TAG, 'recognition engine started, session=%{public}s message=%{public}s',
                    sessionId, eventMessage);
                this.engineStarted = true;
                this.resolveEngineStart('');
                this.notifyState(true, '正在识别…');
            },
            onEvent: (_sessionId: string, _eventCode: number, _eventMessage: string): void => {},
            onResult: (sessionId: string, result: speechRecognizer.SpeechRecognitionResult): void => {
                if (sessionId !== this.sessionId) {
                    return;
                }

                this.notifyText(result.result, result.isFinal);
            },
            onComplete: (sessionId: string, eventMessage: string): void => {
                if (sessionId !== this.sessionId) {
                    return;
                }

                hilog.info(DOMAIN, TAG, 'recognition completed, session=%{public}s message=%{public}s',
                    sessionId, eventMessage);
                this.resolveEngineStart('语音识别未能启动');
                this.completeSession('');
            },
            onError: (sessionId: string, errorCode: number, errorMessage: string): void => {
                if (sessionId !== this.sessionId) {
                    return;
                }

                const message: string = this.formatError({ code: errorCode, message: errorMessage } as BusinessError);
                hilog.error(DOMAIN, TAG, 'recognition engine error: %{public}s', message);
                this.resolveEngineStart(message);
                this.completeSession(message);
            }
        };
    }

    private forwardAudio(buffer: ArrayBuffer): void {
        if (!this.active || this.finishing || !this.engineStarted || this.engine === undefined ||
            this.sessionId.length === 0) {
            return;
        }

        try {
            this.notifyLevel(this.calculateSignalLevel(buffer));
            const incoming: Uint8Array = new Uint8Array(buffer);
            const merged: Uint8Array = new Uint8Array(this.pendingAudio.length + incoming.length);
            merged.set(this.pendingAudio, 0);
            merged.set(incoming, this.pendingAudio.length);

            let offset: number = 0;

            while (offset + AUDIO_PACKET_SIZE <= merged.length) {
                this.audioQueue.push(merged.slice(offset, offset + AUDIO_PACKET_SIZE));
                offset += AUDIO_PACKET_SIZE;
            }

            this.pendingAudio = merged.slice(offset);
            this.startAudioPump();
        } catch (error) {
            const message: string = this.formatError(error as BusinessError);
            hilog.error(DOMAIN, TAG, 'audio forwarding failed: %{public}s', message);
            this.completeSession(message);
        }
    }

    private notifyText(text: string, isFinal: boolean): void {
        if (this.callbacks !== undefined && text.trim().length > 0) {
            this.callbacks.onText(text, isFinal);
        }
    }

    private notifyState(isListening: boolean, message: string): void {
        if (this.callbacks !== undefined) {
            this.callbacks.onState(isListening, message);
        }
    }

    private notifyLevel(level: number): void {
        const now: number = Date.now();

        if (this.callbacks !== undefined && now - this.lastLevelAt >= 60) {
            this.lastLevelAt = now;
            this.callbacks.onLevel(level);
        }
    }

    private startAudioPump(): void {
        if (this.audioSendTimer >= 0) {
            return;
        }

        this.writeNextAudioPacket();
        this.audioSendTimer = setInterval(() => {
            this.writeNextAudioPacket();
        }, AUDIO_PACKET_INTERVAL_MS);
    }

    private flushPendingAudio(): void {
        if (this.pendingAudio.length >= 640) {
            this.audioQueue.push(this.pendingAudio.slice(0, 640));
        }

        this.pendingAudio = new Uint8Array(0);
    }

    private writeNextAudioPacket(): void {
        if (!this.active || !this.engineStarted || this.engine === undefined || this.sessionId.length === 0) {
            this.stopAudioPump();
            return;
        }

        if (this.audioQueue.length === 0) {
            this.stopAudioPump();

            if (this.finishing) {
                this.finishEngine();
            }

            return;
        }

        const packet: Uint8Array | undefined = this.audioQueue.shift();

        if (packet === undefined) {
            return;
        }

        try {
            this.engine.writeAudio(this.sessionId, packet);
        } catch (error) {
            const message: string = this.formatError(error as BusinessError);
            hilog.error(DOMAIN, TAG, 'audio forwarding failed: %{public}s', message);
            this.completeSession(message);
        }
    }

    private finishEngine(): void {
        if (!this.active || !this.engineStarted || this.engine === undefined ||
            this.sessionId.length === 0 || this.engineFinishRequested) {
            return;
        }

        this.engineFinishRequested = true;

        try {
            this.engine.finish(this.sessionId);
        } catch (error) {
            const message: string = this.formatError(error as BusinessError);
            hilog.error(DOMAIN, TAG, 'voice recognition finish failed: %{public}s', message);
            this.completeSession(message);
        }
    }

    private stopAudioPump(): void {
        if (this.audioSendTimer >= 0) {
            clearInterval(this.audioSendTimer);
            this.audioSendTimer = -1;
        }
    }

    private calculateSignalLevel(buffer: ArrayBuffer): number {
        const samples: Int16Array = new Int16Array(buffer);

        if (samples.length === 0) {
            return 0;
        }

        let energy: number = 0;

        for (let index: number = 0; index < samples.length; index++) {
            const normalized: number = Math.abs(samples[index]) / 32768;
            energy += normalized * normalized;
        }

        const rootMeanSquare: number = Math.sqrt(energy / samples.length);
        return Math.min(1, rootMeanSquare * 4);
    }

    private resolveEngineStart(message: string): void {
        if (this.engineStartResolver !== undefined) {
            const resolver: (value: string) => void = this.engineStartResolver;
            this.engineStartResolver = undefined;
            resolver(message);
        }
    }

    private completeSession(message: string): void {
        const wasActive: boolean = this.active;
        this.active = false;
        this.releaseResources();

        if (wasActive || message.length > 0) {
            this.notifyState(false, message.length > 0 ? message : '识别完成');
        }
    }

    private releaseResources(): void {
        const currentCapturer: audio.AudioCapturer | undefined = this.capturer;
        const currentEngine: speechRecognizer.SpeechRecognitionEngine | undefined = this.engine;
        const currentHandler: ((buffer: ArrayBuffer) => void) | undefined = this.readDataHandler;

        this.active = false;
        this.finishing = false;
        this.engineFinishRequested = false;
        this.capturer = undefined;
        this.engine = undefined;
        this.readDataHandler = undefined;
        this.sessionId = '';
        this.engineStarted = false;
        this.pendingAudio = new Uint8Array(0);
        this.audioQueue = [];
        this.stopAudioPump();
        this.lastLevelAt = 0;
        this.resolveEngineStart('语音识别已结束');

        if (currentCapturer !== undefined) {
            if (currentHandler !== undefined) {
                currentCapturer.off('readData', currentHandler);
            }

            currentCapturer.stop()
                .then(() => currentCapturer.release())
                .catch(() => currentCapturer.release());
        }

        if (currentEngine !== undefined) {
            currentEngine.shutdown();
        }
    }

    private formatError(error: BusinessError): string {
        if (error.code === 1002200012) {
            return '未获得麦克风权限，请允许后再试';
        }

        if (error.code === 1002200006) {
            return '语音服务正忙，请稍后再试';
        }

        if (error.code === 1002200001) {
            return '语音引擎创建失败，请确认设备支持 Core Speech Kit';
        }

        if (error.code === 1002200002) {
            return '语音识别启动失败';
        }

        if (error.code === 1002200010) {
            return '语音引擎还未准备好，请稍后再试';
        }

        if (error.code === 1002200011) {
            return '语音识别过程中发生异常';
        }

        if (error.message.length > 0) {
            return error.message;
        }

        return '语音识别不可用，请稍后再试';
    }
}
