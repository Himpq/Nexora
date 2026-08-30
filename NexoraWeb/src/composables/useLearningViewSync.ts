/**
 * useLearningViewSync.ts — Learning 视图与 URL ?view= 同步
 *
 * 对齐 Workspaces 的 URL 直达/刷新恢复模式:
 *   - ?view=learning 直达 Learning 覆盖层
 *   - overlay.view 变化时同步写回 URL（pushState，可后退）
 *   - popstate 时按 URL 回切视图
 * 仅同步 view，不碰 cid 等其他参数。
 */

import { onBeforeUnmount, onMounted, watch } from 'vue'

import { type ContentViewId, overlay, openView, closeView } from '@/ui/overlay'

const VIEW_PARAM = 'view'

function readViewFromLocation(): ContentViewId | null {
    const params = new URLSearchParams(window.location.search || '')
    const raw = String(params.get(VIEW_PARAM) || '').trim().toLowerCase()
    if (raw === 'learning') return 'learning'
    if (raw === 'files') return 'files'
    if (raw === 'workspaces') return 'workspaces'
    if (raw === 'knowledge') return 'knowledge'
    if (raw === 'knowledge-mgmt') return 'knowledge-mgmt'
    if (raw === 'mail') return 'mail'
    return null
}

function buildViewHref(nextView: ContentViewId | null): string {
    const url = new URL(window.location.href)
    if (nextView) {
        url.searchParams.set(VIEW_PARAM, nextView)
    } else {
        url.searchParams.delete(VIEW_PARAM)
    }
    return url.toString()
}

export function useLearningViewSync(): void {
    function handlePopState(): void {
        const target = readViewFromLocation()
        // 学习视图的后退/前进：URL 有 view=learning 即打开，否则回到聊天主视图
        // 其他 view 的同步由既有逻辑覆盖，此处统一处理
        if (target) {
            openView(target)
        } else if (overlay.view) {
            closeView()
        }
    }

    watch(
        () => overlay.view,
        (view) => {
            const current = readViewFromLocation()
            if (current !== view) {
                window.history.pushState({}, '', buildViewHref(view))
            }
        },
    )

    onMounted(() => {
        window.addEventListener('popstate', handlePopState)
        // 首帧直达：?view=learning 刷新即打开
        const initial = readViewFromLocation()
        if (initial && overlay.view !== initial) {
            openView(initial)
        }
    })

    onBeforeUnmount(() => {
        window.removeEventListener('popstate', handlePopState)
    })
}

export function readLearningViewFromLocation(): ContentViewId | null {
    return readViewFromLocation()
}
