/**
 * §8 capability/tts.ets — 端侧语音合成封装（Core Speech Kit）。
 * 事实依据（SDK @hms.ai.textToSpeech.d.ts + devecocli docs `hms-ai-texttospeech`）：
 * - textToSpeech.createEngine({language:'zh-CN', person:0, online:1, extraParams:{...}})
 * - engine.speak(text, {requestId, extraParams})；playType 默认 1 = 合成并播报
 * - setListener(SpeakListener{onStart,onComplete,onStop,onError})；stop() / isBusy() / shutdown()
 * - 单次 ≤10000 字符
 *
 * 长文本（整章听书）走**队列 + onComplete 驱动**逐段播报：
 * 直接循环调用 speak() 会让后一段覆盖前一段，只剩最后一段被读出来。
 */
import { textToSpeech } from '@kit.CoreSpeechKit';
import { BusinessError } from '@kit.BasicServicesKit';

/** 单段长度。远小于 10000 上限，便于停止时快速响应。 */
const TTS_CHUNK_SIZE: number = 1200;

export class TtsService {
  private engine: textToSpeech.TextToSpeechEngine | undefined = undefined;
  private counter: number = 0;
  private queue: string[] = [];
  private current: string = '';
  private busy: boolean = false;
  private paused: boolean = false;
  private onErrorCallback: (message: string) => void = (message: string) => {
  };
  private onStateChange: (speaking: boolean) => void = (speaking: boolean) => {
  };

  /** 朗读状态变化回调（供 UI 切换「朗读/停止」）。 */
  setStateListener(listener: (speaking: boolean) => void): void {
    this.onStateChange = listener;
  }

  isSpeaking(): boolean {
    return this.paused || this.busy || this.current.length > 0 || this.queue.length > 0;
  }

  isPaused(): boolean {
    return this.paused;
  }

  async init(onError: (message: string) => void): Promise<void> {
    this.onErrorCallback = onError;
    if (this.engine !== undefined) {
      return;
    }
    try {
      const params: textToSpeech.CreateEngineParams = {
        language: 'zh-CN',
        person: 0,
        online: 1,
        extraParams: { 'style': 'interaction-broadcast', 'locate': 'CN', 'name': 'NexoraTTS' } as Record<string, Object>,
      };
      this.engine = await textToSpeech.createEngine(params);
      // 队列推进依赖 onComplete；不设监听器就收不到回调（官方文档明确说明）。
      this.engine.setListener({
        onStart: (requestId: string, response: textToSpeech.StartResponse): void => {
        },
        onComplete: (requestId: string, response: textToSpeech.CompleteResponse): void => {
          this.busy = false;
          this.current = '';
          this.pump();
        },
        onStop: (requestId: string, response: textToSpeech.StopResponse): void => {
          this.busy = false;
          if (this.paused) {
            this.onStateChange(true);
            return;
          }
          this.current = '';
          this.queue = [];
          this.onStateChange(false);
        },
        onError: (requestId: string, errorCode: number, errorMessage: string): void => {
          this.busy = false;
          this.paused = false;
          this.current = '';
          this.queue = [];
          this.onStateChange(false);
          this.onErrorCallback('朗读出错了：' + errorMessage);
        },
      });
    } catch (err) {
      const e = err as BusinessError;
      onError('朗读启动失败：' + e.message);
    }
  }

  /**
   * 朗读任意长度文本。会先确保引擎就绪——
   * 原实现由调用方 `init()` 不 await 就 `speak()`，首次点击必然落到「引擎还没准备好」。
   */
  async speakText(text: string, onError: (message: string) => void): Promise<void> {
    const content: string = text.trim();
    if (content.length === 0) {
      return;
    }
    await this.init(onError);
    if (this.engine === undefined) {
      return;
    }
    const chunks: string[] = [];
    let offset: number = 0;
    while (offset < content.length) {
      chunks.push(content.slice(offset, offset + TTS_CHUNK_SIZE));
      offset += TTS_CHUNK_SIZE;
    }
    this.paused = false;
    this.current = '';
    this.queue = chunks;
    this.onStateChange(true);
    this.pump();
  }

  private pump(): void {
    if (this.busy || this.paused || this.engine === undefined) {
      return;
    }
    if (this.current.length === 0) {
      if (this.queue.length === 0) {
        this.onStateChange(false);
        return;
      }
      const next: string | undefined = this.queue.shift();
      this.current = next !== undefined ? next : '';
    }
    if (this.current.length === 0) {
      this.onStateChange(false);
      return;
    }
    this.counter += 1;
    const params: textToSpeech.SpeakParams = {
      requestId: 'nx_tts_' + this.counter,
      extraParams: { 'playType': 1 } as Record<string, Object>,
    };
    try {
      this.busy = true;
      this.engine.speak(this.current, params);
    } catch (err) {
      const e = err as BusinessError;
      this.busy = false;
      this.paused = false;
      this.current = '';
      this.queue = [];
      this.onStateChange(false);
      this.onErrorCallback('朗读失败：' + e.message);
    }
  }

  /** 停在当前句，再点继续从这一句接着读。 */
  pause(): void {
    if (this.paused || !this.isSpeaking()) {
      return;
    }
    this.paused = true;
    if (this.engine !== undefined) {
      try {
        this.engine.stop();
      } catch (err) {
        // 未在播报时忽略
      }
    }
    this.busy = false;
    this.onStateChange(true);
  }

  resume(): void {
    if (!this.paused) {
      return;
    }
    this.paused = false;
    this.onStateChange(true);
    this.pump();
  }

  /** 停止朗读并清空剩余段落（原先没有停止入口，一旦开读只能退出页面）。 */
  stop(): void {
    this.paused = false;
    this.current = '';
    this.queue = [];
    this.busy = false;
    if (this.engine !== undefined) {
      try {
        this.engine.stop();
      } catch (err) {
        // 未在播报时忽略
      }
    }
    this.onStateChange(false);
  }

  release(): void {
    this.paused = false;
    this.current = '';
    this.queue = [];
    this.busy = false;
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

/** 全局单例：同一设备上所有应用最多支持 3 个 TTS 引擎实例（官方文档），必须共享。 */
export const sharedTts: TtsService = new TtsService();
