/// <reference types="vite/client" />

declare module '*.vue' {
    import type { DefineComponent } from 'vue'

    const component: DefineComponent<{}, {}, any>

    export default component
}
interface ToastUiEditorInstance {
    getMarkdown(): string
    setMarkdown(markdown: string): void
    getSelectedText(): string
    insertText(text: string): void
    replaceSelection(text: string): void
    exec(name: string, payload?: Record<string, unknown>): unknown
    changePreviewStyle(style: 'vertical' | 'tab'): void
    getEditorElements(): { mdPreview?: HTMLElement } | null
    destroy(): void
}

interface ToastUiEditorConstructor {
    new (options: Record<string, unknown>): ToastUiEditorInstance
}

interface Window {
    toastui: {
        Editor: ToastUiEditorConstructor
    }
}
