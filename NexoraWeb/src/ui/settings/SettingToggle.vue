<!--
    SettingToggle.vue — 设置通用开关(General Design Development Package)

    设计:
      - 白底细描边开关,accent 黑;标签在右
      - v-model 双向绑定布尔值

    用法:
      <SettingToggle v-model="streaming" label="流式输出" hint="回复时逐字流式显示" />
-->

<template>
    <label class="setting-toggle">
        <span class="setting-toggle-main">
            <span class="setting-toggle-label">{{ label }}</span>
            <span v-if="hint" class="setting-toggle-hint">{{ hint }}</span>
        </span>
        <input v-model="checked" type="checkbox">
    </label>
</template>

<script setup lang="ts">
    import { computed } from 'vue'

    const props = defineProps<{
        modelValue: boolean
        label: string
        hint?: string
    }>()

    const emit = defineEmits<{
        'update:modelValue': [value: boolean]
    }>()

    const checked = computed({
        get: () => props.modelValue,
        set: (value: boolean) => emit('update:modelValue', value),
    })
</script>