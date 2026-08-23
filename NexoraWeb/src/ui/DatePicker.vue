<!--
    DatePicker.vue — 紧凑日期范围选择卡片(General Design Development Package)

    设计:
      - 纯浮层内容件:放在 ui/Popover 默认插槽内使用(Popover 每次打开重挂载,
        本组件 setup 即完成状态初始化,无需 watch 复位)
      - 开始-截止双模式接续选择:起始模式选定后自动切截止;起始晚于原截止自动清空截止;
        截止早于起始时改设为起始(对齐 Workspaces 任务排期交互)
      - 紧凑尺寸:7×26px 列网格,整体宽约 240px,替代旧内嵌大日历

    用法:
      <Popover>
          <template #trigger="{ toggle }">
              <button @click="toggle()">时间范围</button>
          </template>
          <DatePicker :start="start" :due="due" @change="onChange" @done="close" />
      </DatePicker>
-->

<template>
    <div class="g-datepicker">
        <div class="g-datepicker-head">
            <button class="g-datepicker-nav" type="button" title="上个月" aria-label="上个月" @click="shiftMonth(-1)">
                <i class="fa-solid fa-chevron-left" aria-hidden="true"></i>
            </button>
            <strong>{{ monthLabel }}</strong>
            <button class="g-datepicker-nav" type="button" title="下个月" aria-label="下个月" @click="shiftMonth(1)">
                <i class="fa-solid fa-chevron-right" aria-hidden="true"></i>
            </button>
        </div>

        <div class="g-datepicker-modes" role="group" aria-label="日期范围">
            <button type="button" :class="{ active: pickMode === 'start' }" :aria-pressed="pickMode === 'start'" @click="pickMode = 'start'">开始</button>
            <button type="button" :class="{ active: pickMode === 'due' }" :aria-pressed="pickMode === 'due'" @click="pickMode = 'due'">截止</button>
        </div>

        <div class="g-datepicker-weekdays">
            <span v-for="day in WEEKDAYS" :key="day">{{ day }}</span>
        </div>

        <div class="g-datepicker-grid">
            <button
                v-for="cell in cells"
                :key="cell.dateKey"
                class="g-datepicker-day"
                :class="{
                    'is-muted': cell.outsideMonth,
                    'is-today': cell.isToday,
                    'is-start': cell.dateKey === start,
                    'is-due': cell.dateKey === due,
                    'is-in-range': cell.inRange,
                }"
                type="button"
                :aria-label="cell.dateKey"
                @click="selectDay(cell.dateKey)"
            >
                <span>{{ cell.dayNumber }}</span>
            </button>
        </div>

        <div class="g-datepicker-actions">
            <button type="button" @click="clear">清空</button>
            <button type="button" @click="emit('done')">完成</button>
        </div>
    </div>
</template>

<script setup lang="ts">
    import { computed, ref } from 'vue'

    import { dateRangeMonth, formatDateKey, isValidDateKey } from '@/ui/date'

    const props = defineProps<{
        /** 开始日期 YYYY-MM-DD,空串表示未选 */
        start: string
        /** 截止日期 YYYY-MM-DD,空串表示未选 */
        due: string
    }>()

    const emit = defineEmits<{
        /** 任一端日期变化(含清空) */
        change: [range: { start: string; due: string }]
        /** 用户点击 完成/清空,请求收起浮层 */
        done: []
    }>()

    const WEEKDAYS = ['一', '二', '三', '四', '五', '六', '日']

    const pickMode = ref<'start' | 'due'>(props.start ? 'due' : 'start')
    const monthValue = ref(dateRangeMonth(props.start, props.due))

    const monthLabel = computed(() => {
        const month = monthValue.value

        return `${month.slice(0, 4)}年${month.slice(5, 7)}月`
    })

    /** 月份平移 */
    function shiftMonth(offset: number): void {
        const month = monthValue.value
        const year = Number(month.slice(0, 4))
        const monthIndex = Number(month.slice(5, 7)) - 1 + offset

        monthValue.value = formatDateKey(new Date(year, monthIndex, 1)).slice(0, 7)
    }

    interface PickerCell {
        dateKey: string
        dayNumber: number
        outsideMonth: boolean
        isToday: boolean
        inRange: boolean
    }

    const cells = computed<PickerCell[]>(() => {
        const month = monthValue.value
        const year = Number(month.slice(0, 4))
        const monthIndex = Number(month.slice(5, 7)) - 1
        const monthStart = new Date(year, monthIndex, 1)
        // 周一为第一列:周日偏移 6 天
        const firstDayOffset = (monthStart.getDay() + 6) % 7
        const gridStart = new Date(year, monthIndex, 1 - firstDayOffset)
        const today = formatDateKey(new Date())
        const result: PickerCell[] = []

        for (let index = 0; index < 42; index += 1) {
            const day = new Date(gridStart.getFullYear(), gridStart.getMonth(), gridStart.getDate() + index)
            const dateKey = formatDateKey(day)

            result.push({
                dateKey,
                dayNumber: day.getDate(),
                outsideMonth: day.getMonth() !== monthIndex,
                isToday: dateKey === today,
                inRange: Boolean(props.start && props.due && dateKey > props.start && dateKey < props.due),
            })
        }

        return result
    })

    /**
     * 选日(对齐 Workspaces 任务排期):
     * 开始模式直接设开始,原截止早于新开始则清空并切到截止模式;
     * 截止模式早于开始时改设为开始,否则设截止并请求收起。
     */
    function selectDay(dateKey: string): void {
        if (!isValidDateKey(dateKey)) {
            return
        }

        if (pickMode.value === 'start') {
            const nextDue = props.due && props.due >= dateKey ? props.due : ''

            emit('change', { start: dateKey, due: nextDue })
            pickMode.value = 'due'

            return
        }

        if (!props.start || dateKey < props.start) {
            emit('change', { start: dateKey, due: '' })

            return
        }

        emit('change', { start: props.start, due: dateKey })
        pickMode.value = 'start'
        emit('done')
    }

    function clear(): void {
        emit('change', { start: '', due: '' })
        pickMode.value = 'start'
        emit('done')
    }
