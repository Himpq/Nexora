/**
 * confirm.ts — 现代确认/输入小窗(General Design Development Package)
 *
 * 职责:
 *   - 基于 modal.css 现代样式渲染确认框与输入框(Modern/Simplify/Interactive)
 *   - 函数式 Promise API,与 Vue 逻辑天然契合
 *   - z-index 读取设计令牌 --z-confirm,禁止硬编码
 *   - 支持 Esc / 点击遮罩 / Enter 提交等交互
 */

export interface ConfirmOptions {
    title: string
    content: string
    confirmText?: string
    cancelText?: string
    danger?: boolean
}

/** 弹窗 z-index:从设计令牌 --z-confirm 读取(单一来源,禁止硬编码) */
function confirmZIndex(): string {
    const raw = getComputedStyle(document.documentElement).getPropertyValue('--z-confirm').trim()

    return raw || '5000'
}

/** 创建遮罩根节点 */
function ensureRoot(): HTMLElement | null {
    let root = document.getElementById('nexora-confirm-root')

    if (!root) {
        root = document.createElement('div')

        root.id = 'nexora-confirm-root'
        document.body.appendChild(root)
    }

    return root
}

/** 打开确认小窗;resolve(true) 表示用户确认 */
export function showConfirm(options: ConfirmOptions): Promise<boolean> {
    return new Promise((resolve) => {
        const root = ensureRoot()

        if (!root) {
            resolve(false)

            return
        }

        const backdrop = document.createElement('div')

        backdrop.className = 'g-modal-backdrop'
        backdrop.style.zIndex = confirmZIndex()

        /** 防重复 settle:确认/取消/遮罩/Esc 多条路径只允许结算一次 */
        let settled = false

        backdrop.innerHTML = `
            <div class="g-modal g-modal-sm" role="dialog" aria-label="${escapeHtml(options.title)}">
                <div class="g-modal-head">
                    <h3>${escapeHtml(options.title)}</h3>
                    <button type="button" class="g-modal-close" aria-label="关闭">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <line x1="18" y1="6" x2="6" y2="18"></line>
                            <line x1="6" y1="6" x2="18" y2="18"></line>
                        </svg>
                    </button>
                </div>
                <div class="g-modal-body">${escapeHtml(options.content)}</div>
                <div class="g-modal-footer">
                    <button type="button" class="g-btn g-btn-ghost" data-action="cancel">${escapeHtml(options.cancelText || '取消')}</button>
                    <button type="button" class="g-btn ${options.danger ? 'g-btn-danger' : 'g-btn-primary'}" data-action="confirm">${escapeHtml(options.confirmText || '确定')}</button>
                </div>
            </div>
        `

        /** 结算:先播退场动画(leave),结束后移除节点并 resolve */
        function cleanup(result: boolean): void {
            if (settled) {
                return
            }

            settled = true
            document.removeEventListener('keydown', onKeydown)

            backdrop.classList.add('g-modal-leave-active', 'g-modal-leave-to')

            setTimeout(() => {
                backdrop.remove()

                resolve(result)
            }, 200)
        }

        function onKeydown(event: KeyboardEvent): void {
            if (event.key === 'Escape') {
                cleanup(false)
            }
        }

        backdrop.querySelector('[data-action="confirm"]')?.addEventListener('click', () => cleanup(true))
        backdrop.querySelector('[data-action="cancel"]')?.addEventListener('click', () => cleanup(false))
        backdrop.querySelector('.g-modal-close')?.addEventListener('click', () => cleanup(false))
        backdrop.addEventListener('click', (event) => {
            if (event.target === backdrop) {
                cleanup(false)
            }
        })

        document.addEventListener('keydown', onKeydown)

        root.appendChild(backdrop)

        // 入场动画:先置初始态(enter-from),下一帧切换为激活态触发 transition
        backdrop.classList.add('g-modal-enter-from')

        requestAnimationFrame(() => {
            backdrop.classList.remove('g-modal-enter-from')
            backdrop.classList.add('g-modal-enter-active')
        })
    })
}

