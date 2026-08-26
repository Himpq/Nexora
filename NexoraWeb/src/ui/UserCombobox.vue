<!--
    UserCombobox.vue — 用户筛选组合框(General Design Development Package)

    设计:
      - 输入框即触发器:聚焦/输入展开候选浮层(ui/Popover 统一浮动,Teleport + fixed 定位,
        点击外部自动关闭),替代各业务自绘的绝对定位下拉
      - 候选由调用方一次性注入(fetchOptions),输入只做本地过滤
        (匹配 id/显示名/角色/句柄);exclude 名单用于排除自己与已选项
      - 键盘:↑↓ 循环高亮,Enter 选中高亮项;无高亮项时 Enter 把输入原文作为
        自由 ID 上报(对齐 Workspace 分享"输入后回车直接添加")
      - 选中后清空输入、收起浮层并回焦输入框

    用法:
      <UserCombobox
          :fetch-options="loadUsers"
          :exclude="[currentUserId, ...selectedIds]"
          placeholder="输入用户名搜索"
          @select="addUser"
      />
-->

<template>
    <Popover ref="popoverRef" match-trigger-width>
        <template #trigger="{ open }">
            <input
                ref="inputRef"
                v-model="query"
                class="gddp-input user-combobox-input"
                type="text"
                :placeholder="placeholder"
                autocomplete="off"
                role="combobox"
                :aria-expanded="open"
                aria-label="搜索用户"
                @focus="openMenu()"
                @input="openMenu()"
                @keydown="handleKeydown"
                @blur="closeMenu()"
            >
        </template>

        <div class="user-combobox-menu" role="listbox">
            <div v-if="loading" class="user-combobox-state">加载中...</div>
            <div v-else-if="errorText" class="user-combobox-state">{{ errorText }}</div>
            <div v-else-if="!filtered.length" class="user-combobox-state">无匹配用户</div>
            <button
                v-for="(user, index) in filtered"
                v-else
                :key="user.id"
                class="user-combobox-option"
                :class="{ active: index === activeIndex }"
                type="button"
                role="option"
                :aria-selected="index === activeIndex"
                @mousedown.prevent
                @click="choose(user.id)"
            >
                <img v-if="user.avatarUrl" class="user-combobox-avatar" :src="user.avatarUrl" :alt="user.name || user.id">
                <span v-else class="user-combobox-avatar">{{ initialOf(user) }}</span>
                <span class="user-combobox-meta">
                    <span class="user-combobox-name">{{ user.name || user.id }}</span>
                    <span v-if="user.handle || user.role" class="user-combobox-handle">@{{ user.handle || user.id }}<template v-if="user.role"> · {{ user.role }}</template></span>
                </span>
            </button>
        </div>
    </Popover>
</template>

