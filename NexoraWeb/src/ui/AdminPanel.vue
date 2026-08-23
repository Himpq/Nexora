<!--
    AdminPanel.vue — 管理面板通用布局(General Design Development Package)

    提取自设置窗口大量重复的"左列表 + 右详情"结构:
      settings-management-layout
        > settings-management-list(左侧列表)
        > settings-management-detail(右侧详情)

    页面级操作(新增/刷新/必要的下拉)已全部上移 settings-page-head,
    面板不再包含工具栏。

    手机端(≤760px,由 settings.css 生效):两级钻取——
      一级显示列表;点击任意列表项整页切入详情(detailOpen),顶部返回条回列表。
      桌面端保持双栏并排,不受影响。
-->

<template>
    <div class="settings-management-layout" :class="{ 'show-detail': detailOpen }">
        <div class="settings-management-list" @click="handleListClick">
            <slot name="list" />
        </div>

        <div class="settings-management-detail">
            <!-- 手机端返回条(桌面端由 CSS 隐藏) -->
            <button type="button" class="settings-mobile-back" @click="detailOpen = false">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <polyline points="15 18 9 12 15 6"></polyline>
                </svg>
                <span>返回列表</span>
            </button>

            <slot name="detail" />
        </div>
    </div>
</template>

<script setup lang="ts">
    import { ref } from 'vue'

    /** 手机端两级钻取状态:点击列表项(事件冒泡捕获)后整页切到详情 */
    const detailOpen = ref(false)

    function handleListClick(): void {
        // 桌面端双栏并排无此交互;≤760px 由 CSS 切换为两级视图
        detailOpen.value = true
    }
</script>