export interface PromptOptions {
    title: string
    label?: string
    defaultValue?: string
    confirmText?: string
    cancelText?: string
    placeholder?: string
}

/** 打开输入小窗;resolve(输入值) 表示确认,resolve(null) 表示取消 */
export function showPrompt(options: PromptOptions): Promise<string | null> {
    return new Promise((resolve) => {
        const root = ensureRoot()

        if (!root) {
            resolve(null)

            return
        }

        const backdrop = document.createElement('div')

        backdrop.className = 'g-modal-backdrop'
        backdrop.style.zIndex = confirmZIndex()

        /** 防重复 settle:确认/取消/遮罩/Esc 多条路径只允许结算一次 */
        let settled = false

        backdrop.innerHTML = `
            <div class="g-modal g-modal-sm" role="dialog" aria-label="${escapeHtml(options.title)}">
                <div class="g-modal-head">
                    <h3>${escapeHtml(options.title)}</h3>
                    <button type="button" class="g-modal-close" aria-label="关闭">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <line x1="18" y1="6" x2="6" y2="18"></line>
                            <line x1="6" y1="6" x2="18" y2="18"></line>
                        </svg>
                    </button>
                </div>
                <div class="g-modal-body">
                    ${options.label ? `<div style="font-size: 13px; color: #64748b; margin-bottom: 8px;">${escapeHtml(options.label)}</div>` : ''}
                    <input type="text" class="g-input" data-input placeholder="${escapeHtml(options.placeholder || '')}" value="${escapeHtml(options.defaultValue || '')}" />
                </div>
                <div class="g-modal-footer">
                    <button type="button" class="g-btn g-btn-ghost" data-action="cancel">${escapeHtml(options.cancelText || '取消')}</button>
                    <button type="button" class="g-btn g-btn-primary" data-action="confirm">${escapeHtml(options.confirmText || '确定')}</button>
                </div>
            </div>
        `

        const input = backdrop.querySelector('[data-input]') as HTMLInputElement | null

        /** 结算:先播退场动画(leave),结束后移除节点并 resolve */
        function cleanup(result: string | null): void {
            if (settled) {
                return
            }

            settled = true
            document.removeEventListener('keydown', onKeydown)

            backdrop.classList.add('g-modal-leave-active', 'g-modal-leave-to')

            setTimeout(() => {
                backdrop.remove()

                resolve(result)
            }, 200)
        }

        function onKeydown(event: KeyboardEvent): void {
            if (event.key === 'Escape') {
                cleanup(null)
            }
        }

        backdrop.querySelector('[data-action="confirm"]')?.addEventListener('click', () => {
            cleanup(input ? input.value : '')
        })
        backdrop.querySelector('[data-action="cancel"]')?.addEventListener('click', () => cleanup(null))
        backdrop.querySelector('.g-modal-close')?.addEventListener('click', () => cleanup(null))
        backdrop.addEventListener('click', (event) => {
            if (event.target === backdrop) {
                cleanup(null)
            }
        })

        input?.addEventListener('keydown', (event) => {
            if (event.key === 'Enter') {
                cleanup(input.value)
            }

            if (event.key === 'Escape') {
                cleanup(null)
            }
        })

        document.addEventListener('keydown', onKeydown)

        root.appendChild(backdrop)

        // 入场动画:先置初始态(enter-from),下一帧切换为激活态触发 transition
        backdrop.classList.add('g-modal-enter-from')

        requestAnimationFrame(() => {
            backdrop.classList.remove('g-modal-enter-from')
            backdrop.classList.add('g-modal-enter-active')

            input?.focus()
        })
    })
}

/** 基础 HTML 转义,防止内容注入 */
function escapeHtml(text: string): string {
    const div = document.createElement('div')

    div.textContent = text

    return div.innerHTML
}
