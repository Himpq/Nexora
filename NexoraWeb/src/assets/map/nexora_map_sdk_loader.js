/** 所有地图共用 SDK 的加载承诺,命名空间出现不能代表构造函数已准备好。 */
class NexoraMapSdkLoader {
    constructor(provider, namespace, describe, scriptUrl, usesCallback) {
        this.provider = provider;
        this.namespace = namespace;
        this.describe = describe;
        this.scriptUrl = scriptUrl;
        this.usesCallback = usesCallback;
        this.pending = null;
    }

    validate(sdk, stage) {
        const constructors = this.describe(sdk);
        const missing = Object.entries(constructors).filter(([, type]) => type !== 'function');

        if (missing.length > 0) {
            const details = missing.map(([name, type]) => `${name}=${type}`).join(', ');
            console.error('[NexoraMapSdkLoader] SDK not ready', { provider: this.provider, stage, constructors });
            throw new Error(`${this.namespace} 地图 SDK 尚未就绪 (${details})`);
        }

        return sdk;
    }

    /** 正在加载的地图必须先等待同一回调,禁止复用 SDK 引导阶段的空命名空间。 */
    load(config) {

        if (this.pending) {
            return this.pending;
        }

        if (window[this.namespace]) {
            return Promise.resolve(this.validate(window[this.namespace], 'existing'));
        }

        const callback = `__nexoraMapSdk_${this.provider}_${Date.now()}`;
        const url = this.scriptUrl(config, callback);
        this.pending = new Promise((resolve, reject) => {
            const script = document.createElement('script');
            const complete = () => {
                delete window[callback];

                try {
                    const sdk = this.validate(window[this.namespace], 'loaded');
                    console.info('[NexoraMapSdkLoader] SDK ready', { provider: this.provider, constructors: this.describe(sdk) });
                    resolve(sdk);
                } catch (error) {
                    reject(error);
                }
            };

            if (this.usesCallback) {
                window[callback] = complete;
            } else {
                script.onload = complete;
            }

            script.onerror = () => {
                delete window[callback];
                console.error('[NexoraMapSdkLoader] Script load failed', { provider: this.provider });
                reject(new Error(`${this.namespace} 地图 SDK 脚本加载失败`));
            };
            script.src = url;
            script.async = true;
            console.info('[NexoraMapSdkLoader] Loading SDK', { provider: this.provider });
            document.head.appendChild(script);
        });

        return this.pending;
    }
}

const baiduLoader = new NexoraMapSdkLoader(
    'baidu',
    'BMapGL',
    (sdk) => ({ Map: typeof sdk?.Map, Point: typeof sdk?.Point, ScaleControl: typeof sdk?.ScaleControl, ZoomControl: typeof sdk?.ZoomControl }),
    (config, callback) => {
        const ak = String(config.baiduMapAk || '').trim();

        if (!ak) {
            throw new Error('NEXORA_MAP_RENDERER_CONFIG.baiduMapAk 未配置');
        }

        const version = String(config.baiduMapVersion || '1.0').trim();
        return `https://api.map.baidu.com/api?type=webgl&v=${encodeURIComponent(version)}&ak=${encodeURIComponent(ak)}&callback=${encodeURIComponent(callback)}`;
    },
    true,
);

const tiandituLoader = new NexoraMapSdkLoader(
    'tianditu',
    'T',
    (sdk) => ({ Map: typeof sdk?.Map, LngLat: typeof sdk?.LngLat, Zoom: typeof sdk?.Control?.Zoom, Scale: typeof sdk?.Control?.Scale }),
    (config) => {
        const tk = String(config.tiandituMapTk || '').trim();

        if (!tk) {
            throw new Error('NEXORA_MAP_RENDERER_CONFIG.tiandituMapTk 未配置');
        }

        const version = String(config.tiandituMapVersion || '4.0').trim();
        return `https://api.tianditu.gov.cn/api?v=${encodeURIComponent(version)}&tk=${encodeURIComponent(tk)}`;
    },
    false,
);

export function loadBaiduMapGl(config) {
    return baiduLoader.load(config);
}

export function loadTiandituMap(config) {
    return tiandituLoader.load(config);
}
