// ChatItemDataSource.ets - 块级渲染单元的数据源
//
// 与旧的消息级数据源相比，唯一的差别是「一条消息 = 多个单元」，
// 因此流式增量可以只更新真正变化的那一块，而不必重建整条消息对应的行。
//
// 通知口径与消息级保持一致（SDK 要求 onDatasetChange 不得与其它通知接口混用）：
//   全量替换 = RELOAD、头部插入 = ADD@0、尾部追加 = ADD@len、单元数量变化 = ADD/DELETE。
// 单元内容变化只通知实际发生变化的行：ChatItemRow 用 @ObjectLink 绑定单元对象，
// 原地改字段后发 CHANGE，让 ArkUI 重跑这一行而不重建整个列表。

import { hilog } from '@kit.PerformanceAnalysisKit';
import { ChatMessage, MessageSegment } from './ChatTypes';
import { ChatItemBuilder } from './ChatItemBuilder';
import { ChatRenderItem } from './ChatRenderItem';

const DOMAIN: number = 0x0001;
const TAG: string = 'NexoraItems';

export class ChatItemDataSource implements IDataSource {
    private items: ChatRenderItem[] = [];
    private listeners: DataChangeListener[] = [];

    totalCount(): number {
        return this.items.length;
    }

    getData(index: number): ChatRenderItem {
        return this.items[index];
    }

    registerDataChangeListener(listener: DataChangeListener): void {
        if (this.listeners.indexOf(listener) < 0) {
            this.listeners.push(listener);
        }
    }

    unregisterDataChangeListener(listener: DataChangeListener): void {
        const position: number = this.listeners.indexOf(listener);

        if (position >= 0) {
            this.listeners.splice(position, 1);
        }
    }

    // 只读快照：供页面建立「单元索引 → 轮次 / 消息」的映射，不得改动返回的数组
    snapshot(): ChatRenderItem[] {
        return this.items;
    }

    // 全量替换：会话切换 / 首次载入 / 重答重建视图列表
    replaceAll(items: ChatRenderItem[]): void {
        ChatItemBuilder.clearAllCache();
        this.items = items;

        const operation: DataReloadOperation = { type: DataOperationType.RELOAD };
        this.notify([operation]);
        this.dumpSequence('replace');
    }

    // 头部插入历史消息的单元：maintainVisibleContentPosition 只对增量 ADD 生效
    prependItems(items: ChatRenderItem[]): void {
        if (items.length === 0) {
            return;
        }

        this.items = [...items, ...this.items];
        hilog.info(DOMAIN, TAG, '[dataset] prepend count=%{public}d total=%{public}d',
            items.length, this.items.length);

        const operation: DataAddOperation = {
            type: DataOperationType.ADD,
            index: 0,
            count: items.length
        };

        this.notify([operation]);
        this.dumpSequence('prepend');
    }

    // 尾部追加新消息的单元（发送消息 / 后台流补消息）
    appendItems(items: ChatRenderItem[]): void {
        if (items.length === 0) {
            return;
        }

        const startIndex: number = this.items.length;
        this.items = [...this.items, ...items];
        hilog.info(DOMAIN, TAG, '[dataset] append count=%{public}d at=%{public}d total=%{public}d',
            items.length, startIndex, this.items.length);

        const operation: DataAddOperation = {
            type: DataOperationType.ADD,
            index: startIndex,
            count: items.length
        };

        this.notify([operation]);
    }

