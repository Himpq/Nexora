<!--
    SettingDetailSection.vue — 详情分区(General Design Development Package)

    详情内容使用分区标题和分隔线组织,不增加嵌套卡片视觉。
-->

<template>
    <section class="setting-detail-section">
        <h3 class="setting-detail-section-title">{{ title }}</h3>
        <div class="setting-detail-section-content">
            <slot />
        </div>
    </section>
</template>

<script setup lang="ts">
    defineProps<{
        title: string
    }>()
</script>

<style scoped>
    .setting-detail-section {
        padding-bottom: 16px;
        margin-bottom: 16px;
        border-bottom: 1px solid var(--color-border);
    }

    .setting-detail-section-title {
        margin: 0 0 12px;
        font-size: 11.5px;
        font-weight: 650;
        color: var(--color-text-secondary);
        letter-spacing: 0.03em;
    }

    .setting-detail-section-content {
        min-width: 0;
    }
</style>
