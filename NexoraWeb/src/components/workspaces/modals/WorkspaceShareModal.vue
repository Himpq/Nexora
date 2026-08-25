<!--
    WorkspaceShareModal.vue — 分享 Workspace 弹窗

    已选用户行(头像/名称/@ID · 角色/移除)+ GDDP UserCombobox 用户筛选
    (/api/user/search,头像 + 显示名 + @ID,回车直接按输入添加)。
    不能分享给自己。对齐原版 ensureWorkspaceShareModal 的完整交互。
-->

<template>
    <Modal :open="open" title="分享 Workspace" size="sm" :close-on-backdrop="!saving" @close="emit('close')">        <div class="ws-share-body">
            <div class="ws-share-field">
                <span>已共享用户</span>
                <div v-if="!selected.length" class="ws-share-empty">还没有共享用户</div>
                <div v-else class="ws-share-list">
                    <div v-for="userId in selected" :key="userId" class="ws-share-row">
                        <img v-if="avatarUrlOf(cachedUser(userId))" class="ws-share-avatar" :src="String(avatarUrlOf(cachedUser(userId)))" :alt="displayNameOf(cachedUser(userId))">
                        <span v-else class="ws-share-avatar">{{ initialOf(cachedUser(userId), userId) }}</span>
                        <span class="ws-share-meta">
                            <span class="ws-share-name">{{ displayNameOf(cachedUser(userId)) || userId }}</span>
                            <span class="ws-share-handle">{{ handleText(cachedUser(userId), userId) }}</span>
                        </span>
                        <button class="ws-share-remove" type="button" :title="`移除 ${displayNameOf(cachedUser(userId)) || userId}`" :aria-label="`移除 ${displayNameOf(cachedUser(userId)) || userId}`" @click="removeUser(userId)">
                            <i class="fa-solid fa-xmark" aria-hidden="true"></i>
                        </button>
                    </div>
                </div>
            </div>

            <div class="ws-share-field">
                <label><span>添加共享用户</span></label>
                <!-- 用户筛选复用 GDDP 通用组合框(浮动候选/键盘导航/回车自由添加) -->
                <UserCombobox
                    :fetch-options="fetchUsers"
                    :exclude="excludedIds"
                    placeholder="输入用户名搜索"
                    @select="addUser"
                />
                <p class="ws-share-hint">输入后回车直接添加;列表来自用户搜索。</p>
            </div>
        </div>

        <template #footer>
            <Button variant="quiet" :disabled="saving" @click="emit('close')">取消</Button>
            <Button variant="primary" :disabled="saving" @click="emit('save', [...selected])">{{ saving ? '保存中...' : '保存' }}</Button>
        </template>
    </Modal>
</template>

