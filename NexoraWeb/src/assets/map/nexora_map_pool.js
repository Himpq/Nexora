import { TOOL_STAGE_OPEN_EVENT, TOOL_STAGE_RESIZE_EVENT } from '@/ui/toolStage'

/**
 * 地图实例内存预算。
 *
 * 每张 SDK 地图各自持有一个 WebGL 上下文、图层与瓦片缓存:聊天里已加载的地图卡片
 * 一旦全部建图,内存随卡片数线性上涨(实测 5~6 张从 400MB 涨到 1.8GB),而视口里
 * 同时最多只能看清一张。
 *
 * 本类只回答一个问题:此刻哪些卡片应该持有真实地图实例。
 *   - 卡片进入视口附近才建图,离开实际视口后短暂保留,快速滚回时复用现有实例;
 *   - 同一时刻最多保留 maxLive 张,当前可见地图优先,空余名额留给最近离屏地图,
 *     最后才预热尚未显示的地图。
 *
 * build/destroy 由渲染器注入,本类不接触任何 SDK;build 自行处理渲染失败并返回 null,
 * 不向外抛错。
 */
export class NexoraMapPool {
    constructor({ maxLive, enterMargin, build, destroy, idleRetentionMs = 60000 }) {
        this.maxLive = maxLive;
        this.enterMargin = enterMargin;
        this.build = build;
        this.destroy = destroy;
        this.idleRetentionMs = idleRetentionMs;
        this.entries = new Map();
        this.building = new Set();
        this.focusCandidates = new Set();
        this.frame = 0;
        this.retentionTimer = 0;
        this.retentionTimerDeadline = 0;
        this.scheduleBudget = this.scheduleBudget.bind(this);
        this.handleToolStageOpen = this.handleToolStageOpen.bind(this);
        this.handleToolStageResize = this.handleToolStageResize.bind(this);
        this.observer = new IntersectionObserver((observed) => this.handleVisibility(observed), {
            rootMargin: enterMargin,
            threshold: 0
        });
        this.sizeObserver = new ResizeObserver(this.scheduleBudget);
        // 滚动容器里的 scroll 不冒泡,必须在捕获阶段监听。
        window.addEventListener('scroll', this.scheduleBudget, { capture: true, passive: true });
        window.addEventListener('resize', this.scheduleBudget, { passive: true });
        window.addEventListener(TOOL_STAGE_OPEN_EVENT, this.handleToolStageOpen);
        window.addEventListener(TOOL_STAGE_RESIZE_EVENT, this.handleToolStageResize);
    }

    /**
     * 卡片进入页面。entry 由渲染器提供 { element, ...渲染上下文 },
     * 池只读写 element 和自己持有的实例状态。
     */
    attach(entry) {
        this.entries.set(entry.element, {
            ...entry,
            near: false,
            visible: false,
            retainUntil: 0,
            lastUsedAt: 0,
            wanted: false,
            attempted: false,
            pending: false,
            controller: null,
            live: null,
            revision: 0
        });
        this.observer.observe(entry.element);
        this.sizeObserver.observe(entry.element);
    }

    /** 卡片离开页面:解除观察并销毁实例,不留下任何 SDK 引用。 */
    detach(element) {
        const entry = this.entries.get(element);

        if (!entry) {
            return;
        }

        this.observer.unobserve(element);
        this.sizeObserver.unobserve(element);
        this.entries.delete(element);
        this.focusCandidates.delete(element);
        entry.wanted = false;
        this.release(entry);
        this.scheduleBudget();
    }

    /** 切换会话或重渲染会直接移除卡片,必须同步释放已经建好的地图。 */
    detachDisconnected() {
        [...this.entries.keys()].forEach((element) => {

            if (!element.isConnected) {
                this.detach(element);
            }
        });
    }

    handleVisibility(observed) {
        observed.forEach((item) => {
            const entry = this.entries.get(item.target);

            if (entry) {
                if (item.isIntersecting) {

                    if (!entry.near) {
                        entry.lastUsedAt = Date.now();
                        entry.retainUntil = 0;
                    }

                    entry.near = true;
                } else if (entry.near) {
                    entry.near = false;

                    if (entry.live || entry.pending) {
                        entry.retainUntil = Date.now() + this.idleRetentionMs;
                        console.info('[NexoraMapPool] Retaining outside preload margin', JSON.stringify({
                            canvasId: entry.parts.canvas.id,
                            visible: entry.visible,
                            retentionMs: this.idleRetentionMs
                        }));
                    }
                }
            }
        });

        this.applyBudget();
    }

    /** 地图卡片被移动进舞台前先锁住预算名额,避免过渡帧把实例提前释放。 */
    handleToolStageOpen(event) {
        const element = event.detail?.element;

        if (!element || !this.entries.has(element)) {
            return;
        }

        this.focusCandidates.add(element);
        const entry = this.entries.get(element);
        entry.lastUsedAt = Date.now();
        entry.retainUntil = 0;
        this.scheduleBudget();
    }