</script>

<style scoped>
    .g-datepicker {
        width: 244px;
        padding: 8px;
    }

    .g-datepicker-head {
        height: 30px;
        display: grid;
        grid-template-columns: 26px minmax(0, 1fr) 26px;
        align-items: center;
    }

    .g-datepicker-head strong {
        color: var(--color-text-primary);
        font-size: 13px;
        font-weight: 700;
        text-align: center;
    }

    .g-datepicker-nav {
        width: 26px;
        height: 26px;
        border: none;
        border-radius: 6px;
        background: transparent;
        color: var(--color-text-secondary);
        display: inline-flex;
        align-items: center;
        justify-content: center;
        font-size: 11px;
        cursor: pointer;
    }

    .g-datepicker-nav:hover {
        background: var(--color-bg-hover);
        color: var(--color-text-primary);
    }

    .g-datepicker-modes {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 6px;
        margin-bottom: 8px;
    }

    .g-datepicker-modes button {
        height: 26px;
        border: 1px solid var(--color-border);
        border-radius: 6px;
        background: var(--color-bg-elevated);
        color: var(--color-text-secondary);
        font: inherit;
        font-size: 12px;
        font-weight: 650;
        cursor: pointer;
    }

    .g-datepicker-modes button.active {
        border-color: var(--color-text-primary);
        background: var(--color-text-primary);
        color: var(--color-bg-page);
    }

    .g-datepicker-weekdays,
    .g-datepicker-grid {
        display: grid;
        grid-template-columns: repeat(7, 30px);
        justify-content: center;
    }

    .g-datepicker-weekdays span {
        height: 22px;
        color: var(--color-text-secondary);
        display: inline-flex;
        align-items: center;
        justify-content: center;
        font-size: 11px;
        font-weight: 650;
    }

    .g-datepicker-grid {
        gap: 2px;
    }

    .g-datepicker-day {
        width: 30px;
        height: 26px;
        border: none;
        border-radius: 6px;
        background: transparent;
        color: var(--color-text-secondary);
        display: inline-flex;
        align-items: center;
        justify-content: center;
        font: inherit;
        font-size: 12px;
        font-weight: 650;
        font-variant-numeric: tabular-nums;
        cursor: pointer;
    }

    .g-datepicker-day:hover {
        background: var(--color-bg-hover);
        color: var(--color-text-primary);
    }

    .g-datepicker-day.is-muted {
        opacity: 0.5;
    }

    .g-datepicker-day.is-today span {
        width: 20px;
        height: 20px;
        border: 1px solid var(--color-text-primary);
        border-radius: 999px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
    }

    .g-datepicker-day.is-in-range {
        background: var(--color-bg-hover);
        color: var(--color-text-primary);
    }

    .g-datepicker-day.is-start,
    .g-datepicker-day.is-due {
        background: var(--color-text-primary);
        color: var(--color-bg-page);
    }

    .g-datepicker-actions {
        display: flex;
        justify-content: flex-end;
        gap: 6px;
        margin-top: 8px;
    }

    .g-datepicker-actions button {
        height: 26px;
        border: 1px solid var(--color-border);
        border-radius: 6px;
        background: var(--color-bg-elevated);
        color: var(--color-text-secondary);
        font: inherit;
        font-size: 12px;
        font-weight: 650;
        padding: 0 10px;
        cursor: pointer;
    }

    .g-datepicker-actions button:hover {
        border-color: var(--color-border-strong);
        background: var(--color-bg-sunken);
        color: var(--color-text-primary);
    }
</style>
