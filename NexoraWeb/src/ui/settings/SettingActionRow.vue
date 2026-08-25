<!--
    SettingActionRow.vue — 详情操作按钮行(General Design Development Package)

    设计:
      - 全设置壳唯一操作行语言:按钮等宽(flex:1)、34px 高、间距 10px
      - 按钮视觉沿用壳内规范(btn-primary / btn-primary-outline / btn-danger-small),禁止黑底
      - 统一替换 mail-actions / auth-actions / papi-action-row / admin-user-action-row 等历史写法

    用法:
      <SettingActionRow>
          <button class="btn-primary" @click="save">保存设置</button>
          <button class="btn-danger-small" @click="remove">删除</button>
      </SettingActionRow>
-->

<template>
    <div class="setting-action-row">
        <slot />
    </div>
</template>
