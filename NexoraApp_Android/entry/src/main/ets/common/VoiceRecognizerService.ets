// VoiceRecognizerService.ets - Android ArkUI-X 语音能力适配层
// ArkUI-X Android SDK 不提供 HarmonyOS Core Speech Kit，直接返回能力状态，
// 不伪造识别结果，也不引入不存在的 HarmonyOS 语音模块。

import { common } from '@kit.AbilityKit';

export interface VoiceRecognitionCallbacks {
    onText: (text: string, isFinal: boolean) => void;
    onState: (isListening: boolean, message: string) => void;
    onLevel: (level: number) => void;
}

export class VoiceRecognizerService {

    // Android 版本当前没有可用的系统语音识别引擎，状态由 NotesPage 负责展示。
    async start(context: common.UIAbilityContext, callbacks: VoiceRecognitionCallbacks): Promise<string> {
        return 'Android 版本暂不支持系统语音识别';
    }

    async finish(): Promise<void> {
        return;
    }

    cancel(): void {
        return;
    }
}
