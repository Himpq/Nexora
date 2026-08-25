/**
 * ReactiveStore - 极简响应式状态基类
 *
 * 提供 get/set + 发布订阅能力。
 * 子类继承后声明自己管理的状态字段，外部通过 subscribe 监听变更。
 *
 * 用法:
 *   const store = new ReactiveStore({ count: 0 });
 *   store.subscribe('count', (val, old) => console.log(val));
 *   store.set('count', 1);
 */
export class ReactiveStore {

    constructor(initialState = {}) {
        this._state = { ...initialState };
        this._listeners = new Map();
    }

    /**
     * 读取单个字段
     */
    get(key) {
        return this._state[key];
    }

    /**
     * 读取全部状态的浅拷贝（调试用）
     */
    snapshot() {
        return { ...this._state };
    }

    /**
     * 写入单个字段并通知订阅者
     * 值未变化时不触发通知
     */
    set(key, value) {
        const old = this._state[key];

        if (old === value) {
            return;
        }

        this._state[key] = value;
        this._notify(key, value, old);
    }

    /**
     * 批量写入多个字段，逐字段触发通知
     * 适用于一次性更新多个关联状态
     */
    patch(partial) {
        const keys = Object.keys(partial);

        for (let i = 0; i < keys.length; i++) {
            this.set(keys[i], partial[keys[i]]);
        }
    }

    /**
     * 订阅某个字段的变更
     * 返回取消订阅函数
     */
    subscribe(key, callback) {
        if (!this._listeners.has(key)) {
            this._listeners.set(key, new Set());
        }

        this._listeners.get(key).add(callback);

        return () => {
            const set = this._listeners.get(key);

            if (set) {
                set.delete(callback);
            }
        };
    }

    /**
     * 订阅多个字段，任一变更时触发
     * 返回取消订阅函数
     */
    subscribeMany(keys, callback) {
        const unsubs = keys.map((key) => this.subscribe(key, callback));

        return () => {
            for (let i = 0; i < unsubs.length; i++) {
                unsubs[i]();
            }
        };
    }

    /**
     * 触发指定字段的监听器
     */
    _notify(key, value, old) {
        const set = this._listeners.get(key);

        if (!set) {
            return;
        }

        set.forEach((callback) => callback(value, old, key));
    }
}
