<template>
    <img
        v-if="props.iconUrl"
        :class="['provider-logo', sizeClass]"
        :src="props.iconUrl"
        alt=""
    />
    <span v-else :class="['provider-logo', 'provider-logo-fallback', sizeClass]">
        {{ fallbackText }}
    </span>
</template>

<script setup lang="ts">
    import { computed } from 'vue'

    const props = withDefaults(defineProps<{
        iconUrl?: string
        fallbackText: string
        size?: 'sm' | 'md'
    }>(), {
        size: 'sm',
    })

    const sizeClass = computed(() => `provider-logo-${props.size}`)
</script>
