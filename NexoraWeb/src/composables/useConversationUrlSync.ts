/**
 * useConversationUrlSync.ts — 会话与 URL ?cid= 双向同步
 *
 * 对齐原前端(/chat?cid=)的 URL 状态行为:
 *   - 进入页面:location.search 含 cid(或旧别名 id)时直接打开该会话
 *   - 切换会话:currentId 变化后把 cid 写入 search 段(push,产生可后退的历史记录);
 *     空白新会话则移除 cid
 *   - 后退/前进(popstate):按 URL 中的 cid 切换会话,无 cid 则回空白新会话
 *
 * 参数固定写在 search 段(/new?cid=xxx#/),hash 路由部分保持不变:
 * 与原前端链接形式完全一致,且刷新后 Flask /new 仍按同一入口正常渲染。
 */

import { onBeforeUnmount, onMounted, watch } from 'vue'

import { useConversationStore } from '@/stores/conversation'

/** 规范参数名(写入时只使用它) */
const CID_PARAM = 'cid'

/** 旧版链接的别名参数名(读取时兼容,优先级 cid > id) */
const CID_ALIAS_PARAM = 'id'

/**
 * 从 location.search 解析会话目标
 *
 * 返回空串表示 URL 未指向任何会话。
 */
export function readConversationIdFromLocation(): string {
    const params = new URLSearchParams(window.location.search || '')

    return String(params.get(CID_PARAM) || params.get(CID_ALIAS_PARAM) || '').trim()
}

/** 构造写入目标:保持 path 与 hash 不变,仅规范化 search 中的会话参数 */
function buildLocationHref(conversationId: string): string {
    const url = new URL(window.location.href)

    // 写入前清掉两种参数名,保证 URL 始终只有规范的 cid 一种形态
    url.searchParams.delete(CID_PARAM)
    url.searchParams.delete(CID_ALIAS_PARAM)

    const normalized = String(conversationId || '').trim()

    if (normalized) {
        url.searchParams.set(CID_PARAM, normalized)
    }

    return url.toString()
}

/** 当前 URL search 是否已表达该会话(已一致则不再写历史,避免 popstate 场景产生重复历史项) */
function isLocationInSync(conversationId: string): boolean {
    return readConversationIdFromLocation() === String(conversationId || '').trim()
}

/**
 * 会话与 URL 双向同步(在 ChatView setup 中调用)
 *
 * currentId → URL 用 watch 集中覆盖所有切换入口(侧栏/搜索/Workspaces/分支/删除);
 * popstate → 会话负责浏览器后退/前进跟随。
 * 本 composable 随 ChatView 卸载自动注销监听,登录页等场景不会误响应。
 */
export function useConversationUrlSync(): void {
    const store = useConversationStore()

    /** 后退/前进:按 URL 目标切换;生成中回空白项时 newConversation 自身会拒绝(流不中断) */
    function handlePopState(): void {
        const target = readConversationIdFromLocation()

        if (target) {
            void store.openConversation(target).catch(() => {})
        } else {
            void store.newConversation()
        }
    }

    // currentId → URL:仅在两者不一致时 push,保证后退/前进触发的变更不会被重复入栈
    watch(() => store.currentId, (conversationId) => {
        if (!isLocationInSync(conversationId)) {
            window.history.pushState({}, '', buildLocationHref(conversationId))
        }
    })

    onMounted(() => {
        window.addEventListener('popstate', handlePopState)
    })

    onBeforeUnmount(() => {
        window.removeEventListener('popstate', handlePopState)
    })
}
