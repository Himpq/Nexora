<!--
    SettingInput.vue — 设置通用输入(General Design Development Package)

    设计:
      - 统一宽度策略:默认 260px,按需传 width,禁止无脑 100%
      - 复用 .input-modern 视觉(白底/浅描边/focus 黑描边)
      - v-model 双向绑定,透传原生 input 属性

    用法:
      <SettingInput v-model="name" width="240px" placeholder="输入名称" />
-->

<template>
    <input
        class="input-modern"
        :class="inputClass"
        :style="width ? { width } : undefined"
        :type="type"
        :placeholder="placeholder"
        :maxlength="maxlength"
        :readonly="readonly"
        :disabled="disabled"
        :value="modelValue"
        @input="handleInput"
    >
</template>

<script setup lang="ts">
    defineProps<{
        modelValue: string
        type?: string
        placeholder?: string
        maxlength?: number
        width?: string
        inputClass?: string
        readonly?: boolean
        disabled?: boolean
    }>()

    const emit = defineEmits<{
        'update:modelValue': [value: string]
    }>()

    function handleInput(event: Event): void {
        emit('update:modelValue', (event.target as HTMLInputElement).value)
    }
</script>