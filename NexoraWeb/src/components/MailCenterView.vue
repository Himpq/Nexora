<!--
    MailCenterView.vue — 邮件中心(GDDP 内容级视图)

    设计:
      - 效仿 FilesCenterView:shell 容器 + head 标题区(计数/搜索/刷新/写信)
      - 文件夹 tab(收件箱/已发送)切换;列表行点击进入阅读态,整页替换列表
      - 正文渲染对齐原版 chat_mails.js:text 用 pre 展示;html 经无脚本的沙箱 iframe(srcdoc)隔离
      - 未启用/未绑定时显示引导态;数据唯一来源为 mail store(WSS 推送自动同步列表与徽标)
-->

<template>
    <section class="gddp-files-view mail-center-view" aria-label="Mail">
        <div class="mail-center-shell">
            <div class="mail-center-head">
                <div>
                    <h1>Mail</h1>
                    <div v-if="mailStore.mailAvailable" class="mail-center-count-line">
                        <span>{{ mailStore.total }}</span>
                        <span>封邮件</span>
                        <span
                            v-if="mailStore.folder === 'inbox' && mailStore.unreadTotal > 0"
                            class="mail-center-unread-chip"
                        >{{ mailStore.unreadTotal }} 未读</span>
                    </div>
                </div>
                <div v-if="mailStore.mailAvailable" class="mail-center-actions">
                    <label class="mail-center-search">
                        <i class="fa-solid fa-magnifying-glass" aria-hidden="true"></i>
                        <input
                            v-model="searchInput"
                            type="search"
                            placeholder="搜索邮件"
                            aria-label="搜索邮件"
                            @keydown.enter="submitSearch"
                        >
                    </label>
                    <Button
                        variant="secondary"
                        size="icon"
                        icon="fa-solid fa-rotate-right"
                        title="刷新"
                        aria-label="刷新"
                        @click="refresh"
                    />
                    <Button variant="primary" @click="openCompose()">
                        <i class="fa-solid fa-pen-to-square" aria-hidden="true"></i>
                        写信
                    </Button>
                </div>
            </div>

            <!-- 引导态:NexoraMail 未启用 -->
            <div v-if="statusLoading" class="mail-center-empty">正在加载...</div>
            <div v-else-if="statusError" class="mail-center-error">{{ statusError }}</div>
            <div v-else-if="!mailStore.enabled" class="mail-center-guide">
                <div class="mail-center-guide-icon">
                    <i class="fa-regular fa-envelope-open" aria-hidden="true"></i>
                </div>
                <h2>NexoraMail 未启用</h2>
                <p>邮件服务尚未开启,请联系管理员在 系统设置 → NexoraMail 中启用。</p>
            </div>
            <!-- 引导态:未绑定邮箱 -->
            <div v-else-if="!mailStore.linked" class="mail-center-guide">
                <div class="mail-center-guide-icon">
                    <i class="fa-regular fa-envelope" aria-hidden="true"></i>
                </div>
                <h2>未绑定邮箱</h2>
                <p>当前账号还没有 NexoraMail 邮箱,请联系管理员在 用户管理 中为本账号绑定邮箱地址。</p>
            </div>

            <template v-else>
                <!-- 写信视图:独立整页(对齐原版 compose 模式),优先级高于阅读/列表 -->
                <template v-if="composeOpen">
                    <div class="mail-reader-head">
                        <Button
                            variant="secondary"
                            size="icon"
                            icon="fa-solid fa-arrow-left"
                            title="返回列表"
                            aria-label="返回列表"
                            @click="closeCompose"
                        />
                    </div>

                    <h2 class="mail-reader-title">写邮件</h2>
                    <div class="mail-reader-meta">
                        <span :title="mailStore.senderAddress">
                            <i class="fa-regular fa-user" aria-hidden="true"></i>发件人: {{ mailStore.senderAddress || '(未知)' }}
                        </span>
                    </div>

                    <div class="mail-compose-form">
                        <div class="gddp-form-field">
                            <label for="mailComposeTo">收件人</label>
                            <input
                                id="mailComposeTo"
                                v-model="composeForm.to"
                                class="gddp-input"
                                type="text"
                                maxlength="320"
                                placeholder="例如: user@example.com"
                            >
                        </div>
                        <div class="gddp-form-field">
                            <label for="mailComposeSubject">主题</label>
                            <input
                                id="mailComposeSubject"
                                v-model="composeForm.subject"
                                class="gddp-input"
                                type="text"
                                maxlength="200"
                                placeholder="邮件主题"
                            >
                        </div>
                        <div class="gddp-form-field">
                            <label for="mailComposeContent">正文</label>
                            <textarea
                                id="mailComposeContent"
                                v-model="composeForm.content"
                                class="gddp-input mail-compose-content"
                                placeholder="输入邮件内容..."
                            ></textarea>
                        </div>
                        <div class="mail-compose-actions">
                            <label class="mail-compose-html-toggle">
                                <input v-model="composeForm.isHtml" type="checkbox">
                                以 HTML 发送
                            </label>
                            <div class="mail-compose-btn-row">
                                <button class="btn-cancel" type="button" @click="closeCompose">取消</button>
                                <button class="btn-confirm" type="button" :disabled="sending" @click="submitCompose">
                                    {{ sending ? '发送中...' : '发送' }}
                                </button>
                            </div>
                        </div>
                    </div>
                </template>

                <!-- 阅读态:整页替换列表(返回 / 删除与原版一致) -->
                <template v-else-if="mailStore.activeMail">
                    <div class="mail-reader-head">
                        <Button
                            variant="secondary"
                            size="icon"
                            icon="fa-solid fa-arrow-left"
                            title="返回列表"
                            aria-label="返回列表"
                            @click="mailStore.closeMail()"
                        />
                        <Button
                            variant="secondary"
                            size="icon"
                            icon="fa-solid fa-trash-can"
                            title="删除邮件"
                            aria-label="删除邮件"
                            @click="removeActive"
                        />
                    </div>

                    <h2 class="mail-reader-title">{{ mailSubject(mailStore.activeMail) }}</h2>
                    <div class="mail-reader-meta">
                        <span :title="senderAddress(mailStore.activeMail)">
                            <i class="fa-regular fa-user" aria-hidden="true"></i>{{ senderAddress(mailStore.activeMail) }}
                        </span>
                        <span>
                            <i class="fa-regular fa-clock" aria-hidden="true"></i>{{ formatMailTime(mailStore.activeMail.timestamp) }}
                        </span>
                        <span :title="recipientAddress(mailStore.activeMail)">
                            <i class="fa-regular fa-envelope" aria-hidden="true"></i>{{ recipientAddress(mailStore.activeMail) }}
                        </span>
                    </div>

                    <div class="mail-reader-body">
                        <iframe
                            v-if="activeHtmlBody"
                            class="mail-html-frame"
                            title="mail-html"
                            sandbox="allow-popups allow-popups-to-escape-sandbox"
                            :srcdoc="activeHtmlBody"
                        ></iframe>
                        <pre v-else-if="activeTextBody" class="mail-raw-content">{{ activeTextBody }}</pre>
                        <div v-else class="mail-empty-state">邮件内容为空</div>
                    </div>
                </template>

                <!-- 列表态 -->
                <template v-else>
                    <div class="mail-folder-tabs">
                        <button
                            type="button"
                            class="mail-folder-tab"
                            :class="{ active: mailStore.folder === 'inbox' }"
                            @click="switchFolder('inbox')"
                        >收件箱
                            <span class="mail-folder-count" :class="{ muted: mailStore.inboxTotal <= 0 }">{{ folderCountText(mailStore.inboxTotal) }}</span>
                        </button>
                        <button
                            type="button"
                            class="mail-folder-tab"
                            :class="{ active: mailStore.folder === 'unread' }"
                            @click="switchFolder('unread')"
                        >未读
                            <span class="mail-folder-count" :class="{ muted: mailStore.unreadTotal <= 0 }">{{ folderCountText(mailStore.unreadTotal) }}</span>
                        </button>
                        <button
                            type="button"
                            class="mail-folder-tab"
                            :class="{ active: mailStore.folder === 'sent' }"
                            @click="switchFolder('sent')"
                        >已发送
                            <span class="mail-folder-count" :class="{ muted: mailStore.sentTotal <= 0 }">{{ folderCountText(mailStore.sentTotal) }}</span>
                        </button>
                    </div>

                    <div v-if="mailStore.loadingList" class="mail-center-empty">加载中...</div>
                    <div v-else-if="!mailStore.items.length" class="mail-center-empty">
                        {{ emptyText }}
                    </div>
                    <template v-else>
                        <div class="mail-list">
                            <button
                                v-for="item in mailStore.items"
                                :key="item.id"
                                type="button"
                                class="mail-list-item"
                                :class="{ 'is-unread': isUnread(item) }"
                                :title="mailSubject(item)"
                                @click="openMail(item)"
                            >
                                <!-- 未读红点:仅收件箱未读显示(对齐原版,已读/发件箱无点) -->
                                <span
                                    v-if="isUnread(item)"
                                    class="mail-unread-dot"
                                    title="未读"
                                    aria-hidden="true"
                                ></span>
                                <span class="mail-list-main">
                                    <span class="mail-list-row-top">
                                        <span class="mail-list-party">{{ folderPartyLabel(item) }}</span>
                                        <span class="mail-list-time">{{ formatMailTime(item.timestamp) }}</span>
                                    </span>
                                    <span class="mail-list-subject">{{ mailSubject(item) }}</span>
                                    <span v-if="item.preview_text" class="mail-list-preview">{{ item.preview_text }}</span>
                                </span>
                                <span
                                    class="mail-list-delete"
                                    role="button"
                                    tabindex="0"
                                    title="删除邮件"
                                    aria-label="删除邮件"
                                    @click.stop="removeItem(item)"
                                    @keydown.enter.stop.prevent="removeItem(item)"
                                >
                                    <i class="fa-solid fa-trash-can" aria-hidden="true"></i>
                                </span>
                            </button>
                        </div>

                        <!-- 分页条(对齐原版 renderMailPagination:上一页/窗口页码/下一页,单页隐藏) -->
                        <nav v-if="mailStore.totalPages > 1" class="mail-pagination" aria-label="分页">
                            <button
                                type="button"
                                class="mail-page-btn"
                                :disabled="mailStore.page <= 1"
                                @click="goToPage(mailStore.page - 1)"
                            >上一页</button>

                            <button
                                v-if="pageWindow.start > 1"
                                type="button"
                                class="mail-page-btn"
                                @click="goToPage(1)"
                            >1</button>
                            <span v-if="pageWindow.start > 2" class="mail-page-ellipsis">…</span>

                            <button
                                v-for="p in pageWindow.range"
                                :key="p"
                                type="button"
                                class="mail-page-btn"
                                :class="{ active: p === mailStore.page }"
                                @click="goToPage(p)"
                            >{{ p }}</button>

                            <span v-if="pageWindow.end < mailStore.totalPages - 1" class="mail-page-ellipsis">…</span>
                            <button
                                v-if="pageWindow.end < mailStore.totalPages"
                                type="button"
                                class="mail-page-btn"
                                @click="goToPage(mailStore.totalPages)"
                            >{{ mailStore.totalPages }}</button>

                            <button
                                type="button"
                                class="mail-page-btn"
                                :disabled="mailStore.page >= mailStore.totalPages"
                                @click="goToPage(mailStore.page + 1)"
                            >下一页</button>
                        </nav>
                    </template>
                </template>
            </template>
        </div>
    </section>
