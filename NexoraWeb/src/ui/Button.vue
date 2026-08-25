<template>
    <button
        :type="type"
        :class="buttonClasses"
        :disabled="disabled"
        @click="$emit('click', $event)"
    >
        <i v-if="icon" :class="icon" aria-hidden="true"></i>
        <span v-if="$slots.default"><slot /></span>
    </button>
</template>

<script setup lang="ts">
    import { computed } from 'vue'

    const props = withDefaults(defineProps<{
        variant?: 'primary' | 'secondary' | 'danger' | 'quiet'
        size?: 'regular' | 'compact' | 'icon'
        type?: 'button' | 'submit' | 'reset'
        icon?: string
        disabled?: boolean
    }>(), {
        variant: 'secondary',
        size: 'regular',
        type: 'button',
        disabled: false,
    })

    defineEmits<{
        click: [event: MouseEvent]
    }>()

    const buttonClasses = computed(() => [
        'gddp-button',
        `gddp-button-${props.variant}`,
        `gddp-button-${props.size}`,
        {
            'gddp-button-icon-only': props.size === 'icon',
        },
    ])
</script>
