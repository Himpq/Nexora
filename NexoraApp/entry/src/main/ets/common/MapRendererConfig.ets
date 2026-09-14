// MapRendererConfig.ets - 地图渲染器 provider 配置缓存
// GET /api/map/provider 每次进程只拉一次，MapCard 注入 Web 渲染器时复用

import { hilog } from '@kit.PerformanceAnalysisKit';
import { ApiService } from './ApiService';

const DOMAIN: number = 0x0001;
const TAG: string = 'NexoraMapConfig';

// 注入给 Web 渲染器的配置形态（字段名与 Web NEXORA_MAP_RENDERER_CONFIG 一致）
interface MapRendererConfigPayload {
    provider: string;
    baiduMapAk: string;
    baiduMapVersion: string;
    tiandituMapTk: string;
    tiandituMapVersion: string;
}

export class MapRendererConfig {
    private static cachedJson: string = '';
    private static pending: Promise<string> | null = null;

    static cached(): string {
        return MapRendererConfig.cachedJson;
    }

    // 按需拉取；并发调用共享同一个请求，失败返回空串且不缓存
    static async ensure(): Promise<string> {
        if (MapRendererConfig.cachedJson.length > 0) {
            return MapRendererConfig.cachedJson;
        }

        if (MapRendererConfig.pending !== null) {
            return MapRendererConfig.pending;
        }

        MapRendererConfig.pending = MapRendererConfig.fetchConfig();

        try {
            return await MapRendererConfig.pending;
        } finally {
            MapRendererConfig.pending = null;
        }
    }

    private static async fetchConfig(): Promise<string> {
        const result = await ApiService.fetchMapRendererConfig();

        if (!result.success) {
            hilog.warn(DOMAIN, TAG, 'map renderer config unavailable: %{public}s', result.message);
            return '';
        }

        const payload: MapRendererConfigPayload = {
            provider: result.provider,
            baiduMapAk: result.baiduMapAk,
            baiduMapVersion: result.baiduMapVersion,
            tiandituMapTk: result.tiandituMapTk,
            tiandituMapVersion: result.tiandituMapVersion
        };

        MapRendererConfig.cachedJson = JSON.stringify(payload);
        hilog.info(DOMAIN, TAG, 'map renderer config ready provider=%{public}s', result.provider);

        return MapRendererConfig.cachedJson;
    }
}
