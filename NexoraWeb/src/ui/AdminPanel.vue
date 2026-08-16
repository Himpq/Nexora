<!--
    AdminPanel.vue — 管理面板通用布局(General Design Development Package)

    提取自原版设置窗口大量重复的"工具栏 + 左列表 + 右详情"结构:
      admin-users-toolbar(工具栏,如搜索/刷新/新增)
        + admin-users-layout
          > admin-users-list(左侧列表)
          > admin-user-detail(右侧详情)

    用法:
      <AdminPanel>
          <template #toolbar>
              <input class="input-modern" placeholder="搜索..." />
          </template>
          <template #list>
              <div class="admin-user-item">...</div>
          </template>
          <template #detail>
              <div class="admin-user-detail-empty">请选择左侧项目</div>
          </template>
      </AdminPanel>
-->

<template>
    <div class="admin-users-toolbar settings-management-toolbar">
        <slot name="toolbar" />
    </div>

    <div class="admin-users-layout settings-management-layout">
        <div class="admin-users-list settings-management-list">
            <slot name="list" />
        </div>

        <div class="admin-user-detail settings-management-detail">
            <slot name="detail" />
        </div>
    </div>
</template>

<script setup lang="ts">
</script>
