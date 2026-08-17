<!--
    SettingSegmented.vue — 胶囊分段切换(General Design Development Package)

    设计:
      - 灰底容器(#f3f3f3)+ active 白底浮起,全设置壳唯一分段视觉
      - 与页头 subtabs(settings-page-head-tabs)、模式切换(settings-mode-toggle)同一规则组渲染
      - v-model 绑定当前值

    用法:
      <SettingSegmented
          v-model="scope"
          :options="[
              { value: 'owner', label: '仅自己' },
              { value: 'global', label: '全局共享' },
          ]"
      />
-->

<template>
    <div class="setting-segmented" role="tablist">
        <button
            v-for="option in options"
            :key="option.value"
            type="button"
            class="setting-segmented-btn"
            :class="{ active: option.value === modelValue }"
            @click="emit('update:modelValue', option.value)"
        >
            <i v-if="option.icon" :class="option.icon" aria-hidden="true"></i>
            <span>{{ option.label }}</span>
        </button>
    </div>
</template>

<script setup lang="ts">
    interface SegmentOption {
        value: string
        label: string
        icon?: string
    }

    defineProps<{
        modelValue: string
        options: SegmentOption[]
    }>()

    const emit = defineEmits<{
        'update:modelValue': [value: string]
    }>()
</script>
