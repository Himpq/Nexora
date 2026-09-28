<template>
    <ModelSelectBase
        :models="models"
        :model-value="selectedId"
        :popover-key="popoverKey"
        :container-id="containerId"
        :leading-placeholder="leadingPlaceholder"
        :empty-label="emptyLabel"
        @update:model-value="select"
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
        /**
         * 受控模式:传入 onSelect 后不再读写云端 modelStore。
         * 远程视图要用「当前这台电脑的模型目录」复用同一个选择器,
         * 不能把电脑的模型写进云端的全局选中项里。
         */
        selectedId?: string
        onSelect?: (id: string) => void
        /** 未选中时触发器上的文案(远程视图为空选=电脑默认模型) */
        leadingPlaceholder?: string
        emptyLabel?: string
    }>(), {
        popoverKey: 'model-select',
        containerId: 'modelSelectContainer',
        selectedId: undefined,
        onSelect: undefined,
        leadingPlaceholder: undefined,
        emptyLabel: '暂无可用模型',
    })

    const modelStore = useModelStore()
    const models = computed(() => toModelSelectOptions(props.models))

    const isControlled = computed(() => typeof props.onSelect === 'function')

    const selectedId = computed(() => isControlled.value ? props.selectedId || '' : modelStore.selectedId)

    function select(id: string): void {
        if (props.onSelect) {
            props.onSelect(id)

            return
        }

        modelStore.selectModel(id)
    }
</script>
