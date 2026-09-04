/**
 * §8 services/StreamClient.ets（#21）：SSE 流式接收与自解析帧。
 * 事实依据：/api/sample/agents/stream 帧格式（frontend.py）：
 *   id: {seq}\nevent: runlog\ndata: {json}\n\n；event: ready（含 last_seq）；event: ping。
 * 断点续传：Last-Event-ID 请求头。发送锁/取消由调用方管理（本类暴露 stop）。
 */
import { http } from '@kit.NetworkKit';
import { util } from '@kit.ArkTS';
import { NxEnv } from '../config/Env';
import { Identity } from './Identity';

export interface RunlogRow {
  seq: number;
  event: string;
  title: string;
  payload: Record<string, string>;
}

export class StreamClient {
  private root: string = NxEnv.baseUrl();
  private request: http.HttpRequest | null = null;
  private buffer: string = '';
  private stopped: boolean = false;

  constructor() {
    this.refreshRoot();
  }

  async stream(path: string, lastEventId: string, onRow: (row: RunlogRow) => void, onError: (message: string) => void): Promise<void> {
    try {
      await Identity.waitReady();
    } catch (err) {
      if (!this.stopped) {
        onError((err as Error).message);
      }
      return;
    }
    this.refreshRoot();
    this.stopped = false;
    this.buffer = '';
    this.request = http.createHttp();
    const headers: Record<string, string> = {
      'Accept': 'text/event-stream',
    };
    if (lastEventId.length > 0) {
      headers['Last-Event-ID'] = lastEventId;
    }
    this.request.on('dataReceive', (chunk: ArrayBuffer) => {
      if (this.stopped) {
        return;
      }
      const decoder = util.TextDecoder.create('utf-8');
      const text = decoder.decodeToString(new Uint8Array(chunk));
      this.buffer += text;
      this.drain(onRow);
    });
    this.request.requestInStream(this.root + path, {
      method: http.RequestMethod.GET,
      header: headers,
      readTimeout: 0,
      connectTimeout: 15000,
    }).catch((err: Error) => {
      if (!this.stopped) {
        onError(err.message);
      }
    });
  }

  private refreshRoot(): void {
    const override: string | undefined = AppStorage.get<string>('nxBaseUrl');
    this.root = (override !== undefined && override.trim().length > 0 ? override.trim() : NxEnv.baseUrl()).replace(/\/+$/, '');
  }

  private drain(onRow: (row: RunlogRow) => void): void {
    while (true) {
      const index = this.buffer.indexOf('\n\n');
      if (index < 0) {
        return;
      }
      const frame = this.buffer.slice(0, index);
      this.buffer = this.buffer.slice(index + 2);
      const lines = frame.split('\n');
      let dataLine = '';
      let idLine = '';
      for (const line of lines) {
        if (line.startsWith('data: ')) {
          dataLine = line.slice(6);
        } else if (line.startsWith('id: ')) {
          idLine = line.slice(4);
        }
      }
      if (dataLine.length === 0 || dataLine === '{}') {
        continue;
      }
      try {
        const parsed = JSON.parse(dataLine) as Record<string, Object>;
        const seq = parsed.seq !== undefined ? Number(parsed.seq) : Number(idLine);
        onRow({
          seq: isNaN(seq) ? 0 : seq,
          event: String(parsed.event !== undefined ? parsed.event : 'runlog'),
          title: String(parsed.title !== undefined ? parsed.title : ''),
          payload: parsed.payload !== undefined ? parsed.payload as Record<string, string> : {},
        });
      } catch (err) {
        // 非法帧忽略，不影响流
      }
    }
  }

  stop(): void {
    this.stopped = true;
    if (this.request !== null) {
      try {
        this.request.off('dataReceive');
        this.request.destroy();
      } catch (err) {
        // 已销毁则忽略
      }
      this.request = null;
    }
  }
}
