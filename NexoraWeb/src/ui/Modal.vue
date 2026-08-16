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
              <div class="trash-modal-head-actions">…</div>
          </template>
      </Modal>
-->

<template>
    <Teleport to="body">
        <Transition :name="legacy ? 'g-modal-fade' : 'g-modal'">
            <div
                v-if="open"
                class="g-modal-backdrop"
                :class="legacy ? 'modal-backdrop active' : ''"
                :id="legacy && rootId ? rootId : undefined"
                @click.self="handleBackdropClick"
            >
                <div
                    class="g-modal"
                    :class="legacy ? ['modal', modalClass] : [`g-modal-${size}`, modalClass]"
                    :style="width ? { maxWidth: width } : undefined"
                    role="dialog"
                    :aria-label="title"
                    @keydown.esc="handleEscape"
                >
                    <div
                        v-if="title || showClose || $slots.head"
                        :class="legacy ? 'modal-head g-modal-head' : 'g-modal-head'"
                    >
                        <slot name="head">
                            <h3>{{ title }}</h3>
                        </slot>
                        <button
                            v-if="showClose"
                            type="button"
                            :class="legacy ? 'btn-modal-close g-modal-close' : 'g-modal-close'"
                            aria-label="关闭"
                            @click="emit('close')"
                        >
                            <span v-if="legacy">×</span>
                            <svg v-else width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <line x1="18" y1="6" x2="6" y2="18"></line>
                                <line x1="6" y1="6" x2="18" y2="18"></line>
                            </svg>
                        </button>
                    </div>

                    <div :class="legacy ? 'modal-body g-modal-body' : 'g-modal-body'">
                        <slot />
                    </div>

                    <div v-if="$slots.footer" :class="legacy ? 'modal-footer g-modal-footer' : 'g-modal-footer'">
                        <slot name="footer" />
                    </div>
                </div>
            </div>
        </Transition>
    </Teleport>
</template>

<script setup lang="ts">
    import { onBeforeUnmount, watch } from 'vue'

    const props = withDefaults(defineProps<{
        open: boolean
        title?: string
        size?: 'sm' | 'default' | 'lg'
        /** 自定义最大宽度(如设置窗口 '1120px'),覆盖 size 默认 */
        width?: string
        /** 附加到模态卡片的 class(如复用原版布局样式) */
        modalClass?: string
        showClose?: boolean
        /** 点击遮罩关闭,默认 true */
        closeOnBackdrop?: boolean
        /** Esc 关闭,默认 true */
        closeOnEsc?: boolean
        /** 原版兼容模式:渲染 .modal/.modal-head/.modal-body 类名与遮罩 id,复用原版 Nexora CSS */
        legacy?: boolean
        /** legacy 模式下挂到遮罩上的 id(如 settingsModal,原版 CSS 依赖该 id) */
        rootId?: string
    }>(), {
        title: '',
        size: 'default',
        width: '',
        modalClass: '',
        showClose: true,
        closeOnBackdrop: true,
        closeOnEsc: true,
        legacy: false,
        rootId: '',
    })

    const emit = defineEmits<{
        close: []
    }>()

    function handleBackdropClick(): void {
        if (props.closeOnBackdrop) {
            emit('close')
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
