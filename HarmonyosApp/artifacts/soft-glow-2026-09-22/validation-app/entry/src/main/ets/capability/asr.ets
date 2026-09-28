/**
 * §8 capability/asr.ets — 端侧语音识别封装（Core Speech Kit）。
 * 事实依据（devecocli docs `hms-ai-speechrecognizer`）：
 * - createEngine({language:'zh-CN', online:1, extraParams:{locate:'CN', recognizerMode:'short'}})
 * - startListening 需 StartParams{sessionId, audioInfo:{audioType:'pcm', sampleRate:16000,
 *   sampleBit:16, soundChannel:1}}；实时录音模式 recognitionMode:0 需 MICROPHONE 权限。
 * - 结果经 RecognitionListener.onResult(sessionId, {result, isFinal})。
 * 错误码 1002200012 = 没有获取麦克风权限。模拟器无麦克风时失败需降级为文本输入。
 */
import { speechRecognizer } from '@kit.CoreSpeechKit';
import { BusinessError } from '@kit.BasicServicesKit';

export class AsrService {
  private engine: speechRecognizer.SpeechRecognitionEngine | undefined = undefined;
  private sessionSeq: number = 0;
  private sessionId: string = 'nx_asr_session';
  private active: boolean = false;
  private onTextCallback: (text: string) => void = (text: string) => {
  };
  private onErrorCallback: (message: string) => void = (message: string) => {
  };
  private onCompleteCallback: () => void = () => {
  };

  private buildListener(sessionId: string): speechRecognizer.RecognitionListener {
    const listener: speechRecognizer.RecognitionListener = {
      onStart: (id: string, eventMessage: string): void => {
        // 开始识别，无需处理
      },
      onEvent: (id: string, eventCode: number, eventMessage: string): void => {
        // 音频起止事件，无需处理
      },
      onResult: (id: string, result: speechRecognizer.SpeechRecognitionResult): void => {
        if (id !== sessionId) {
          return;
        }
        const text: string = result.result;
        if (text.length > 0 && result.isFinal) {
          this.onTextCallback(text);
        }
      },
      onComplete: (id: string, eventMessage: string): void => {
        if (id !== sessionId) {
          return;
        }
        // 正常结束也要通知 UI 复位（2026-09-21 审查 I7：原先按钮停在「停止」）。
        this.active = false;
        this.onCompleteCallback();
      },
      onError: (id: string, errorCode: number, errorMessage: string): void => {
        if (id !== sessionId) {
          return;
        }
        this.active = false;
        if (errorCode === 1002200012) {
          this.onErrorCallback('没有麦克风权限，先用文字跟我说吧。');
        } else {
          this.onErrorCallback('我没听清：' + errorMessage);
        }
      },
    };
    return listener;
  }

  isListening(): boolean {
    return this.active;
  }

  /** 引擎复用：每次 start 不再新建引擎（F15：旧引擎从未关闭，引用被覆盖后泄漏）。 */
  private async ensureEngine(): Promise<speechRecognizer.SpeechRecognitionEngine> {
    if (this.engine !== undefined) {
      return this.engine;
    }
    const engineParams: speechRecognizer.CreateEngineParams = {
      language: 'zh-CN',
      online: 1,
      extraParams: { 'locate': 'CN', 'recognizerMode': 'short' } as Record<string, Object>,
    };
    this.engine = await speechRecognizer.createEngine(engineParams);
    return this.engine;
  }

  async start(onText: (text: string) => void, onError: (message: string) => void, onComplete: () => void = () => {
  }): Promise<void> {
    if (this.active) {
      return;
    }
    this.onTextCallback = onText;
    this.onErrorCallback = onError;
    this.onCompleteCallback = onComplete;
    this.sessionSeq += 1;
    this.sessionId = 'nx_asr_' + this.sessionSeq;
    try {
      const engine = await this.ensureEngine();
      engine.setListener(this.buildListener(this.sessionId));
      const audioInfo: speechRecognizer.AudioInfo = {
        audioType: 'pcm',
        sampleRate: 16000,
        sampleBit: 16,
        soundChannel: 1,
      };
      const startParams: speechRecognizer.StartParams = {
        sessionId: this.sessionId,
        audioInfo: audioInfo,
        extraParams: { 'recognitionMode': 0 } as Record<string, Object>,
      };
      engine.startListening(startParams);
      this.active = true;
    } catch (err) {
      this.active = false;
      const e = err as BusinessError;
      if (e.code === 1002200012) {
        onError('没有麦克风权限，先用文字跟我说吧。');
      } else {
        onError('语音识别启动失败：' + e.message);
      }
    }
  }

  stop(): void {
    if (this.engine !== undefined && this.active) {
      try {
        this.engine.finish(this.sessionId);
      } catch (err) {
        // finish 失败不阻断：引擎释放兜底
      }
    }
    this.active = false;
  }

  release(): void {
    this.stop();
    if (this.engine !== undefined) {
      try {
        this.engine.shutdown();
      } catch (err) {
        // 已销毁则忽略
      }
      this.engine = undefined;
    }
  }
}

/** 全局单例：语音识别引擎按实例占用系统资源，共享使用。 */
export const sharedAsr: AsrService = new AsrService();
