/**
 * useBottomFollow — 消息区"跟随底部"滚动策略
 *
 * 职责:
 *   - 流式输出时仅当视口处于底部附近才自动滚到底(跟随模式)
 *   - 用户向上滚动离开底部即暂停跟随,回到底部附近自动恢复,
 *     避免生成期间视图被增量更新反复钉死在底部而无法回看
 *
 * 状态判定:
 *   以"距底部距离 ≤ 阈值"作为唯一依据,统一覆盖滚轮/触摸/键盘/拖动滚动条;
 *   程序化滚动(scrollTop 赋值)触发的 scroll 事件同样进入判定,状态自洽。
 */

import { ref } from 'vue'

/** 距底部多少像素内视为"位于底部" */
const BOTTOM_THRESHOLD_PX = 80

export function useBottomFollow() {
    /** 是否跟随底部(用户上滑离开底部后为 false,回到底部附近恢复 true) */
    const following = ref(true)

    /** 依据容器当前滚动位置更新跟随状态(在 scroll 监听中调用) */
    function syncWithScroll(container: HTMLElement): void {
        const distanceToBottom = container.scrollHeight - container.scrollTop - container.clientHeight

        following.value = distanceToBottom <= BOTTOM_THRESHOLD_PX
    }

    /** 恢复跟随并立即滚到底部(会话加载完成等场景) */
    function followNow(container: HTMLElement): void {
        following.value = true

        container.scrollTop = container.scrollHeight
    }

    /** 恢复跟随(发送/重答等需要回到最新消息的场景;实际滚动由消息变化监听执行) */
    function resume(): void {
        following.value = true
    }

    /** 暂停跟随(轮次跳转/笔记跳转等主动离开底部的场景) */
    function suspend(): void {
        following.value = false
    }

    return {
        following,
        syncWithScroll,
        followNow,
        resume,
        suspend,
    }
}
