/** 百度 SDK 的异步版权请求不能由 Map.destroy 取消,每张地图单独持有浏览器上下文。 */
export class NexoraMapFrame {
    constructor(canvas, onContextReload) {
        this.canvas = canvas;
        this.onContextReload = onContextReload;
        this.document = null;
        this.element = document.createElement('iframe');
        this.element.title = '交互地图';
        this.element.className = 'nexora-map-frame';
        this.reportError = (event) => console.error('[NexoraMapFrame] SDK async error', JSON.stringify({
            canvasId: this.canvas.id,
            message: event.message,
            line: event.lineno,
            column: event.colno
        }));
        this.handleContextReload = () => {
            const currentDocument = this.element.contentDocument;

            if (!currentDocument || !this.document || currentDocument === this.document) {
                return;
            }

            this.document = currentDocument;
            console.warn('[NexoraMapFrame] Context reloaded', JSON.stringify({
                canvasId: this.canvas.id,
                connected: this.element.isConnected
            }));
            this.onContextReload?.();
        };
    }

    /** 等待同源页面就绪后提供 SDK 的 document/window,取消建图则立即卸载。 */
    open(signal) {
        return new Promise((resolve, reject) => {
            const cleanup = () => {
                this.element.removeEventListener('load', loaded);
                this.element.removeEventListener('error', failed);
                signal.removeEventListener('abort', aborted);
            };
            const failed = () => {
                cleanup();
                reject(new Error('地图独立页面加载失败'));
            };
            const aborted = () => {
                cleanup();
                this.destroy();
                reject(new DOMException('地图建图已取消', 'AbortError'));
            };
            const loaded = () => {
                cleanup();
                const host = this.element.contentWindow;
                const frameDocument = this.element.contentDocument;
                const canvas = frameDocument?.getElementById('map-root');

                if (!host || !canvas) {
                    reject(new Error('地图独立页面缺少 SDK 容器'));

                    return;
                }

                // Each map owns its iframe, so keep the stable id required by the frame's height rule.
                const bounds = canvas.getBoundingClientRect();
                this.host = host;
                this.document = frameDocument;
                host.addEventListener('error', this.reportError);
                this.element.addEventListener('load', this.handleContextReload);
                console.info('[NexoraMapFrame] Context ready', JSON.stringify({
                    canvasId: this.canvas.id,
                    width: bounds.width,
                    height: bounds.height
                }));
                resolve({ host, canvas });
            };

            if (signal.aborted) {
                aborted();

                return;
            }

            this.element.addEventListener('load', loaded);
            this.element.addEventListener('error', failed);
            signal.addEventListener('abort', aborted, { once: true });
            this.element.src = `${import.meta.env.BASE_URL}nexora_map_frame.html`;
            this.canvas.append(this.element);
        });
    }

    /** 卸载整个上下文,不执行会留下迟到 JSONP 回调的 Map.destroy。 */
    destroy() {
        this.host?.removeEventListener('error', this.reportError);
        this.element.removeEventListener('load', this.handleContextReload);
        this.element.remove();
    }
}
