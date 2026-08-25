<template>
    <header class="settings-page-head">
        <div class="settings-page-head-main">
            <h2>{{ title }}</h2>
            <p>{{ description }}</p>
        </div>

        <div v-if="actions.length" class="settings-page-head-actions">
            <div class="settings-page-head-commands">
                <template v-for="action in commandActions" :key="action.method">
                    <SettingSelect
                        v-if="action.type === 'select' && isActionVisible(action)"
                        :model-value="selects[action.method]"
                        :options="action.options || []"
                        :placeholder="action.placeholder"
                        :width="action.width || '120px'"
                        @update:model-value="updateSelect(action.method, String($event))"
                    />
                    <Button
                        v-else
                        :class="{ 'is-hidden': !isActionVisible(action) }"
                        variant="secondary"
                        size="compact"
                        :icon="action.icon"
                        @click="emit('action', action.method)"
                    >{{ action.label }}</Button>
                </template>
            </div>

            <div
                v-for="action in tabActions"
                :key="action.method"
                class="settings-page-head-tabs"
                role="tablist"
            >
                <button
                    v-for="option in action.options || []"
                    :key="option.value"
                    class="settings-page-head-tab"
                    :class="{ active: subtabs[action.method] === option.value }"
                    type="button"
                    role="tab"
                    :aria-selected="subtabs[action.method] === option.value"
                    @click="emit('subtab', action.method, option.value)"
                >{{ option.label }}</button>
            </div>
        </div>
    </header>
</template>

<script setup lang="ts">
    import { computed } from 'vue'

    import Button from '@/ui/Button.vue'
    import SettingSelect from '@/ui/settings/SettingSelect.vue'

    export interface SettingsPageHeadAction {
        type?: 'button' | 'select' | 'subtabs'
        label?: string
        icon?: string
        method: string
        placeholder?: string
        options?: Array<{ value: string; label: string }>
        width?: string
        subTab?: string
    }

    const props = defineProps<{
        title?: string
        description?: string
        actions: SettingsPageHeadAction[]
        selects: Record<string, string>
        subtabs: Record<string, string>
    }>()

    const emit = defineEmits<{
        action: [method: string]
        select: [method: string, value: string]
        subtab: [method: string, value: string]
    }>()

    const commandActions = computed(() => props.actions.filter((action) => action.type !== 'subtabs'))
    const tabActions = computed(() => props.actions.filter((action) => action.type === 'subtabs'))

    function isActionVisible(action: SettingsPageHeadAction): boolean {
        if (!action.subTab) {
            return true
        }

        return Object.values(props.subtabs).includes(action.subTab)
    }

    function updateSelect(method: string, value: string): void {
        emit('select', method, value)
    }
</script>
