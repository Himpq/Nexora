<!--
    App.vue — 应用根组件

    职责:
      - 挂载路由视图
      - 全局提示容器
      - 登录态就绪后同步服务器主题偏好(权威源)
-->

<template>
    <div id="nexora-app">
        <router-view />
        <div id="nexora-toast-root"></div>
        <div id="nexora-confirm-root"></div>
    </div>
</template>

<script setup lang="ts">
    import { onMounted } from 'vue'

    import { fetchUserPreferences } from '@/api/preferences'
    import { useUserStore } from '@/stores/user'
    import { isThemePreference, setTheme, theme } from '@/ui/theme'

    const userStore = useUserStore()

    /*
     * 主题偏好来源优先级:本地 localStorage(用户最新意图) > 服务器偏好。
     * 仅当本地没有任何偏好记录(新设备/清缓存)时才采用服务器值初始化;
     * 本地已有值时绝不回退 —— 否则未点"保存偏好"的临时切换会在刷新后被
     * 服务器旧值覆盖,表现为"切了浅色又自动变回黑色"。
     */
    onMounted(async () => {
        await userStore.init()

        if (!userStore.isLoggedIn) {
            return
        }

        if (theme.preference !== 'system' || localStorage.getItem('nexora-theme')) {
            return
        }

        try {
            const preferences = await fetchUserPreferences()

            if (preferences && isThemePreference(preferences.theme) && preferences.theme !== 'system') {
                setTheme(preferences.theme)
            }
        } catch {
            // 偏好接口不可达时保持本地缓存主题:主题属可离线运行的本地能力
        }
    })
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
