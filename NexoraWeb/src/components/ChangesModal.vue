<!--
    ChangesModal.vue — 变更中心

    统一承载时间线与回收站：左侧使用设置窗口同款分组导航，右侧只切换
    内容面板。时间线/回收站不再各自创建可拖拽的小窗，避免两个入口与两套
    窗口视觉并存。
-->

<template>
    <Modal
        :open="open"
        :width="modalWidth"
        :height="modalHeight"
        title="变更"
        modal-class="changes-modal"
        @close="emit('close')"
    >
        <div class="settings-modal-shell changes-modal-shell" :class="{ 'is-drilled': isCompactViewport && mobileLevel === 2 }">
            <SettingsNav :groups="navGroups" :active="activeTab" @select="onTabSelect" />

            <section class="settings-main">
                <button type="button" class="settings-mobile-back" @click="mobileLevel = 1">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <polyline points="15 18 9 12 15 6"></polyline>
                    </svg>
                    <span>返回分类</span>
                </button>

                <SettingsPageHeader
                    :title="activeTabMeta.title"
                    :description="activeTabMeta.description"
                    :actions="activeTabActions"
                    :selects="emptyHeadValues"
                    :subtabs="emptyHeadValues"
                    @action="runPanelAction"
                />

                <div class="settings-page-body changes-page-body">
                    <TimelinePanel v-show="activeTab === 'timeline'" :open="open && activeTab === 'timeline'" />
                    <TrashModal
                        ref="trashPanelRef"
                        v-show="activeTab === 'trash'"
                        :open="open && activeTab === 'trash'"
                        @restored="emit('restored')"
                    />
                </div>
            </section>
        </div>
    </Modal>
</template>

<script setup lang="ts">
    import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'

    import Modal from '@/ui/Modal.vue'
    import SettingsNav, { type SettingsNavGroup } from '@/ui/settings/SettingsNav.vue'
    import SettingsPageHeader from '@/ui/settings/SettingsPageHeader.vue'

    import TimelinePanel from './TimelinePanel.vue'
    import TrashModal from './TrashModal.vue'

    type ChangesTab = 'timeline' | 'trash'

    interface TrashPanelHandle {
        load: () => Promise<void>
        clear: () => Promise<void>
    }

    const props = defineProps<{
        open: boolean
    }>()

    const emit = defineEmits<{
        close: []
        restored: []
    }>()

    const activeTab = ref<ChangesTab>('timeline')
    const mobileLevel = ref<1 | 2>(1)
    const isCompactViewport = ref(false)
    const trashPanelRef = ref<TrashPanelHandle | null>(null)
    const emptyHeadValues: Record<string, string> = {}

    const navGroups: SettingsNavGroup[] = [
        {
            label: '变更',
            items: [
                { key: 'timeline', label: '时间线', icon: 'fa-solid fa-timeline' },
                { key: 'trash', label: '回收站', icon: 'fa-regular fa-trash-can' },
            ],
        },
    ]

    const tabMeta: Record<ChangesTab, { title: string; description: string }> = {
        timeline: {
            title: '时间线',
            description: '查看知识库与笔记的变更记录',
        },
        trash: {
            title: '回收站',
            description: '恢复或永久清理已删除的会话与知识库',
        },
    }

    const activeTabMeta = computed(() => tabMeta[activeTab.value])

    const activeTabActions = computed(() => {
        if (activeTab.value !== 'trash') {
            return []
        }

        return [
            { label: '刷新', icon: 'fa-solid fa-rotate-right', method: 'load' },
            { label: '清空', icon: 'fa-regular fa-trash-can', method: 'clear', variant: 'danger' as const },
        ]
    })

    const modalWidth = computed(() => (isCompactViewport.value ? '100%' : '1060px'))
    const modalHeight = computed(() => (isCompactViewport.value ? '100%' : 'min(80vh, 720px)'))

    function syncCompactViewport(): void {
        const isTouch = 'ontouchstart' in window || (navigator.maxTouchPoints ?? 0) > 0
        isCompactViewport.value = isTouch || window.innerWidth <= 820
    }

    function onTabSelect(tab: string): void {
        if (tab !== 'timeline' && tab !== 'trash') {
            return
        }

        activeTab.value = tab

        if (isCompactViewport.value) {
            mobileLevel.value = 2
        }
    }

    function runPanelAction(method: string): void {
        const panel = trashPanelRef.value

        if (activeTab.value !== 'trash' || !panel) {
            return
        }

        if (method === 'load') {
            void panel.load()

            return
        }

        if (method === 'clear') {
            void panel.clear()
        }
    }

    watch(
        () => props.open,
        (opened) => {
            document.body.classList.toggle('changes-modal-open', opened)

            if (opened) {
                mobileLevel.value = 1
            }
        },
        { immediate: true }
    )

    onMounted(() => {
        syncCompactViewport()
        window.addEventListener('resize', syncCompactViewport)
    })

    onBeforeUnmount(() => {
        window.removeEventListener('resize', syncCompactViewport)
        document.body.classList.remove('changes-modal-open')
    })
</script>
