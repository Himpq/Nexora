/**
 * user.ts — 用户状态
 *
 * 职责:
 *   - 当前登录用户信息
 *   - 头像 URL 统一管理(上传/刷新后全站联动)
 *   - 登录态判断(供路由守卫使用)
 */

import { defineStore } from 'pinia'

import { getUserInfo, login as apiLogin, logout as apiLogout, updateUserProfile, type UserInfo } from '@/api/auth'

interface UserState {
    user: UserInfo | null
    initialized: boolean
    /** 头像 URL(取自后端 avatar_url,自带 avatar_updated_at 版本号);由 syncAvatarUrl 统一同步 */
    avatarUrl: string
}

export const useUserStore = defineStore('user', {
    state: (): UserState => ({
        user: null,
        initialized: false,
        avatarUrl: '',
    }),

    getters: {
        isLoggedIn(state): boolean {
            return state.initialized && !!state.user
        },

        username(state): string {
            return state.user?.username || ''
        },

        /** 用户 ID(原版 avatar URL 基于 user_id,而非 username) */
        userId(state): string {
            return state.user?.id || state.user?.username || ''
        },
    },

    actions: {
        /** 初始化登录态:拉取用户信息,失败视为未登录 */
        async init(): Promise<void> {
            try {
                this.user = await getUserInfo()
            } catch {
                this.user = null
            } finally {
                this.initialized = true
            }

            this.syncAvatarUrl()
        },

        /**
         * 同步头像 URL 为后端下发的 avatar_url。
         *
         * 后端版本号取 avatar_updated_at(仅头像真正变更时才变),因此:
         *   - 头像未变更时 URL 稳定,浏览器直接命中缓存,侧栏头像和设置页头像不会重复下载;
         *   - 严禁再用前端 Date.now() 之类的时间戳拼 URL,那会让每次同步都变成强制全量重新下载。
         */
        syncAvatarUrl(): void {
            this.avatarUrl = String(this.user?.avatar_url || '')
        },

        /** 应用资料更新结果(用户名/头像变更统一入口,避免各调用方重复合并逻辑) */
        applyProfileUpdate(updated: { username?: string; avatar_url?: string }): void {
            if (!this.user) {
                return
            }

            this.user = {
                ...this.user,
                username: updated.username || this.user.username,
                avatar_url: updated.avatar_url as string | undefined,
            }

            this.syncAvatarUrl()
        },

        /** 上传新头像(base64 data URL),成功后同步用户信息与头像 */
        async uploadAvatar(avatarBase64: string): Promise<void> {
            const updated = await updateUserProfile({
                displayName: this.username,
                avatarBase64,
            })

            this.applyProfileUpdate(updated)
        },

        /** 登录:成功后刷新用户信息 */
        async login(username: string, password: string): Promise<boolean> {
            const result = await apiLogin(username, password)

            if (!result.success) {
                return false
            }

            await this.init()

            return true
        },

        /** 登出:本地登录态必须无条件清空;服务端登出尽力而为
         *  (会话已失效时 /logout 也可能失败,若向上抛错会阻断调用方的跳转) */
        async logout(): Promise<void> {
            try {
                await apiLogout()
            } catch {
                // 服务端登出失败不阻断本地登出:cookie 失效等场景下服务端本就无需再清
            } finally {
                this.user = null
                this.initialized = false
                this.avatarUrl = ''
            }
        },
    },
})
