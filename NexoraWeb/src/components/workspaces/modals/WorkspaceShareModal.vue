<!--
    WorkspaceShareModal.vue — 分享 Workspace 弹窗

    用户搜索下拉(/api/user/search,头像 + 显示名 + @ID)+ 已选用户行(头像/名称/@ID · 角色/移除)+
    Enter 直接按输入添加;不能分享给自己。对齐原版 ensureWorkspaceShareModal 的完整交互。
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
                <label for="workspaceShareUserInput"><span>添加共享用户</span></label>
                <div class="ws-share-selector">
                    <input
                        id="workspaceShareUserInput"
                        ref="inputRef"
                        v-model="inputValue"
                        class="ws-share-input"
                        type="text"
                        placeholder="输入用户名搜索"
                        autocomplete="off"
                        role="combobox"
                        :aria-expanded="menuVisible && filteredOptions.length > 0"
                        aria-label="添加共享用户"
                        @focus="menuVisible = true"
                        @input="menuVisible = true"
                        @keydown="handleKeydown"
                        @blur="menuVisible = false"
                    >

                    <div v-if="menuVisible" class="ws-share-menu" role="listbox">
                        <div v-if="loadingOptions" class="ws-share-menu-state">加载中...</div>
                        <div v-else-if="optionsError" class="ws-share-menu-state">{{ optionsError }}</div>
                        <div v-else-if="!filteredOptions.length" class="ws-share-menu-state">无匹配用户</div>
                        <button
                            v-for="(user, index) in filteredOptions"
                            v-else
                            :key="userIdOf(user)"
                            class="ws-share-option"
                            :class="{ active: index === activeIndex }"
                            type="button"
                            role="option"
                            :aria-selected="index === activeIndex"
                            @mousedown.prevent
                            @click="selectUser(user)"
                        >
                            <img v-if="avatarUrlOf(user)" class="ws-share-avatar is-sm" :src="String(avatarUrlOf(user))" :alt="displayNameOf(user)">
                            <span v-else class="ws-share-avatar is-sm">{{ initialOf(user, userIdOf(user)) }}</span>
                            <span class="ws-share-meta">
                                <span class="ws-share-name">{{ displayNameOf(user) }}</span>
                                <span class="ws-share-handle">@{{ userIdOf(user) }}</span>
                            </span>
                        </button>
                    </div>
                </div>
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

    function searchTextOf(user: WorkspaceUserOption): string {
        return [
            userIdOf(user),
            displayNameOf(user),
            roleOf(user),
        ].join(' ').toLowerCase()
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
    const options = ref<WorkspaceUserOption[]>([])
    const loadingOptions = ref(false)
    const optionsError = ref('')
    const inputValue = ref('')
    const activeIndex = ref(0)
    const menuVisible = ref(false)
    const inputRef = ref<HTMLInputElement | null>(null)

    /** 缓存的用户详情;未加载到时返回 null,由模板走首字母块 */
    function cachedUser(userId: string): WorkspaceUserOption | null {
        return detailsById.value.get(userId) || null
    }

    /**
     * 过滤候选:排除自己与已选,再按输入做本地包含匹配。
     * 候选集合在打开时一次性拉取,输入过程只做本地过滤(对齐原版交互)。
     */
    const filteredOptions = computed(() => {
        const query = inputValue.value.trim().toLowerCase()

        return options.value.filter((user) => {
            const id = userIdOf(user)

            if (!id || id === props.currentUserId || selected.value.includes(id)) {
                return false
            }

            if (!query) {
                return true
            }

            return searchTextOf(user).includes(query)
        })
    })

    watch(
        () => props.open,
        async (opened) => {
            if (!opened) {
                return
            }

            selected.value = Array.from(new Set(props.sharedUsers.map((item) => item.trim()).filter(Boolean)))
                .filter((item) => item !== props.currentUserId)

            inputValue.value = ''
            activeIndex.value = 0
            menuVisible.value = false
            optionsError.value = ''

            await Promise.all([loadOptions(), loadSelectedDetails(selected.value)])
        },
        { immediate: true }
    )

    async function loadOptions(): Promise<void> {
        loadingOptions.value = true

        try {
            options.value = await searchWorkspaceUsers('')
        } catch (error) {
            options.value = []
            optionsError.value = error instanceof Error ? error.message : '用户列表加载失败'
        } finally {
            loadingOptions.value = false
        }
    }

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

    /** ===== 键盘导航与选择 ===== */

    function handleKeydown(event: KeyboardEvent): void {
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault()

            const count = filteredOptions.value.length

            if (!count) {
                return
            }

            const offset = event.key === 'ArrowDown' ? 1 : -1

            activeIndex.value = (activeIndex.value + offset + count) % count

            return
        }

        if (event.key === 'Enter') {
            event.preventDefault()

            const active = filteredOptions.value[activeIndex.value]

            if (menuVisible.value && active) {
                selectUser(active)

                return
            }

            addFromInput()
        }
    }

    function selectUser(user: WorkspaceUserOption): void {
        addUser(userIdOf(user))
    }

    function addFromInput(): void {
        addUser(inputValue.value.trim())
    }

    function addUser(userId: string): void {
        if (!userId) {
            return
        }

        if (userId === props.currentUserId) {
            return
        }

        if (!selected.value.includes(userId)) {
            selected.value.push(userId)

            void loadSelectedDetails([userId])
        }

        inputValue.value = ''
        activeIndex.value = 0
        menuVisible.value = false

        inputRef.value?.focus()
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

    /* 用户选择器与下拉菜单 */
    .ws-share-selector {
        position: relative;
    }

    .ws-share-input {
        width: 100%;
        height: 38px;
        border: 1px solid var(--color-border-input);
        border-radius: 8px;
        background: var(--color-bg-elevated);
        color: var(--color-text-primary);
        padding: 0 12px;
        box-sizing: border-box;
        font: inherit;
        font-size: 13px;
        outline: none;
    }

    .ws-share-input:focus {
        border-color: var(--color-accent-text);
        box-shadow: 0 0 0 3px var(--color-accent-surface);
    }

    .ws-share-menu {
        position: absolute;
        top: calc(100% + 6px);
        left: 0;
        right: 0;
        z-index: var(--z-dropdown);
        max-height: 196px;
        overflow-y: auto;
        border: 1px solid var(--color-border);
        border-radius: 10px;
        background: var(--color-bg-elevated);
        box-shadow: 0 12px 32px rgba(15, 23, 42, 0.14);
        padding: 4px;
        box-sizing: border-box;
    }

    .ws-share-menu-state {
        padding: 10px;
        color: var(--color-text-secondary);
        font-size: 12px;
    }

    .ws-share-option {
        width: 100%;
        min-height: 46px;
        border: none;
        border-radius: 7px;
        background: transparent;
        display: grid;
        grid-template-columns: 30px minmax(0, 1fr);
        align-items: center;
        gap: 10px;
        padding: 6px 9px;
        cursor: pointer;
        text-align: left;
    }

    .ws-share-option:hover,
    .ws-share-option.active {
        background: var(--color-bg-hover);
    }

    .ws-share-hint {
        margin: 0;
        color: var(--color-text-secondary);
        font-size: 12px;
    }
</style>
