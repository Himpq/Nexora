/**
 * mail.ts — 邮件状态
 *
 * 职责:
 *   - 绑定状态 / 顶栏红点 / 文件夹列表(分页) / 阅读详情的唯一数据源
 *   - HTTP 拉取与 WSS mail_changed 推送双入口
 *
 * 红点口径(对齐原版 chat_mails.js mailNotifyState):
 *   - 红点计数 = 上次打开邮件面板之后新到达的邮件数(非未读总数)
 *   - lastOpenTs 持久化到 localStorage(nexora_mail_last_open_ts,与原版同键);
 *     首次使用时以当前最新邮件时间戳为基线,不追溯历史
 *   - 面板可见期间的任何列表刷新都会推进基线并清零(对齐原版 markChecked)
 *
 * 分页口径(对齐原版):
 *   - pageSize=20;offset=(page-1)*pageSize;total 以服务端返回为准
 *   - 当前页为空但 total>0 且 page>1 时自动回退一页重载
 */

import { defineStore } from 'pinia'

import type { MailDetail, MailFolder, MailListItem } from '@/api/mail'
import { deleteMail, fetchMailDetail, fetchMailStatus, listMail, markMailRead, sendMail } from '@/api/mail'

/** 列表单页条数 */
const MAIL_PAGE_SIZE = 8

/** 未读文件夹累积收件箱的最大页数(对齐原版 MAX_FETCH_PAGES,防御上游异常时的死循环) */
const MAX_UNREAD_FETCH_PAGES = 50

/** 红点基线持久化键(与原版 MAIL_LAST_OPEN_TS_KEY 同键,迁移兼容) */
const MAIL_LAST_OPEN_TS_KEY = 'nexora_mail_last_open_ts'

/** 徽标刷新拉取的收件箱条数(对齐原版 refreshMailNotifyBadgeFromServer 的 limit=20) */
const BADGE_FETCH_LIMIT = 20

/** 视图文件夹:未读为客户端筛选视图,数据源是收件箱(对齐原版 folder 三态) */
export type MailViewFolder = 'inbox' | 'unread' | 'sent'

/** 视图文件夹 → API 文件夹(未读视图读写都落在收件箱) */
function toApiFolder(folder: MailViewFolder): MailFolder {
    return folder === 'sent' ? 'sent' : 'inbox'
}

/** 列表请求序号:静默同步与用户刷新并发时,仅最新一次请求的结果生效 */
let listRequestSerial = 0

function loadLastOpenTs(): number {
    try {
        const value = Number(localStorage.getItem(MAIL_LAST_OPEN_TS_KEY) || 0)

        return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0
    } catch {
        return 0
    }
}

function saveLastOpenTs(timestamp: number): void {
    try {
        localStorage.setItem(MAIL_LAST_OPEN_TS_KEY, String(Math.max(0, Math.floor(timestamp))))
    } catch {
        // localStorage 不可用时红点退化为会话内状态,不影响主流程
    }
}

interface MailState {
    /** 绑定状态是否已加载(init 后为 true,失败时保持 false 以便下次重试) */
    statusLoaded: boolean
    enabled: boolean
    linked: boolean
    senderAddress: string
    /** 视图文件夹(未读为收件箱的客户端筛选视图) */
    folder: MailViewFolder
    /** 已生效的搜索关键字(输入框回车后写入) */
    query: string
    page: number
    items: MailListItem[]
    /** 当前文件夹总数(inbox/sent 为服务端 total;unread 为累积未读数) */
    total: number
    /** 收件箱总数(tab 徽标用;徽标/列表接口都会刷新) */
    inboxTotal: number
    sentTotal: number
    unreadTotal: number
    /** 未读文件夹的完整未读列表(跨页累积,按当前页切片展示;对齐原版 unreadMails) */
    unreadMails: MailListItem[]
    loadingList: boolean
    activeMail: MailDetail | null
    detailLoading: boolean
    /** 面板是否可见(可见期间列表刷新会推进红点基线) */
    viewVisible: boolean
    /** 列表是否已成功加载过(WSS 推送时决定是否静默同步) */
    listLoaded: boolean
    /** 顶栏红点:上次打开面板后新到的邮件数 */
    newCount: number
    lastOpenTs: number
}

