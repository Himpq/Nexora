<!--
    AdminStatsPanel.vue — 管理员:统计信息(对齐原版 settings-admin-stats-tab)

    设计:
      - 复用原版 .admin-stats-grid + .stat-card 样式
      - 统计项对齐原版 loadAdminStats:总用户数 / 管理员数 / 总 Token 消耗
-->

<template>
    <div class="admin-stats-grid">
        <div class="stat-card">
            <span class="label">总用户数</span>
            <span class="value mono">{{ totalUsers }}</span>
        </div>
        <div class="stat-card">
            <span class="label">管理员数</span>
            <span class="value mono">{{ adminCount }}</span>
        </div>
        <div class="stat-card">
            <span class="label">总 Token 消耗</span>
            <span class="value mono">{{ totalTokens.toLocaleString() }}</span>
        </div>
    </div>
</template>

<script setup lang="ts">
    import { onMounted, ref } from 'vue'

    import { listAdminUsers } from '@/api/admin-users'
    import { fetchAdminTokenStats } from '@/api/admin-stats'
    import { showError } from '@/stores/notify'

    const totalUsers = ref(0)
    const adminCount = ref(0)
    const totalTokens = ref(0)

    onMounted(() => {
        void load()
    })

    /** 加载统计数据(对齐原版 loadAdminStats:用户列表 + token 统计) */
    async function load(): Promise<void> {
        try {
            const users = await listAdminUsers()

            totalUsers.value = users.length
            adminCount.value = users.filter((user) => String(user.role || '').toLowerCase() === 'admin').length
        } catch (error) {
            showError(error instanceof Error ? error.message : '加载用户统计失败')
        }

        try {
            totalTokens.value = await fetchAdminTokenStats()
        } catch (error) {
            showError(error instanceof Error ? error.message : '加载 Token 统计失败')
        }
    }
</script>
