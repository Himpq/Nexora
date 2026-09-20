<script setup lang="ts" generic="TRow">
    import { computed, ref } from 'vue'

    type SortDirection = 'none' | 'desc' | 'asc'
    type SortValue = string | number | boolean | null | undefined

    interface GddpTableColumn<TRow> {
        key: string
        label: string
        align?: 'left' | 'center' | 'right'
        sortable?: boolean
        sortValue?: (row: TRow) => SortValue
    }

    const props = withDefaults(defineProps<{
        rows: readonly TRow[]
        columns: readonly GddpTableColumn<TRow>[]
        rowKey?: string | ((row: TRow, index: number) => string | number)
        emptyText?: string
    }>(), {
        emptyText: '暂无数据',
    })

    const sortKey = ref<string | null>(null)
    const sortDirection = ref<SortDirection>('none')

    const sortedRows = computed(() => {
        const indexedRows = props.rows.map((row, index) => ({ row, index }))

        if (!sortKey.value || sortDirection.value === 'none') {
            return indexedRows
        }

        const column = props.columns.find((item) => item.key === sortKey.value)

        if (!column || column.sortable === false) {
            return indexedRows
        }

        const direction = sortDirection.value === 'desc' ? -1 : 1

        return indexedRows
            .slice()
            .sort((left, right) => {
                const result = compareValues(getSortValue(column, left.row), getSortValue(column, right.row))

                return result === 0 ? left.index - right.index : result * direction
            })
    })

    function getCellValue(row: TRow, key: string): unknown {
        return (row as Record<string, unknown>)[key]
    }

    function getSortValue(column: GddpTableColumn<TRow>, row: TRow): SortValue {
        return column.sortValue ? column.sortValue(row) : getCellValue(row, column.key) as SortValue
    }

    function compareValues(left: SortValue, right: SortValue): number {
        if (left === null || left === undefined) {
            return right === null || right === undefined ? 0 : 1
        }

        if (right === null || right === undefined) {
            return -1
        }

        if (typeof left === 'number' && typeof right === 'number') {
            return left === right ? 0 : left < right ? -1 : 1
        }

        return String(left).localeCompare(String(right), 'zh-CN', {
            numeric: true,
            sensitivity: 'base',
        })
    }

    function toggleSort(column: GddpTableColumn<TRow>): void {
        if (column.sortable === false) {
            return
        }

        if (sortKey.value !== column.key) {
            sortKey.value = column.key
            sortDirection.value = 'desc'

            return
        }

        if (sortDirection.value === 'desc') {
            sortDirection.value = 'asc'

            return
        }

        sortKey.value = null
        sortDirection.value = 'none'
    }

    function headerAriaSort(column: GddpTableColumn<TRow>): 'ascending' | 'descending' | 'none' {
        if (sortKey.value !== column.key || sortDirection.value === 'none') {
            return 'none'
        }

        return sortDirection.value === 'desc' ? 'descending' : 'ascending'
    }

    function sortButtonLabel(column: GddpTableColumn<TRow>): string {
        if (sortKey.value !== column.key || sortDirection.value === 'none') {
            return `按${column.label}降序排序`
        }

        return sortDirection.value === 'desc'
            ? `按${column.label}升序排序`
            : `恢复${column.label}自然顺序`
    }

    function sortIcon(column: GddpTableColumn<TRow>): string {
        if (sortKey.value !== column.key || sortDirection.value === 'none') {
            return 'fa-solid fa-sort'
        }

        return sortDirection.value === 'desc' ? 'fa-solid fa-sort-down' : 'fa-solid fa-sort-up'
    }

    function resolveRowKey(row: TRow, index: number): string | number {
        if (typeof props.rowKey === 'function') {
            return props.rowKey(row, index)
        }

        if (props.rowKey) {
            const value = getCellValue(row, props.rowKey)

            if (value !== null && value !== undefined && value !== '') {
                return String(value)
            }
        }

        return index
    }

    function formatCellValue(value: unknown): string {
        return value === null || value === undefined ? '' : String(value)
    }
</script>

<template>
    <div class="gddp-table-wrap">
        <table class="gddp-table">
            <thead>
                <tr>
                    <th
                        v-for="column in columns"
                        :key="column.key"
                        :class="[`is-${column.align || 'left'}`, { 'is-sortable': column.sortable !== false }]"
                        :aria-sort="headerAriaSort(column)"
                    >
                        <button
                            v-if="column.sortable !== false"
                            type="button"
                            class="gddp-table-sort-trigger"
                            :aria-label="sortButtonLabel(column)"
                            :title="sortButtonLabel(column)"
                            @click="toggleSort(column)"
                        >
                            <span>{{ column.label }}</span>
                            <i :class="sortIcon(column)" aria-hidden="true"></i>
                        </button>
                        <span v-else>{{ column.label }}</span>
                    </th>
                </tr>
            </thead>
            <tbody>
                <tr v-if="!sortedRows.length">
                    <td class="gddp-table-empty" :colspan="columns.length">
                        <slot name="empty">{{ emptyText }}</slot>
                    </td>
                </tr>
                <template v-else>
                    <tr v-for="(item, index) in sortedRows" :key="resolveRowKey(item.row, item.index)">
                        <td
                            v-for="column in columns"
                            :key="column.key"
                            :class="`is-${column.align || 'left'}`"
                        >
                            <slot
                                :name="`cell-${column.key}`"
                                :row="item.row"
                                :value="getCellValue(item.row, column.key)"
                                :index="index"
                            >
                                {{ formatCellValue(getCellValue(item.row, column.key)) }}
                            </slot>
                        </td>
                    </tr>
                </template>
            </tbody>
        </table>
    </div>
</template>
