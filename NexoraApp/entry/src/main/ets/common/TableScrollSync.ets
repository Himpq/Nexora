// TableScrollSync.ets - 同一块（表格 / 代码块）各分片之间的横向滚动同步
//
// 表格按数据行、代码块按源码行切成多片渲染后（见 ChatItemBuilder.pushTableSlices /
// pushCodeSlices），每一片都是独立的列表行，各自带一个横向 Scroll。用户横拖时手指
// 只落在其中一片上，若不共享偏移，其余片会停在原处 —— 一块被切成几截、列错位。
//
// 这里让同一块的所有分片共用一个横向偏移量：任意一片真实滚动时把偏移广播给其余片，
// 而程序性滚动（由本类发起的 scrollTo）产生的回调被忽略，避免来回互相触发。

// 注册上限：键按「会话内块数」增长（表格 + 代码块），长会话下 64 会被逐出，
// 逐出后该块各片拿到新实例，横向偏移会归零。上限放宽到 512，实例本身极小
const MAX_SYNC_KEYS: number = 512;

export class TableScrollSync {
    // 按表身份注册：分片会被列表反复销毁重建，偏移量不能随行消失
    private static registry: Map<string, TableScrollSync> = new Map<string, TableScrollSync>();
    private static keys: string[] = [];

    private offset: number = 0;
    private scrollers: Scroller[] = [];
    // 正在被本类程序性滚动的滚动区：它们上报的回调要忽略，否则会与本类的广播互相触发
    private applying: Map<Scroller, boolean> = new Map<Scroller, boolean>();

    static forKey(key: string): TableScrollSync {
        const existing: TableScrollSync | undefined = TableScrollSync.registry.get(key);

        if (existing !== undefined) {
            return existing;
        }

        const created: TableScrollSync = new TableScrollSync();
        TableScrollSync.registry.set(key, created);
        TableScrollSync.keys.push(key);

        if (TableScrollSync.keys.length > MAX_SYNC_KEYS) {
            const oldest: string | undefined = TableScrollSync.keys.shift();

            if (oldest !== undefined) {
                TableScrollSync.registry.delete(oldest);
            }
        }

        return created;
    }

    // 新出现的分片对齐到共享偏移：不做这一步，新片会停在最左侧，与其余片错位
    align(scroller: Scroller): void {
        this.register(scroller);

        if (this.offset > 0) {
            this.applying.set(scroller, true);
            scroller.scrollTo({ xOffset: this.offset, yOffset: 0, animation: false });
        }
    }

    unregister(scroller: Scroller): void {
        const position: number = this.scrollers.indexOf(scroller);

        if (position >= 0) {
            this.scrollers.splice(position, 1);
        }

        this.applying.delete(scroller);
    }

    // 某一片上报滚动：正在被同步的忽略，否则把它作为新的共享偏移广播给其余片
    onRowScroll(scroller: Scroller, xOffset: number): void {
        if (this.applying.get(scroller) === true) {
            this.applying.set(scroller, false);
            return;
        }

        this.offset = xOffset;
        // 新一轮真实滚动：先清掉上一轮可能残留的标记（未产生回调的 scrollTo 会留下标记）
        this.applying.clear();

        for (let i: number = 0; i < this.scrollers.length; i++) {
            const other: Scroller = this.scrollers[i];

            if (other === scroller) {
                continue;
            }

            this.applying.set(other, true);
            other.scrollTo({ xOffset: xOffset, yOffset: 0, animation: false });
        }
    }

    private register(scroller: Scroller): void {
        if (this.scrollers.indexOf(scroller) < 0) {
            this.scrollers.push(scroller);
        }
    }
}