</template>

<script setup lang="ts">
    import { computed, reactive, ref, watch } from 'vue'

    import type { MailListItem } from '@/api/mail'
    import { showConfirm } from '@/stores/confirm'
    import { showError, showToast } from '@/stores/notify'
    import { useMailStore, type MailViewFolder } from '@/stores/mail'

    import Button from '@/ui/Button.vue'

    const props = defineProps<{
        open: boolean
    }>()

    const mailStore = useMailStore()

    const searchInput = ref('')
    const statusLoading = ref(false)
    const statusError = ref('')

    /** 写信视图状态(独立整页,对齐原版 compose 模式) */
    const composeOpen = ref(false)
    const sending = ref(false)
    const composeForm = reactive({
        to: '',
        subject: '',
        content: '',
        isHtml: false,
    })

    /** 打开时加载一次(v-show 常驻挂载,需 watch 触发首次加载;immediate 覆盖打开即默认视图的场景) */
    watch(
        () => props.open,
        (opened) => {
            mailStore.viewVisible = opened

            if (opened) {
                void prepare()
            }
        },
        { immediate: true }
    )

    /** 进入面板:状态未就绪则补拉并向用户报错,随后加载文件夹列表 */
    async function prepare(): Promise<void> {
        if (!mailStore.statusLoaded && !statusLoading.value) {
            statusLoading.value = true
            statusError.value = ''

            try {
                await mailStore.loadStatus()
            } catch (statusError_) {
                statusError.value = statusError_ instanceof Error ? statusError_.message : '邮件状态读取失败'

                return
            } finally {
                statusLoading.value = false
            }
        }

        if (!mailStore.mailAvailable || (mailStore.items.length > 0 && !mailStore.query)) {
            return
        }

        try {
            await mailStore.loadList()
        } catch (loadError) {
            showError(loadError instanceof Error ? loadError.message : '邮件列表读取失败')
        }
    }

    /** 分页窗口:当前页 ±2,配合首尾页与省略号(对齐原版 renderMailPagination) */
    const pageWindow = computed(() => {
        const current = mailStore.page
        const totalPages = mailStore.totalPages
        const start = Math.max(1, current - 2)
        const end = Math.min(totalPages, current + 2)
        const range: number[] = []

        for (let p = start; p <= end; p += 1) {
            range.push(p)
        }

        return { start, end, range }
    })

    /** tab 计数文本(>99 显示 99+,0 显示 0) */
    function folderCountText(count: number): string {
        return count > 99 ? '99+' : String(Math.max(0, count))
    }

    /** 跳转页码 */
    function goToPage(page: number): void {
        void mailStore.setPage(page).catch((pageError) => {
            showError(pageError instanceof Error ? pageError.message : '翻页失败')
        })
    }

    /** 刷新:徽标 + 当前列表 */
    async function refresh(): Promise<void> {
        try {
            await Promise.all([
                mailStore.refreshBadge(),
                mailStore.loadList(),
            ])
        } catch (refreshError) {
            showError(refreshError instanceof Error ? refreshError.message : '刷新失败')
        }
    }

    function switchFolder(folder: MailViewFolder): void {
        void mailStore.setFolder(folder).catch((folderError) => {
            showError(folderError instanceof Error ? folderError.message : '切换文件夹失败')
        })
    }

    function submitSearch(): void {
        void mailStore.search(searchInput.value).catch((searchError) => {
            showError(searchError instanceof Error ? searchError.message : '搜索失败')
        })
    }

    async function openMail(item: MailListItem): Promise<void> {
        try {
            await mailStore.openMail(item.id)
        } catch (openError) {
            showError(openError instanceof Error ? openError.message : '读取邮件失败')
        }
    }

    /** 删除列表项(带确认) */
    async function removeItem(item: MailListItem): Promise<void> {
        const confirmed = await confirmDelete(mailSubject(item))

        if (!confirmed) {
            return
        }

        try {
            await mailStore.removeMail(item.id)

            showToast('邮件已删除', 'success')
        } catch (deleteError) {
            showError(deleteError instanceof Error ? deleteError.message : '删除失败')
        }
    }

    /** 删除正在阅读的邮件 */
    async function removeActive(): Promise<void> {
        const active = mailStore.activeMail

        if (!active) {
            return
        }

        await removeItem(active)
    }

    function confirmDelete(subject: string): Promise<boolean> {
        return showConfirm({
            title: '删除邮件',
            content: `确定删除邮件「${subject}」吗?`,
            confirmText: '删除',
            cancelText: '取消',
            danger: true,
        })
    }

    /** 打开写信弹窗(可预填收件人) */
    function openCompose(recipient = ''): void {
        composeForm.to = recipient
        composeForm.subject = ''
        composeForm.content = ''
        composeOpen.value = true
    }

    function closeCompose(): void {
        composeOpen.value = false
    }

    /** 发送邮件(校验收件人与正文非空) */
    async function submitCompose(): Promise<void> {
        const to = composeForm.to.trim()
        const subject = composeForm.subject.trim()
        const content = composeForm.content

        if (!to) {
            showToast('请填写收件人邮箱', 'warning')

            return
        }

        if (!content.trim()) {
            showToast('请填写邮件正文', 'warning')

            return
        }

        sending.value = true

        try {
            await mailStore.sendMessage({
                recipient: to,
                subject: subject || '(无主题)',
                content,
                isHtml: composeForm.isHtml,
            })

            showToast('邮件已发送', 'success')
            closeCompose()

            // 发送后回到列表态(若停留在发件箱,store 已静默刷新)
            mailStore.closeMail()
        } catch (sendError) {
            showError(sendError instanceof Error ? sendError.message : '发送失败')
        } finally {
            sending.value = false
        }
    }

    // ─── 展示辅助 ───

    /** 空态文案(区分未读文件夹,对齐原版) */
    const emptyText = computed(() => {
        if (mailStore.query) {
            return '没有匹配的邮件'
        }

        if (mailStore.folder === 'unread') {
            return '暂无未读邮件'
        }

        return mailStore.folder === 'sent' ? '暂无发件记录' : '暂无邮件'
    })

    /** 是否未读(收件箱与未读视图显示红点;发件箱无已读语义) */
    function isUnread(item: MailListItem): boolean {
        return mailStore.folder !== 'sent' && !item.is_read
    }

    /** 无主题兜底文案 */
    function mailSubject(item: MailListItem): string {
        const subject = String(item.subject || '').trim()

        return subject || '(无主题)'
    }

    /** 列表主身份:收件箱显示发件人,发件箱显示收件人 */
    function folderPartyLabel(item: MailListItem): string {
        return compactAddress(mailStore.folder === 'inbox' ? item.sender : item.recipient)
    }

    /** 详情页发件人(压缩为纯地址) */
    function senderAddress(item: MailListItem): string {
        return compactAddress(item.sender)
    }

    /** 详情页收件人(压缩为纯地址) */
    function recipientAddress(item: MailListItem): string {
        return compactAddress(item.recipient)
    }

    /** 地址压缩:去掉显示名,仅保留 <> 内的邮箱部分(如 "Zhang" <z@x.com> → z@x.com) */
    function compactAddress(raw: unknown): string {
        const text = String(raw || '').trim()

        if (!text) {
            return '(未知)'
        }

        const angled = text.match(/<([^>]+)>/)

        return (angled ? angled[1] : text.split(',')[0]).trim() || text
    }

    /** 时间格式化:今天/昨天用相对描述,其余按日期 */
    function formatMailTime(timestamp: number): string {
        const timeMs = Number(timestamp || 0) * 1000

        if (!timeMs) {
            return ''
        }

        const date = new Date(timeMs)

        if (Number.isNaN(date.getTime())) {
            return ''
        }

        const now = new Date()
        const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
        const diffDays = Math.floor((startOfToday - new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()) / 86400000)
        const hhmm = `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`

        if (diffDays <= 0) {
            return hhmm
        }

        if (diffDays === 1) {
            return `昨天 ${hhmm}`
        }

        const sameYear = date.getFullYear() === now.getFullYear()

        return sameYear
            ? `${date.getMonth() + 1}月${date.getDate()}日`
            : `${date.getFullYear()}/${date.getMonth() + 1}/${date.getDate()}`
    }

    /** 阅读态正文:html 经沙箱 iframe 渲染,text 直接展示(对齐原版 renderMailDetail) */
    const activeHtmlBody = computed(() => String(mailStore.activeMail?.content_html || '').trim())
    const activeTextBody = computed(() => String(mailStore.activeMail?.content_text || '').trim())

    /** 顶栏返回键联动:写信/阅读态先回列表,列表态才关闭整个视图(与 Workspaces 详情同构) */
    defineExpose({
        isInDetail: () => !!mailStore.activeMail || composeOpen.value,
        backToList: () => {
            composeOpen.value = false
            mailStore.closeMail()
        },
    })
</script>
