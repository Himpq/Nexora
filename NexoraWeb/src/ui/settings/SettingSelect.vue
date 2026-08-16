<!--
    SettingSelect.vue — 设置通用下拉(General Design Development Package)

    设计:
      - 自建下拉(禁用原生 select/Chrome 样式),按钮 + 浮层列表
      - 点击外部 / Esc 关闭;选中后自动关闭
      - 支持禁用的占位选项(placeholder)

    用法:
      <SettingSelect
          v-model="theme"
          :options="[{ value: 'light', label: '浅色' }, { value: 'dark', label: '深色' }]"
          width="160px"
      />
-->

<template>
    <div ref="wrapRef" class="setting-select" :style="width ? { width } : undefined">
        <button
            ref="triggerRef"
            type="button"
            class="setting-select-trigger"
            :class="{ open: open }"
            :aria-expanded="open"
            @click.stop="toggle"
        >
            <span class="setting-select-label">{{ selectedLabel }}</span>
            <i class="fa-solid fa-chevron-down" aria-hidden="true"></i>
        </button>

        <div class="setting-select-menu" :class="{ open }" :style="menuStyle" role="listbox">
            <button
                v-for="option in options"
                :key="String(option.value)"
                type="button"
                role="option"
                :class="{ active: String(option.value) === String(modelValue) }"
                @click="select(option.value)"
            >{{ option.label }}</button>
        </div>
    </div>
</template>

<script setup lang="ts">
    import { computed, onBeforeUnmount, onMounted, ref } from 'vue'

    export interface SettingSelectOption {
        value: string | number
        label: string
    }

    const props = defineProps<{
        modelValue: string | number
        options: SettingSelectOption[]
        width?: string
        placeholder?: string
    }>()

    const emit = defineEmits<{
        'update:modelValue': [value: string | number]
    }>()

    const open = ref(false)
    const wrapRef = ref<HTMLElement | null>(null)
    const triggerRef = ref<HTMLElement | null>(null)

    /** 菜单定位(fixed,避免被滚动容器裁剪) */
    const menuStyle = ref<Record<string, string>>({})

    const selectedLabel = computed(() => {
        const matched = props.options.find((option) => String(option.value) === String(props.modelValue))

        return matched ? matched.label : (props.placeholder || '请选择')
    })

    onMounted(() => {
        document.addEventListener('click', onPageClick)
        document.addEventListener('keydown', onKeydown)
        document.addEventListener('scroll', onScroll, true)
    })

    onBeforeUnmount(() => {
        document.removeEventListener('click', onPageClick)
        document.removeEventListener('keydown', onKeydown)
        document.removeEventListener('scroll', onScroll, true)
    })

    function onPageClick(event: MouseEvent): void {
        if (wrapRef.value && !wrapRef.value.contains(event.target as Node)) {
            open.value = false
        }
    }

    function onKeydown(event: KeyboardEvent): void {
        if (event.key === 'Escape') {
            open.value = false
        }
    }

    /** 页面滚动时关闭浮层,避免错位 */
    function onScroll(): void {
        if (open.value) {
            open.value = false
        }
    }

    function toggle(): void {
        open.value = !open.value

        if (open.value) {
            positionMenu()
        }
    }

    /** 依据触发器位置定位菜单(覆盖 absolute 定位,防滚动容器裁剪) */
    function positionMenu(): void {
        const trigger = triggerRef.value

        if (!trigger) {
            return
        }

        const rect = trigger.getBoundingClientRect()

        menuStyle.value = {
            position: 'fixed',
            top: `${rect.bottom + 4}px`,
            left: `${rect.left}px`,
            right: 'auto',
            minWidth: `${rect.width}px`,
        }
    }

    function select(value: string | number): void {
        emit('update:modelValue', value)
        open.value = false
    }
</script>