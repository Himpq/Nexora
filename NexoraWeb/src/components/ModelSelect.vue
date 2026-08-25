<template>
    <ModelSelectBase
        :models="models"
        :model-value="modelStore.selectedId"
        :popover-key="popoverKey"
        :container-id="containerId"
        @update:model-value="modelStore.selectModel"
    />
</template>

<script setup lang="ts">
    import { computed } from 'vue'

    import type { ModelItem } from '@/api/config'
    import { toModelSelectOptions } from '@/ui/model/adapter'
    import { useModelStore } from '@/stores/model'

    import ModelSelectBase from '@/ui/model/ModelSelectBase.vue'

    const props = withDefaults(defineProps<{
        models: ModelItem[]
        popoverKey?: string
        containerId?: string
    }>(), {
        popoverKey: 'model-select',
        containerId: 'modelSelectContainer',
    })

    const modelStore = useModelStore()
    const models = computed(() => toModelSelectOptions(props.models))
</script>
