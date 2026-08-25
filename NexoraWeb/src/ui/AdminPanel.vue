<!--
    AdminPanel.vue — 管理面板通用布局(General Design Development Package)

    提取自设置窗口大量重复的"左列表 + 右详情"结构:
      settings-management-layout
        > settings-management-list(左侧列表)
        > settings-management-detail(右侧详情)

    页面级操作(新增/刷新/必要的下拉)已全部上移 settings-page-head,
    面板不再包含工具栏。

    用法:
      <AdminPanel>
          <template #list>
              <div class="admin-user-item">...</div>
          </template>
          <template #detail>
              <div class="admin-user-detail-empty">请选择左侧项目</div>
          </template>
      </AdminPanel>
-->

<template>
    <div class="settings-management-layout">
        <div class="settings-management-list">
            <slot name="list" />
        </div>

        <div class="settings-management-detail">
            <slot name="detail" />
        </div>
    </div>
</template>

<script setup lang="ts">
</script>
