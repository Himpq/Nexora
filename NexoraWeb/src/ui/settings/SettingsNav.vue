<!--
    SettingsNav.vue — 设置导航(分组列表)

    提取自设置窗口侧栏:基础组 + 管理员组(按角色显示)。
    视觉:分组小标题 + 图标项,浅色底、圆角、激活态靛蓝。

    用法:
      <SettingsNav :groups="groups" :active="activeKey" @select="key => activeKey = key" />
-->

<template>
    <nav class="settings-nav" aria-label="设置导航">
        <div v-for="group in groups" :key="group.label" class="settings-nav-group">
            <div v-if="group.label" class="settings-nav-group-label">{{ group.label }}</div>
            <button
                v-for="item in group.items"
                :key="item.key"
                type="button"
                class="settings-nav-item"
                :class="{ active: item.key === active }"
                @click="emit('select', item.key)"
            >
                <i v-if="item.icon" :class="item.icon" aria-hidden="true"></i>
                <span>{{ item.label }}</span>
            </button>
        </div>
    </nav>
</template>

<script setup lang="ts">
    export interface SettingsNavItem {
        key: string
        label: string
        icon?: string
    }

    export interface SettingsNavGroup {
        label?: string
        items: SettingsNavItem[]
    }

    defineProps<{
        groups: SettingsNavGroup[]
        active: string
    }>()

    const emit = defineEmits<{
        select: [key: string]
    }>()
</script>