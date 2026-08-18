<template>
    <ModelSelectBase
        v-model="selectedModelValue"
        :models="models"
        :loading="loading"
        leading-label="自动"
        :leading-placeholder="placeholder"
        :width="width"
        popover-key="gddp-memory-model-select"
        :empty-label="loading ? '正在读取可用模型...' : '暂无可用模型'"
    />
</template>

<script setup lang="ts">
    import { computed, onMounted, ref } from 'vue'

    import { fetchAppConfig, normalizeModelItems } from '@/api/config'
    import { toModelSelectOptions } from '@/ui/model/adapter'
    import { showError } from '@/stores/notify'

    import ModelSelectBase from '@/ui/model/ModelSelectBase.vue'
    import type { ModelSelectOption } from '@/ui/model/types'

    const props = defineProps<{
        modelValue: string | number
        width?: string
        placeholder?: string
    }>()

    const emit = defineEmits<{
        'update:modelValue': [value: string]
    }>()

    const loading = ref(true)
    const models = ref<ModelSelectOption[]>([])
    const placeholder = props.placeholder || '请选择'
    const width = props.width
    const modelValue = computed(() => String(props.modelValue))
    const selectedModelValue = computed({
        get: () => modelValue.value,
        set: (value: string) => emit('update:modelValue', value),
    })

    onMounted(() => {
        void loadModels()
    })

    async function loadModels(): Promise<void> {
        try {
            const config = await fetchAppConfig()

            models.value = toModelSelectOptions(normalizeModelItems(config.models))
        } catch (error) {
            showError(error instanceof Error ? error.message : '加载可用模型失败')
        } finally {
            loading.value = false
        }
    }
</script>