    // 刷新一条消息的单元（流式增量 / 工具卡与选择题卡状态变化）。
    // 同类型单元原地写字段，并对实际发生变化的行发 CHANGE，
    // 语义类型变化时替换该位置的对象并发 CHANGE；数量变化时再补发 ADD / DELETE。
    // 例如 STREAMING_DOTS -> CONTENT_BLOCK 不能只改字段，否则 ArkUI 会继续持有旧的
    // 圆点子树，正文虽然已经进入数据源，界面却仍显示占位行。
    refreshMessage(message: ChatMessage): void {
        const startIndex: number = this.startIndexOf(message.uid);

        if (startIndex < 0) {
            return;
        }

        let oldCount: number = 0;

        while (startIndex + oldCount < this.items.length
            && this.items[startIndex + oldCount].message.uid === message.uid) {
            oldCount++;
        }

        const fresh: ChatRenderItem[] = ChatItemBuilder.build(message);
        const shared: number = Math.min(oldCount, fresh.length);
        const operations: DataOperation[] = [];
        let changedStart: number = -1;
        let changedCount: number = 0;

        const flushChangedRange = (): void => {
            if (changedCount === 0) {
                return;
            }

            for (let i: number = 0; i < changedCount; i++) {
                const change: DataChangeOperation = {
                    type: DataOperationType.CHANGE,
                    index: changedStart + i
                };
                operations.push(change);
            }
            changedStart = -1;
            changedCount = 0;
        };

        for (let i: number = 0; i < shared; i++) {
            const current: ChatRenderItem = this.items[startIndex + i];
            const next: ChatRenderItem = fresh[i];

            if (current.kind !== next.kind || current.key() !== next.key()) {
                this.items[startIndex + i] = next;

                if (changedStart < 0) {
                    changedStart = startIndex + i;
                    changedCount = 1;
                } else if (startIndex + i === changedStart + changedCount) {
                    changedCount++;
                } else {
                    flushChangedRange();
                    changedStart = startIndex + i;
                    changedCount = 1;
                }

                hilog.info(DOMAIN, TAG,
                    '[dataset] refresh-replace index=%{public}d old=%{public}s new=%{public}s',
                    startIndex + i, current.key(), next.key());
                continue;
            }

            const changed: boolean = ChatItemBuilder.copyInto(current, next);

            if (!changed) {
                flushChangedRange();
                continue;
            }

            if (changedStart < 0) {
                changedStart = startIndex + i;
                changedCount = 1;
            } else if (startIndex + i === changedStart + changedCount) {
                changedCount++;
            } else {
                flushChangedRange();
                changedStart = startIndex + i;
                changedCount = 1;
            }
        }

        flushChangedRange();

        if (fresh.length === oldCount) {
            if (operations.length > 0) {
                this.notify(operations);
            }

            return;
        }

        if (fresh.length > oldCount) {
            const added: ChatRenderItem[] = fresh.slice(oldCount);
            this.items.splice(startIndex + oldCount, 0, ...added);
            hilog.info(DOMAIN, TAG, '[dataset] refresh-add count=%{public}d at=%{public}d',
                added.length, startIndex + oldCount);

            const operation: DataAddOperation = {
                type: DataOperationType.ADD,
                index: startIndex + oldCount,
                count: added.length
            };

            operations.push(operation);
            this.notify(operations);
            return;
        }

        const removedCount: number = oldCount - fresh.length;
        this.items.splice(startIndex + fresh.length, removedCount);
        hilog.info(DOMAIN, TAG, '[dataset] refresh-delete count=%{public}d at=%{public}d',
            removedCount, startIndex + fresh.length);

        const operation: DataDeleteOperation = {
            type: DataOperationType.DELETE,
            index: startIndex + fresh.length,
            count: removedCount
        };

        operations.push(operation);
        this.notify(operations);
    }

    // 流结束后做一次终态重绑定：流式切片会经历 ADD / DELETE，ArkUI 可能保留已经
    // 删除的旧 Text 子树。这里先清掉该消息的增量缓存，再以最终 Markdown AST 重建
    // 该消息的全部行。已有列表行保留原对象并发 CHANGE，Markdown 行则换入新的
    // holder；这样既不会让相同 key 的旧行组件拒绝换绑，也不会让 RELOAD 重建整张列表。
    reloadMessage(message: ChatMessage): void {
        const startIndex: number = this.startIndexOf(message.uid);

        if (startIndex < 0) {
            return;
        }

        let oldCount: number = 0;

        while (startIndex + oldCount < this.items.length
            && this.items[startIndex + oldCount].message.uid === message.uid) {
            oldCount++;
        }

        ChatItemBuilder.clearCache(message.uid);
        const fresh: ChatRenderItem[] = ChatItemBuilder.build(message);
        const shared: number = Math.min(oldCount, fresh.length);
        const operations: DataOperation[] = [];

        for (let i: number = 0; i < shared; i++) {
            const current: ChatRenderItem = this.items[startIndex + i];
            const next: ChatRenderItem = fresh[i];

            if (current.kind !== next.kind || current.key() !== next.key()) {
                this.items[startIndex + i] = next;
            } else {
                ChatItemBuilder.copyInto(current, next);

                if (next.blockHolder !== null) {
                    current.blockHolder = next.blockHolder;
                }
            }

            const change: DataChangeOperation = {
                type: DataOperationType.CHANGE,
                index: startIndex + i
            };
            operations.push(change);
        }

        if (fresh.length > oldCount) {
            const added: ChatRenderItem[] = fresh.slice(oldCount);
            this.items.splice(startIndex + oldCount, 0, ...added);

            const add: DataAddOperation = {
                type: DataOperationType.ADD,
                index: startIndex + oldCount,
                count: added.length
            };
            operations.push(add);
        } else if (fresh.length < oldCount) {
            const removedCount: number = oldCount - fresh.length;
            this.items.splice(startIndex + fresh.length, removedCount);

            const remove: DataDeleteOperation = {
                type: DataOperationType.DELETE,
                index: startIndex + fresh.length,
                count: removedCount
            };
            operations.push(remove);
        }

        hilog.info(DOMAIN, TAG, '[dataset] reload-message old=%{public}d new=%{public}d at=%{public}d',
            oldCount, fresh.length, startIndex);

        this.notify(operations);
        this.dumpSequence('reload-message');
    }

