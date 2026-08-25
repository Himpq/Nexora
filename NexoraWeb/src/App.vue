<!--
    App.vue — 应用根组件

    职责:
      - 挂载路由视图
      - 全局提示容器
-->

<template>
    <div id="nexora-app">
        <router-view />
        <div id="nexora-toast-root"></div>
        <div id="nexora-confirm-root"></div>
    </div>
</template>

<script setup lang="ts">
</script>

<style>
    html,
    body,
    #app {
        height: 100%;
        margin: 0;
        padding: 0;
    }

    /* 高度链补齐:#nexora-app 必须有高度,.app-container(height:100%)才能撑满视口,
       否则 sidebar 高度塌陷,footer(用户区)会被挤出可视区域 */
    #nexora-app {
        height: 100%;
    }
</style>