<script setup lang="ts">
    import { computed, ref, watch } from 'vue'

    import type { WorkspaceUserOption } from '@/api/workspaces'
    import { searchWorkspaceUsers } from '@/api/workspaces'

    import Button from '@/ui/Button.vue'
    import Modal from '@/ui/Modal.vue'
    import UserCombobox from '@/ui/UserCombobox.vue'
    import type { UserComboboxUser } from '@/ui/UserCombobox.vue'

    const props = defineProps<{
        open: boolean
        workspaceId: string
        sharedUsers: string[]
        currentUserId: string
        /** 保存请求进行中(由根组件持有,控制按钮态与遮罩关闭) */
        saving: boolean
    }>()

    const emit = defineEmits<{
        close: []
        save: [users: string[]]
    }>()

    /** ===== 用户字段读取(对齐原版 getWorkspaceShareUserId 等) ===== */

    function userIdOf(user: WorkspaceUserOption | null): string {
        return String(user?.user_id || user?.username || '').trim()
    }

    function displayNameOf(user: WorkspaceUserOption | null): string {
        return String(user?.display_name || user?.username || '').trim()
    }

    function avatarUrlOf(user: WorkspaceUserOption | null): string {
        return String(user?.avatar_url || '').trim()
    }

    function roleOf(user: WorkspaceUserOption | null): string {
        return String(user?.role || '').trim()
    }

    function initialOf(user: WorkspaceUserOption | null, fallbackId: string): string {
        return (displayNameOf(user) || fallbackId || 'U').charAt(0).toUpperCase()
    }

    function handleText(user: WorkspaceUserOption | null, userId: string): string {
        const role = roleOf(user)

        return role ? `@${userId} · ${role}` : `@${userId}`
    }

    /** ===== 弹窗状态 ===== */
    const selected = ref<string[]>([])
    const detailsById = ref<Map<string, WorkspaceUserOption>>(new Map())

    /** 缓存的用户详情;未加载到时返回 null,由模板走首字母块 */
    function cachedUser(userId: string): WorkspaceUserOption | null {
        return detailsById.value.get(userId) || null
    }

    /** 组合框排除名单:自己与已选用户不再出现在候选里 */
    const excludedIds = computed(() => [props.currentUserId, ...selected.value])

    /** 候选拉取(适配 GDDP UserCombobox 条目结构) */
    async function fetchUsers(): Promise<UserComboboxUser[]> {
        const users = await searchWorkspaceUsers('')

        return users.map((user) => ({
            id: userIdOf(user),
            name: displayNameOf(user),
            handle: userIdOf(user),
            role: roleOf(user),
            avatarUrl: avatarUrlOf(user) || undefined,
        }))
    }

    watch(
        () => props.open,
        async (opened) => {
            if (!opened) {
                return
            }

            selected.value = Array.from(new Set(props.sharedUsers.map((item) => item.trim()).filter(Boolean)))
                .filter((item) => item !== props.currentUserId)

            await loadSelectedDetails(selected.value)
        },
        { immediate: true }
    )

    /** 拉取已选用户的展示信息(头像/显示名),失败仅影响展示不影响保存 */
    async function loadSelectedDetails(userIds: string[]): Promise<void> {
        const missing = userIds.filter((id) => !detailsById.value.has(id))

        await Promise.all(missing.map(async (id) => {
            try {
                const matched = (await searchWorkspaceUsers(id)).find((user) => userIdOf(user) === id)

                if (matched) {
                    detailsById.value.set(id, matched)
                }
            } catch {
                // 单个用户详情缺失时保持首字母块展示,不打断分享流程
            }
        }))
    }

    /** 组合框上报的选中(自由文本回车也会走到这里;去重/排除自己在此兜底) */
    function addUser(userId: string): void {
        if (!userId || userId === props.currentUserId || selected.value.includes(userId)) {
            return
        }

        selected.value.push(userId)

        void loadSelectedDetails([userId])
    }

    function removeUser(userId: string): void {
        selected.value = selected.value.filter((item) => item !== userId)
    }
</script>

<style scoped>
    .ws-share-body {
        display: flex;
        flex-direction: column;
        gap: 16px;
    }

    .ws-share-field {
        display: flex;
        flex-direction: column;
        gap: 8px;
    }

    .ws-share-field > span,
    .ws-share-field label span {
        color: var(--color-text-primary);
        font-size: 13px;
        font-weight: 600;
    }

    .ws-share-empty {
        color: var(--color-text-secondary);
        font-size: 13px;
        line-height: 24px;
    }

    .ws-share-list {
        display: grid;
        gap: 8px;
    }

    .ws-share-row {
        display: grid;
        grid-template-columns: 30px minmax(0, 1fr) 28px;
        align-items: center;
        gap: 10px;
        min-height: 42px;
        padding: 6px 8px;
        border: 1px solid var(--color-border);
        border-radius: 8px;
        background: var(--color-bg-elevated);
    }

    .ws-share-avatar {
        width: 30px;
        height: 30px;
        border-radius: 8px;
        background: var(--color-text-primary);
        color: var(--color-bg-page);
        display: inline-flex;
        align-items: center;
        justify-content: center;
        overflow: hidden;
        object-fit: cover;
        font-size: 12px;
        font-weight: 700;
    }

    .ws-share-avatar.is-sm {
        width: 30px;
        height: 30px;
        flex-basis: 30px;
    }

    .ws-share-meta {
        display: grid;
        gap: 2px;
        min-width: 0;
        overflow: hidden;
    }

    .ws-share-name,
    .ws-share-handle {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    .ws-share-name {
        color: var(--color-text-primary);
        font-size: 13px;
        font-weight: 650;
    }

    .ws-share-handle {
        color: var(--color-text-secondary);
        font-size: 12px;
    }

    .ws-share-remove {
        width: 28px;
        height: 28px;
        border: none;
        border-radius: 8px;
        background: transparent;
        color: var(--color-text-secondary);
        display: inline-flex;
        align-items: center;
        justify-content: center;
        padding: 0;
        cursor: pointer;
    }

    .ws-share-remove:hover {
        background: var(--color-bg-hover);
        color: var(--color-text-primary);
    }

    /* 输入框与候选浮层样式由 GDDP UserCombobox 提供 */
    .ws-share-hint {
        margin: 0;
        color: var(--color-text-secondary);
        font-size: 12px;
    }
</style>
