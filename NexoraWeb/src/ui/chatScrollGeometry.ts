export const CHAT_SCROLL_BOTTOM_THRESHOLD = 80
export const CHAT_SCROLL_RESTORING_ATTRIBUTE = 'data-tool-stage-scroll-restoring'
export const CHAT_SCROLL_LAYOUT_READY_EVENT = 'nexora:chat-scroll-layout-ready'

/** 隐藏时尺寸为零；布局恢复中的程序化滚动也不能当作用户阅读操作。 */
export function isChatScrollLayoutReady(container: HTMLElement): boolean {
    return container.clientWidth > 0 && container.clientHeight > 0
        && !container.hasAttribute(CHAT_SCROLL_RESTORING_ATTRIBUTE)
}

export interface ChatScrollViewport {
    top: number
    scrollTop: number
    height: number
}

export function readChatScrollViewport(container: HTMLElement): ChatScrollViewport {
    return {
        top: container.getBoundingClientRect().top + container.clientTop,
        scrollTop: container.scrollTop,
        height: container.clientHeight,
    }
}

/** 转为消息滚动区自身的坐标，不依赖正常界面与浮窗不同的 offsetParent。 */
export function readChatScrollElementBounds(viewport: ChatScrollViewport, element: HTMLElement): { top: number, height: number } {
    const bounds = element.getBoundingClientRect()

    return { top: bounds.top - viewport.top + viewport.scrollTop, height: bounds.height }
}

export function getChatScrollCenterTarget(container: HTMLElement, element: HTMLElement): number {
    const viewport = readChatScrollViewport(container)
    const bounds = readChatScrollElementBounds(viewport, element)

    return Math.max(0, bounds.top + bounds.height / 2 - viewport.height / 2)
}

/** 记录内的正文最小单位：段落、标题、列表项、引用、代码块、表格行、图片和分隔线。 */
const CHAT_READING_BLOCK_SELECTOR = 'p, h1, h2, h3, h4, h5, h6, li, pre, blockquote, tr, img, hr'

export interface ChatReadingAnchor {
    /** 阅读位置所属记录，形态切换前后始终是同一个节点。 */
    record: HTMLElement
    /** 记录内正文块的阅读序号，-1 表示这条记录以自身为阅读单位。 */
    blockIndex: number
    /** 阅读单位顶部到视口顶部的距离，重排完成后保持不变。 */
    offset: number
}

/**
 * 只保留可见且不含其他正文块的叶子节点。
 * 收起的外层容器(如整条长回复的正文段)会把全部重排误差一起带进锚点，
 * 而 display:none 的收起块不参与阅读顺序，两者都必须排除。
 */
export function readChatReadingBlocks(record: HTMLElement): HTMLElement[] {
    return [...record.querySelectorAll<HTMLElement>(CHAT_READING_BLOCK_SELECTOR)]
        .filter((block) => block.getBoundingClientRect().height > 0 && !block.querySelector(CHAT_READING_BLOCK_SELECTOR))
}

/**
 * 视口顶边所在的阅读单位。
 * 浮窗宽度和普通聊天不同，同一条长回复换行后整体变高或变矮，只锚定记录顶部
 * 会让正在读的段落滚出视口，因此锚点必须下沉到记录内压住视口顶边的那段正文。
 */
export function readChatReadingAnchor(records: HTMLElement[], viewport: ChatScrollViewport): ChatReadingAnchor | null {
    const record = records.find((element) => element.getBoundingClientRect().bottom > viewport.top)

    if (!record) {
        return null
    }

    const blocks = readChatReadingBlocks(record)
    const blockIndex = blocks.findIndex((block) => block.getBoundingClientRect().bottom > viewport.top)

    // 顶边落在记录内的空白处时没有正文块可锚定，阅读单位就是这条记录本身。
    const unit = blocks[blockIndex] ?? record

    return { record, blockIndex, offset: unit.getBoundingClientRect().top - viewport.top }
}

/**
 * 重排完成后取回同一个正文块。
 * 记录节点由会话保持稳定，隐藏期间的流式重渲染只会在记录末尾追加正文块，
 * 因此序号在恢复时仍然指向同一段；记录内已无该正文块时阅读单位就是记录本身。
 */
export function resolveChatReadingAnchor(anchor: ChatReadingAnchor): HTMLElement {
    return readChatReadingBlocks(anchor.record)[anchor.blockIndex] ?? anchor.record
}
