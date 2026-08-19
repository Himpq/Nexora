<!--
    Modal.vue — 通用模态窗口(General Design Development Package 基础组件)

    特性:
      - Modern:柔和高斯模糊遮罩 + 大圆角卡片
      - Simplify:头部/正文/底部清晰分区
      - Interactive:入场动画、Esc 关闭、点击遮罩关闭、按钮反馈

    用法:
      <Modal :open="visible" title="标题" size="sm" @close="visible = false">
          <p>正文</p>
          <template #footer>
              <button class="g-btn g-btn-ghost">取消</button>
              <button class="g-btn g-btn-primary">确定</button>
          </template>
      </Modal>

      自定义头部(如回收站的 清空/刷新 按钮组):head 插槽替换默认标题
      <Modal :open="visible" @close="visible = false">
          <template #head>
              <h3>回收站</h3>
              <div class="trash-head-actions">…</div>
          </template>
      </Modal>
-->

<template>
    <Teleport to="body">
        <Transition name="g-modal">
            <div
                v-if="open"
                class="g-modal-backdrop"
                @mousedown.self="handleBackdropMousedown"
                @mouseup.self="handleBackdropMouseup"
                @mouseleave="handleBackdropMouseleave"
                @click.capture="swallowBackdropClick"
            >
                <div
                    class="g-modal"
                    :class="[`g-modal-${size}`, modalClass]"
                    :style="modalStyle"
                    role="dialog"
                    :aria-label="title"
                    @keydown.esc="handleEscape"
                >
                    <div v-if="title || showClose || $slots.head" class="g-modal-head">
                        <slot name="head">
                            <h3>{{ title }}</h3>
                        </slot>
                        <button
                            v-if="showClose"
                            type="button"
                            class="g-modal-close"
                            aria-label="关闭"
                            @click="emit('close')"
                        >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <line x1="18" y1="6" x2="6" y2="18"></line>
                                <line x1="6" y1="6" x2="18" y2="18"></line>
                            </svg>
                        </button>
                    </div>

                    <div class="g-modal-body">
                        <slot />
                    </div>

                    <div v-if="$slots.footer" class="g-modal-footer">
                        <slot name="footer" />
                    </div>
                </div>
            </div>
        </Transition>
    </Teleport>
</template>

<script setup lang="ts">
    import { computed, onBeforeUnmount, watch } from 'vue'

    const props = withDefaults(defineProps<{
        open: boolean
        title?: string
        size?: 'sm' | 'default' | 'lg'
        /** 自定义最大宽度(如设置窗口 '1120px'),覆盖 size 默认 */
        width?: string
        /** 自定义高度(如设置窗口 'min(80vh, 720px)'),覆盖 size 默认;不传则遵循 .g-modal 默认 */
        height?: string
        /** 附加到模态卡片的 class(如 settings-modal 壳,由 settings.css 接管) */
        modalClass?: string
        showClose?: boolean
        /** 点击遮罩关闭,默认 true(用 mousedown 判定,对齐原版:避免文本拖选跨出遮罩松开时误关) */
        closeOnBackdrop?: boolean
        /** Esc 关闭,默认 true */
        closeOnEsc?: boolean
    }>(), {
        title: '',
        size: 'default',
        width: '',
        height: '',
        modalClass: '',
        showClose: true,
        closeOnBackdrop: true,
        closeOnEsc: true,
    })

    const emit = defineEmits<{
        close: []
    }>()

    /** 尺寸内联覆盖:width/height 任一生效即覆盖 size 默认值 */
    const modalStyle = computed<Record<string, string> | undefined>(() => {
        const style: Record<string, string> = {}

        if (props.width) {
            style.width = props.width
        }

        if (props.height) {
            style.height = props.height

            // 显式高度时解除 .g-modal 默认 max-height 上限(设置窗口 80vh 等大窗口)
            style.maxHeight = 'none'
        }

        return Object.keys(style).length ? style : undefined
    })

    /** 按下是否发生在遮罩自身(对齐原版 bindBackdropSafeClose:仅当 mousedown 与 mouseup 都在遮罩上才关闭,
     *  避免在弹窗内选中文本拖出遮罩松开时误关) */
    let pressedOnBackdrop = false

    function handleBackdropMousedown(): void {
        pressedOnBackdrop = true
    }

    function handleBackdropMouseup(): void {
        const shouldClose = props.closeOnBackdrop && pressedOnBackdrop

        pressedOnBackdrop = false

        if (shouldClose) {
            emit('close')
        }
    }

    function handleBackdropMouseleave(): void {
        pressedOnBackdrop = false
    }

    /** 捕获阶段吞掉遮罩上的 click,阻止其他 click 关闭路径在拖选结束时误触发(对齐原版 swallowBackdropClick) */
    function swallowBackdropClick(event: MouseEvent): void {
        if (event.target === event.currentTarget) {
            event.preventDefault()
            event.stopPropagation()
        }
    }

    function handleEscape(): void {
        if (props.closeOnEsc) {
            emit('close')
        }
    }

    /** 打开时挂载 Esc 监听(Esc 需在 document 层捕获) */
    function onDocumentKeydown(event: KeyboardEvent): void {
        if (event.key === 'Escape' && props.open && props.closeOnEsc) {
            emit('close')
        }
    }

    watch(
        () => props.open,
        (opened) => {
            if (opened) {
                document.addEventListener('keydown', onDocumentKeydown)
            } else {
                document.removeEventListener('keydown', onDocumentKeydown)
            }
        }
    )

    onBeforeUnmount(() => {
        document.removeEventListener('keydown', onDocumentKeydown)
    })
</script>