    /** 舞台完成移动或恢复后更新保护状态,关闭舞台时恢复普通可见性预算。 */
    handleToolStageResize(event) {
        const element = event.target;

        if (!(element instanceof HTMLElement) || !this.entries.has(element)) {
            return;
        }

        const entry = this.entries.get(element);

        if (element.closest('.tool-stage-focus__surface')) {
            this.focusCandidates.add(element);
            entry.lastUsedAt = Date.now();
            entry.retainUntil = 0;
        } else {
            this.focusCandidates.delete(element);

            if (!entry.visible && (entry.live || entry.pending)) {
                entry.retainUntil = Date.now() + this.idleRetentionMs;
            }
        }

        this.scheduleBudget();
    }

    /** 一帧只重排一次,滚动不跨过相交边界时也要更新正在看的卡片。 */
    scheduleBudget() {
        if (this.frame) {
            return;
        }

        this.frame = window.requestAnimationFrame(() => {
            this.frame = 0;
            this.applyBudget();
        });
    }

    isInFocusedStage(entry) {
        return this.focusCandidates.has(entry.element)
            || Boolean(entry.element.closest('.tool-stage-focus__surface'));
    }

    /** 舞台移动导致百度 iframe 文档重载时,销毁过期实例并按新尺寸重建。 */
    rebuildAfterFrameReload(entry) {
        if (this.entries.get(entry.element) !== entry || !entry.live) {
            return;
        }

        console.info('[NexoraMapPool] Rebuilding after frame reload', JSON.stringify({
            canvasId: entry.parts.canvas.id,
            focused: this.isInFocusedStage(entry),
            maxLive: this.maxLive
        }));
        this.release(entry);
        this.scheduleBudget();
    }

    /** 焦点与当前可见地图优先;其余名额先留给刚离屏的地图,再预热邻近地图。 */
    applyBudget() {
        const now = Date.now();
        const ranked = [...this.entries.values()]
            .filter((entry) => entry.element.isConnected)
            .map((entry) => {
                const focused = this.isInFocusedStage(entry);
                const viewport = readViewportMetrics(entry.element);

                if (viewport.visible) {

                    if (!entry.visible) {
                        entry.lastUsedAt = now;
                    }

                    entry.retainUntil = 0;
                } else if (entry.visible && (entry.live || entry.pending)) {
                    entry.retainUntil = now + this.idleRetentionMs;
                }

                entry.visible = viewport.visible;
                const retained = !viewport.visible && !focused && entry.retainUntil > now
                    && (entry.live || entry.pending);

                return {
                    entry,
                    focused,
                    visible: viewport.visible,
                    visibilityRatio: viewport.visibilityRatio,
                    retained,
                    near: entry.near,
                    lastUsedAt: entry.lastUsedAt,
                    distance: viewport.distance
                };
            })
            // 放大视图会移动原地图卡片,焦点舞台中的地图仍是用户正在查看的地图。
            .filter((item) => item.focused || item.visible || item.near || item.retained)
            .sort((left, right) => {
                const focusPriority = Number(right.focused) - Number(left.focused);

                if (focusPriority !== 0) {
                    return focusPriority;
                }

                const visibilityPriority = Number(right.visible) - Number(left.visible);

                if (visibilityPriority !== 0) {
                    return visibilityPriority;
                }

                if (left.visible && right.visible) {
                    const areaPriority = right.visibilityRatio - left.visibilityRatio;

                    if (areaPriority !== 0) {
                        return areaPriority;
                    }
                }

                const retentionPriority = Number(right.retained) - Number(left.retained);

                if (retentionPriority !== 0) {
                    return retentionPriority;
                }

                if (left.retained && right.retained) {
                    return right.lastUsedAt - left.lastUsedAt;
                }

                return left.distance - right.distance;
            });
        const kept = new Set(ranked.slice(0, this.maxLive).map((item) => item.entry));

        // 先释放旧实例再分配槽位;尚未结束的建图也占预算,包括已经移除的卡片。
        this.entries.forEach((entry) => {
            entry.wanted = kept.has(entry);

            if (!entry.wanted) {
                entry.retainUntil = 0;
                this.release(entry);
            }
        });
        let occupied = this.building.size + [...this.entries.values()].filter((entry) => entry.live).length;

        for (const { entry } of ranked) {

            if (kept.has(entry) && !entry.live && !entry.pending && !entry.attempted && occupied < this.maxLive) {
                occupied += 1;
                void this.acquire(entry);
            }

        }

        this.scheduleRetentionExpiry(now);
    }

