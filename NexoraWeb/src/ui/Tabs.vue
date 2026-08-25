<!--
    Tabs.vue — GDDP 通用标签页切换

    下划线式 Tab(对齐原版页面内 Tab 视觉):
      - v-model 绑定当前值,tabs 配置驱动渲染(value/label/icon)
      - 视觉样式在 styles/tabs.css(经 gddp.css 统一引入),
        宿主只负责外边距等布局间距(class 直接落在根元素上)
-->

<template>
    <div class="gddp-tabs" role="tablist">
        <button
            v-for="tab in tabs"
            :key="tab.value"
            type="button"
            role="tab"
            class="gddp-tab"
            :class="{ 'is-active': tab.value === modelValue }"
            :aria-selected="tab.value === modelValue"
            @click="select(tab.value)"
        >
            <i v-if="tab.icon" :class="tab.icon" aria-hidden="true"></i>
            <span>{{ tab.label }}</span>
        </button>
    </div>
</template>

<script setup lang="ts">
    export interface GddpTabItem {
        /** 唯一值(v-model 回传) */
        value: string
        /** 显示文字 */
        label: string
        /** 前置图标(fa class) */
        icon?: string
    }

    const props = defineProps<{
        /** 当前激活值 */
        modelValue: string
        /** 标签配置 */
        tabs: GddpTabItem[]
    }>()

    const emit = defineEmits<{
        'update:modelValue': [value: string]
    }>()

    /** 切换标签(重复点击当前项不回传) */
    function select(value: string): void {
        if (value !== props.modelValue) {
            emit('update:modelValue', value)
        }
    }
</script>