<script setup lang="ts">
    import { computed, ref, watch } from 'vue'

    import Popover from '@/ui/Popover.vue'

    /** 组合框用户条目(id 必填;其余缺省时走首字母块与 @id 展示) */
    export interface UserComboboxUser {
        id: string
        name?: string
        handle?: string
        role?: string
        avatarUrl?: string
    }

    const props = defineProps<{
        /** 拉取全量候选(首次展开拉取一次,之后输入只做本地过滤) */
        fetchOptions: () => Promise<UserComboboxUser[]>
        /** 排除的用户 id(自己 / 已选) */
        exclude?: string[]
        placeholder?: string
    }>()

    const emit = defineEmits<{
        /** 选中一个候选 id;自由文本回车时上报原文 */
        select: [id: string]
    }>()

    const popoverRef = ref<InstanceType<typeof Popover> | null>(null)
    const inputRef = ref<HTMLInputElement | null>(null)

    const query = ref('')
    const options = ref<UserComboboxUser[]>([])
    const loading = ref(false)
    const errorText = ref('')
    const activeIndex = ref(0)
    const optionsLoadedOnce = ref(false)

    function searchTextOf(user: UserComboboxUser): string {
        return [user.id, user.name, user.handle, user.role]
            .map((part) => String(part || '').trim().toLowerCase())
            .join(' ')
    }

    /** 本地过滤:排除名单 + 关键词包含 */
    const filtered = computed<UserComboboxUser[]>(() => {
        const excluded = new Set((props.exclude ?? []).map((id) => id.trim()).filter(Boolean))
        const keyword = query.value.trim().toLowerCase()

        return options.value.filter((user) => {
            if (!user.id || excluded.has(user.id)) {
                return false
            }

            if (!keyword) {
                return true
            }

            return searchTextOf(user).includes(keyword)
        })
    })

    // 过滤结果变化(含排除名单更新)时收敛高亮位置
    watch(filtered, (list) => {
        if (activeIndex.value >= list.length) {
            activeIndex.value = Math.max(0, list.length - 1)
        }
    })

    async function ensureOptions(): Promise<void> {
        if (optionsLoadedOnce.value) {
            return
        }

        loading.value = true
        errorText.value = ''

        try {
            options.value = await props.fetchOptions()
            optionsLoadedOnce.value = true
        } catch (error) {
            options.value = []
            errorText.value = error instanceof Error ? error.message : '用户列表加载失败'
        } finally {
            loading.value = false
        }
    }

    function openMenu(): void {
        void ensureOptions()
        popoverRef.value?.open()

        if (activeIndex.value >= filtered.value.length) {
            activeIndex.value = 0
        }
    }

    function closeMenu(): void {
        popoverRef.value?.close()
    }

    function initialOf(user: UserComboboxUser): string {
        return (user.name || user.id || 'U').charAt(0).toUpperCase()
    }

    /** 选中:上报 id 并复位输入(收起浮层,回焦输入框便于连续添加) */
    function choose(id: string): void {
        const safe = id.trim()

        if (!safe) {
            return
        }

        emit('select', safe)
        query.value = ''
        activeIndex.value = 0
        popoverRef.value?.close()
        inputRef.value?.focus()
    }

    /** 键盘:↑↓ 循环高亮;Enter 优先选高亮项,无候选时把输入原文当自由 ID 上报 */
    function handleKeydown(event: KeyboardEvent): void {
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault()

            const count = filtered.value.length

            if (!count) {
                return
            }

            const offset = event.key === 'ArrowDown' ? 1 : -1

            activeIndex.value = (activeIndex.value + offset + count) % count

            return
        }

        if (event.key === 'Enter') {
            event.preventDefault()

            const active = filtered.value[activeIndex.value]

            choose(active ? active.id : query.value.trim())
        }
    }
</script>

<style scoped>
    .user-combobox-input {
        width: 100%;
    }

    .user-combobox-menu {
        max-height: 216px;
        overflow-y: auto;
        padding: 4px;
    }

    .user-combobox-state {
        color: var(--color-text-secondary);
        font-size: 12px;
        padding: 10px;
    }

    .user-combobox-option {
        width: 100%;
        min-height: 44px;
        border: none;
        border-radius: 7px;
        background: transparent;
        display: grid;
        grid-template-columns: 28px minmax(0, 1fr);
        align-items: center;
        gap: 10px;
        padding: 6px 9px;
        font: inherit;
        cursor: pointer;
        text-align: left;
    }

    .user-combobox-option:hover,
    .user-combobox-option.active {
        background: var(--color-bg-hover);
    }

    .user-combobox-avatar {
        width: 28px;
        height: 28px;
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

    .user-combobox-meta {
        min-width: 0;
        display: grid;
        gap: 2px;
    }

    .user-combobox-name,
    .user-combobox-handle {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    .user-combobox-name {
        color: var(--color-text-primary);
        font-size: 13px;
        font-weight: 650;
    }

    .user-combobox-handle {
        color: var(--color-text-secondary);
        font-size: 12px;
    }
</style>
