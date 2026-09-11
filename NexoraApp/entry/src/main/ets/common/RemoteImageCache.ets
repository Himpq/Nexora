// RemoteImageCache.ets - 需登录图片的本地缓存
// 附件下载接口 /api/files/download 要求登录态：ArkUI Image 组件直接加载网络 URL
// 不会携带会话 Cookie，必然 401。统一经 HttpUtil(自动带 Cookie、跳过自签证书) 下载
// 二进制并落本地缓存，再由 Image 以 file:// 加载；同一 URL 的并发请求合并为一次下载

import common from '@ohos.app.ability.common';
import fs from '@ohos.file.fs';
import { hilog } from '@kit.PerformanceAnalysisKit';
import { HttpUtil } from './HttpUtil';

const DOMAIN: number = 0x0001;
const TAG: string = 'NexoraImageCache';

// 缓存目录名（位于应用 cacheDir 下，系统可随时回收，不做持久化保证）
const CACHE_DIR_NAME: string = 'attachments';

export class RemoteImageCache {
    static readonly shared: RemoteImageCache = new RemoteImageCache();

    private context: common.UIAbilityContext | null = null;
    // url → 本地 file:// 路径（已下载完成的）
    private resolved: Map<string, string> = new Map<string, string>();
    // url → 进行中的下载 Promise（并发去重）
    private inflight: Map<string, Promise<string>> = new Map<string, Promise<string>>();

    // 宿主启动时注入 UIAbilityContext（AppState.restore 调用）
    attach(context: common.UIAbilityContext): void {
        this.context = context;
    }

    // 把服务端下载路径解析为本地可加载路径：命中缓存直接返回，否则下载后落缓存。
    // 失败返回空串，由调用方展示失败占位
    async resolve(source: string): Promise<string> {
        const url: string = this.toAbsoluteUrl(source);

        if (url.length === 0 || this.context === null) {
            return '';
        }

        const cached: string | undefined = this.resolved.get(url);

        if (cached !== undefined) {
            return cached;
        }

        const running: Promise<string> | undefined = this.inflight.get(url);

        if (running !== undefined) {
            return running;
        }

        const task: Promise<string> = this.download(url);
        this.inflight.set(url, task);

        try {
            const local: string = await task;

            if (local.length > 0) {
                this.resolved.set(url, local);
            }

            return local;
        } finally {
            this.inflight.delete(url);
        }
    }

    // 相对路径补齐后端地址；绝对 URL 原样使用
    private toAbsoluteUrl(source: string): string {
        const raw: string = source.trim();

        if (raw.length === 0) {
            return '';
        }

        if (raw.startsWith('http://') || raw.startsWith('https://')) {
            return raw;
        }

        const base: string = HttpUtil.getBackendUrl();

        if (base.length === 0) {
            return '';
        }

        return raw.startsWith('/') ? base + raw : base + '/' + raw;
    }

    private async download(url: string): Promise<string> {
        const buffer: ArrayBuffer | null = await HttpUtil.downloadBinary(url);

        if (buffer === null || buffer.byteLength === 0) {
            hilog.warn(DOMAIN, TAG, 'download empty url=%{public}s', url);
            return '';
        }

        try {
            const dir: string = (this.context as common.UIAbilityContext).cacheDir + '/' + CACHE_DIR_NAME;

            if (!fs.accessSync(dir)) {
                fs.mkdirSync(dir);
            }

            const filePath: string = dir + '/' + RemoteImageCache.hashKey(url) + RemoteImageCache.extensionOf(url);
            const file: fs.File = fs.openSync(filePath, fs.OpenMode.CREATE | fs.OpenMode.WRITE_ONLY | fs.OpenMode.TRUNC);
            fs.writeSync(file.fd, buffer);
            fs.closeSync(file);

            return 'file://' + filePath;
        } catch (err) {
            hilog.error(DOMAIN, TAG, 'write cache failed: %{public}s', JSON.stringify(err));
            return '';
        }
    }

    // 下载地址的文件扩展名（file_ref 在查询串里，取解码后的首个图片扩展名；未知按 .img）
    private static extensionOf(url: string): string {
        let decoded: string = url;

        try {
            decoded = decodeURIComponent(url).toLowerCase();
        } catch (err) {
            decoded = url.toLowerCase();
        }

        const extensions: string[] = ['.jpeg', '.jpg', '.png', '.gif', '.webp', '.bmp', '.svg'];

        for (let i: number = 0; i < extensions.length; i++) {
            if (decoded.indexOf(extensions[i]) >= 0) {
                return extensions[i];
            }
        }

        return '.img';
    }

    // 简单字符串哈希（djb2）：缓存文件名稳定且不暴露原始路径
    private static hashKey(url: string): string {
        let hash: number = 5381;

        for (let i: number = 0; i < url.length; i++) {
            hash = ((hash << 5) + hash + url.charCodeAt(i)) >>> 0;
        }

        return hash.toString(36);
    }
}
