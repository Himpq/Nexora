<template>
    <ModelSelectBase
        v-model="selectedModelValue"
        :models="models"
        :loading="modelStore.loading"
        leading-label="自动"
        :leading-placeholder="placeholder"
        :width="width"
        popover-key="gddp-memory-model-select"
        :empty-label="modelStore.loading ? '正在读取可用模型...' : '暂无可用模型'"
    />
</template>

<script setup lang="ts">
    import { computed } from 'vue'

    import { toModelSelectOptions } from '@/ui/model/adapter'
    import { useModelStore } from '@/stores/model'

    import ModelSelectBase from '@/ui/model/ModelSelectBase.vue'

    const props = defineProps<{
        modelValue: string | number
        width?: string
        placeholder?: string
    }>()

    const emit = defineEmits<{
        'update:modelValue': [value: string]
    }>()

    // 模型目录统一取自 modelStore 单一来源,不再自行拉取/规范化,避免重复取数
    const modelStore = useModelStore()
    const models = computed(() => toModelSelectOptions(modelStore.models))
    const placeholder = props.placeholder || '请选择'
    const width = props.width
    const modelValue = computed(() => String(props.modelValue))
    const selectedModelValue = computed({
        get: () => modelValue.value,
        set: (value: string) => emit('update:modelValue', value),
    })
</script>
