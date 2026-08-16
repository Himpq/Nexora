/**
 * router/index.ts — 路由配置
 *
 * 职责:
 *   - /login 登录页
 *   - / 对话主界面(需登录守卫)
 *   - 守卫基于 user store 的登录态,未初始化时先拉取用户信息
 */

import { createRouter, createWebHashHistory } from 'vue-router'

import { useUserStore } from '@/stores/user'

const router = createRouter({
    // hash 路由:避免与 Flask 后端路由(/login 等)冲突,刷新不丢失前端路由
    history: createWebHashHistory(),
    routes: [
        {
            path: '/login',
            name: 'login',
            // 懒加载:登录页独立 chunk
            component: () => import('@/views/LoginView.vue'),
            meta: { public: true },
        },
        {
            path: '/',
            name: 'chat',
            // 懒加载:对话主界面独立 chunk
            component: () => import('@/views/ChatView.vue'),
        },
    ],
})

/** 全局守卫:非公开页要求登录 */
router.beforeEach(async (to) => {
    const userStore = useUserStore()

    if (!userStore.initialized) {
        await userStore.init()
    }

    if (to.meta.public) {
        return true
    }

    if (!userStore.isLoggedIn) {
        return {
            name: 'login',
            query: { next: to.fullPath },
        }
    }

    return true
})

export default router
