<!--
    ModelSelect.vue — 模型选择器(逐像素复刻原版 custom-select 结构)

    结构(与原版 chat_model_select.js 一致):
      custom-select-container > select-selected + select-items
      select-items > model-group(provider 分组) > model-chip-wrap > model-chip
-->

<template>
    <div ref="containerRef" class="custom-select-container" id="modelSelectContainer">
        <div class="select-selected" id="currentModelDisplay" @click="toggleOpen">
            {{ selectedLabel }}
        </div>

        <div class="select-items" :class="{ 'select-hide': !open }" id="modelOptions">
            <div class="model-options-scroll">
                <section v-for="group in groups" :key="group.provider" class="model-group">
                    <div class="model-group-title">
                        <span class="provider-title-main">
                            <img
                                v-if="group.icon"
                                class="provider-logo provider-logo-sm"
                                :src="group.icon"
                                alt=""
                            />
                            <span v-else class="provider-logo provider-logo-sm provider-logo-fallback">
                                {{ group.fallback }}
                            </span>
                            <span class="label">{{ group.provider }}</span>
                        </span>
                    </div>
                    <div class="model-chip-wrap">
                        <button
                            v-for="model in group.models"
                            :key="model.id"
                            type="button"
                            class="model-chip"
                            :class="{ 'same-as-selected': model.id === selectedId }"
                            :data-model-id="model.id"
                            role="option"
                            :aria-selected="model.id === selectedId ? 'true' : 'false'"
                            @click="handleSelect(model.id)"
                        >
                            <span class="model-chip-name" :title="model.name">{{ model.name }}</span>
                            <span
                                v-if="model.status"
                                class="model-chip-status"
                                :class="`model-status-${normalizeStatus(model.status)}`"
                            >
                                {{ statusLabel(model.status) }}
                            </span>
                        </button>
                    </div>
                </section>
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
    import { computed, ref } from 'vue'

    import type { ModelItem } from '@/api/config'
    import { providerIconFallbackText, resolveProviderIconSlug, resolveProviderIconUrl } from '@/api/providerIcons'
    import { useModelStore } from '@/stores/model'
    import { closePopover, openPopover, overlay } from '@/ui/overlay'

    const props = defineProps<{
        models: ModelItem[]
    }>()

    const modelStore = useModelStore()

    const selectedId = computed(() => modelStore.selectedId)

    /** 按 provider 分组(保持原版分组渲染) */
    const groups = computed(() => {
        const map = new Map<string, ModelItem[]>()

        props.models.forEach((model) => {
            const provider = resolveProviderIconSlug(model.provider) || String(model.provider || 'other').toLowerCase()

            if (!map.has(provider)) {
                map.set(provider, [])
            }

            map.get(provider)!.push(model)
        })

        return Array.from(map.entries()).map(([provider, models]) => ({
            provider,
            icon: resolveProviderIconUrl(provider),
            fallback: providerIconFallbackText(provider),
            models,
        }))
    })

    const selectedLabel = computed(() => {
        const model = props.models.find((item) => item.id === selectedId.value)

        return model ? model.name : 'Select Model'
    })

    const STATUS_LABELS: Record<string, string> = {
        good: '良好',
        normal: '正常',
        fast: '快速',
        slow: '缓慢',
        error: '错误',
    }

    function normalizeStatus(status: string): string {
        return String(status || 'normal').toLowerCase()
    }

    function statusLabel(status: string): string {
        return STATUS_LABELS[normalizeStatus(status)] || String(status || '').toUpperCase()
    }

    const containerRef = ref<HTMLElement | null>(null)

    /** 下拉打开状态:由浮层协调器统一管理(自动外部关闭 + 互斥) */
    const open = computed(() => overlay.popover === 'model-select')

    function toggleOpen(): void {
        if (open.value) {
            closePopover('model-select')

            return
        }

        openPopover('model-select', containerRef.value)
    }

    function handleSelect(modelId: string): void {
        modelStore.selectModel(modelId)

        closePopover('model-select')
    }
</script>
