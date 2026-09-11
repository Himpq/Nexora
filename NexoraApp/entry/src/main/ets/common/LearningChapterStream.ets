// LearningChapterStream.ets - 个性化章节素材的生成流（SSE）
// 后端 generate-chapter-stream 是 GET + text/event-stream，帧格式固定为 event/data 两行：
//   delta  {content}  增量正文（可多次到达）
//   status {message}  阶段说明
//   done   {content}  生成完成，后端此时已把 Markdown 落盘
//   error  {error}    失败原因
//   close  {}         流结束
// 一章素材要跑一次长文模型（后端 request_timeout 为 300s），期间只有 delta 到达，
// 所以 readTimeout 必须放宽到分钟级，且正文必须边到边显——等整包等于页面卡死几分钟。

import http from '@ohos.net.http';
import util from '@ohos.util';
import { BusinessError } from '@kit.BasicServicesKit';
import { hilog } from '@kit.PerformanceAnalysisKit';
import { Json } from './JsonUtil';
import { LearningHttp } from './LearningHttp';

const DOMAIN: number = 0x0001;
const TAG: string = 'NexoraChapterStream';

const CONNECT_TIMEOUT: number = 15000;
const READ_TIMEOUT: number = 300000;

// 生成过程回调：正文增量、阶段说明、终结（成功与否由 success 表达）
export interface ChapterStreamListener {
    onDelta: (text: string) => void;
    onStatus: (message: string) => void;
    onFinished: (success: boolean, message: string) => void;
}

export class LearningChapterStream {
    static readonly shared: LearningChapterStream = new LearningChapterStream();

    private request: http.HttpRequest | null = null;
    private finished: boolean = false;
    private buffer: string = '';

    async generate(lectureId: string, chapterIndex: number, listener: ChapterStreamListener): Promise<void> {
        if (this.request !== null) {
            return;
        }

        const path: string = '/api/frontend/personalized-learning/generate-chapter-stream'
            + '?lecture_id=' + encodeURIComponent(lectureId)
            + '&chapter_index=' + chapterIndex;
        const url: string = LearningHttp.absolute(path);
        const decoder: util.TextDecoder = util.TextDecoder.create('utf-8', { ignoreBOM: true });

        // 地址必须落日志：流式请求绕不开原生 http，一旦服务根取到相对地址，
        // 客户端只会拿到 curl 的 2300003(URL 非法)，没有地址无从定位
        hilog.info(DOMAIN, TAG, 'chapter stream url=%{public}s', url);

        this.finished = false;
        this.buffer = '';

        await new Promise<void>((resolve: () => void) => {
            const request: http.HttpRequest = http.createHttp();

            this.request = request;

            request.on('dataReceive', (data: ArrayBuffer) => {
                if (this.finished) {
                    return;
                }

                // stream:true —— 跨分块保留不完整的多字节序列，中文不会被截断
                this.buffer = this.buffer + decoder.decodeToString(new Uint8Array(data), { stream: true });
                this.drain(listener);
            });

            request.on('dataEnd', () => {
                this.settle(listener, '生成流意外中断');
                resolve();
            });

            request.requestInStream(url, {
                method: http.RequestMethod.GET,
                header: LearningHttp.authHeaders(),
                usingCache: false,
                connectTimeout: CONNECT_TIMEOUT,
                readTimeout: READ_TIMEOUT,
                remoteValidation: 'skip'
            }, (err: BusinessError, code: number) => {
                request.off('dataReceive');
                request.off('dataEnd');
                request.destroy();
                this.request = null;

                if (err !== undefined && err !== null && err.code !== 0) {
                    hilog.warn(DOMAIN, TAG, 'stream closed with error %{public}d', err.code);
                    this.settle(listener, '生成连接中断(' + err.code + ')');
                }

                resolve();
            });
        });
    }

    // 取消：仅断开本地连接。后端生成任务独立于连接存活，重新进入本页可直接读到已生成的内容
    cancel(): void {
        this.finished = true;

        if (this.request !== null) {
            this.request.destroy();
            this.request = null;
        }
    }

    // 终结一次：只有第一个到达的终结信号生效，避免 dataEnd 与回调重复上报
    private settle(listener: ChapterStreamListener, message: string): void {
        if (this.finished) {
            return;
        }

        this.finished = true;
        listener.onFinished(false, message);
    }

    private drain(listener: ChapterStreamListener): void {
        let boundary: number = this.buffer.indexOf('\n\n');

        while (boundary >= 0) {
            const frame: string = this.buffer.substring(0, boundary);

            this.buffer = this.buffer.substring(boundary + 2);
            this.handleFrame(frame, listener);
            boundary = this.buffer.indexOf('\n\n');
        }
    }

    private handleFrame(frame: string, listener: ChapterStreamListener): void {
        const lines: string[] = frame.split('\n');
        let name: string = '';
        let data: string = '';

        for (let i: number = 0; i < lines.length; i++) {
            const line: string = lines[i];

            if (line.startsWith('event:')) {
                name = line.substring(6).trim();
            } else if (line.startsWith('data:')) {
                data = data + line.substring(5).trim();
            }
        }

        if (name.length === 0) {
            return;
        }

        const payload: Record<string, Object> | null = Json.parseObject(data);

        if (name === 'delta') {
            listener.onDelta(payload === null ? '' : Json.string(payload, 'content'));
            return;
        }

        if (name === 'status') {
            listener.onStatus(payload === null ? '' : Json.string(payload, 'message'));
            return;
        }

        // 完成与失败都要立刻终结：done 之后后端只再补一帧 close
        if (name === 'done') {
            this.finished = true;
            listener.onFinished(true, '');
            return;
        }

        if (name === 'error') {
            this.finished = true;
            listener.onFinished(false, payload === null ? '生成失败' : Json.string(payload, 'error'));
        }
    }
}
