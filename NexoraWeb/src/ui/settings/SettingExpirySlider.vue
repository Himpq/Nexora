<!--
    SettingExpirySlider.vue — 有效期滑条(General Design Development Package)

    对齐原版 renderExpirySlider / setExpiryIndex:
      - range 滑条 + 当前值展示 + 分段 mark(每个档位一个可点按钮)
      - 通过 v-model 双向绑定档位 id(如 7d / forever)
      - mark 点击 / 滑条拖动均生效

    用法:
      <SettingExpirySlider
          v-model="expire"
          :options="[{ value: '1d', label: '1 天' }, { value: 'forever', label: '永久' }]"
      />
-->

<template>
    <div class="setting-expiry-slider">
        <div class="setting-expiry-slider-current">
            <span>当前</span>
            <strong>{{ currentLabel }}</strong>
        </div>
        <input
            class="setting-expiry-slider-input"
            type="range"
            min="0"
            :max="Math.max(0, options.length - 1)"
            step="1"
            :value="currentIndex"
            :style="{ '--settings-expiry-progress': `${progress}%` }"
            aria-label="有效期"
            @input="onInput"
        >
        <div class="setting-expiry-slider-marks" :style="{ '--settings-expiry-count': String(options.length) }">
            <button
                v-for="(option, index) in options"
                :key="option.value"
                type="button"
                class="setting-expiry-slider-mark"
                :class="{ active: index === currentIndex }"
                :aria-pressed="index === currentIndex ? 'true' : 'false'"
                @click="selectIndex(index)"
            >{{ option.label }}</button>
        </div>
    </div>
</template>

<script setup lang="ts">
    import { computed } from 'vue'

    export interface SettingExpiryOption {
        value: string
        label: string
    }

    const props = withDefaults(defineProps<{
        modelValue: string
        options: SettingExpiryOption[]
    }>(), {
        modelValue: '',
        options: () => [],
    })

    const emit = defineEmits<{
        'update:modelValue': [value: string]
    }>()

    /** 当前选中档位索引(找不到时回退到 0) */
    const currentIndex = computed(() => {
        const found = props.options.findIndex((option) => option.value === props.modelValue)

        return found >= 0 ? found : 0
    })

    /** 当前档位文案 */
    const currentLabel = computed(() => {
        return props.options[currentIndex.value]?.label || '请选择'
    })

    /** 滑条进度百分比(多档时按索引均分,对齐原版 setExpiryIndex) */
    const progress = computed(() => {
        const count = props.options.length

        return count <= 1 ? 0 : (currentIndex.value / (count - 1)) * 100
    })

    function onInput(event: Event): void {
        const index = Number((event.target as HTMLInputElement).value)

        selectIndex(index)
    }

    function selectIndex(index: number): void {
        const option = props.options[index]

        if (option) {
            emit('update:modelValue', option.value)
        }
    }
</script>

<style scoped>
    .setting-expiry-slider {
        min-width: 0;
        padding: 2px 2px 0;
    }

    .setting-expiry-slider-current {
        display: flex;
        align-items: baseline;
        justify-content: flex-end;
        gap: 6px;
        margin-bottom: 8px;
        font-size: 12px;
        color: #7a7a7a;
        line-height: 1.4;
    }

    .setting-expiry-slider-current strong {
        color: #111111;
        font-size: 13px;
        font-weight: 650;
    }

    .setting-expiry-slider-input {
        appearance: none;
        width: 100%;
        height: 4px;
        margin: 10px 0 8px;
        padding: 0;
        border: 0;
        border-radius: 2px;
        outline: none;
        cursor: pointer;
        background: linear-gradient(
            to right,
            #111111 0,
            #111111 var(--settings-expiry-progress),
            #dbe2ea var(--settings-expiry-progress),
            #dbe2ea 100%
        );
    }

    .setting-expiry-slider-input::-webkit-slider-thumb {
        appearance: none;
        width: 18px;
        height: 18px;
        border-radius: 50%;
        background: #ffffff;
        border: 2px solid #111111;
        box-shadow: 0 1px 3px rgba(15, 23, 42, 0.2);
    }

    .setting-expiry-slider-input::-moz-range-thumb {
        width: 14px;
        height: 14px;
        border-radius: 50%;
        background: #ffffff;
        border: 2px solid #111111;
        box-shadow: 0 1px 3px rgba(15, 23, 42, 0.2);
    }

    .setting-expiry-slider-input:focus-visible::-webkit-slider-thumb {
        box-shadow: 0 0 0 4px rgba(15, 23, 42, 0.14);
    }

    .setting-expiry-slider-marks {
        display: grid;
        gap: 4px;
        grid-template-columns: repeat(var(--settings-expiry-count), minmax(0, 1fr));
    }

    .setting-expiry-slider-mark {
        appearance: none;
        min-width: 0;
        padding: 4px 0;
        border: 0;
        background: transparent;
        color: #999999;
        font-size: 11px;
        line-height: 1.25;
        text-align: center;
        white-space: normal;
        cursor: pointer;
    }

    .setting-expiry-slider-mark:first-child {
        text-align: left;
    }

    .setting-expiry-slider-mark:last-child {
        text-align: right;
    }

    .setting-expiry-slider-mark.active {
        color: #111111;
        font-weight: 650;
    }
</style>