    // 某条消息的首个单元下标：自后向前查找（流式消息总在末尾，命中更快）
    startIndexOf(messageUid: string): number {
        for (let i: number = this.items.length - 1; i >= 0; i--) {
            if (this.items[i].message.uid === messageUid) {
                while (i > 0 && this.items[i - 1].message.uid === messageUid) {
                    i--;
                }

                return i;
            }
        }

        return -1;
    }

    // ==== 诊断探针（定位"顺序/内容错位"，完成即删）====
    // 按渲染顺序压缩输出「index/uid x 单元数」、每条消息的内容摘要、
    // 以及「同一条消息的单元在数组里是否连续（order 是否 0..n）」
    private dumpSequence(tag: string): void {
        const counts: string[] = [];
        let i: number = 0;

        while (i < this.items.length) {
            const uid: string = this.items[i].message.uid;
            let n: number = 1;

            while (i + n < this.items.length && this.items[i + n].message.uid === uid) {
                n++;
            }

            counts.push(this.items[i].message.index + '/' + uid + 'x' + n);
            i += n;
        }

        hilog.info(DOMAIN, TAG, '[seq] %{public}s n=%{public}d %{public}s',
            tag, this.items.length, counts.join(' '));

        const summaries: string[] = [];

        for (let k: number = 0; k < this.items.length; k++) {
            const m: ChatMessage = this.items[k].message;

            if (k === 0 || this.items[k - 1].message.uid !== m.uid) {
                let head: string = m.content.split('\r').join(' ').split('\n').join(' ');

                if (head.length > 40) {
                    head = head.substring(0, 40);
                }

                let segLen: number = 0;
                let segHead: string = '';

                for (let s: number = 0; s < m.segments.length; s++) {
                    const st: MessageSegment = m.segments[s];

                    if (st.type === 'content') {
                        segLen += st.text.length;
                        segHead += st.text.split('\r').join(' ').split('\n').join(' ');
                    }
                }

                if (segHead.length > 26) {
                    segHead = segHead.substring(0, 26);
                }

                const use: string = m.usage === null
                    ? '-' : (m.usage.inputTokens + '/' + m.usage.outputTokens);

                summaries.push(m.uid + '/' + m.index + '/' + m.role + '/c' + m.content.length
                    + '/sg' + segLen + '/u' + use + ':' + head + ' ## ' + segHead);
            }
        }

        const CHUNK: number = 5;
        let base: number = 0;

        while (base < summaries.length) {
            const part: string[] = [];

            for (let k: number = base; k < summaries.length && k < base + CHUNK; k++) {
                part.push(summaries[k]);
            }

            hilog.info(DOMAIN, TAG, '[msg] %{public}s part=%{public}d/%{public}d %{public}s',
                tag, base / CHUNK, summaries.length, part.join(' | '));
            base += CHUNK;
        }

        let j: number = 0;

        while (j < this.items.length) {
            const uid: string = this.items[j].message.uid;
            const orders: number[] = [];

            while (j < this.items.length && this.items[j].message.uid === uid) {
                orders.push(this.items[j].order);
                j++;
            }

            let sequential: boolean = true;

            for (let k: number = 0; k < orders.length; k++) {
                if (orders[k] !== k) {
                    sequential = false;
                    break;
                }
            }

            if (!sequential) {
                hilog.info(DOMAIN, TAG, '[ord] %{public}s NOT-0..n %{public}s',
                    uid, orders.join(','));
            }
        }
    }

    private notify(operations: DataOperation[]): void {
        for (let i: number = 0; i < this.listeners.length; i++) {
            this.listeners[i].onDatasetChange(operations);
        }
    }
}
