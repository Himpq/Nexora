<!--
    AccountPanel.vue — 个人资料面板（settings 14 tab 首域 SFC 化示范）

    职责：
      - 头像、用户名、角色、UserID、账号概览（创建时间/最后登录）
      - 头像上传触发与保存由父级 SettingsModal 统一协调（复用 pendingAvatarBase64 逻辑）
    设计：
      - 纯展示型 SFC，样式由 settings/account.css 提供，scoped 仅作隔离
      - 遵循 4 空格缩进，逻辑分层留空行，重要函数留注释
-->
<template>
    <SettingCard title="个人资料" description="与账号相关的基本信息与头像">
        <div class="settings-profile-head">
            <div class="settings-avatar-panel">
                <div
                    v-if="avatarUrl"
                    id="settingsAvatarImg"
                    class="settings-avatar"
                    :style="avatarBackground"
                    alt="avatar"
                ></div>
                <div v-else id="settingsAvatarImg" class="settings-avatar settings-avatar-placeholder">{{ avatarChar }}</div>

                <div class="settings-avatar-actions">
                    <button class="btn-primary-outline btn-compact" type="button" @click="emit('open-avatar-picker')">上传头像</button>
                </div>
            </div>

            <div class="settings-profile-meta">
                <SettingRow label="用户名" hint="登录与展示所用名称">
                    <input
                        id="set-username-input"
                        :value="profileName"
                        class="gddp-input settings-profile-name-input"
                        type="text"
                        maxlength="60"
                        @input="onNameInput"
                    >
                </SettingRow>

                <SettingRow label="角色">
                    <span class="settings-field" style="background:transparent;border:none;padding:0;">{{ roleLabel }}</span>
                </SettingRow>

                <SettingRow label="UserID" hint="系统内部标识,不可修改">
                    <span class="mono" style="font-size:12.5px;color:#8b95a7;">{{ userId || '-' }}</span>
                </SettingRow>
            </div>
        </div>

        <div class="settings-profile-actions" style="justify-content:flex-end;">
            <button class="btn-primary" type="button" @click="emit('save-profile')">保存资料</button>
        </div>
    </SettingCard>

    <SettingCard title="账号概览" description="账号使用情况统计">
        <SettingRow label="创建时间">
            <span class="settings-field" style="min-width:160px;">{{ createdAt }}</span>
        </SettingRow>

        <SettingRow label="最后登录">
            <span class="settings-field" style="min-width:160px;">{{ lastLogin }}</span>
        </SettingRow>
    </SettingCard>
</template>

<script setup lang="ts">
    import SettingCard from '@/ui/settings/SettingCard.vue'
    import SettingRow from '@/ui/settings/SettingRow.vue'

    withDefaults(defineProps<{
        profileName: string
        avatarUrl: string
        avatarBackground: Record<string, string>
        avatarChar: string
        roleLabel: string
        userId: string
        createdAt: string
        lastLogin: string
    }>(), {
        profileName: '',
        avatarUrl: '',
        avatarBackground: () => ({}),
        avatarChar: 'U',
        roleLabel: '成员',
        userId: '',
        createdAt: '-',
        lastLogin: '-',
    })

    const emit = defineEmits<{
        'update:profileName': [value: string]
        'open-avatar-picker': []
        'save-profile': []
    }>()

    function onNameInput(event: Event): void {
        const value = (event.target as HTMLInputElement).value

        emit('update:profileName', value)
    }
</script>

<style scoped src="@/styles/settings/account.css">
</style>
