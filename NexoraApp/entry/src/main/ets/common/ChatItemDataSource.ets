// ChatItemDataSource.ets - 块级渲染单元的数据源
//
// 与旧的消息级数据源相比，唯一的差别是「一条消息 = 多个单元」，
// 因此流式增量可以只更新真正变化的那一块，而不必重建整条消息对应的行。
//
// 通知口径与消息级保持一致（SDK 要求 onDatasetChange 不得与其它通知接口混用）：
//   全量替换 = RELOAD、头部插入 = ADD@0、尾部追加 = ADD@len、单元数量变化 = ADD/DELETE。
// 单元内容变化不发通知：ChatItemRow 用 @ObjectLink 绑定单元对象，
// 原地改字段即可让那一行重渲染，这也是流式期间不重建列表的关键。

import { hilog } from '@kit.PerformanceAnalysisKit';
import { ChatMessage } from './ChatTypes';
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
        this.items = items;

        const operation: DataReloadOperation = { type: DataOperationType.RELOAD };
        this.notify([operation]);
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
    // 重叠部分原地写字段（不触发数据集变更，只让对应行重渲染），
    // 数量变化时才补发 ADD / DELETE —— 流式期间绝大多数帧只走原地写这一条路
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

        for (let i: number = 0; i < shared; i++) {
            ChatItemBuilder.copyInto(this.items[startIndex + i], fresh[i]);
        }

        if (fresh.length === oldCount) {
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

            this.notify([operation]);
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

        this.notify([operation]);
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

    private notify(operations: DataOperation[]): void {
        for (let i: number = 0; i < this.listeners.length; i++) {
            this.listeners[i].onDatasetChange(operations);
        }
    }
}
