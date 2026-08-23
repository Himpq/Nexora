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
    /** 头像 URL(带版本号防缓存);由 refreshAvatar 统一刷新 */
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

            this.refreshAvatar()
        },

        /** 刷新头像 URL(基于 user_id + 时间戳版本号,避免浏览器缓存旧头像) */
        refreshAvatar(): void {
            const userId = this.userId

            if (!userId) {
                this.avatarUrl = ''

                return
            }

            this.avatarUrl = `/api/user/avatar/${encodeURIComponent(userId)}?v=${Date.now()}`
        },

        /** 上传新头像(base64 data URL),成功后刷新用户信息与头像 */
        async uploadAvatar(avatarBase64: string): Promise<void> {
            const updated = await updateUserProfile({
                displayName: this.username,
                avatarBase64,
            })

            if (this.user) {
                this.user = {
                    ...this.user,
                    username: updated.username || this.user.username,
                    avatar_url: updated.avatar_url as string | undefined,
                }
            }

            this.refreshAvatar()
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
