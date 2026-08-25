/** 模型选择器的展示模型,与数据来源解耦。 */
export interface ModelSelectOption {
    id: string
    name: string
    provider: string
    status?: string
    context_window?: number
    providerIconUrl?: string
    providerIconFallback?: string
}
