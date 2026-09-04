/**
 * viewport.ts — 视口断点与移动端抽屉(General Design Development Package 基础模块)
 *
 * 职责:
 *   - 移动端断点在 JS 侧的单一来源(与样式 max-width: 980px 同源,改动需同步 css)
 *   - 移动端侧栏抽屉(body.mobile-sidebar-open)开关的统一出入口;
 *     桌面端侧栏常驻,该类无意义,收起调用在非移动端自动空转,
 *     调用方无需再判端,桌面行为天然不受影响。
 */

/** 移动端断点查询(与样式媒体查询 max-width: 980px 同源) */
export const MOBILE_BREAKPOINT_QUERY = '(max-width: 980px)'

/** 是否处于移动端视口 */
export function isMobileViewport(): boolean {
    return window.matchMedia(MOBILE_BREAKPOINT_QUERY).matches
}

/** 移动端抽屉是否展开 */
export function isMobileSidebarOpen(): boolean {
    return document.body.classList.contains('mobile-sidebar-open')
}

/** 收起移动端抽屉;桌面端或已收起时空转 */
export function collapseMobileSidebar(): void {
    if (isMobileViewport() && isMobileSidebarOpen()) {
        document.body.classList.remove('mobile-sidebar-open')
    }
}