    /** 到期时重新分配预算,让离屏地图在没有新滚动事件时也能释放。 */
    scheduleRetentionExpiry(now) {
        const nextExpiry = [...this.entries.values()]
            .filter((entry) => !entry.visible && !this.isInFocusedStage(entry)
                && entry.retainUntil > now && (entry.live || entry.pending) && entry.element.isConnected)
            .reduce((earliest, entry) => Math.min(earliest, entry.retainUntil), Infinity);

        if (!Number.isFinite(nextExpiry)) {

            if (this.retentionTimer) {
                window.clearTimeout(this.retentionTimer);
                this.retentionTimer = 0;
                this.retentionTimerDeadline = 0;
            }

            return;
        }

        if (this.retentionTimer && this.retentionTimerDeadline === nextExpiry) {
            return;
        }

        if (this.retentionTimer) {
            window.clearTimeout(this.retentionTimer);
        }

        this.retentionTimerDeadline = nextExpiry;
        this.retentionTimer = window.setTimeout(() => {
            this.retentionTimer = 0;
            this.retentionTimerDeadline = 0;
            this.scheduleBudget();
        }, Math.max(nextExpiry - Date.now(), 0));
    }

    /** 建图是异步的:期间卡片可能已被移出预算或移出页面,迟到的实例必须当场销毁。 */
    async acquire(entry) {
        if (entry.live || entry.pending || entry.attempted) {
            return;
        }

        entry.attempted = true;
        entry.pending = true;
        entry.controller = new AbortController();
        this.building.add(entry);
        const revision = ++entry.revision;
        const isCurrent = () => this.entries.get(entry.element) === entry
            && entry.element.isConnected && entry.wanted && entry.revision === revision;
        console.info('[NexoraMapPool] Build started', JSON.stringify({
            canvasId: entry.element.querySelector('.nexora-map-canvas')?.id,
            focused: this.isInFocusedStage(entry),
            pending: this.building.size,
            maxLive: this.maxLive
        }));

        try {
            const live = await this.build(entry, {
                isCurrent,
                signal: entry.controller.signal,
                onContextReload: () => this.rebuildAfterFrameReload(entry)
            });

            if (!isCurrent()) {
                this.destroy(live);

                return;
            }

            entry.live = live;
        } finally {
            // 旧任务清理完成之前保持 pending,同一画布不能同时建两张地图。
            entry.pending = false;
            entry.controller = null;
            this.building.delete(entry);
            this.scheduleBudget();
        }
    }

    /** 释放实例并复位尝试标记:卡片重新进入预算后会按原始 payload 重新建图。 */
    release(entry) {
        if (!entry.attempted && !entry.live) {
            return;
        }

        entry.revision += 1;
        entry.attempted = false;

        if (entry.pending) {
            console.info('[NexoraMapPool] Build cancelled', { pending: this.building.size, maxLive: this.maxLive });
        }

        entry.controller?.abort();

        if (entry.live) {
            this.destroy(entry.live);
            entry.live = null;
        }
    }
}

const CLIPPING_OVERFLOW_VALUES = new Set(['auto', 'scroll', 'hidden', 'clip', 'overlay']);

/** 按滚动容器裁剪后的可见面积排序,避免把滚出消息区域的卡片当成当前地图。 */
function readViewportMetrics(element) {
    const rect = element.getBoundingClientRect();
    let clipLeft = 0;
    let clipTop = 0;
    let clipRight = window.innerWidth;
    let clipBottom = window.innerHeight;

    for (let ancestor = element.parentElement; ancestor; ancestor = ancestor.parentElement) {
        const style = window.getComputedStyle(ancestor);
        const ancestorRect = ancestor.getBoundingClientRect();

        if (CLIPPING_OVERFLOW_VALUES.has(style.overflowX)) {
            clipLeft = Math.max(clipLeft, ancestorRect.left);
            clipRight = Math.min(clipRight, ancestorRect.right);
        }

        if (CLIPPING_OVERFLOW_VALUES.has(style.overflowY)) {
            clipTop = Math.max(clipTop, ancestorRect.top);
            clipBottom = Math.min(clipBottom, ancestorRect.bottom);
        }
    }

    const visibleWidth = Math.max(0, Math.min(rect.right, clipRight) - Math.max(rect.left, clipLeft));
    const visibleHeight = Math.max(0, Math.min(rect.bottom, clipBottom) - Math.max(rect.top, clipTop));
    const area = rect.width * rect.height;
    const visibilityRatio = area > 0 ? Math.min(1, visibleWidth * visibleHeight / area) : 0;
    // 至少四分之一的地图卡片实际落在滚动区域里,才算当前要优先保活的地图。
    const visible = visibilityRatio >= 0.25;
    const clipCenter = (clipTop + clipBottom) / 2;

    return {
        visible,
        visibilityRatio,
        distance: rect.height > 0
            ? Math.abs(rect.top + rect.height / 2 - clipCenter)
            : Infinity
    };
}
