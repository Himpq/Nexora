<!--
    ContextMenu.vue — GDDP 通用右键上下文菜单容器

    职责(从原 components/ContextMenu、SelectionContextMenu、WorkspaceResourceMenu
    三套分散实现收敛而来):
      - 统一的菜单项渲染(items 配置:图标 / 文字 / 危险态 / 分隔线 / 子菜单)
      - 复杂的子菜单(如"归入工作区"异步列表)通过具名 slot #submenu-{key} 注入
      - Teleport 到 body;打开时向浮层协调器注册 popoverId(互斥 + 外部点击关闭统一保证)
      - 视口内钳制(按实测尺寸,防止溢出屏幕)
      - 暗色:全部引用 --color-* 语义令牌,无第二套 dark 规则

    用法:
      <ContextMenu ref="menu" popover-id="unique-menu-id" :items="items" @select="onSelect">
        <template #submenu-workspace="{ close }">
          <button v-for="ws in workspaces" @click="addToWorkspace(ws)">...</button>
        </template>
      </ContextMenu>

      // 父级在 contextmenu 事件里:
      menu.open(x, y)
-->

<template>
    <Teleport to="body">
        <div
            v-if="visible"
            ref="rootEl"
            class="gddp-context-menu"
            :class="{ 'submenu-left': submenuLeft }"
            :style="{ left: `${posX}px`, top: `${posY}px` }"
            role="menu"
            @click.stop
            @contextmenu.prevent
        >
            <template v-for="item in items" :key="item.key">
                <div v-if="item.divider" class="gddp-context-divider" role="separator"></div>
                <!-- 条目容器:子菜单的定位锚点与 hover/focus 展开边界(对齐原版 pin-context-submenu-wrap) -->
                <div v-else class="gddp-context-entry">
                    <button
                        type="button"
                        role="menuitem"
                        class="gddp-context-item"
                        :class="{ 'is-danger': item.danger, 'has-submenu': item.submenuKey }"
                        :disabled="item.disabled"
                        @click="onSelect(item)"
                    >
                        <i v-if="item.icon" :class="item.icon" aria-hidden="true"></i>
                        <span class="gddp-context-label">{{ item.label }}</span>
                        <i v-if="item.submenuKey" class="fa-solid fa-chevron-right gddp-context-submenu-arrow" aria-hidden="true"></i>
                    </button>
                    <div
                        v-if="item.submenuKey"
                        class="gddp-context-submenu"
                        :data-submenu="item.submenuKey"
                    >
                        <slot :name="`submenu-${item.submenuKey}`" :close="close" />
                    </div>
                </div>
            </template>
        </div>
    </Teleport>
</template>

<script setup lang="ts">
    import { computed, nextTick, ref, useId, watch } from 'vue'

    import { closePopover, openPopover, overlay } from '@/ui/overlay'

    export interface ContextMenuItem {
        /** 唯一键,select 事件回传 */
        key: string
        /** 显示文字 */
        label: string
        /** 前置图标(fa class) */
        icon?: string
        /** 危险态(红色文字) */
        danger?: boolean
        /** 分隔线(独占一行,忽略其他字段) */
        divider?: boolean
        /** 禁用 */
        disabled?: boolean
        /** 子菜单 slot 名(渲染 #submenu-{key} 内容) */
        submenuKey?: string
    }

    const props = withDefaults(defineProps<{
        /** 浮层协调器菜单 id(缺省按实例自动生成,天然互斥;仅需跨组件协同控制同一菜单时才显式传入) */
        popoverId?: string
        /** 菜单项配置(分隔线项 divider:true) */
        items: ContextMenuItem[]
        /** 打开时保留右侧栏面板(面板内触发的菜单) */
        keepPanel?: boolean
    }>(), {
        keepPanel: false,
    })

    const emit = defineEmits<{
        select: [key: string]
    }>()

    /** 实例唯一菜单 id:可见性按 id 全局匹配,自动生成保证多个实例永不互相串扰 */
    const autoPopoverId = `gddp-ctx-${useId()}`

    const effectivePopoverId = computed(() => props.popoverId || autoPopoverId)

    /** 可见性跟随浮层协调器:openPopover 命中本 id 即显示(外部点击关闭由 overlay 全局监听统一保证) */
    const visible = computed(() => overlay.popover === effectivePopoverId.value)
    const posX = ref(0)
    const posY = ref(0)
    const submenuLeft = ref(false)
    const rootEl = ref<HTMLElement | null>(null)

    /** 打开菜单:先向协调器注册 popoverId(触发 visible 与 Teleport 渲染),
     *  待菜单 div 挂载后再用真实容器二次 openPopover 注册外部点击关闭边界 */
    function open(x: number, y: number): void {
        posX.value = x
        posY.value = y

        openPopover(effectivePopoverId.value, null, { keepPanel: props.keepPanel })

        void nextTick().then(() => {
            if (rootEl.value) {
                openPopover(effectivePopoverId.value, rootEl.value, { keepPanel: props.keepPanel })
            }

            clampToViewport()
            positionSubmenu()
            requestAnimationFrame(() => {
                clampToViewport()
                positionSubmenu()
            })
        })
    }

    /** 关闭菜单 */
    function close(): void {
        closePopover(effectivePopoverId.value)
    }

    /** 菜单是否当前打开(供外部判断) */
    function isOpen(): boolean {
        return overlay.popover === effectivePopoverId.value
    }

    /** 点击菜单项:关闭并回传 key(危险项同样回传,由宿主判断语义) */
    function onSelect(item: ContextMenuItem): void {
        if (item.disabled) {
            return
        }

        close()
        emit('select', item.key)
    }

    /** 钳制菜单到视口内(按实测尺寸) */
    function clampToViewport(): void {
        if (!rootEl.value) {
            return
        }

        const rect = rootEl.value.getBoundingClientRect()
        const width = rect.width || rootEl.value.offsetWidth || 170
        const height = rect.height || rootEl.value.offsetHeight || 90

        posX.value = Math.min(Math.max(8, posX.value), Math.max(8, window.innerWidth - width - 12))
        posY.value = Math.min(Math.max(8, posY.value), Math.max(8, window.innerHeight - height - 12))
    }

    /** 靠近右边缘时子菜单向左弹出,避免溢出屏幕 */
    function positionSubmenu(): void {
        if (!rootEl.value) {
            return
        }

        const menuWidth = rootEl.value.offsetWidth || 170
        const submenuEl = rootEl.value.querySelector('.gddp-context-submenu') as HTMLElement | null
        const submenuWidth = (submenuEl ? submenuEl.offsetWidth : 0) || 190

        submenuLeft.value = posX.value + menuWidth + submenuWidth + 24 > window.innerWidth
    }

    /** 坐标变化后重新钳制(布局稳定后再校准一次) */
    watch(
        () => [posX.value, posY.value, visible.value] as const,
        () => {
            if (visible.value) {
                void nextTick().then(() => {
                    clampToViewport()
                    positionSubmenu()
                })
            }
        }
    )

    defineExpose({ open, close, isOpen })
</script>