export const useMailStore = defineStore('mail', {
    state: (): MailState => ({
        statusLoaded: false,
        enabled: false,
        linked: false,
        senderAddress: '',
        folder: 'inbox',
        query: '',
        page: 1,
        items: [],
        total: 0,
        inboxTotal: 0,
        sentTotal: 0,
        unreadTotal: 0,
        unreadMails: [],
        loadingList: false,
        activeMail: null,
        detailLoading: false,
        viewVisible: false,
        listLoaded: false,
        newCount: 0,
        lastOpenTs: loadLastOpenTs(),
    }),

    getters: {
        /** 邮件功能可用:NexoraMail 已启用且当前用户已绑定邮箱 */
        mailAvailable(state): boolean {
            return state.enabled && state.linked
        },

        /** 总页数(分页条渲染用) */
        totalPages(state): number {
            return Math.max(1, Math.ceil(state.total / MAIL_PAGE_SIZE))
        },
    },

    actions: {
        /** 应用初始化:加载绑定状态 + 红点(失败仅告警,不打扰用户;打开面板时会重试) */
        async init(): Promise<void> {
            try {
                await this.loadStatus()

                if (this.mailAvailable) {
                    await this.refreshBadge()
                }
            } catch (initError) {
                console.warn('[mail] 初始化邮件状态失败', initError)
            }
        },

        /** 加载绑定状态(statusLoaded 保持 false 时,打开面板会再次尝试并向用户报错) */
        async loadStatus(): Promise<void> {
            const status = await fetchMailStatus()

            this.enabled = status.enabled
            this.linked = status.linked
            this.senderAddress = status.senderAddress
            this.statusLoaded = true
        },

        /**
         * 刷新顶栏红点与 tab 计数(对齐原版 refreshMailNotifyBadgeFromServer):
         * 强制走上游(cache_mode=refresh)拉收件箱前 20 条统计新邮件;
         * 并行取发件箱总数,保证"已发送"tab 徽标不切换文件夹也能显示。
         */
        async refreshBadge(): Promise<void> {
            if (!this.mailAvailable) {
                return
            }

            const [inboxResult, sentResult] = await Promise.all([
                listMail('inbox', { offset: 0, limit: BADGE_FETCH_LIMIT }),
                listMail('sent', { offset: 0, limit: 1 }),
            ])

            this.inboxTotal = inboxResult.total
            this.unreadTotal = inboxResult.unreadTotal
            this.sentTotal = sentResult.total

            const maxTs = inboxResult.mails.reduce((max, item) => Math.max(max, item.timestamp), 0)

            if (!this.lastOpenTs) {
                // 首次初始化:以当前最新邮件为基线,不追溯历史(对齐原版)
                this.lastOpenTs = maxTs > 0 ? maxTs : Math.floor(Date.now() / 1000)
                saveLastOpenTs(this.lastOpenTs)
                this.newCount = 0

                return
            }

            this.newCount = inboxResult.mails.filter((item) => item.timestamp > this.lastOpenTs).length
        },

        /** 面板可见时推进红点基线并清零(对齐原版 updateMailNotifyFromMails markChecked) */
        markOpened(): void {
            const maxTs = this.items.reduce((max, item) => Math.max(max, item.timestamp), 0)

            this.lastOpenTs = maxTs > 0 ? maxTs : Math.floor(Date.now() / 1000)
            saveLastOpenTs(this.lastOpenTs)
            this.newCount = 0
        },

        /**
         * 拉取当前文件夹列表(分页)
         *
         * @param options.silent 静默模式(WSS 推送触发的后台同步:不进入加载态,旧列表保持展示)
         */
        async loadList(options: { silent?: boolean } = {}): Promise<void> {
            if (!this.mailAvailable || this.loadingList) {
                return
            }

            if (this.folder === 'unread') {
                await this.loadUnreadList(options)

                return
            }

            const serial = ++listRequestSerial

            if (!options.silent) {
                this.loadingList = true
            }

            try {
                const offset = (Math.max(1, this.page) - 1) * MAIL_PAGE_SIZE
                const result = await listMail(this.folder, { q: this.query, offset, limit: MAIL_PAGE_SIZE })

                // 并发场景下仅应用最新请求结果,避免慢响应覆盖新数据
                if (serial !== listRequestSerial) {
                    return
                }

                this.total = result.total

                if (this.folder === 'inbox') {
                    this.inboxTotal = result.total
                    this.unreadTotal = result.unreadTotal
                } else {
                    this.sentTotal = result.total
                }

                // 当前页越界(如他端删除导致总数变少):回退一页重载(对齐原版)
                if (!result.mails.length && result.total > 0 && this.page > 1) {
                    this.page -= 1

                    await this.loadList(options)

                    return
                }

                this.items = result.mails
                this.listLoaded = true

                // 面板可见期间数据即为已读基准,推进红点基线(对齐原版 markChecked)
                if (this.viewVisible) {
                    this.markOpened()
                }
            } finally {
                if (!options.silent) {
                    this.loadingList = false
                }
            }
        },

        /**
         * 未读文件夹加载:分页累积收件箱中的全部未读,再按当前页切片。
         * 未读邮件可能分布在收件箱任意页,只筛当前页会漏(对齐原版 loadMailUnread)。
         */
        async loadUnreadList(options: { silent?: boolean } = {}): Promise<void> {
            const serial = ++listRequestSerial

            if (!options.silent) {
                this.loadingList = true
            }

            try {
                const accumulated: MailListItem[] = []
                let offset = 0
                let fetchCount = 0

                while (fetchCount < MAX_UNREAD_FETCH_PAGES) {
                    const result = await listMail('inbox', { q: this.query, offset, limit: MAIL_PAGE_SIZE })

                    if (serial !== listRequestSerial) {
                        return
                    }

                    for (const item of result.mails) {
                        if (!item.is_read) {
                            accumulated.push(item)
                        }
                    }

                    this.unreadTotal = Math.max(this.unreadTotal, accumulated.length)

                    const nextOffset = offset + Math.max(result.mails.length, MAIL_PAGE_SIZE)

                    if (nextOffset >= result.total || !result.mails.length) {
                        break
                    }

                    offset = nextOffset
                    fetchCount += 1
                }

                if (serial !== listRequestSerial) {
                    return
                }

                this.unreadMails = accumulated
                this.total = accumulated.length

                // 页码越界时收敛到最后一页(对齐原版)
                const totalPages = Math.max(1, Math.ceil(accumulated.length / MAIL_PAGE_SIZE))

                if (this.page > totalPages) {
                    this.page = totalPages
                }

                this.items = accumulated.slice((this.page - 1) * MAIL_PAGE_SIZE, this.page * MAIL_PAGE_SIZE)
                this.listLoaded = true

                if (this.viewVisible) {
                    this.markOpened()
                }
            } finally {
                if (!options.silent) {
                    this.loadingList = false
                }
            }
        },

        /** 切换文件夹并回到第一页 */
        async setFolder(folder: MailViewFolder): Promise<void> {
            this.closeMail()

            // 同文件夹重复点击:仅退出阅读态,不重复拉取
            if (this.folder === folder && this.listLoaded) {
                return
            }

            this.folder = folder
            this.page = 1

            await this.loadList()
        },

        /** 跳转页码(分页条) */
        async setPage(page: number): Promise<void> {
            const target = Math.min(Math.max(1, Math.floor(page)), this.totalPages)

            if (target === this.page) {
                return
            }

            this.page = target
            this.closeMail()

            await this.loadList()
        },

        /** 搜索(服务端 q 过滤),回车触发;搜索总是回到第一页 */
        async search(query: string): Promise<void> {
            this.query = String(query || '').trim()
            this.page = 1
            this.closeMail()

            await this.loadList()
        },

        /** 打开邮件:拉取正文;收件箱未读时标记已读并同步本地计数 */
        async openMail(mailId: string): Promise<void> {
            if (this.detailLoading) {
                return
            }

            this.detailLoading = true

            try {
                const detail = await fetchMailDetail(toApiFolder(this.folder), mailId)

                this.activeMail = detail

                const listItem = this.items.find((row) => row.id === mailId)

                if (this.folder !== 'sent' && listItem && !listItem.is_read) {
                    const confirmed = await markMailRead(mailId, true)

                    listItem.is_read = confirmed

                    if (confirmed) {
                        if (this.unreadTotal > 0) {
                            this.unreadTotal -= 1
                        }

                        // 未读视图内就地移除该邮件并收敛当前页(对齐"读后即出未读列表")
                        if (this.folder === 'unread') {
                            this.unreadMails = this.unreadMails.filter((row) => row.id !== mailId)
                            this.total = this.unreadMails.length
                            await this.setPage(this.page)
                        }
                    }
                }
            } finally {
                this.detailLoading = false
            }
        },

        /** 关闭阅读视图,回到列表 */
        closeMail(): void {
            this.activeMail = null
        },

        /** 删除当前文件夹中的邮件(确认交互由视图层负责) */
        async removeMail(mailId: string): Promise<void> {
            const target = this.items.find((row) => row.id === mailId)

            await deleteMail(toApiFolder(this.folder), mailId)

            this.items = this.items.filter((row) => row.id !== mailId)
            this.total = Math.max(0, this.total - 1)

            if (this.folder === 'sent') {
                this.sentTotal = Math.max(0, this.sentTotal - 1)
            } else {
                this.inboxTotal = Math.max(0, this.inboxTotal - 1)

                if (target && !target.is_read && this.unreadTotal > 0) {
                    this.unreadTotal -= 1
                }

                if (this.folder === 'unread') {
                    this.unreadMails = this.unreadMails.filter((row) => row.id !== mailId)
                    this.total = this.unreadMails.length
                }
            }

            if (this.activeMail?.id === mailId) {
                this.closeMail()
            }

            await this.refreshBadge()
        },

        /** 发送邮件;成功后若停留在发件箱则静默刷新列表 */
        async sendMessage(options: { recipient: string; subject: string; content: string; isHtml?: boolean }): Promise<void> {
            await sendMail(options)

            if (this.folder === 'sent') {
                await this.loadList({ silent: true })
            }
        },

        /**
         * WSS mail_changed 入口:新邮件/状态变更推送。
         * 红点始终刷新;列表已加载过时静默同步,保证面板内容与服务端一致。
         */
        handleRemoteChange(): void {
            if (!this.mailAvailable) {
                return
            }

            void this.refreshBadge()

            if (this.listLoaded) {
                void this.loadList({ silent: true })
            }
        },
    },
})
