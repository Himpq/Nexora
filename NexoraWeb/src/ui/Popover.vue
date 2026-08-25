<!--
    Popover.vue — 通用浮层原语(General Design Development Package 基础组件)

    设计:
      - 触发器留在文档流,内容 Teleport 到 body + position:fixed 定位,
        不受祖先 transform/overflow 裁剪,弹窗内也能正确压顶(--z-portal-dropdown)
      - 内容常驻 fixed(初始隐藏于视口原点)再测量定位:
        若先按文档流静态块测量,width 会被拉伸到 body 宽,夹紧计算全错
      - 开关经 ui/overlay 浮层协调器注册:同一时刻至多一个浮层,
        点击外部自动关闭(容器判定含触发器,不含 Teleport 内容——内容由 @click.stop 兜住)
      - 空间不足自动上翻(placement: auto / top / bottom);上下都放不下时夹紧视口边缘

    用法:
      <Popover ref="pop">
          <template #trigger="{ open, toggle }">
              <button :aria-expanded="open" @click="toggle()">选择</button>
          </template>
          <MyMenuContent />
      </Popover>

      编程控制:const pop = ref(); pop.value.open() / close() / toggle()
-->

<template>
    <div ref="wrapRef" class="g-popover">
        <slot name="trigger" :open="isOpen" :toggle="toggle" />
        <Teleport to="body">
            <div
                v-if="isOpen"
                ref="contentRef"
                class="g-popover-content"
                :style="contentStyle"
                @click.stop
                @mousedown.stop
            >
                <slot />
            </div>
        </Teleport>
    </div>
</template>

<script setup lang="ts">
    import { computed, nextTick, onBeforeUnmount, ref, useId, watch } from 'vue'

    import { closePopover, openPopover, overlay } from '@/ui/overlay'

    const props = withDefaults(defineProps<{
        /** 展开方向:auto 空间不足上翻、top 固定向上、bottom 固定向下 */
        placement?: 'auto' | 'top' | 'bottom'
        disabled?: boolean
        /** 内容最小宽度取触发器宽度(输入框类组合框需要) */
        matchTriggerWidth?: boolean
        /** 同一页面需要独立开合的多个实例可显式指定 key */
        popoverKey?: string
    }>(), {
        placement: 'auto',
        disabled: false,
        matchTriggerWidth: false,
        popoverKey: undefined,
    })

    /** 未显式传入 popoverKey 时按实例自增,避免同屏多实例联动开合 */
    const autoPopoverKey = `g-popover-${useId()}`
    const effectivePopoverKey = computed(() => props.popoverKey ?? autoPopoverKey)

    const wrapRef = ref<HTMLElement | null>(null)
    const contentRef = ref<HTMLElement | null>(null)

    /*
     * 初始即 fixed(脱离文档流收缩到内容宽)但隐藏于视口原点:
     * positionContent 在隐藏态测量真实尺寸后落最终坐标并显示。
     */
    const contentStyle = ref<Record<string, string>>({
        position: 'fixed',
        top: '0px',
        left: '0px',
        visibility: 'hidden',
    })

    const isOpen = computed(() => !props.disabled && overlay.popover === effectivePopoverKey.value)

    function updatePosition(): void {
        if (isOpen.value) {
            positionContent()
        }
    }

    watch(isOpen, (open) => {
        if (open) {
            window.addEventListener('resize', updatePosition)
            window.addEventListener('scroll', updatePosition, true)
            void nextTick(positionContent)
        } else {
            window.removeEventListener('resize', updatePosition)
            window.removeEventListener('scroll', updatePosition, true)
        }
    })

    // 内容挂载帧再定位一次:兜底 Teleport 渲染时序与首帧字体/尺寸变化
    watch(contentRef, (el) => {
        if (el && isOpen.value) {
            void nextTick(positionContent)
        }
    })

    onBeforeUnmount(() => {
        window.removeEventListener('resize', updatePosition)
        window.removeEventListener('scroll', updatePosition, true)

        if (overlay.popover === effectivePopoverKey.value) {
            closePopover(effectivePopoverKey.value)
        }
    })

    function open(): void {
        if (!props.disabled && !isOpen.value) {
            // 复位到隐藏原点:避免上一次的坐标在测量前闪现
            contentStyle.value = {
                position: 'fixed',
                top: '0px',
                left: '0px',
                visibility: 'hidden',
            }

            openPopover(effectivePopoverKey.value, wrapRef.value)
        }
    }

    function close(): void {
        closePopover(effectivePopoverKey.value)
    }

    function toggle(): void {
        if (props.disabled) {
            return
        }

        if (isOpen.value) {
            close()

            return
        }

        open()
    }

    defineExpose({ open, close, toggle })

    /**
     * 依据触发器位置定位内容:贴触发器下缘,空间不足按 placement 上翻,
     * 左右与底边都夹紧视口(内容此时已是 fixed 隐藏态,测量值即真实渲染尺寸)。
     */
    function positionContent(): void {
        const trigger = wrapRef.value
        const content = contentRef.value

        if (!trigger || !content) {
            return
        }

        const rect = trigger.getBoundingClientRect()
        const vw = window.innerWidth || document.documentElement.clientWidth
        const vh = window.innerHeight || document.documentElement.clientHeight
        const gap = 6
        const contentWidth = content.offsetWidth
        const contentHeight = content.offsetHeight

        if (contentWidth <= 0 || contentHeight <= 0) {
            return
        }

        const spaceBelow = vh - rect.bottom - gap
        const spaceAbove = rect.top - gap
        let openUp = spaceBelow < contentHeight && spaceAbove > spaceBelow

        if (props.placement === 'top') {
            openUp = true
        } else if (props.placement === 'bottom') {
            openUp = false
        }

        let top = openUp ? rect.top - gap - contentHeight : rect.bottom + gap
        // 上下都放不下时夹紧视口边缘(避免底边裁切)
        top = Math.max(12, Math.min(top, vh - contentHeight - 12))

        const left = Math.max(12, Math.min(rect.left, vw - contentWidth - 12))

        const style: Record<string, string> = {
            position: 'fixed',
            top: `${Math.round(top)}px`,
            left: `${Math.round(left)}px`,
            visibility: 'visible',
        }

        if (props.matchTriggerWidth) {
            style.minWidth = `${Math.round(Math.max(rect.width, 160))}px`
        }

        contentStyle.value = style
    }
</script>

<style scoped>
    /*
     * 触发器包裹壳:仅作定位锚与外部点击判定。必须是生成盒子的真实元素
     * (display:contents 无盒,getBoundingClientRect 全零会导致浮层定位失效),
     * 块级布局在 flex 行/列内均表现正常。
     */
    .g-popover {
        position: relative;
        min-width: 0;
    }

    /*
     * 浮层卡片基础视觉(GDDP 统一:白底描边 + 柔和投影 + portal 层级)。
     * position:fixed 常驻(初始坐标与显隐由内联样式驱动),内容自身的
     * 布局/配色由使用方(如 DatePicker)提供。
     */
    .g-popover-content {
        position: fixed;
        z-index: var(--z-portal-dropdown);
        border: 1px solid var(--color-border);
        border-radius: 10px;
        background: var(--color-bg-elevated);
        box-shadow: 0 12px 32px rgba(15, 23, 42, 0.14);
        overflow: hidden;
    }
</style>
