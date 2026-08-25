<!--
    SettingCard.vue — 设置分组卡片

    提取自设置面板的"标题 + 若干行"分组:白底圆角卡片,行间细分隔线。

    用法:
      <SettingCard title="基础信息" description="与账号相关的基本资料">
          <SettingRow label="用户名">...</SettingRow>
      </SettingCard>
-->

<template>
    <section class="setting-card">
        <header v-if="title" class="setting-card-head">
            <h4>{{ title }}</h4>
            <p v-if="description">{{ description }}</p>
        </header>
        <div class="setting-card-body">
            <slot />
        </div>
    </section>
</template>

<script setup lang="ts">
    defineProps<{
        title?: string
        description?: string
    }>()
</script>