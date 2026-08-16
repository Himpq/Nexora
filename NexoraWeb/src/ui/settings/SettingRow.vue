<!--
    SettingRow.vue — 设置行(可复用左右布局)

    提取自设置面板高频出现的"标签+说明 居左 / 控件 居右"行。
    视觉:白卡片内细分隔线、标签加粗、说明浅灰、控件右对齐。

    用法:
      <SettingRow label="用户名" hint="登录时使用的名称" name="profile-username">
          <input v-model="name" class="setting-input" />
      </SettingRow>
-->

<template>
    <div class="setting-row" :class="{ 'no-control': !$slots.default }">
        <div class="setting-row-main">
            <div class="setting-row-label">{{ label }}</div>
            <div v-if="hint" class="setting-row-hint">{{ hint }}</div>
        </div>
        <div v-if="$slots.default" class="setting-row-control">
            <slot />
        </div>
    </div>
</template>

<script setup lang="ts">
    defineProps<{
        label: string
        hint?: string
    }>()
</script>