/**
 * ModelStore - 模型选择状态
 *
 * 管理当前选中模型、模型目录、供应商目录。
 */
import { ReactiveStore } from './ReactiveStore.js';

export class ModelStore extends ReactiveStore {

    constructor() {
        super({
            // 当前选中的模型 ID
            selectedId: '',

            // 可用模型列表（服务端返回）
            catalog: [],

            // 供应商配置表 { [providerKey]: providerConfig }
            providerCatalogByKey: {},

            // 模型元数据缓存 Map<modelId, meta>
            metaById: new Map(),

            // 模型配置同步状态 {version, inFlight, pending}
            configSyncState: {
                version: '',
                inFlight: false,
                pending: false
            }
        });
    }

    get selectedId() {
        return this.get('selectedId');
    }

    set selectedId(value) {
        this.set('selectedId', value);
    }

    get catalog() {
        return this.get('catalog');
    }

    set catalog(value) {
        this.set('catalog', value);
    }

    /**
     * 根据模型 ID 查找模型配置
     */
    findById(modelId) {
        const catalog = this.get('catalog');

        for (let i = 0; i < catalog.length; i++) {
            if (catalog[i].id === modelId) {
                return catalog[i];
            }
        }

        return null;
    }

    /**
     * 获取当前选中模型的配置对象
     */
    getSelectedModel() {
        return this.findById(this.get('selectedId'));
    }
}
